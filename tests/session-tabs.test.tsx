import { expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { EmbeddedTerminalRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { EmbeddedProcess } from "../src/platform/embedded-process";
import { ProviderManager } from "../src/providers/manager";
import type { ProviderAdapter } from "../src/providers/types";
import { App } from "../src/tui/app";
import { fixture } from "./helpers";

class Providers extends ProviderManager {
  launches = 0;
  failLaunch = false;
  paintBounds = false;
  override adapter(): ProviderAdapter {
    return {
      id: "codex",
      detect: async () => ({
        id: "codex",
        installed: true,
        version: "test",
        interactive: true,
        history: true,
        reason: null,
      }),
      connect: async () => ({
        create: async () => ({
          threadId: randomUUID(),
          sessionId: randomUUID(),
        }),
        resume: async () => {},
        history: async () => [],
        close: async () => {},
        launch: async (_id, cwd, prompt, _options, runner) => {
          this.launches++;
          if (!runner) throw new Error("Expected embedded runner");
          return runner(
            this.failLaunch ? "/missing-agentos-provider" : process.execPath,
            [
              "-e",
              this.paintBounds
                ? `process.stdin.setRawMode(true);const draw=()=>{const [rows,cols]=require("node:child_process").execFileSync("stty",["size"],{stdio:["inherit","pipe","inherit"]}).toString().trim().split(" ").map(Number);process.stdout.write("\\x1b[2J\\x1b[HSIZE:"+cols+"x"+rows+"\\x1b[1;"+(cols-4)+"HRIGHT\\x1b["+rows+";1HBOTTOM")};process.on("SIGWINCH",draw);draw();process.stdin.resume();`
                : `process.stdin.setRawMode(true);console.log("PROVIDER:"+${JSON.stringify(prompt ?? "resumed")});process.stdin.on("data",bytes=>console.log("KEY:"+bytes.toString()));setInterval(()=>{},100);`,
            ],
            cwd,
          );
        },
      }),
    };
  }
  override async list() {
    return [await this.adapter().detect()];
  }
}

async function setup() {
  const providers = new Providers();
  const f = fixture(providers);
  const screen = await createTestRenderer({
    width: 110,
    height: 40,
    kittyKeyboard: true,
  });
  const root = createRoot(screen.renderer);
  const type = async (value: string) => {
    flushSync(() => {
      for (const char of value) screen.mockInput.pressKey(char);
    });
    await screen.flush();
  };
  const key = async (
    value: string,
    modifiers: { ctrl?: boolean; meta?: boolean } = {},
  ) => {
    flushSync(() => screen.mockInput.pressKey(value, modifiers));
    await screen.flush();
  };
  const enter = async () => {
    flushSync(() => screen.mockInput.pressEnter());
    await screen.flush();
  };
  const until = async (check: () => boolean) => {
    const deadline = Date.now() + 4000;
    while (!check()) {
      if (Date.now() > deadline)
        throw new Error(`Timed out\n${screen.captureCharFrame()}`);
      await Bun.sleep(20);
      await screen.flush();
    }
  };
  flushSync(() => root.render(<App app={f.app} />));
  await screen.flush();
  return {
    ...f,
    providers,
    screen,
    key,
    type,
    enter,
    until,
    async closeUI() {
      flushSync(() => root.unmount());
      await screen.dispose();
      await f.app.settleInteractiveSessions();
    },
  };
}

test("tabs preserve independent drafts, launch context, and forms across keyboard switching", async () => {
  const f = await setup();
  try {
    await f.type("First draft");
    await f.key("t", { ctrl: true });
    expect(f.screen.captureCharFrame()).not.toContain("First draft");
    await f.type("Second draft");
    await f.key("1", { ctrl: true });
    expect(f.screen.captureCharFrame()).toContain("First draft");
    expect(f.screen.captureCharFrame()).not.toContain("Second draft");
    await f.key("2", { meta: true });
    expect(f.screen.captureCharFrame()).toContain("Second draft");
    await f.key("p", { ctrl: true });
    await f.type("directory");
    await f.enter();
    await f.key("1", { ctrl: true });
    await f.key("ESCAPE");
    await Bun.sleep(60);
    await f.screen.flush();
    await f.key("2", { ctrl: true });
    expect(f.screen.captureCharFrame()).toContain("Session working directory");
    await f.key("ESCAPE");
    await Bun.sleep(60);
    await f.screen.flush();
    expect(f.screen.captureCharFrame()).toContain("Second draft");
    await f.key("w", { ctrl: true });
    expect(f.screen.captureCharFrame()).toContain("First draft");
    await f.key("w", { ctrl: true });
    expect(f.screen.captureCharFrame()).toContain("New session");
    expect(f.screen.captureCharFrame()).not.toContain("First draft");
  } finally {
    await f.closeUI();
    f.close();
  }
});

test("tab labels use the session title and refresh when a session is renamed", async () => {
  const input = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const output = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  const f = await setup();
  try {
    await f.type("Tab title task");
    await f.enter();
    await f.until(() =>
      f.screen.captureCharFrame().includes("PROVIDER:Tab title task"),
    );
    await f.key("F2");
    expect(f.screen.captureCharFrame()).toContain("codex · Tab title task");
    const session = f.app.listSessions()[0];
    expect(session?.title).toBe("Tab title task");
    if (!session) throw new Error("Session was not created");
    await f.app.renameSession(session.id, "Renamed tab");
    await f.screen.flush();
    await f.until(() =>
      f.screen.captureCharFrame().includes("codex · Renamed tab"),
    );
  } finally {
    await f.closeUI();
    f.close();
    if (input) Object.defineProperty(process.stdin, "isTTY", input);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    if (output) Object.defineProperty(process.stdout, "isTTY", output);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  }
});

test("provider UIs remain live in separate tabs; switching routes input and quitting settles attachments", async () => {
  const input = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const output = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  const f = await setup();
  let closed = false;
  try {
    await f.type("First task");
    await f.enter();
    await f.until(() =>
      f.screen.captureCharFrame().includes("PROVIDER:First task"),
    );
    expect(f.app.listSessions()[0]?.status).toBe("attached");
    await f.key("t", { ctrl: true });
    await f.type("Second task");
    await f.enter();
    await f.until(() =>
      f.screen.captureCharFrame().includes("PROVIDER:Second task"),
    );
    expect(f.providers.launches).toBe(2);
    expect(f.app.listSessions().every((s) => s.status === "attached")).toBe(
      true,
    );
    await f.key("1", { ctrl: true });
    expect(f.screen.captureCharFrame()).toContain("PROVIDER:First task");
    await f.type("a");
    await f.until(() => f.screen.captureCharFrame().includes("KEY:a"));
    await f.key("2", { ctrl: true });
    expect(f.screen.captureCharFrame()).toContain("PROVIDER:Second task");
    expect(f.screen.captureCharFrame()).not.toContain("KEY:a");
    f.screen.resize(72, 25);
    await f.screen.flush();
    expect(f.screen.captureCharFrame()).toContain("PROVIDER:Second task");
    await f.key("F2");
    await f.key("p", { ctrl: true });
    await f.type("sessions");
    await f.enter();
    expect(f.screen.captureCharFrame()).toContain("Sessions");
    await f.key("p", { ctrl: true });
    await f.type("resume");
    await f.enter();
    expect(f.providers.launches).toBe(2); // focuses the existing tab
    expect(f.screen.captureCharFrame()).toContain("PROVIDER:");
    await f.key("w", { ctrl: true });
    await f.until(() => f.app.listSessions().some((s) => s.status === "idle"));
    expect(
      f.app.listSessions().filter((s) => s.status === "attached"),
    ).toHaveLength(1);
    await f.closeUI();
    closed = true;
    expect(f.app.listSessions().every((s) => s.status === "idle")).toBe(true);
  } finally {
    if (!closed) await f.closeUI();
    f.close();
    if (input) Object.defineProperty(process.stdin, "isTTY", input);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    if (output) Object.defineProperty(process.stdout, "isTTY", output);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  }
}, 15_000);

test("failed embedded startup leaves the task draft available on the dashboard", async () => {
  const input = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const output = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  const f = await setup();
  f.providers.failLaunch = true;
  try {
    await f.type("Keep this failed launch draft");
    await f.enter();
    await f.until(() => f.app.listSessions()[0]?.status === "failed");
    await f.key("F2");
    expect(f.screen.captureCharFrame()).toContain(
      "Keep this failed launch draft",
    );
  } finally {
    await f.closeUI();
    f.close();
    if (input) Object.defineProperty(process.stdin, "isTTY", input);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    if (output) Object.defineProperty(process.stdout, "isTTY", output);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  }
});

test("compact provider viewport fills the width and keeps its right and bottom edges visible after resize", async () => {
  const input = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const output = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  const f = await setup();
  f.providers.paintBounds = true;
  const originalResize = EmbeddedProcess.prototype.resize;
  const resizing: { requested: number[]; display: number[] }[] = [];
  const resize = spyOn(EmbeddedProcess.prototype, "resize").mockImplementation(
    function (this: EmbeddedProcess, columns: number, rows: number) {
      const session = f.app.listSessions()[0];
      const surface = session
        ? f.screen.renderer.root.findDescendantById(`terminal-${session.id}`)
        : undefined;
      if (surface instanceof EmbeddedTerminalRenderable)
        resizing.push({
          requested: [columns, rows],
          display: [surface.width, surface.height],
        });
      originalResize.call(this, columns, rows);
    },
  );
  try {
    await f.type("Check viewport");
    await f.enter();
    await f.until(() => f.screen.captureCharFrame().includes("SIZE:108x37"));
    let lines = f.screen.captureCharFrame().split("\n");
    expect(lines[1]?.[0]).toBe("┌");
    expect(lines[1]?.[109]).toBe("┐");
    expect(lines[2]?.indexOf("SIZE:")).toBe(1);
    expect(lines[2]?.indexOf("RIGHT")).toBe(104);
    expect(lines[38]?.indexOf("BOTTOM")).toBe(1);
    expect(lines[39]?.[109]).toBe("┘");
    f.screen.resize(72, 25);
    await f.screen.flush();
    await f.until(() => f.screen.captureCharFrame().includes("SIZE:70x22"));
    lines = f.screen.captureCharFrame().split("\n");
    expect(lines[1]?.[71]).toBe("┐");
    expect(lines[2]?.indexOf("RIGHT")).toBe(66);
    expect(lines[23]?.indexOf("BOTTOM")).toBe(1);
    expect(lines[24]?.[71]).toBe("┘");
    for (const [width, height] of [
      [140, 46],
      [85, 24],
      [155, 48],
      [72, 22],
      [110, 40],
      [80, 20],
      [140, 46],
    ] as const) {
      f.screen.resize(width, height);
      await f.screen.flush();
      await Bun.sleep(5);
    }
    await f.until(() => f.screen.captureCharFrame().includes("SIZE:138x43"));
    const finalLines = f.screen.captureCharFrame().split("\n");
    expect(finalLines[44]?.indexOf("BOTTOM")).toBe(1);
    expect(resizing.length).toBeGreaterThan(1);
    expect(
      resizing.every(
        (size) =>
          size.requested[0] === size.display[0] &&
          size.requested[1] === size.display[1],
      ),
    ).toBe(true);
    expect(f.providers.launches).toBe(1);
  } finally {
    resize.mockRestore();
    await f.closeUI();
    f.close();
    if (input) Object.defineProperty(process.stdin, "isTTY", input);
    else Reflect.deleteProperty(process.stdin, "isTTY");
    if (output) Object.defineProperty(process.stdout, "isTTY", output);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  }
});
