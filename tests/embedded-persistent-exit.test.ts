import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  EmbeddedProcess,
  persistentTerminal,
} from "../src/lib/platform/embedded-process";
import { fixture } from "./helpers";

const cases = [
  { name: "successful native exit", nativeExit: 0, expected: 0 },
  { name: "failed native exit", nativeExit: 9, expected: 9 },
  { name: "native signal", nativeExit: "SIGTERM", expected: 143 },
  { name: "missing native result", nativeExit: null, expected: 1 },
] as const;

test.each(cases)(
  "persistent terminal handles empty tmux exit fields: $name",
  async ({ nativeExit, expected }) => {
    const f = fixture();
    const originalPath = process.env.PATH;
    const bin = join(f.root, "bin");
    mkdirSync(bin);
    const state = join(f.root, "command.json");
    const dead = join(f.root, "dead");
    const cleaned = join(f.root, "cleaned");
    const received = join(f.root, "received.json");
    const unexpected = join(f.root, "unexpected");
    const argument = `spaces ' $dollar $(touch ${unexpected}) \`literal\``;
    const command = join(f.root, "native provider");
    const persistent = { database: f.paths.database, sessionId: "exit-test" };
    const target = persistentTerminal(
      persistent.database,
      persistent.sessionId,
    );
    writeFileSync(
      command,
      `#!${process.execPath}
import {writeFileSync} from "node:fs";
writeFileSync(${JSON.stringify(received)}, JSON.stringify(process.argv.slice(2)));
${nativeExit === "SIGTERM" ? 'process.kill(process.pid, "SIGTERM");' : `process.exit(${nativeExit ?? 0});`}
`,
      { mode: 0o700 },
    );
    // Simulate the CI failure without a real tmux socket: the native command
    // runs in the real embedded PTY, but tmux reports a dead pane as "1::".
    writeFileSync(
      join(bin, "tmux"),
      `#!${process.execPath}
import {existsSync,readFileSync,writeFileSync,rmSync} from "node:fs";
const args=process.argv.slice(2);
const state=${JSON.stringify(state)},dead=${JSON.stringify(dead)};
if(args.includes("has-session"))process.exit(existsSync(state)?0:1);
if(args.includes("new-session")){
  writeFileSync(state,JSON.stringify(args.slice(args.indexOf("--")+1)));
}else if(args.includes("display-message")){
  console.log(existsSync(dead)?"1::":"0::");
}else if(args.includes("attach-session")){
  if(${nativeExit !== null}){
    const child=Bun.spawn(JSON.parse(readFileSync(state,"utf8")),{stdin:"inherit",stdout:"inherit",stderr:"inherit"});
    await child.exited;
  }
  writeFileSync(dead,"");
  setInterval(()=>{},100);
}else if(args.includes("kill-session")){
  writeFileSync(${JSON.stringify(cleaned)},"");
  rmSync(state);
}else process.exit(2);
`,
      { mode: 0o700 },
    );
    // A new terminal must never reuse a previous command's successful result.
    writeFileSync(target.exitStatus, "0\n", { mode: 0o600 });
    const child = new EmbeddedProcess(
      { command, args: [argument], cwd: f.root, persistent },
      80,
      24,
      () => {},
    );
    try {
      process.env.PATH = `${bin}:${originalPath}`;
      await child.start();
      expect(await child.exited).toBe(expected);
      expect(existsSync(cleaned)).toBe(true);
      expect(existsSync(target.exitStatus)).toBe(false);
      expect(existsSync(unexpected)).toBe(false);
      if (nativeExit !== null)
        expect(JSON.parse(readFileSync(received, "utf8"))).toEqual([argument]);
    } finally {
      child.disconnect();
      process.env.PATH = originalPath;
      rmSync(dirname(target.exitStatus), { recursive: true, force: true });
      f.close();
    }
  },
  10_000,
);
