import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, rmdirSync, symlinkSync } from "node:fs";
import { eq } from "drizzle-orm";
import { sourceCheckoutDirectory } from "../src/lib/platform/paths";
import { ProviderManager } from "../src/lib/providers/manager";
import type {
  ProviderConnection,
  SessionOptions,
} from "../src/lib/providers/types";
import { sessions } from "../src/lib/storage/schema";
import { fixture } from "./helpers";

class FakeProviders extends ProviderManager {
  calls: { id: string; cwd: string; prompt?: string }[] = [];
  createOptions: (SessionOptions | undefined)[] = [];
  createTitles: (string | undefined)[] = [];
  launchOptions: (SessionOptions | undefined)[] = [];
  renamed: { threadId: string; title: string }[] = [];
  providerTitle: string | null = null;
  supportsRename = true;
  supportsTitle = true;
  closed = 0;
  exitCode = 0;
  failResume = false;
  override adapter() {
    const manager = this;
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
      async connect(): Promise<ProviderConnection> {
        return {
          async create(_cwd, options, title) {
            manager.createOptions.push(options);
            manager.createTitles.push(title);
            return { threadId: "native-thread", sessionId: "native-session" };
          },
          ...(manager.supportsTitle
            ? {
                async readTitle() {
                  return manager.providerTitle;
                },
              }
            : {}),
          ...(manager.supportsRename
            ? {
                async rename(threadId: string, title: string) {
                  manager.renamed.push({ threadId, title });
                  manager.providerTitle = title;
                },
              }
            : {}),
          async resume() {
            if (manager.failResume) throw new Error("Native history missing");
          },
          async launch(id, cwd, prompt, options) {
            manager.launchOptions.push(options);
            manager.calls.push({ id, cwd, prompt });
            return manager.exitCode;
          },
          async history() {
            return { data: [], nextCursor: null };
          },
          async close() {
            manager.closed++;
          },
        };
      },
    };
  }
}

let f: ReturnType<typeof fixture>;
let providers: FakeProviders;
const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutDescriptor = Object.getOwnPropertyDescriptor(
  process.stdout,
  "isTTY",
);
beforeEach(() => {
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: true,
    configurable: true,
  });
  providers = new FakeProviders();
  f = fixture(providers);
});
afterEach(() => {
  f.close();
  if (stdinDescriptor)
    Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  if (stdoutDescriptor)
    Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
  else Reflect.deleteProperty(process.stdout, "isTTY");
});

test("new session saves native identity before handoff and resume keeps identity without reinjecting role", async () => {
  const p = f.app.createProject("Project");
  const a = f.app.createAgent("Developer", "Follow repository instructions.");
  const session = await f.app.newSession(
    { project: p.id, cwd: f.root, agent: a.id, prompt: "Review the code" },
    async (run) => {
      const pending = f.app.listSessions()[0];
      expect(pending?.nativeThreadId).toBe("native-thread");
      expect(pending?.title).toBe("Review the code");
      expect(pending?.status).toBe("attached");
      return run();
    },
  );
  expect(session.status).toBe("idle");
  expect(session.nativeSessionId).toBe("native-session");
  expect(session.title).toBe("Review the code");
  expect(providers.createTitles[0]).toBe("Review the code");
  expect(providers.calls[0]?.cwd).toBe(f.root);
  expect(providers.calls[0]?.prompt).toContain(
    "Follow repository instructions.",
  );
  await f.app.resumeSession(session.id);
  expect(providers.calls[1]).toEqual({
    id: "native-thread",
    cwd: f.root,
    prompt: undefined,
  });
  expect(providers.closed).toBe(2);
  f.app.removeProject(p.id);
  expect(f.app.session(session.id).projectId).toBeNull();
  expect(f.app.session(session.id).cwd).toBe(f.root);
});

test("project and agent are optional", async () => {
  const session = await f.app.newSession({ cwd: f.root });
  expect(session.projectId).toBeNull();
  expect(session.agentId).toBeNull();
  expect(session.title).toBeNull();
  expect(providers.createTitles[0]).toBeUndefined();
});

test("checkout sessions remain normal sessions and resume with their saved directory and provider", async () => {
  f.app.setDefaultDirectory(f.root);
  const cwd = sourceCheckoutDirectory();
  const session = await f.app.newSession({ cwd, provider: "codex" });
  expect(session.cwd).toBe(cwd);
  expect(session.provider).toBe("codex");
  expect(session.projectId).toBeNull();
  expect(session.agentId).toBeNull();
  expect(providers.calls[0]?.prompt).toBeUndefined();
  f.app.setPreferredProvider("opencode");
  await f.app.resumeSession(session.id);
  expect(providers.calls[1]).toEqual({
    id: "native-thread",
    cwd,
    prompt: undefined,
  });
  expect(f.app.session(session.id).provider).toBe("codex");
  expect(f.app.defaultDirectory()).toBe(f.root);
});

