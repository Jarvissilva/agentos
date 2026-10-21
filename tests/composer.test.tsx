import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import type { Application } from "../src/app";
import { sourceCheckoutDirectory } from "../src/lib/platform/paths";
import type { ProviderId, ProviderInfo } from "../src/lib/providers/types";
import { sessions } from "../src/lib/storage/schema";
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
  providers: ProviderInfo[] | Promise<ProviderInfo[]> = [
    info("codex"),
    info("opencode"),
    info("agy", false),
  ],
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

test.each(["codex", "opencode", "agy"] as const)(
  "/builder starts fresh %s sessions without inheriting Home context",
  async (provider) => {
    const f = await setup(
      [info("codex"), info("opencode"), info("agy")],
      provider,
    );
    const calls: Parameters<Application["newSession"]>[0][] = [];
    const project = f.app.createProject("Business");
    const agent = f.app.createAgent("Developer", "Follow project conventions");
    f.app.newSession = async (input, _handoff, launcher) => {
      expect(launcher).toBeDefined();
      calls.push(input);
      return f.storage.db
        .insert(sessions)
        .values({
          id: `builder-${calls.length}`,
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
      f.type("Preserve this draft");
      await f.palette("directory");
      flushSync(() => f.screen.mockInput.pressKey("u", { ctrl: true }));
      f.type(f.root);
      await f.enter();
      await f.palette("project");
      f.type(project.name);
      await f.enter();
      await f.palette("agent");
      f.type(agent.name);
      await f.enter();

      // The action is shared by Home, resource lists, and resource details.
      for (const section of [
        "home",
        "agents",
        "skills",
        "automations",
        "projects",
        "mcps",
        "providers",
        "runs",
        "notifications",
        "settings",
        "sessions",
      ]) {
        await f.palette(section);
        await f.palette("builder");
      }
      await f.palette("projects");
      await f.enter();
      await f.palette("builder");
      expect(calls).toHaveLength(12);
      for (const call of calls)
        expect(call).toEqual({
          cwd: sourceCheckoutDirectory(),
          provider,
          project: undefined,
          agent: undefined,
        });
      expect(f.app.listSessions()).toHaveLength(12);
      await f.palette("home");
      const frame = f.screen.captureCharFrame();
      expect(frame).toContain("Preserve this draft");
      expect(frame).toContain(f.root);
      expect(frame).toContain("Business");
      expect(frame).toContain("Developer");
      expect(f.app.defaultDirectory()).toBeUndefined();
    } finally {
      await f.close();
    }
  },
);

test("/builder uses the available fallback but never replaces an unavailable saved provider", async () => {
  for (const preferred of [undefined, "codex"] as const) {
    const f = await setup([info("codex", false), info("opencode")], preferred);
    const calls: Parameters<Application["newSession"]>[0][] = [];
    f.app.newSession = async (input) => {
      calls.push(input);
      throw new Error("Launch failed");
    };
    try {
      f.type("Keep my draft");
      await f.palette("builder");
      expect(calls).toHaveLength(preferred ? 0 : 1);
      if (!preferred) expect(calls[0]?.provider).toBe("opencode");
      const frame = f.screen.captureCharFrame();
      expect(frame).toContain(preferred ? "Not installed" : "Launch failed");
      expect(frame).toContain("Keep my draft");
    } finally {
      await f.close();
    }
  }
});

test("/builder reports when no interactive provider is available", async () => {
  const f = await setup([
    info("codex", false),
    info("opencode", false),
    info("agy", false),
  ]);
  f.app.newSession = async () => {
    throw new Error("Unexpected launch");
  };
  try {
    await f.palette("builder");
    expect(f.screen.captureCharFrame()).toContain(
      "No interactive provider available",
    );
    expect(f.app.listSessions()).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("/builder waits for provider detection before launching", async () => {
  let completeDetection: (providers: ProviderInfo[]) => void = () => {};
  const detection = new Promise<ProviderInfo[]>((resolve) => {
    completeDetection = resolve;
  });
  const f = await setup(detection, "codex");
  let calls = 0;
  f.app.newSession = async () => {
    calls++;
    throw new Error("Launch attempted");
  };
  try {
    await f.palette("builder");
    expect(calls).toBe(0);
    expect(f.screen.captureCharFrame()).toContain(
      "Detecting providers; please wait.",
    );
    completeDetection([info("codex")]);
    await f.screen.flush();
    await f.palette("builder");
    expect(calls).toBe(1);
    expect(f.screen.captureCharFrame()).toContain("Launch attempted");
  } finally {
    completeDetection([]);
    await f.close();
  }
});
