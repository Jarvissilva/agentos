import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ProviderManager } from "../src/providers/manager";
import type { ProviderConnection } from "../src/providers/types";
import { sessions } from "../src/storage/schema";
import { fixture } from "./helpers";

class FakeProviders extends ProviderManager {
  calls: { id: string; cwd: string; prompt?: string }[] = [];
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
          async create() {
            return { threadId: "native-thread", sessionId: "native-session" };
          },
          async resume() {
            if (manager.failResume) throw new Error("Native history missing");
          },
          async launch(id, cwd, prompt) {
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
  const p = f.app.createProject("Project", f.root);
  const a = f.app.createAgent("Developer", "Follow repository instructions.");
  const session = await f.app.newSession(
    { project: p.id, agent: a.id, prompt: "Review the code" },
    async (run) => {
      const pending = f.app.listSessions()[0];
      expect(pending?.nativeThreadId).toBe("native-thread");
      expect(pending?.status).toBe("attached");
      return run();
    },
  );
  expect(session.status).toBe("idle");
  expect(session.nativeSessionId).toBe("native-session");
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
