import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { commands } from "../src/cli/commands";
import type { ProviderInfo } from "../src/lib/providers/types";
import { McpService } from "../src/modules/mcps/service";
import { App } from "../src/tui/app";
import { fixture } from "./helpers";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0).reverse()) close();
});
const available: ProviderInfo[] = (["codex", "opencode", "agy"] as const).map(
  (id) => ({
    id,
    installed: true,
    interactive: true,
    history: true,
    version: "test",
    reason: null,
  }),
);
function setup() {
  const f = fixture();
  cleanups.push(() => f.close());
  const isolated = new McpService(
    f.storage.db,
    f.root,
    join(f.root, "config"),
    join(f.root, "codex"),
  );
  const path = spyOn(f.app.mcps, "configPath").mockImplementation((provider) =>
    isolated.configPath(provider),
  );
  const detection = spyOn(f.app.providers, "list").mockResolvedValue(available);
  cleanups.push(
    () => path.mockRestore(),
    () => detection.mockRestore(),
  );
  const mcp = f.app.mcps.register({
    name: "research",
    transport: "stdio",
    command: "example",
  });
  return { ...f, mcp, detection };
}

test("install all validates first, refreshes detection, and reinstalls without duplicates", async () => {
  const f = setup();
  await expect(f.app.installMcpAll("missing")).rejects.toThrow("MCP not found");
  expect(f.detection).not.toHaveBeenCalled();
  expect(f.app.mcps.installations(f.mcp.id)).toHaveLength(0);
  const result = await f.app.installMcpAll(f.mcp.name);
  expect(result.summary).toEqual({ installed: 3, skipped: 0, failed: 0 });
  expect(result.success).toBe(true);
  const files = available.map((p) =>
    readFileSync(f.app.mcps.configPath(p.id), "utf8").trim(),
  );
  await f.app.installMcpAll(f.mcp.id);
  expect(f.detection).toHaveBeenCalledTimes(2);
  expect(f.app.mcps.installations(f.mcp.id)).toHaveLength(3);
  expect(
    f.app.mcps.installations(f.mcp.id).every((i) => i.status === "installed"),
  ).toBe(true);
  expect(
    available.map((p) =>
      readFileSync(f.app.mcps.configPath(p.id), "utf8").trim(),
    ),
  ).toEqual(files);
});

test("install all reports missing and unsupported providers and fails when none install", async () => {
  const f = setup();
  f.detection.mockResolvedValue(
    available.map((p) => ({
      ...p,
      installed: p.id !== "opencode",
      interactive: p.id === "codex",
      reason: p.id === "agy" ? "Unsupported native version" : null,
    })),
  );
  const partial = await f.app.installMcpAll(f.mcp.id);
  expect(partial.summary).toEqual({ installed: 1, skipped: 2, failed: 0 });
  expect(partial.success).toBe(true);
  expect(partial.results[2]).toMatchObject({
    status: "skipped",
    reason: "Unsupported native version",
  });
  f.detection.mockResolvedValue(
    available.map((p) => ({ ...p, installed: false, interactive: false })),
  );
  const none = await f.app.installMcpAll(f.mcp.id);
  expect(none.summary).toEqual({ installed: 0, skipped: 3, failed: 0 });
  expect(none.success).toBe(false);
});

test("native capability detection failures become skipped results", async () => {
  const f = setup();
  f.detection.mockRestore();
  for (const p of available) {
    const detection = spyOn(
      f.app.providers.adapter(p.id),
      "detect",
    ).mockRejectedValue(new Error("private detection details"));
    cleanups.push(() => detection.mockRestore());
  }
  const result = await f.app.installMcpAll(f.mcp.id);
  expect(result.success).toBe(false);
  expect(result.results).toHaveLength(3);
  for (const r of result.results)
    expect(r).toMatchObject({
      status: "skipped",
      reason:
        "Native capability detection failed; inspect the provider directly",
    });
});

