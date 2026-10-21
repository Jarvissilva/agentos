import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { App } from "../src/tui/app";
import { fixture } from "./helpers";

test("dashboard renders, navigation opens projects, and small terminals remain usable", async () => {
  const f = fixture();
  f.app.createProject("Example workspace", f.root);
  const screen = await createTestRenderer({ width: 100, height: 32 });
  const root = createRoot(screen.renderer);
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("AGENT OS");
    expect(screen.captureCharFrame()).toContain("Start a native session");
    await screen.mockInput.pressArrow("down");
    await screen.mockInput.pressArrow("down");
    await screen.mockInput.pressKey("RETURN");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Example workspace");
    flushSync(() => screen.mockInput.pressKey("n"));
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("New project");
    flushSync(() => {
      for (const char of "Another project") screen.mockInput.pressKey(char);
    });
    flushSync(() => screen.mockInput.pressEnter());
    await screen.flush();
    flushSync(() => screen.mockInput.pressEnter());
    await screen.flush();
    flushSync(() => screen.mockInput.pressEnter());
    await screen.flush();
    expect(f.app.project("Another project").cwd).toBe(process.cwd());
    screen.resize(50, 12);
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Resize the terminal");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("configuration and automation pages open real forms and provider selection is native", async () => {
  const f = fixture();
  const screen = await createTestRenderer({ width: 110, height: 40 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    for (let i = 0; i < 4; i++) press("ARROW_DOWN");
    press("RETURN");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Discover native skills");
    press("n");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("New skill");
    press("ESCAPE");
    await Bun.sleep(60);
    flushSync(() => {});
    await screen.flush();
    press("TAB");
    press("ARROW_DOWN");
    press("RETURN");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("MCPs");
    press("n");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Register MCP");
    press("ESCAPE");
    await Bun.sleep(60);
    flushSync(() => {});
    await screen.flush();
    press("TAB");
    press("ARROW_DOWN");
    press("ARROW_DOWN");
    press("RETURN");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Automations");
    press("n");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("New automation");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});
