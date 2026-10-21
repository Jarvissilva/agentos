import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import type { Application } from "../src/core/application";
import type { ProviderId, ProviderInfo } from "../src/providers/types";
import { sessions } from "../src/storage/schema";
import { App } from "../src/tui/app";
import { fixture } from "./helpers";

const info = (id: ProviderId, interactive = true): ProviderInfo => ({
  id,
  installed: interactive,
  interactive,
  version: "test",
  history: false,
  reason: interactive ? null : "Not installed",
});
async function setup(
  providers = [info("codex"), info("opencode"), info("agy", false)],
  preferred?: ProviderId,
) {
  const f = fixture();
  f.app.detectProviders = async () => providers;
  if (preferred) f.app.setPreferredProvider(preferred);
  const screen = await createTestRenderer({ width: 110, height: 40 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = async () => {
    flushSync(() => screen.mockInput.pressEnter());
    await screen.flush();
  };
  const palette = async (command: string) => {
    flushSync(() => screen.mockInput.pressKey("p", { ctrl: true }));
    await screen.flush();
    type(command);
    await screen.flush();
    await enter();
  };
  flushSync(() => root.render(<App app={f.app} />));
  await screen.flush();
  return {
    ...f,
    screen,
    reactRoot: root,
    press,
    type,
    enter,
    palette,
    close: async () => {
      root.unmount();
      await screen.dispose();
      f.close();
    },
  };
}

test("plain home text starts a native session with its exact message, while slash opens commands", async () => {
  const f = await setup();
  const calls: Parameters<Application["newSession"]>[0][] = [];
  f.app.newSession = async (input) => {
    calls.push(input);
    return f.storage.db
      .insert(sessions)
      .values({
        id: "sent",
        provider: input.provider ?? "codex",
        providerVersion: "test",
        cwd: input.cwd ?? f.root,
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
  };
  try {
    expect(f.screen.captureCharFrame()).toContain("codex ▾");
    await f.enter();
    expect(calls).toHaveLength(0);
    f.type("Review src/api/routes.ts without editing");
    await f.screen.flush();
    expect(f.screen.captureCharFrame()).not.toContain("/new session");
    await f.enter();
    expect(calls).toEqual([
      {
        provider: "codex",
        cwd: process.cwd(),
        project: undefined,
        agent: undefined,
        prompt: "Review src/api/routes.ts without editing",
      },
    ]);
    await f.palette("home");
    expect(f.screen.captureCharFrame()).toContain(
      "What would you like to work on?",
    );
    f.press("/");
    await f.screen.flush();
    f.type("provider");
    await f.screen.flush();
    expect(f.screen.captureCharFrame()).toContain("/provider");
    expect(calls).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("provider picker preserves the draft, rejects unavailable choices, and persists the selection", async () => {
  const f = await setup();
  try {
    f.type("Fix the checkout bug");
    await f.screen.flush();
    await f.palette("provider");
    expect(f.screen.captureCharFrame()).toContain("Choose session provider");
    f.type("agy");
    await f.screen.flush();
    await f.enter();
    expect(f.screen.captureCharFrame()).toContain("Not installed");
    expect(f.screen.captureCharFrame()).toContain("Choose session provider");
    flushSync(() => f.screen.mockInput.pressKey("u", { ctrl: true }));
    f.type("opencode");
    await f.screen.flush();
    await f.enter();
    expect(f.screen.captureCharFrame()).toContain("opencode ▾");
    expect(f.screen.captureCharFrame()).toContain("Fix the checkout bug");
    expect(f.app.preferredProvider()).toBe("opencode");
    const file = join(f.paths.config, "preferences.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      provider: "opencode",
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // Reopening the same application loads the preference instead of selecting Codex.
    f.reactRoot.unmount();
    const reopened = createRoot(f.screen.renderer);
    try {
      flushSync(() => reopened.render(<App app={f.app} />));
      await f.screen.flush();
      expect(f.screen.captureCharFrame()).toContain("opencode ▾");
    } finally {
      reopened.unmount();
    }
  } finally {
    await f.close();
  }
});

test("fallback and unavailable providers preserve messages without launching anything", async () => {
  const f = await setup([info("codex", false), info("opencode")]);
  try {
    expect(f.screen.captureCharFrame()).toContain("opencode ▾");
  } finally {
    await f.close();
  }
  const unavailable = await setup(
    [info("codex", false), info("opencode", false)],
    "codex",
  );
  let calls = 0;
  unavailable.app.newSession = async () => {
    calls++;
    throw new Error("Unexpected launch");
  };
  try {
    expect(unavailable.screen.captureCharFrame()).toContain(
      "codex ▾ (unavailable)",
    );
    unavailable.type("Keep this draft");
    await unavailable.screen.flush();
    await unavailable.enter();
    expect(calls).toBe(0);
    expect(unavailable.screen.captureCharFrame()).toContain("Keep this draft");
    expect(unavailable.screen.captureCharFrame()).toContain("Not installed");
  } finally {
    await unavailable.close();
  }
});

test("launch failure and palette cancellation keep the draft; home context reaches the native launcher", async () => {
  const f = await setup();
  const group = f.app.createProject("Business");
  const role = f.app.createAgent("Developer", "Follow project conventions");
  let received: Parameters<Application["newSession"]>[0] | undefined;
  f.app.newSession = async (input) => {
    received = input;
    throw new Error("Native startup failed");
  };
  const replace = (text: string) => {
    flushSync(() => f.screen.mockInput.pressKey("u", { ctrl: true }));
    f.type(text);
  };
  try {
    f.type("Inspect the application");
    await f.screen.flush();
    await f.palette("directory");
    replace(f.root);
    await f.enter();
    await f.palette("project");
    f.type(group.name);
    await f.enter();
    await f.palette("agent");
    f.type(role.name);
    await f.enter();
    expect(f.screen.captureCharFrame()).toContain("Developer");
    expect(f.screen.captureCharFrame()).toContain("Business");
    await f.palette("provider");
    f.press("ESCAPE");
    await Bun.sleep(60);
    await f.screen.flush();
    expect(f.screen.captureCharFrame()).toContain("Inspect the application");
    await f.enter();
    expect(received).toEqual({
      provider: "codex",
      cwd: f.root,
      project: group.id,
      agent: role.id,
      prompt: "Inspect the application",
    });
    expect(f.screen.captureCharFrame()).toContain("Native startup failed");
    expect(f.screen.captureCharFrame()).toContain("Inspect the application");
  } finally {
    await f.close();
  }
});
