import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  EmbeddedProcess,
  persistentTerminal,
} from "../src/lib/platform/embedded-process";

async function until(check: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for fake tmux");
    await Bun.sleep(10);
  }
}

test.each([
  { status: "1:9:", expected: 9 },
  { status: "1::TERM", expected: 143 },
])(
  "persistent exit waits for status and ignores frontend cleanup exit: %j",
  async ({ status, expected }) => {
    const root = mkdtempSync("/tmp/agentos-pane-exit-");
    const bin = join(root, "bin");
    mkdirSync(bin);
    const stateFile = join(root, "session");
    const pending = join(root, "pending-status");
    const cleanupStarted = join(root, "cleanup-started");
    const frontendExited = join(root, "frontend-exited");
    const cleanupDone = join(root, "cleanup-done");
    const oldPath = process.env.PATH;
    // Simulate tmux's status-ready delay and a frontend exiting while kill-session
    // is still running. No actual tmux server or Unix socket is used by this test.
    writeFileSync(
      join(bin, "tmux"),
      `#!${process.execPath}
import {existsSync,writeFileSync} from "node:fs";
const args=process.argv.slice(2);
const session=${JSON.stringify(stateFile)},pending=${JSON.stringify(pending)};
const cleanupStarted=${JSON.stringify(cleanupStarted)},frontendExited=${JSON.stringify(frontendExited)},cleanupDone=${JSON.stringify(cleanupDone)};
if(args.includes("has-session"))process.exit(existsSync(session)?0:1);
else if(args.includes("new-session"))writeFileSync(session,"ready");
else if(args.includes("attach-session")) {
  console.log("ATTACHED");
  setInterval(()=>{if(existsSync(cleanupStarted)){writeFileSync(frontendExited,"exited");process.exit(130)}},5);
} else if(args.includes("display-message")) {
  if(args.at(-1)==="#{pane_dead}")console.log("0");
  else if(!existsSync(pending)){writeFileSync(pending,"pending");console.log("1::");}
  else console.log(${JSON.stringify(status)});
} else if(args.includes("kill-session")) {
  writeFileSync(cleanupStarted,"started");
  const deadline=Date.now()+2000;
  while(!existsSync(frontendExited)&&Date.now()<deadline)await Bun.sleep(5);
  if(!existsSync(frontendExited))process.exit(1);
  await Bun.sleep(50);
  writeFileSync(cleanupDone,"done");
}
`,
      { mode: 0o700 },
    );
    const persistent = {
      database: join(root, "agentos.db"),
      sessionId: "status-test",
    };
    const target = persistentTerminal(
      persistent.database,
      persistent.sessionId,
    );
    let output = "";
    const child = new EmbeddedProcess(
      {
        command: process.execPath,
        args: ["-e", "process.exit(9)"],
        cwd: root,
        persistent,
      },
      80,
      24,
      (bytes) => {
        output += new TextDecoder().decode(bytes);
      },
    );
    let settled = false;
    void child.exited.then(() => {
      settled = true;
    });
    process.env.PATH = `${bin}:${oldPath}`;
    try {
      await child.start();
      await until(() => output.includes("ATTACHED"));
      await until(() => existsSync(pending));
      await Bun.sleep(30);
      expect(settled).toBe(false);
      expect(existsSync(cleanupStarted)).toBe(false);
      expect(await child.exited).toBe(expected);
      expect(existsSync(frontendExited)).toBe(true);
      expect(existsSync(cleanupDone)).toBe(true);
    } finally {
      child.disconnect();
      process.env.PATH = oldPath;
      rmSync(root, { recursive: true, force: true });
      const socket = target.prefix[1];
      if (socket) rmSync(dirname(socket), { recursive: true, force: true });
    }
  },
  6000,
);
