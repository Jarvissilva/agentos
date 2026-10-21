import { createHash } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "./files";

export interface EmbeddedCommand {
  command: string;
  args: string[];
  cwd: string;
  // A stable key enables Agy to reconnect to its existing terminal after UI exit.
  persistent?: { database: string; sessionId: string };
}

async function tmux(args: string[], allowFailure = false) {
  const child = Bun.spawn(["tmux", ...args], {
    env: { ...process.env, TMUX: undefined, TMUX_PANE: undefined },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
  });
  const [stdout, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && !allowFailure)
    throw new Error(
      "Agy background terminal is unavailable; inspect tmux installation and permissions",
    );
  return { stdout: stdout.trim(), code };
}

export function persistentTerminal(database: string, sessionId: string) {
  const hash = createHash("sha256").update(database).digest("hex").slice(0, 16);
  const root = join(
    tmpdir(),
    `agentos-pty-${process.getuid?.() ?? "user"}-${hash}`,
  );
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  )
    throw new Error(
      "Agy terminal directory must be private and owned by the current user",
    );
  const config = join(root, "tmux.conf");
  atomicWrite(
    config,
    "set -g status off\nset -g prefix None\nunbind-key -a\nset -g remain-on-exit on\nset -g destroy-unattached off\nset -g exit-empty on\n",
  );
  return {
    prefix: ["-S", join(root, "tmux.sock"), "-f", config],
    name: `session-${createHash("sha256").update(sessionId).digest("hex").slice(0, 24)}`,
  };
}

// Owns only a terminal frontend. Disconnecting never stops provider background
// services; Agy's terminal itself is retained by an isolated tmux server.
export class EmbeddedProcess {
  private child?: Bun.Subprocess;
  private terminal?: Bun.Terminal;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private settled = false;
  private columns: number;
  private rows: number;
  private finish!: (code: number) => void;
  readonly exited: Promise<number>;
  constructor(
    private readonly spec: EmbeddedCommand,
    columns: number,
    rows: number,
    private readonly output: (bytes: Uint8Array) => void,
  ) {
    this.columns = Math.max(1, columns);
    this.rows = Math.max(1, rows);
    this.exited = new Promise((resolve) => {
      this.finish = resolve;
    });
  }
  async start() {
    const setsid = Bun.which("setsid", { PATH: process.env.PATH });
    if (!setsid)
      throw new Error(
        "Embedded provider terminals require setsid from util-linux. Install util-linux and retry.",
      );
    let command = [this.spec.command, ...this.spec.args];
    if (this.spec.persistent) {
      if (!Bun.which("tmux", { PATH: process.env.PATH }))
        throw new Error(
          "Agy embedded tabs require tmux to keep tasks running after agentos exits. Install tmux and retry.",
        );
      const target = persistentTerminal(
        this.spec.persistent.database,
        this.spec.persistent.sessionId,
      );
      const exists = await tmux(
        [...target.prefix, "has-session", "-t", target.name],
        true,
      );
      if (this.closed) return;
      if (exists.code === 0) {
        const state = await tmux([
          ...target.prefix,
          "display-message",
          "-p",
          "-t",
          target.name,
          "#{pane_dead}",
        ]);
        if (state.stdout === "1")
          await tmux([...target.prefix, "kill-session", "-t", target.name]);
      }
      if (
        (await tmux([...target.prefix, "has-session", "-t", target.name], true))
          .code !== 0
      ) {
        if (this.closed) return;
        await tmux([
          ...target.prefix,
          "new-session",
          "-d",
          "-s",
          target.name,
          "-x",
          String(this.columns),
          "-y",
          String(this.rows),
          "-c",
          this.spec.cwd,
          "--",
          ...command,
        ]);
      }
      if (this.closed) return;
      command = ["tmux", ...target.prefix, "attach-session", "-t", target.name];
      let checking = false;
      this.timer = setInterval(() => {
        if (checking || this.closed) return;
        checking = true;
        void tmux(
          [
            ...target.prefix,
            "display-message",
            "-p",
            "-t",
            target.name,
            "#{pane_dead}:#{pane_dead_status}",
          ],
          true,
        )
          .then(async (result) => {
            if (this.closed) return;
            if (result.code !== 0) this.settle(1);
            else if (result.stdout.startsWith("1:")) {
              const status = result.stdout.slice(2);
              const code = /^\d+$/.test(status) ? Number(status) : 130;
              // Remove the dead pane before releasing the database attachment;
              // a reconnect must never race cleanup of the previous terminal.
              await tmux(
                [...target.prefix, "kill-session", "-t", target.name],
                true,
              );
              this.settle(code);
            }
          })
          .catch(() => this.settle(1))
          .finally(() => {
            checking = false;
          });
      }, 500);
    }
    if (this.closed) return;
    try {
      this.terminal = new Bun.Terminal({
        cols: this.columns,
        rows: this.rows,
        name: "xterm-256color",
        data: (_terminal, bytes) => this.output(bytes),
      });
      // A PTY on stdio alone still inherits agentos's controlling terminal.
      // Native TUIs such as Codex open /dev/tty for sizing and raw input; give
      // them their own session and make the embedded PTY its controlling TTY.
      this.child = Bun.spawn([setsid, "--ctty", "--wait", "--", ...command], {
        cwd: this.spec.cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          TMUX: undefined,
          TMUX_PANE: undefined,
        },
        terminal: this.terminal,
      });
      void this.child.exited.then((code) => this.settle(code));
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }
  write(bytes: Uint8Array) {
    if (!this.closed) this.terminal?.write(bytes);
  }
  resize(columns: number, rows: number) {
    const nextColumns = Math.max(1, Math.floor(columns));
    const nextRows = Math.max(1, Math.floor(rows));
    if (nextColumns === this.columns && nextRows === this.rows) return;
    this.columns = nextColumns;
    this.rows = nextRows;
    // The controlling PTY sends SIGWINCH to the provider's foreground process
    // group. Extra manual signals can race native resize handling.
    if (!this.closed) this.terminal?.resize(this.columns, this.rows);
  }
  disconnect() {
    this.settle(0);
  }
  private settle(code: number) {
    if (this.settled) return;
    this.settled = true;
    this.closed = true;
    clearInterval(this.timer);
    // SIGHUP disconnects the frontend. Never signal its process group or daemon.
    if (this.child?.exitCode === null) this.child.kill("SIGHUP");
    this.terminal?.close();
    this.finish(code);
  }
}
