import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers";

test("persistent worker executes a one-time schedule with no TUI and exits gracefully", async () => {
  const f = fixture();
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "codex"),
    `#!${process.execPath}\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"worker-native"}));console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Scheduled result"}}));console.log(JSON.stringify({type:"turn.completed"}));\n`,
    { mode: 0o700 },
  );
  const a = f.app.automations.save({
    version: 1,
    name: "Scheduled",
    slug: "scheduled",
    cwd: f.root,
    schedule: { kind: "once", at: new Date(Date.now() + 300).toISOString() },
    steps: [
      {
        name: "Execute",
        provider: "codex",
        prompt: "Test",
        timeoutSeconds: 10,
      },
    ],
  });
  const worker = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      "automations",
      "worker",
    ],
    {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        XDG_DATA_HOME: dirname(f.paths.data),
        XDG_CONFIG_HOME: dirname(f.paths.config),
        XDG_CACHE_HOME: dirname(f.paths.cache),
      },
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  try {
    const limit = Date.now() + 6000;
    while (
      Date.now() < limit &&
      !f.app.automations.history(a.id).some((r) => r.status === "completed")
    )
      await Bun.sleep(50);
    const run = f.app.automations.history(a.id)[0];
    expect(run?.status).toBe("completed");
    expect(f.app.automations.runDetails(run?.id ?? "").steps[0]?.nativeId).toBe(
      "worker-native",
    );
    worker.kill("SIGTERM");
    expect(await worker.exited).toBe(0);
    expect(await new Response(worker.stderr).text()).toBe("");
  } finally {
    if (worker.exitCode === null) {
      worker.kill("SIGKILL");
      await worker.exited;
    }
    f.close();
  }
}, 10000);
