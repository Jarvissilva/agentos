import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { sessions } from "../src/lib/storage/schema";
import { App } from "../src/tui/app";
import { fixture } from "./helpers";

test("hero opens sections from slash commands, creates a project, and stays usable when small", async () => {
  const f = fixture();
  f.app.createProject("Example workspace", "A demo workspace");
  const screen = await createTestRenderer({ width: 100, height: 32 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = () => flushSync(() => screen.mockInput.pressEnter());
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    const home = screen.captureCharFrame();
    expect(home).toContain("AgentOS");
    expect(home).toContain("Your local agent workspace");
    expect(home).toContain("What would you like to work on?");
    expect(home).toContain("commands");
    expect(home).toContain("send");
    expect(home).toContain("Ctrl+P");

    press("/");
    await screen.flush();
    type("projects");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("/projects");
    expect(screen.captureCharFrame()).toContain(
      "Groups for sessions and automations",
    );
    enter();
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Projects");
    expect(screen.captureCharFrame()).toContain("Example workspace");

    press("/");
    await screen.flush();
    type("new project");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("/new project");
    enter();
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("New project");
    expect(screen.captureCharFrame()).not.toContain("Working directory");

    type("Another project");
    enter();
    enter();
    await screen.flush();
    expect(f.app.project("Another project").description).toBe("");
    expect(screen.captureCharFrame()).toContain("Project created");

    screen.resize(50, 12);
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Resize the terminal");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("opening the slash palette does not resize or move the globe", async () => {
  const f = fixture();
  const screen = await createTestRenderer({ width: 100, height: 40 });
  const root = createRoot(screen.renderer);
  const bounds = (frame: string) => {
    const rows = frame.split("\n");
    let top = Infinity;
    let left = Infinity;
    let right = -1;
    rows.forEach((line, y) => {
      if (y < 4) return;
      for (const [x, char] of [...line].entries()) {
        if (char !== "█" && char !== "•") continue;
        top = Math.min(top, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    });
    return { top, left, right };
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    const home = bounds(screen.captureCharFrame());
    flushSync(() => screen.mockInput.pressKey("/"));
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("/settings");
    expect(bounds(screen.captureCharFrame())).toEqual(home);
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("slash palette reaches configuration sections and every creation form", async () => {
  const f = fixture();
  const screen = await createTestRenderer({ width: 110, height: 40 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = () => flushSync(() => screen.mockInput.pressEnter());
  const back = async () => {
    press("ESCAPE");
    await Bun.sleep(60);
    flushSync(() => {});
    await screen.flush();
  };
  const run = async (command: string) => {
    press("/");
    await screen.flush();
    type(command);
    await screen.flush();
    enter();
    await screen.flush();
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();

    await run("skills");
    expect(screen.captureCharFrame()).toContain("No managed skills");
    await run("new skill");
    expect(screen.captureCharFrame()).toContain("New skill");
    expect(screen.captureCharFrame()).toContain("Instructions");
    await back();
    expect(screen.captureCharFrame()).toContain("Skills");

    await run("mcps");
    expect(screen.captureCharFrame()).toContain("MCP servers");
    await run("new mcp");
    expect(screen.captureCharFrame()).toContain("Register MCP");
    expect(screen.captureCharFrame()).toContain("Definition (YAML)");
    await back();

    await run("automations");
    expect(screen.captureCharFrame()).toContain("Automations");
    expect(screen.captureCharFrame()).toContain("No automations");
    await run("new automation");
    expect(screen.captureCharFrame()).toContain("New automation");
    await back();

    await run("new session");
    expect(screen.captureCharFrame()).toContain("New session");
    expect(screen.captureCharFrame()).toContain("choose a project");
    expect(screen.captureCharFrame()).toContain("No project");
    await back();

    await run("providers");
    expect(screen.captureCharFrame()).toContain("Providers");

    press("/");
    await screen.flush();
    type("help");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("/help");
    expect(screen.captureCharFrame()).toContain("Browse every command");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("context actions are slash commands and destructive actions confirm first", async () => {
  const f = fixture();
  const created = f.app.createProject("Temporary", "Remove me");
  const screen = await createTestRenderer({ width: 100, height: 32 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = () => flushSync(() => screen.mockInput.pressEnter());
  const run = async (command: string) => {
    press("/");
    await screen.flush();
    type(command);
    await screen.flush();
    enter();
    await screen.flush();
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    await run("projects");
    enter(); // open the selected project
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Temporary");
    expect(screen.captureCharFrame()).toContain(
      "Use /sessions or /automations to browse this group",
    );

    press("/");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("/edit");
    expect(screen.captureCharFrame()).not.toContain("/instructions");
    expect(screen.captureCharFrame()).toContain("/delete");
    type("delete");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("/delete");
    enter();
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Confirm");
    expect(screen.captureCharFrame()).toContain(
      "Remove this project's metadata?",
    );
    press("n");
    await screen.flush();
    expect(f.app.listProjects().length).toBe(1);

    await run("delete");
    expect(screen.captureCharFrame()).toContain("Confirm");
    press("y");
    await screen.flush();
    expect(f.app.listProjects().length).toBe(0);
    expect(screen.captureCharFrame()).toContain("Projects");
    expect(screen.captureCharFrame()).toContain("No projects yet");
    expect(created.name).toBe("Temporary");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("arrows and vim keys move through lists, open rows, and go back", async () => {
  const f = fixture();
  const notes = [
    "Second project",
    ...Array.from({ length: 50 }, (_, index) => `Detail line ${index + 1}`),
  ].join("\n");
  f.app.createProject("Alpha", "First project");
  f.app.createProject("Beta", notes);
  const screen = await createTestRenderer({ width: 100, height: 32 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = () => flushSync(() => screen.mockInput.pressEnter());
  const arrow = (direction: "up" | "down" | "left" | "right") =>
    flushSync(() => screen.mockInput.pressArrow(direction));
  const selectedProject = () => {
    const line = screen
      .captureCharFrame()
      .split("\n")
      .find((item) => item.includes("▱") && item.includes("▌"));
    if (line?.includes("Alpha")) return "Alpha";
    if (line?.includes("Beta")) return "Beta";
    return "";
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();

    press("/");
    await screen.flush();
    type("projects");
    await screen.flush();
    enter();
    await screen.flush();
    expect(selectedProject()).toBe("Alpha");

    press("j");
    await screen.flush();
    expect(selectedProject()).toBe("Beta");

    press("k");
    await screen.flush();
    expect(selectedProject()).toBe("Alpha");

    arrow("down");
    await screen.flush();
    expect(selectedProject()).toBe("Beta");

    press("l");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Second project");
    const beforeScroll = screen.captureCharFrame();
    press("j");
    press("j");
    press("j");
    await screen.flush();
    expect(screen.captureCharFrame()).not.toBe(beforeScroll);

    press("h");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Projects");
    expect(selectedProject()).toBe("Beta");

    arrow("right");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Second project");

    arrow("left");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Projects");

    arrow("left");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Your local agent workspace");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("session wizard asks for a validated directory independently of its project", async () => {
  const f = fixture();
  f.app.createProject("Business");
  const screen = await createTestRenderer({ width: 110, height: 40 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = () => flushSync(() => screen.mockInput.pressEnter());
  const replace = (text: string) => {
    flushSync(() => screen.mockInput.pressKey("u", { ctrl: true }));
    type(text);
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    press("/");
    await screen.flush();
    type("new session");
    await screen.flush();
    enter();
    await screen.flush();
    flushSync(() => screen.mockInput.pressArrow("down"));
    await screen.flush();
    enter();
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Session working directory");
    expect(screen.captureCharFrame()).toContain("Group: Business");
    expect(screen.captureCharFrame()).toContain(process.cwd());
    replace("/missing-agentos-test-directory");
    enter();
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Session working directory");
    expect(screen.captureCharFrame()).toContain("ENOENT");
    replace(f.root);
    enter();
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("3 / 4");
    expect(screen.captureCharFrame()).toContain("No agent");
    press("ESCAPE");
    await Bun.sleep(60);
    await screen.flush();
    expect(screen.captureCharFrame()).toContain(f.root);
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("project details filter grouped work and slash project clears automation membership", async () => {
  const f = fixture();
  const group = f.app.createProject("Business");
  const other = f.app.createProject("Other");
  for (const [id, projectId] of [
    ["selected-session", group.id],
    ["other-session", other.id],
  ] as const) {
    f.storage.db
      .insert(sessions)
      .values({
        id,
        projectId,
        provider: "codex",
        providerVersion: "test",
        cwd: f.root,
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }
  const save = (name: string) =>
    f.app.automations.save({
      name,
      slug: name,
      cwd: f.root,
      steps: [{ name: "Check", provider: "codex", prompt: "Check" }],
    });
  const selected = save("selected-job"),
    unrelated = save("unrelated-job");
  f.app.automations.assignProject(selected.id, group.id);
  f.app.automations.assignProject(unrelated.id, other.id);
  const screen = await createTestRenderer({ width: 110, height: 40 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = () => flushSync(() => screen.mockInput.pressEnter());
  const run = async (text: string) => {
    press("/");
    await screen.flush();
    type(text);
    await screen.flush();
    enter();
    await screen.flush();
  };
  const back = async () => {
    press("ESCAPE");
    await Bun.sleep(60);
    await screen.flush();
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    await run("projects");
    enter();
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("selected-job");
    expect(screen.captureCharFrame()).not.toContain("unrelated-job");
    await run("sessions");
    expect(screen.captureCharFrame()).toContain("selected");
    expect(screen.captureCharFrame()).not.toContain("other-se");
    await back();
    await run("automations");
    expect(screen.captureCharFrame()).toContain("selected-job");
    expect(screen.captureCharFrame()).not.toContain("unrelated-job");
    enter();
    await screen.flush();
    await run("project");
    expect(screen.captureCharFrame()).toContain("Assign project");
    flushSync(() => screen.mockInput.pressKey("u", { ctrl: true }));
    enter();
    await screen.flush();
    expect(f.app.automations.get(selected.id).projectId).toBeNull();
    await run("home");
    await run("automations");
    expect(screen.captureCharFrame()).toContain("unrelated-job");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("r renames the selected session and refreshes the session list", async () => {
  const f = fixture();
  f.storage.db
    .insert(sessions)
    .values({
      id: "renamable-session",
      provider: "codex",
      providerVersion: "test",
      cwd: f.root,
      title: "Original title",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const screen = await createTestRenderer({ width: 110, height: 40 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = () => flushSync(() => screen.mockInput.pressEnter());
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    press("/");
    await screen.flush();
    type("sessions");
    enter();
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Original title");
    press("r");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Rename session");
    flushSync(() => screen.mockInput.pressKey("u", { ctrl: true }));
    type("Renamed from r");
    enter();
    await screen.flush();
    const deadline = Date.now() + 2000;
    while (
      !screen.captureCharFrame().includes("Renamed from r") &&
      Date.now() < deadline
    ) {
      await Bun.sleep(20);
      await screen.flush();
    }
    expect(f.app.session("renamable-session").title).toBe("Renamed from r");
    expect(screen.captureCharFrame()).toContain("Renamed from r");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("sessions filter strip selects projects with arrows and Enter resumes directly", async () => {
  const f = fixture();
  const alpha = f.app.createProject("Alpha");
  const beta = f.app.createProject("Beta");
  for (const [id, projectId, title] of [
    ["alpha-session", alpha.id, "Alpha chat"],
    ["beta-session", beta.id, "Beta chat"],
    ["loose-session", null, "Loose chat"],
  ] as const) {
    f.storage.db
      .insert(sessions)
      .values({
        id,
        projectId,
        provider: "codex",
        providerVersion: "test",
        cwd: f.root,
        title,
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }
  const resumed: string[] = [];
  f.app.resumeSession = (async (id: string) => {
    resumed.push(id);
    return f.app.session(id);
  }) as unknown as typeof f.app.resumeSession;
  const screen = await createTestRenderer({ width: 110, height: 40 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = () => flushSync(() => screen.mockInput.pressEnter());
  const arrow = (direction: "left" | "right") =>
    flushSync(() => screen.mockInput.pressArrow(direction));
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    press("/");
    await screen.flush();
    type("sessions");
    enter();
    await screen.flush();

    let frame = screen.captureCharFrame();
    expect(frame).toContain("[All]");
    expect(frame).toContain("Alpha chat");
    expect(frame).toContain("Beta chat");
    expect(frame).toContain("Loose chat");

    arrow("right");
    await screen.flush();
    frame = screen.captureCharFrame();
    expect(frame).toContain("[Alpha]");
    expect(frame).toContain("Alpha chat");
    expect(frame).not.toContain("Beta chat");
    expect(frame).not.toContain("Loose chat");

    arrow("right");
    await screen.flush();
    frame = screen.captureCharFrame();
    expect(frame).toContain("[Beta]");
    expect(frame).toContain("Beta chat");
    expect(frame).not.toContain("Alpha chat");

    arrow("right");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("[All]");
    expect(screen.captureCharFrame()).toContain("Alpha chat");

    arrow("left");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("[Beta]");

    arrow("left");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("[Alpha]");

    enter();
    const deadline = Date.now() + 2000;
    while (resumed.length === 0 && Date.now() < deadline) {
      await Bun.sleep(20);
      await screen.flush();
    }
    expect(resumed).toEqual(["alpha-session"]);
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("resource modals are centered over home and n opens each supported creation flow", async () => {
  const f = fixture();
  f.app.createProject("Business");
  const screen = await createTestRenderer({ width: 120, height: 44 });
  const root = createRoot(screen.renderer);
  const press = (key: string) =>
    flushSync(() => screen.mockInput.pressKey(key));
  const type = (text: string) =>
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
  const enter = () => flushSync(() => screen.mockInput.pressEnter());
  const back = async () => {
    press("ESCAPE");
    await Bun.sleep(60);
    await screen.flush();
  };
  const run = async (command: string) => {
    press("/");
    await screen.flush();
    type(command);
    await screen.flush();
    enter();
    await screen.flush();
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    type("Do not lose this draft");
    await screen.flush();
    flushSync(() => screen.mockInput.pressKey("p", { ctrl: true }));
    await screen.flush();
    type("projects");
    await screen.flush();
    enter();
    await screen.flush();
    let frame = screen.captureCharFrame();
    const topBorder = frame
      .split("\n")
      .find((line) => line.includes("╭") && line.includes("─".repeat(80)));
    expect(topBorder).toBeDefined();
    expect(topBorder?.indexOf("╭")).toBeGreaterThan(0);
    expect(frame.split("\n").indexOf(topBorder ?? "")).toBeGreaterThan(0);
    expect(frame).toContain("new");
    press("n");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("New project");
    type("new business");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("new business");
    expect(f.app.listProjects()).toHaveLength(1);
    await back();
    for (const [section, title] of [
      ["agents", "New agent"],
      ["skills", "New skill"],
      ["mcps", "Register MCP"],
      ["automations", "New automation"],
      ["sessions", "New session"],
    ]) {
      await run(section ?? "");
      press("n");
      await screen.flush();
      expect(screen.captureCharFrame()).toContain(title ?? "");
      await back();
    }
    await run("projects");
    // The palette treats n as search text, not a creation shortcut.
    press("/");
    await screen.flush();
    type("n");
    await screen.flush();
    expect(screen.captureCharFrame()).not.toContain("Name");
    await back();
    screen.resize(80, 24);
    await screen.flush();
    frame = screen.captureCharFrame();
    expect(frame).toContain("Projects");
    expect(frame).toContain("Business");
    expect(frame).toContain("back");
    press("n");
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("New project");
    expect(screen.captureCharFrame()).toContain("save");
    await back();
    await run("home");
    expect(screen.captureCharFrame()).toContain("Do not lose this draft");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});

test("wizard filtering, resize, back navigation and launch preserve home state", async () => {
  const f = fixture();
  const project = f.app.createProject("Selected group");
  const agent = f.app.createAgent("Reviewer", "Review changes");
  f.app.detectProviders = async () => [
    {
      id: "codex",
      installed: true,
      interactive: true,
      history: true,
      version: "test",
      reason: null,
    },
    {
      id: "agy",
      installed: false,
      interactive: false,
      history: false,
      version: null,
      reason: "Not installed",
    },
  ];
  const calls: Parameters<typeof f.app.newSession>[0][] = [];
  f.app.newSession = async (input) => {
    calls.push(input);
    return f.storage.db
      .insert(sessions)
      .values({
        id: "wizard-session",
        provider: "codex",
        providerVersion: "test",
        cwd: input.cwd ?? f.root,
        projectId: input.project,
        agentId: input.agent,
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
      })
      .returning()
      .get();
  };
  const screen = await createTestRenderer({ width: 110, height: 40 });
  const root = createRoot(screen.renderer);
  const type = async (text: string) => {
    flushSync(() => {
      for (const char of text) screen.mockInput.pressKey(char);
    });
    await screen.flush();
  };
  const enter = async () => {
    flushSync(() => screen.mockInput.pressEnter());
    await screen.flush();
  };
  const command = async (text: string) => {
    flushSync(() => screen.mockInput.pressKey("p", { ctrl: true }));
    await screen.flush();
    await type(text);
    await enter();
  };
  const back = async () => {
    flushSync(() => screen.mockInput.pressKey("ESCAPE"));
    await Bun.sleep(60);
    await screen.flush();
  };
  try {
    flushSync(() => root.render(<App app={f.app} />));
    await screen.flush();
    await type("Keep this home draft");
    await command("new session");
    await type("Selected group");
    await enter();
    expect(screen.captureCharFrame()).toContain("Group: Selected group");
    flushSync(() => screen.mockInput.pressKey("u", { ctrl: true }));
    await type(f.root);
    await enter();
    await type("Reviewer");
    await enter();
    expect(screen.captureCharFrame()).toContain("4 / 4");
    expect(screen.captureCharFrame()).toContain("Reviewer");
    await type("agy");
    expect(screen.captureCharFrame()).toContain(
      "No interactive providers detected",
    );
    await enter();
    expect(calls).toHaveLength(0);
    await back();
    expect(screen.captureCharFrame()).toContain("3 / 4");
    await type("Reviewer");
    await enter();
    screen.resize(50, 12);
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("Resize the terminal");
    screen.resize(110, 40);
    await screen.flush();
    expect(screen.captureCharFrame()).toContain("4 / 4");
    await type("codex");
    await enter();
    expect(calls).toEqual([
      { project: project.id, agent: agent.id, provider: "codex", cwd: f.root },
    ]);
    expect(screen.captureCharFrame()).toContain("Session saved");
    await command("home");
    expect(screen.captureCharFrame()).toContain("Keep this home draft");
    await command("new session");
    expect(screen.captureCharFrame()).toContain("1 / 4");
    await back();
    expect(screen.captureCharFrame()).toContain("Keep this home draft");
  } finally {
    root.unmount();
    await screen.dispose();
    f.close();
  }
});
