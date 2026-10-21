import { spawn } from "node:child_process";

export async function runInteractive(
  command: string,
  args: string[],
  cwd: string,
): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("This operation requires an interactive terminal.");
  }
  const stty = Bun.which("stty");
  if (!stty)
    throw new Error(
      "stty (GNU coreutils) is required for terminal restoration",
    );
  const snapshot = Bun.spawn([stty, "-g"], {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "ignore",
  });
  const savedState = (await new Response(snapshot.stdout).text()).trim();
  if ((await snapshot.exited) || !savedState)
    throw new Error("Unable to save terminal settings");
  let result: number | undefined;
  let restoreCode = 0;
  try {
    result = await new Promise<number>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: "inherit",
        shell: false,
      });
      // The foreground process group receives terminal signals directly. Do not
      // forward SIGINT a second time or let it kill the parent before restoration.
      const onInterrupt = () => {};
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const onTerminate = () => {
        child.kill("SIGTERM");
        killTimer ??= setTimeout(() => child.kill("SIGKILL"), 3000);
      };
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onTerminate);
      const cleanup = () => {
        clearTimeout(killTimer);
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
      };
      child.once("error", (error) => {
        cleanup();
        reject(error);
      });
      child.once("exit", (code) => {
        cleanup();
        resolve(code ?? 130);
      });
    });
  } finally {
    const restore = Bun.spawn([stty, savedState], {
      stdin: "inherit",
      stdout: "ignore",
      stderr: "ignore",
    });
    restoreCode = await restore.exited;
    if (result === undefined || result !== 0) {
      // A killed provider may not have restored alternate-screen, mouse, paste,
      // or cursor modes. The host renderer will resume after this cleanup.
      process.stdout.write(
        "\x1b[?1049l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[0m\x1b[?25h",
      );
    }
    if (restoreCode !== 0)
      console.error("Unable to restore terminal settings; run stty sane");
  }
  if (restoreCode !== 0) throw new Error("Terminal restoration failed");
  return result;
}

export async function probe(command: string, args: string[]): Promise<string> {
  const child = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5000,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
  });
  const [output, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${command} probe exited ${code}; run ${command} --version directly for diagnostics.`,
    );
  return output.trim();
}