for (const failure of ["malformed", "conflict", "credentials"] as const) {
  test(`install all retains other successes after ${failure} failure`, async () => {
    const f = setup();
    const file = f.app.mcps.configPath("opencode");
    if (failure === "credentials") {
      f.app.mcps.update(f.mcp.id, {
        name: f.mcp.name,
        transport: "http",
        url: "https://example.com/mcp",
        bearerEnv: "EXAMPLE_TOKEN",
      });
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        failure === "malformed"
          ? "{broken"
          : '{"mcp":{"research":{"command":"external"}}}',
      );
    }
    const result = await f.app.installMcpAll(f.mcp.id);
    expect(result.success).toBe(false);
    expect(result.summary).toEqual({ installed: 2, skipped: 0, failed: 1 });
    expect(result.results.find((r) => r.status === "failed")?.provider).toBe(
      failure === "credentials" ? "agy" : "opencode",
    );
    expect(f.app.mcps.installations(f.mcp.id)).toHaveLength(2);
    if (failure !== "credentials")
      expect(readFileSync(file, "utf8")).toBe(
        failure === "malformed"
          ? "{broken"
          : '{"mcp":{"research":{"command":"external"}}}',
      );
  });
}

test("batch errors are redacted and do not prevent later installations", async () => {
  const f = setup();
  const install = f.app.mcps.install.bind(f.app.mcps);
  const mock = spyOn(f.app.mcps, "install").mockImplementation(
    (id, provider) => {
      if (provider === "codex") throw new Error("Bearer sensitive-token");
      install(id, provider);
    },
  );
  cleanups.push(() => mock.mockRestore());
  const result = await f.app.installMcpAll(f.mcp.id);
  expect(result.results[0]).toEqual({
    provider: "codex",
    status: "failed",
    error: "Bearer [REDACTED]",
  });
  expect(result.summary.installed).toBe(2);
});

test("CLI prints structured outcomes and sets failure status for failure or no installations", async () => {
  const f = setup();
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((text) =>
    output.push(text),
  );
  const previous = process.exitCode;
  cleanups.push(() => {
    log.mockRestore();
    process.exitCode = previous ?? 0;
  });
  const run = () =>
    commands(f.app)
      .exitOverride()
      .parseAsync(["mcps", "install-all", "research"], { from: "user" });
  process.exitCode = 0;
  await run();
  expect(process.exitCode).toBe(0);
  expect(JSON.parse(output.at(-1) ?? "").summary.installed).toBe(3);
  const install = spyOn(f.app.mcps, "install").mockImplementation(() => {
    throw new Error("test failure");
  });
  cleanups.push(() => install.mockRestore());
  await run();
  expect(process.exitCode).toBe(1);
  expect(JSON.parse(output.at(-1) ?? "").summary.failed).toBe(3);
  process.exitCode = 0;
  f.detection.mockResolvedValue(
    available.map((p) => ({ ...p, installed: false })),
  );
  await run();
  expect(process.exitCode).toBe(1);
  expect(JSON.parse(output.at(-1) ?? "").summary.skipped).toBe(3);
  expect(JSON.parse(output.at(-1) ?? "").reminder).toContain(
    "fresh provider sessions",
  );
});

test("TUI installs the selected MCP, reports every outcome, and preserves navigation", async () => {
  const f = setup();
  f.app.mcps.register({ name: "other", transport: "stdio", command: "other" });
  f.detection.mockResolvedValue(
    available.map((p) => ({ ...p, installed: p.id !== "agy" })),
  );
  const install = f.app.mcps.install.bind(f.app.mcps);
  const failedInstall = spyOn(f.app.mcps, "install").mockImplementation(
    (id, provider) => {
      if (provider === "opencode") throw new Error("Native MCP entry exists");
      install(id, provider);
    },
  );
  cleanups.push(() => failedInstall.mockRestore());
  const screen = await createTestRenderer({ width: 120, height: 44 });
  const root = createRoot(screen.renderer);
  const run = async (command: string) => {
    flushSync(() => screen.mockInput.pressKey("p", { ctrl: true }));
    await screen.flush();
    flushSync(() => {
      for (const char of command) screen.mockInput.pressKey(char);
    });
    await screen.flush();
    flushSync(() => screen.mockInput.pressEnter());
    await screen.flush();
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    await run("mcps");
    await run("install all");
    const frame = screen.captureCharFrame();
    expect(frame).toContain("Install research");
    expect(frame).toContain("codex: installed");
    expect(frame).toContain("opencode: failed");
    expect(frame).toContain("Native MCP entry exists");
    expect(frame).toContain("agy: skipped");
    expect(frame).toContain("1 installed, 1 skipped, 1 failed");
    expect(frame).toContain("fresh provider sessions");
    expect(f.app.mcps.installations("other")).toHaveLength(0);
    flushSync(() => screen.mockInput.pressKey("ESCAPE"));
    await Bun.sleep(60);
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("MCP servers");
    expect(screen.captureCharFrame()).toContain("research");
  } finally {
    root.unmount();
    screen.renderer.destroy();
  }
});