test("rename writes the normalized title through and provider names win during sync", async () => {
  const session = await f.app.newSession({
    cwd: f.root,
    prompt: "  First   prompt\nwith whitespace  ",
  });
  expect(session.title).toBe("First prompt with whitespace");
  expect(providers.createTitles[0]).toBe("First prompt with whitespace");
  const renamed = await f.app.renameSession(session.id, "  New\n title  ");
  expect(renamed.title).toBe("New title");
  expect(providers.renamed).toEqual([
    { threadId: "native-thread", title: "New title" },
  ]);
  await expect(f.app.renameSession(session.id, "   ")).rejects.toThrow(
    "cannot be empty",
  );
  expect(providers.renamed).toHaveLength(1);

  providers.providerTitle = "Provider title";
  expect(await f.app.syncSessionNames()).toBe(1);
  expect(f.app.session(session.id).title).toBe("Provider title");
  expect(await f.app.syncSessionNames()).toBe(0);

  providers.providerTitle = "   ";
  expect(await f.app.syncSessionNames()).toBe(0);
  expect(f.app.session(session.id).title).toBe("Provider title");
});

test("providers without native title support keep local-only names", async () => {
  providers.supportsRename = false;
  providers.supportsTitle = false;
  const session = await f.app.newSession({
    cwd: f.root,
    prompt: "Local title",
  });
  const renamed = await f.app.renameSession(session.id, "Renamed locally");
  expect(renamed.title).toBe("Renamed locally");
  expect(providers.renamed).toHaveLength(0);
  expect(await f.app.syncSessionNames()).toBe(0);
  expect(f.app.session(session.id).title).toBe("Renamed locally");
});

test("native failures persist error and identity and always clean up", async () => {
  const session = await f.app.newSession({ cwd: f.root });
  providers.failResume = true;
  await expect(f.app.resumeSession(session.id)).rejects.toThrow(
    "Native history missing",
  );
  expect(f.app.session(session.id).status).toBe("failed");
  expect(f.app.session(session.id).nativeThreadId).toBe("native-thread");
  expect(providers.closed).toBe(2);
});

test("nonzero native exit is a failed launch, not a successful command", async () => {
  providers.exitCode = 1;
  await expect(f.app.newSession({ cwd: f.root })).rejects.toThrow("exited 1");
  expect(f.app.listSessions()[0]?.status).toBe("failed");
  expect(f.app.listSessions()[0]?.exitCode).toBe(1);
});

test("live owners cannot be resumed concurrently; stale process identities recover", async () => {
  let id = "";
  await f.app.newSession({ cwd: f.root }, async (run) => {
    id = f.app.listSessions()[0]?.id ?? "";
    f.app.recoverSessions();
    expect(f.app.session(id).status).toBe("attached");
    await expect(f.app.resumeSession(id)).rejects.toThrow("already open");
    return run();
  });
  f.storage.db
    .update(sessions)
    .set({
      status: "attached",
      ownerPid: process.pid,
      ownerStart: "old-boot:old-process",
    })
    .where(eq(sessions.id, id))
    .run();
  f.app.recoverSessions();
  expect(f.app.session(id).status).toBe("interrupted");
  await f.app.resumeSession(id);
  expect(f.app.session(id).status).toBe("idle");
});

test("group membership is independent of session directories and native identity", async () => {
  const first = f.app.createProject("First");
  const second = f.app.createProject("Second");
  const one = await f.app.newSession({ project: first.id, cwd: f.root });
  const two = await f.app.newSession({ project: first.id });
  expect(two.cwd).toBe(process.cwd());
  expect(one.cwd).toBe(f.root);
  f.app.assignSessionProject(one.id, second.name);
  expect(f.app.session(one.id).projectId).toBe(second.id);
  expect(f.app.session(one.id).nativeSessionId).toBe(one.nativeSessionId);
  expect(f.app.session(one.id).cwd).toBe(f.root);
  expect(() => f.app.assignSessionProject(one.id, "missing")).toThrow();
  f.app.assignSessionProject(one.id);
  expect(f.app.session(one.id).projectId).toBeNull();
  f.app.removeProject(first.id);
  expect(f.app.session(two.id).projectId).toBeNull();
  await f.app.resumeSession(one.id);
  expect(providers.calls.at(-1)?.cwd).toBe(f.root);
});

test("instruction editing uses the session directory", async () => {
  const session = await f.app.newSession({ cwd: f.root });
  expect(f.app.readInstructions(session.id)).toBe("");
  f.app.saveInstructions(session.id, "Follow these repository rules.");
  expect(f.app.readInstructions(session.id)).toBe(
    "Follow these repository rules.",
  );
  expect(f.app.instructionFile(session.id)).toBe(`${f.root}/AGENTS.md`);
  expect(() => f.app.instructionFile(session.id, "../AGENTS.md")).toThrow();
});

