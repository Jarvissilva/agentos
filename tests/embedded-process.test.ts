import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  EmbeddedProcess,
  persistentTerminal,
} from "../src/lib/platform/embedded-process";
import { fixture } from "./helpers";

async function within<T>(
  phase: string,
  operation: Promise<T>,
  timeoutMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out during ${phase} (${timeoutMs}ms)`)),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    throw new Error(`${phase}: ${String(error)}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

async function until(check: () => boolean, phase = "terminal output") {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${phase}`);
    await Bun.sleep(20);
  }
}

test("terminal phase deadlines identify a stalled helper", async () => {
  await expect(
    within("frontend exit", new Promise<never>(() => {}), 10),
  ).rejects.toThrow("Timed out during frontend exit (10ms)");
  await expect(
    within("completed phase", Promise.resolve(9), 100),
  ).resolves.toBe(9);
});

test("embedded PTY forwards input, terminal dimensions, and native exit status", async () => {
  let output = "";
  const child = new EmbeddedProcess(
    {
      command: process.execPath,
      cwd: process.cwd(),
      args: [
        "-e",
        `process.stdin.setRawMode(true);const report=()=>console.log("SIZE:"+require("node:child_process").execFileSync("stty",["size"],{stdio:["inherit","pipe","inherit"]}).toString().trim());report();process.on("SIGWINCH",report);process.stdin.on("data",bytes=>{console.log("INPUT:"+bytes.toString());if(bytes.toString()==="x")process.exit(7)});`,
      ],
    },
    81,
    24,
    (bytes) => {
      output += new TextDecoder().decode(bytes);
    },
  );
  try {
    await child.start();
    await until(() => output.includes("SIZE:24 81"));
    child.resize(92, 31);
    await until(() => output.includes("SIZE:31 92"));
    child.write(new TextEncoder().encode("hello"));
    await until(() => output.includes("INPUT:hello"));
    child.write(new TextEncoder().encode("x"));
    expect(await child.exited).toBe(7);
    child.disconnect(); // idempotent
    expect(await child.exited).toBe(7);
  } finally {
    child.disconnect();
  }
});

test.skipIf(!Bun.which("tmux"))(
  "Agy terminal keeps working after UI disconnect and reconnects without launching twice",
  async () => {
    const f = fixture();
    const boot = join(f.root, "starts");
    const heartbeat = join(f.root, "heartbeat");
    const code = `import {appendFileSync,writeFileSync} from "node:fs";appendFileSync(${JSON.stringify(boot)},${JSON.stringify("start\n")});process.stdin.setRawMode(true);setInterval(()=>writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),30);console.log("PERSISTENT READY");process.stdin.on("data",bytes=>{if(bytes.toString()==="x")process.exit(9)});`;
    const persistent = {
      database: f.paths.database,
      sessionId: "persistent-test",
    };
    const spec = {
      command: process.execPath,
      args: ["-e", code],
      cwd: f.root,
      persistent,
    };
    const target = persistentTerminal(
      persistent.database,
      persistent.sessionId,
    );
    let first: EmbeddedProcess | undefined;
    let second: EmbeddedProcess | undefined;
    let owner: Bun.Subprocess<"ignore", "ignore", "pipe"> | undefined;
    let ownerStderr = Promise.resolve("Frontend not started");
    let firstOutput = "";
    let output = "";
    let failure: Error | undefined;
    let starting: Promise<void> | undefined;
    const tmuxCommand = async (args: string[]) => {
      const child = Bun.spawn(["tmux", ...target.prefix, ...args], {
        env: { ...process.env, TMUX: undefined, TMUX_PANE: undefined },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 1500,
        killSignal: "SIGKILL",
      });
      return within(
        `tmux ${args[0]}`,
        Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]),
        2000,
      );
    };
    try {
      first = new EmbeddedProcess(spec, 80, 24, (bytes) => {
        firstOutput += new TextDecoder().decode(bytes);
      });
      starting = first.start();
      await within("initial startup", starting, 6000);
      await until(() => existsSync(heartbeat), "initial heartbeat");
      first.disconnect();
      expect(await within("initial disconnect", first.exited, 1000)).toBe(0);
      const before = readFileSync(heartbeat, "utf8");
      await until(
        () => readFileSync(heartbeat, "utf8") !== before,
        "heartbeat after UI disconnect",
      );
      // A separate frontend exits without cleanup, as on terminal loss.
      owner = Bun.spawn(
        [
          process.execPath,
          "-e",
          `import {EmbeddedProcess} from ${JSON.stringify(resolve("src/lib/platform/embedded-process.ts"))};const child=new EmbeddedProcess(${JSON.stringify(spec)},80,24,()=>{});await child.start();await Bun.sleep(100);process.exit(0);`,
        ],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
          timeout: 6000,
          killSignal: "SIGKILL",
        },
      );
      ownerStderr = new Response(owner.stderr).text();
      expect(await within("abrupt frontend exit", owner.exited, 8000)).toBe(0);
      const afterOwnerExit = readFileSync(heartbeat, "utf8");
      await until(
        () => readFileSync(heartbeat, "utf8") !== afterOwnerExit,
        "heartbeat after abrupt frontend exit",
      );
      second = new EmbeddedProcess(spec, 90, 30, (bytes) => {
        output += new TextDecoder().decode(bytes);
      });
      starting = second.start();
      await within("reconnect startup", starting, 6000);
      await until(
        () => output.includes("PERSISTENT READY"),
        "reconnected terminal output",
      );
      expect(readFileSync(boot, "utf8")).toBe("start\n");
      second.write(new TextEncoder().encode("x"));
      expect(await within("native exit status", second.exited, 6000)).toBe(9);
    } catch (error) {
      const diagnostics = await Promise.allSettled([
        within("frontend stderr", ownerStderr, 2000),
        tmuxCommand([
          "list-panes",
          "-a",
          "-F",
          "#{session_name} pane=#{pane_id} dead=#{pane_dead} status=#{pane_dead_status} signal=#{pane_dead_signal} pid=#{pane_pid}",
        ]),
        tmuxCommand([
          "list-clients",
          "-F",
          "#{client_name} session=#{client_session} pid=#{client_pid}",
        ]),
      ]);
      failure = new Error(
        `${String(error)}\nInitial terminal output: ${JSON.stringify(firstOutput)}\nReconnected terminal output: ${JSON.stringify(output)}\nDiagnostics (frontend stderr, tmux panes, tmux clients): ${JSON.stringify(diagnostics.map((result) => (result.status === "fulfilled" ? result.value : String(result.reason))))}`,
        { cause: error },
      );
    } finally {
      first?.disconnect();
      second?.disconnect();
      try {
        const cleanup = await Promise.allSettled([
          (async () => {
            if (owner?.exitCode === null) {
              owner.kill("SIGKILL");
              await within("frontend cleanup", owner.exited, 2000);
            }
          })(),
          // Disconnect prevents later startup stages. Drain any active tmux
          // command before removing the server; its error was diagnosed above.
          starting
            ? within(
                "startup cleanup",
                starting.catch(() => {}),
                6000,
              )
            : Promise.resolve(),
        ]);
        const serverCleanup = await Promise.allSettled([
          tmuxCommand(["kill-server"]),
        ]);
        const errors = [...cleanup, ...serverCleanup].flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length)
          failure = new AggregateError(
            failure ? [failure, ...errors] : errors,
            "Agy terminal cleanup failed",
          );
      } finally {
        try {
          rmSync(dirname(target.prefix[1] ?? ""), {
            recursive: true,
            force: true,
          });
        } finally {
          f.close();
        }
      }
    }
    if (failure) throw failure;
  },
  // Phase deadlines total at most 43s, plus 10s for diagnostics and cleanup.
  60_000,
);

test("closing before startup does not spawn a terminal process", async () => {
  const f = fixture();
  const marker = join(f.root, "unexpected");
  const child = new EmbeddedProcess(
    {
      command: process.execPath,
      args: ["-e", `await Bun.write(${JSON.stringify(marker)},"spawned")`],
      cwd: f.root,
    },
    80,
    24,
    () => {},
  );
  try {
    child.disconnect();
    await child.start();
    expect(await child.exited).toBe(0);
    expect(existsSync(marker)).toBe(false);
  } finally {
    child.disconnect();
    f.close();
  }
});

test.skipIf(!Bun.which("python3"))(
  "embedded /dev/tty is isolated from the outer terminal for sizing, raw input, and resize",
  async () => {
    const runner = `
    import {EmbeddedProcess} from ${JSON.stringify(resolve("src/lib/platform/embedded-process.ts"))};
    const program = ${JSON.stringify(`import os,fcntl,termios,tty,struct,json,signal
fd=os.open('/dev/tty',os.O_RDWR)
def report(event):
 print(json.dumps({'event':event,'stdin':list(struct.unpack('HHHH',fcntl.ioctl(0,termios.TIOCGWINSZ,b'\\0'*8))[:2]),'controlling':list(struct.unpack('HHHH',fcntl.ioctl(fd,termios.TIOCGWINSZ,b'\\0'*8))[:2])}),flush=True)
signal.signal(signal.SIGWINCH,lambda *args:report('resize'))
tty.setraw(fd)
report('ready')
text=os.read(fd,5).decode()
print(json.dumps({'event':'input','text':text}),flush=True)
`)};
    let output='';
    const child=new EmbeddedProcess({command:'python3',args:['-c',program],cwd:process.cwd()},72,20,bytes=>output+=new TextDecoder().decode(bytes));
    const wait=async check=>{const deadline=Date.now()+4000;while(!check()){if(Date.now()>deadline)throw new Error('PTY test timed out: '+output);await Bun.sleep(10)}};
    try {
      await child.start();
      await wait(()=>output.includes('"ready"'));
      child.resize(64,18);
      await wait(()=>output.includes('"resize"'));
      child.write(new TextEncoder().encode('hello'));
      await child.exited;
      console.log(JSON.stringify(output.trim().split(/\\r?\\n/).map(line=>JSON.parse(line))));
    } finally {child.disconnect()}
  `;
    const python = `import os,pty,fcntl,termios,struct,json,sys
pid,master=pty.fork()
if pid==0:
 fcntl.ioctl(0,termios.TIOCSWINSZ,struct.pack('HHHH',45,130,0,0))
 os.execvp(sys.argv[1],[sys.argv[1],'-e',sys.argv[2]])
before=termios.tcgetattr(master)
output=b''
try:
 while True:
  try:
   chunk=os.read(master,8192)
   if not chunk:break
   output+=chunk
  except OSError:break
 _,status=os.waitpid(pid,0)
 print(json.dumps({'exit':os.waitstatus_to_exitcode(status),'outerUnchanged':termios.tcgetattr(master)==before,'output':output.decode()}))
finally:os.close(master)
`;
    const probe = Bun.spawn(
      ["python3", "-c", python, process.execPath, runner],
      { stdout: "pipe", stderr: "pipe", timeout: 10_000 },
    );
    const [output, error, code] = await Promise.all([
      new Response(probe.stdout).text(),
      new Response(probe.stderr).text(),
      probe.exited,
    ]);
    expect(code).toBe(0);
    expect(error).toBe("");
    const result = JSON.parse(output);
    expect(result.exit).toBe(0);
    expect(result.outerUnchanged).toBe(true);
    const events = JSON.parse(result.output.trim());
    expect(
      events.find((event: { event: string }) => event.event === "ready"),
    ).toEqual({ event: "ready", stdin: [20, 72], controlling: [20, 72] });
    expect(
      events.find((event: { event: string }) => event.event === "resize"),
    ).toEqual({ event: "resize", stdin: [18, 64], controlling: [18, 64] });
    expect(events.at(-1)).toEqual({ event: "input", text: "hello" });
  },
  12_000,
);
