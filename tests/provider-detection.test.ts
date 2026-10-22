import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

test.each([false, true])(
  "provider detection uses the current PATH after startup (probe failure: %s)",
  async (failProbe) => {
    const root = mkdtempSync("/tmp/agentos-provider-path-");
    const empty = join(root, "empty");
    const bin = join(root, "bin");
    mkdirSync(empty);
    mkdirSync(bin);
    for (const name of ["codex", "opencode", "agy"]) {
      writeFileSync(
        join(bin, name),
        `#!${process.execPath}
if (process.env.PROVIDER_TEST_FAIL === "1") process.exit(1);
const name=${JSON.stringify(name)};
console.log(process.argv.includes("--help") ? "resume unix://" : name === "opencode" ? "2.0.0" : name + " 0.163.0");
`,
        { mode: 0o700 },
      );
    }
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          `
import {ProviderManager} from ${JSON.stringify(resolve("src/lib/providers/manager.ts"))};
const manager=new ProviderManager();
const before=await manager.list();
process.env.PATH=${JSON.stringify(bin)};
const after=await manager.list();
console.log(JSON.stringify({before,after}));
`,
        ],
        {
          env: {
            ...process.env,
            PATH: empty,
            PROVIDER_TEST_FAIL: failProbe ? "1" : "0",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(err).toBe("");
      expect(code).toBe(0);
      const result: {
        before: { installed: boolean }[];
        after: { installed: boolean; interactive: boolean }[];
      } = JSON.parse(out);
      expect(result.before.map((provider) => provider.installed)).toEqual([
        false,
        false,
        false,
      ]);
      expect(result.after.map((provider) => provider.installed)).toEqual([
        true,
        true,
        true,
      ]);
      expect(result.after.map((provider) => provider.interactive)).toEqual([
        !failProbe,
        !failProbe,
        !failProbe,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
