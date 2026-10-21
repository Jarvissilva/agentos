import { expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { commands } from "../src/cli/commands";
import { App } from "../src/tui/app";
import { fixture } from "./helpers";

test("settings persist session defaults privately and preserve unrelated preferences", async () => {
  const f = fixture();
  const original = console.log;
  const output: unknown[] = [];
  console.log = (text: string) => output.push(JSON.parse(text));
  const run = (...args: string[]) =>
    commands(f.app).exitOverride().parseAsync(args, { from: "user" });
  try {
    await run("settings", "provider", "opencode");
    const file = join(f.paths.config, "preferences.json");
    writeFileSync(
      file,
      JSON.stringify({ provider: "opencode", extra: "preserved" }),
    );
    await run("settings", "directory", f.root);
    expect(f.app.defaultDirectory()).toBe(f.root);
    expect(f.app.preferredProvider()).toBe("opencode");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).extra).toBe("preserved");
    await expect(
      run("settings", "directory", "/missing-agentos-settings"),
    ).rejects.toThrow();
    expect(f.app.defaultDirectory()).toBe(f.root);
    await run("settings", "show");
    expect(output.at(-1)).toEqual({
      provider: "opencode",
      defaultDirectory: f.root,
      providerDefaults: { codex: {}, opencode: {}, agy: {} },
    });
    await expect(
      run("settings", "directory", f.root, "--clear"),
    ).rejects.toThrow("exclusively");
    await run("settings", "directory", "--clear");
    expect(f.app.defaultDirectory()).toBeUndefined();
    expect(f.app.preferredProvider()).toBe("opencode");
  } finally {
    console.log = original;
    f.close();
  }
});

