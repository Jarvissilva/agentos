import { afterEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  nextOccurrence,
  validateAutomation,
} from "../src/automations/definition";
import { ProviderManager } from "../src/providers/manager";
import type { ExecutionInput, ExecutionResult } from "../src/providers/types";
import { directoryLocks, runs, schedules } from "../src/storage/schema";
import { fixture } from "./helpers";

class Providers extends ProviderManager {
  calls: ExecutionInput[] = [];
  fail = false;
  gate: Promise<void> | undefined;
  override adapter() {
    const m = this;
    return {
      id: "codex" as const,
      async detect() {
        return {
          id: "codex" as const,
          installed: true,
          version: "test",
          interactive: true,
          history: true,
          reason: null,
        };
      },
      async connect(): Promise<never> {
        throw new Error("Not used");
      },
      async execute(input: ExecutionInput): Promise<ExecutionResult> {
        m.calls.push(input);
        input.onEvent?.("turn.started");
        input.onIdentity?.(`native-${m.calls.length}`);
        if (m.gate) await m.gate;
        if (input.signal?.aborted) throw new Error("Canceled");
        if (m.fail && input.prompt.startsWith("Fail"))
          throw new Error("Provider failed");
        return { nativeId: `native-${m.calls.length}`, text: "Short result" };
      },
    };
  }
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
function setup() {
  const providers = new Providers();
  const f = fixture(providers);
  cleanups.push(() => f.close());
  return { ...f, providers };
}
function definition(cwd: string, slug = "example") {
  return {
    version: 1,
    name: slug,
    slug,
    cwd,
    schedule: { kind: "manual" },
    steps: [
      { name: "Research", provider: "codex", prompt: "Research" },
      {
        name: "Review",
        provider: "codex",
        prompt: "Fail then review",
        session: "previous",
        includePrevious: true,
      },
    ],
  };
}

test("failed-step retry retains successful results and compatible native session context", async () => {
  const f = setup();
  const a = f.app.automations.save(definition(f.root));
  f.providers.fail = true;
  const failed = await f.app.automations.run(a.id);
  expect(failed?.status).toBe("failed");
  expect(failed?.steps.filter((s) => s.status === "completed")).toHaveLength(1);
  f.providers.fail = false;
  const retried = await f.app.automations.run(a.id, { retryId: failed?.id });
  expect(retried?.status).toBe("completed");
  expect(
    f.providers.calls.filter((s) => s.prompt.startsWith("Research")),
  ).toHaveLength(1);
  expect(f.providers.calls[2]?.nativeId).toBe("native-1");
  expect(f.providers.calls[2]?.prompt).toContain("Short result");
  expect(f.app.listNotifications()).toHaveLength(2);
  expect(f.storage.db.select().from(directoryLocks).all()).toHaveLength(0);
});
test("concurrent automations and overlapping scheduled occurrences are skipped, not queued", async () => {
  const f = setup();
  const one = f.app.automations.save(definition(f.root, "one")),
    two = f.app.automations.save(definition(f.root, "two"));
  let release: (() => void) | undefined;
  f.providers.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = f.app.automations.run(one.id);
  await Bun.sleep(5);
  expect(await f.app.automations.run(two.id)).toBeNull();
  expect(await f.app.automations.run(one.id)).toBeNull();
  release?.();
  await active;
  expect(
    f.app.automations.history().filter((r) => r.status === "skipped"),
  ).toHaveLength(2);
});
test("stale workers recover without replaying completed steps", async () => {
  const f = setup();
  const a = f.app.automations.save(definition(f.root));
  const claim = f.app.automations.claim(a.id);
  expect(claim).not.toBeNull();
  if (!claim) throw new Error("No claim");
  f.storage.db
    .update(runs)
    .set({ ownerIdentity: "old-boot" })
    .where(eq(runs.id, claim.runId))
    .run();
  f.app.automations.recover();
  expect(f.app.automations.runDetails(claim.runId).status).toBe("interrupted");
  expect(f.providers.calls).toHaveLength(0);
  expect(f.storage.db.select().from(directoryLocks).all()).toHaveLength(0);
});
test("scheduled reservations are unique and missed downtime occurrences are recorded", async () => {
  const f = setup();
  const d = {
    ...definition(f.root),
    schedule: { kind: "interval", everySeconds: 60 },
  };
  const a = f.app.automations.save(d);
  const now = Date.now();
  f.storage.db
    .update(schedules)
    .set({ nextAt: now - 120000 })
    .where(eq(schedules.automationId, a.id))
    .run();
  await f.app.automations.tick(now);
  await f.app.automations.tick(now);
  expect(f.app.automations.history(a.id)).toHaveLength(1);
  expect(f.app.automations.history(a.id)[0]?.status).toBe("skipped");
  f.storage.db
    .update(schedules)
    .set({ nextAt: now })
    .where(eq(schedules.automationId, a.id))
    .run();
  await f.app.automations.tick(now);
  await f.app.automations.tick(now);
  await f.app.automations.drain();
  expect(
    f.app.automations.history(a.id).filter((r) => r.status === "completed"),
  ).toHaveLength(1);
});
test("automation validation rejects incompatible continuation and prompt path escapes", () => {
  const f = setup();
  const d = definition(f.root);
  d.steps[1] = {
    name: "Bad",
    provider: "agy",
    prompt: "Bad",
    session: "previous",
    includePrevious: false,
  };
  expect(() => validateAutomation(d)).toThrow("same provider");
  const file = join(f.root, "definition.yaml");
  writeFileSync(file, "{}");
  expect(() =>
    validateAutomation(
      {
        ...definition(f.root),
        steps: [{ name: "Bad", provider: "codex", promptFile: "../escape.md" }],
      },
      file,
    ),
  ).toThrow("escapes");
});
test("supporting files stay in the repository and gitignore preserves existing entries", async () => {
  const f = setup();
  mkdirSync(join(f.root, ".git"));
  writeFileSync(join(f.root, ".gitignore"), "node_modules/\n");
  const a = f.app.automations.save(definition(f.root));
  const r = await f.app.automations.run(a.id);
  expect(r?.status).toBe("completed");
  expect(readFileSync(join(f.root, ".gitignore"), "utf8")).toBe(
    "node_modules/\n.agentos/\n",
  );
  expect(f.providers.calls[0]?.prompt).toContain(
    join(f.root, ".agentos", "example", "runs", r?.id ?? ""),
  );
});
test("cron and interval schedules retain timezone and calendar semantics", () => {
  const t = Date.parse("2026-10-21T00:00:00Z");
  expect(nextOccurrence({ kind: "interval", everySeconds: 60 }, t)).toBe(
    t + 60000,
  );
  expect(
    nextOccurrence(
      { kind: "cron", expression: "0 9 * * *", timezone: "Asia/Kolkata" },
      t,
    ),
  ).toBe(Date.parse("2026-10-21T03:30:00Z"));
  expect(
    nextOccurrence({ kind: "once", at: "2020-01-01T00:00:00Z" }, t),
  ).toBeNull();
});

test("cancellation stops the active step, releases the workspace, and records the outcome", async () => {
  const f = setup();
  const a = f.app.automations.save(definition(f.root));
  let release: (() => void) | undefined;
  f.providers.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = new AbortController();
  const job = f.app.automations.run(a.id, { signal: controller.signal });
  await Bun.sleep(5);
  controller.abort();
  release?.();
  const r = await job;
  expect(r?.status).toBe("canceled");
  expect(f.providers.calls).toHaveLength(1);
  expect(f.storage.db.select().from(directoryLocks).all()).toHaveLength(0);
});

test("scheduler keeps polling while a scheduled run is active and records overlap skips", async () => {
  const f = setup();
  const a = f.app.automations.save({
    ...definition(f.root),
    schedule: { kind: "interval", everySeconds: 60 },
  });
  const now = Date.now();
  let release: (() => void) | undefined;
  f.providers.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.storage.db
    .update(schedules)
    .set({ nextAt: now })
    .where(eq(schedules.automationId, a.id))
    .run();
  await f.app.automations.tick(now);
  expect(f.app.automations.history(a.id)[0]?.status).toBe("running");
  await f.app.automations.tick(now + 60000);
  expect(
    f.app.automations.history(a.id).filter((r) => r.status === "skipped"),
  ).toHaveLength(1);
  release?.();
  await f.app.automations.drain();
});

test("interactive model defaults never reach automation execution", async () => {
  const f = setup();
  f.app.modelCatalog = async () => ({
    reasoningLabel: "effort",
    models: [{ id: "test-model", name: "Test", reasoning: [{ id: "high" }] }],
  });
  await f.app.setProviderDefaults("codex", {
    model: "test-model",
    reasoning: "high",
  });
  f.app.modelCatalog = async () => {
    throw new Error("Automation must not discover defaults");
  };
  const automation = f.app.automations.save(definition(f.root));
  const result = await f.app.automations.run(automation.id);
  expect(result?.status).toBe("completed");
  expect(f.providers.calls).toHaveLength(2);
  for (const input of f.providers.calls)
    expect(input.sessionOptions).toBeUndefined();
});
