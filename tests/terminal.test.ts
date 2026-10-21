import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test.skipIf(!Bun.which("python3"))(
  "a provider that exits in raw mode leaves the PTY settings restored",
  async () => {
    const runner = `import {runInteractive} from ${JSON.stringify(fileURLToPath(new URL("../src/lib/platform/process.ts", import.meta.url)))};
    const code = await runInteractive(process.execPath, ["-e", "process.stdin.setRawMode(true); process.exit(9)"], process.cwd());
    if (code !== 9) throw new Error("Native exit code was lost");
    try { await runInteractive("/missing-agentos-test-executable", [], process.cwd()); throw new Error("Missing executable was accepted"); }
    catch (error) { if (!String(error).includes("ENOENT")) throw error; }`;
    const python = `import os, pty, subprocess, sys, termios, json
master, slave = pty.openpty()
before = termios.tcgetattr(slave)
try:
    result = subprocess.run([sys.argv[1], '-e', sys.argv[2]], stdin=slave, stdout=slave, stderr=slave, timeout=10)
    print(json.dumps({'exit': result.returncode, 'restored': termios.tcgetattr(slave) == before}))
finally:
    os.close(master)
    os.close(slave)
`;
    const child = Bun.spawn(
      ["python3", "-c", python, process.execPath, runner],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(error).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual({ exit: 0, restored: true });
  },
);