test("settings modal edits defaults, shows paths, and confirms scheduler installation without losing drafts", async () => {
  const f = fixture();
  f.app.detectProviders = async () => [
    {
      id: "codex",
      installed: true,
      version: "test",
      interactive: true,
      history: true,
      reason: null,
    },
  ];
  const screen = await createTestRenderer({ width: 120, height: 44 });
  const root = createRoot(screen.renderer);
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const enter = async () => {
    flushSync(() => screen.mockInput.pressEnter());
    await screen.flush();
  };
  const arrow = async (direction: "up" | "down") => {
    flushSync(() => screen.mockInput.pressArrow(direction));
    await screen.flush();
  };
  const run = async (command: string) => {
    flushSync(() => screen.mockInput.pressKey("p", { ctrl: true }));
    await screen.flush();
    type(command);
    await screen.flush();
    await enter();
  };
  const back = async () => {
    press("ESCAPE");
    await Bun.sleep(60);
    await screen.flush();
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    type("Keep my task");
    await screen.flush();
    await run("settings");
    expect(screen.captureCharFrame()).toContain("Settings");
    expect(screen.captureCharFrame()).toContain("Default provider");
    expect(screen.captureCharFrame()).toContain("Default working directory");
    expect(screen.captureCharFrame()).toContain("Storage paths");
    expect(screen.captureCharFrame()).toContain("Background scheduler");
    await enter(); // selected provider
    expect(screen.captureCharFrame()).toContain("Choose session provider");
    await enter();
    expect(f.app.preferredProvider()).toBe("codex");
    for (let i = 0; i < 4; i++) await arrow("down");
    await enter();
    expect(screen.captureCharFrame()).toContain("Directory (optional)");
    type(f.root);
    await enter();
    expect(f.app.defaultDirectory()).toBe(f.root);
    await arrow("down");
    await enter(); // paths
    expect(screen.captureCharFrame()).toContain(f.paths.config);
    await back();
    await run("scheduler install");
    expect(screen.captureCharFrame()).toContain("Confirm");
    press("n");
    await screen.flush();
    expect(screen.captureCharFrame()).not.toContain("Confirm");
    await run("home");
    expect(screen.captureCharFrame()).toContain("Keep my task");
    expect(screen.captureCharFrame()).toContain(f.root);
    await run("new session");
    await enter(); // no project -> directory
    expect(screen.captureCharFrame()).toContain("Session working directory");
    expect(screen.captureCharFrame()).toContain(f.root);
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("model pickers search native choices, save pairs, cancel safely, retry discovery, and preserve Home drafts through resize", async () => {
  const f = fixture();
  const models = {
    reasoningLabel: "reasoning effort",
    models: [
      {
        id: "test-model",
        name: "Test Model",
        reasoning: [{ id: "high" }, { id: "low" }],
      },
      { id: "simple", name: "Simple", reasoning: [] },
    ],
  };
  f.app.modelCatalog = async () => models;
  f.app.detectProviders = async () => [
    {
      id: "codex",
      installed: true,
      version: "test",
      interactive: true,
      history: true,
      reason: null,
    },
  ];
  await f.app.setProviderDefaults("codex", {
    model: "test-model",
    reasoning: "high",
  });
  const screen = await createTestRenderer({ width: 120, height: 44 });
  const root = createRoot(screen.renderer);
  const flush = async () => {
    await Bun.sleep(20);
    await screen.flush();
  };
  const type = async (text: string) => {
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
    await flush();
  };
  const enter = async () => {
    flushSync(() => screen.mockInput.pressEnter());
    await flush();
  };
  const backPicker = async () => {
    flushSync(() => screen.mockInput.pressKey("ESCAPE"));
    await Bun.sleep(60);
    await flush();
  };
  const run = async (command: string) => {
    flushSync(() => screen.mockInput.pressKey("p", { ctrl: true }));
    await flush();
    await type(command);
    await enter();
  };
  const open = async () => {
    await run("settings");
    flushSync(() => screen.mockInput.pressArrow("down"));
    await flush();
    await enter();
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await flush();
    await type("Retain this task");
    await open();
    expect(screen.captureCharFrame()).toContain("codex model");
    await type("simple");
    await enter();
    expect(screen.captureCharFrame()).toContain("reasoning effort");
    await type("high");
    expect(screen.captureCharFrame()).toContain("No choices match");
    // Canceling the second stage must leave the saved pair intact.
    await backPicker();
    expect(f.app.providerDefaults("codex")).toEqual({
      model: "test-model",
      reasoning: "high",
    });
    await enter(); // reopen selected defaults row
    await type("simple");
    await enter();
    await enter();
    expect(f.app.providerDefaults("codex")).toEqual({ model: "simple" });
    await enter();
    await type("test-model");
    await enter();
    await type("low");
    await enter();
    expect(f.app.providerDefaults("codex")).toEqual({
      model: "test-model",
      reasoning: "low",
    });
    await run("home");
    expect(screen.captureCharFrame()).toContain("Retain this task");
    expect(screen.captureCharFrame()).toContain("test-model · low");
    f.app.modelCatalog = async () => {
      throw new Error("Catalog offline");
    };
    await open();
    expect(screen.captureCharFrame()).toContain("Discovery failed");
    expect(f.app.providerDefaults("codex")).toEqual({
      model: "test-model",
      reasoning: "low",
    });
    await type("Retry");
    f.app.modelCatalog = async () => ({ ...models, models: [] });
    await enter();
    expect(screen.captureCharFrame()).toContain("No models available");
    await backPicker();
    f.app.modelCatalog = async () => {
      throw new Error("Catalog offline");
    };
    await enter(); // reopen defaults, clearing still works offline
    await enter();
    expect(f.app.providerDefaults("codex")).toEqual({});
    let resolve: (value: typeof models) => void = () => {};
    f.app.modelCatalog = () =>
      new Promise((r) => {
        resolve = r;
      });
    await enter();
    expect(screen.captureCharFrame()).toContain("Loading models");
    await backPicker();
    resolve(models);
    await flush();
    expect(screen.captureCharFrame()).not.toContain("Use provider default");
    f.app.modelCatalog = async () => models;
    await enter();
    screen.resize(72, 25);
    await flush();
    expect(screen.captureCharFrame()).toContain("codex model");
    await backPicker();
    await run("home");
    expect(screen.captureCharFrame()).toContain("Retain this task");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});