test("saved working directory defaults apply to future sessions and explicit directories override them", async () => {
  f.app.setDefaultDirectory(f.paths.data);
  const session = await f.app.newSession({});
  expect(session.cwd).toBe(f.paths.data);
  const explicit = await f.app.newSession({ cwd: f.root });
  expect(explicit.cwd).toBe(f.root);
  f.app.setDefaultDirectory();
  expect(f.app.defaultDirectory()).toBeUndefined();
  expect(f.app.session(session.id).cwd).toBe(f.paths.data);
  expect(f.app.session(explicit.id).cwd).toBe(f.root);
});

test("new session validates and passes the same defaults to creation and handoff; resume ignores changed defaults", async () => {
  f.app.modelCatalog = async () => ({
    reasoningLabel: "effort",
    models: [{ id: "test-model", name: "Test", reasoning: [{ id: "high" }] }],
  });
  await f.app.setProviderDefaults("codex", {
    model: "test-model",
    reasoning: "high",
  });
  const session = await f.app.newSession({ cwd: f.root });
  expect(providers.createOptions[0]).toEqual({
    model: "test-model",
    reasoning: "high",
  });
  expect(providers.launchOptions[0]).toBe(providers.createOptions[0]);
  f.app.modelCatalog = async () => {
    throw new Error("Discovery failed");
  };
  await f.app.resumeSession(session.id);
  expect(providers.launchOptions[1]).toBeUndefined();
  await expect(f.app.newSession({ cwd: f.root })).rejects.toThrow(
    "Discovery failed",
  );
  expect(f.app.listSessions()).toHaveLength(1);
  expect(providers.createOptions).toHaveLength(1);
  f.app.modelCatalog = async () => ({ reasoningLabel: "effort", models: [] });
  await expect(f.app.newSession({ cwd: f.root })).rejects.toThrow(
    "unavailable",
  );
  await f.app.setProviderDefaults("codex", {});
  f.app.modelCatalog = async () => {
    throw new Error("Must not discover without overrides");
  };
  await f.app.newSession({ cwd: f.root });
  expect(providers.createOptions[1]).toEqual({});
});

test("embedded launch preflight fails before initialization or claiming a resume", async () => {
  const launcher = Object.assign(async () => 0, {
    preflight: () => {
      throw new Error("Missing terminal capability");
    },
  });
  await expect(
    f.app.newSession({ cwd: f.root }, (run) => run(), launcher),
  ).rejects.toThrow("Missing terminal capability");
  expect(f.app.listSessions()).toHaveLength(0);
  expect(providers.createOptions).toHaveLength(0);
  const session = await f.app.newSession({ cwd: f.root });
  await expect(
    f.app.resumeSession(session.id, (run) => run(), launcher),
  ).rejects.toThrow("Missing terminal capability");
  expect(f.app.session(session.id).status).toBe("idle");
});

test("project sessions prepare memory for existing projects and preserve task, role, title, and resume context", async () => {
  const project = f.app.createProject("Work");
  const other = f.app.createProject("Other");
  const memory = f.app.projectMemory(project.id);
  rmdirSync(memory.path);
  expect(f.app.projectMemory(project.id)).toEqual(memory);
  expect(existsSync(memory.path)).toBe(false);
  const agent = f.app.createAgent(
    "Developer",
    "Follow repository conventions.",
  );
  const session = await f.app.newSession({
    project: project.id,
    cwd: f.root,
    agent: agent.id,
    prompt: "Review the code",
  });
  const prompt = providers.calls[0]?.prompt;
  expect(existsSync(memory.path)).toBe(true);
  expect(prompt).toStartWith("agentos memory context:");
  expect(prompt).not.toContain("Before working");
  expect(prompt).toContain(memory.directory);
  expect(prompt).toContain(project.id);
  expect(prompt).toContain(memory.root);
  expect(prompt).toContain("Follow repository conventions.");
  expect(prompt).toContain("Review the code");
  expect(prompt).not.toContain(f.app.projectMemory(other.id).path);
  expect(session.title).toBe("Review the code");
  f.app.assignSessionProject(session.id, other.id);
  await f.app.resumeSession(session.id);
  expect(providers.calls[1]?.prompt).toBeUndefined();
  const ungrouped = await f.app.newSession({
    cwd: f.root,
    prompt: "Exact task",
  });
  expect(ungrouped.projectId).toBeNull();
  expect(providers.calls[2]?.prompt).toBe("Exact task");
});

test("project memory path replacement is rejected before native session creation", async () => {
  const project = f.app.createProject("Work");
  const memory = f.app.projectMemory(project.id);
  rmdirSync(memory.path);
  symlinkSync(f.root, memory.path);
  await expect(
    f.app.newSession({ project: project.id, cwd: f.root, prompt: "Task" }),
  ).rejects.toThrow("Memory path");
  expect(providers.createOptions).toHaveLength(0);
  expect(f.app.listSessions()).toHaveLength(0);
});
