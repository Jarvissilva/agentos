import { readFileSync } from "node:fs";
import { Command } from "commander";
import type { Application } from "../app";
import { runInteractive } from "../lib/platform/process";
import { resourceCommands } from "./resources";

export function commands(app: Application) {
  const program = new Command()
    .name("agentos")
    .description("Local-first native AI provider orchestration")
    .version("0.1.0");
  const output = (value: unknown) =>
    console.log(JSON.stringify(value, null, 2));
  program.action(async () => {
    const { startTui } = await import("../tui/app");
    await startTui(app);
  });
  program
    .command("paths")
    .description("Show agentos storage paths")
    .action(() => output(app.paths));
  const memory = program
    .command("memory")
    .description("Show the shared global memory location")
    .action(() => output(app.globalMemory()));
  memory
    .command("install <provider>")
    .description(
      "Install shared memory rules in a provider's native global instructions",
    )
    .action((provider) => output(app.installMemoryInstructions(provider)));
  const settings = program
    .command("settings")
    .description("Manage agentos session defaults");
  const settingsValue = () => ({
    provider: app.preferredProvider() ?? null,
    defaultDirectory: app.defaultDirectory() ?? null,
    providerDefaults: Object.fromEntries(
      (["codex", "opencode", "agy"] as const).map((id) => [
        id,
        app.providerDefaults(id),
      ]),
    ),
  });
  settings.command("show").action(() => output(settingsValue()));
  settings.command("provider <provider>").action((id) => {
    app.setPreferredProvider(app.providers.adapter(id).id);
    output(settingsValue());
  });
  settings
    .command("directory [path]")
    .option("--clear", "Use the launch directory")
    .action((path, options) => {
      if (Boolean(path) === Boolean(options.clear))
        throw new Error("Supply a directory or --clear, exclusively");
      app.setDefaultDirectory(path);
      output(settingsValue());
    });
  for (const kind of ["model", "reasoning"] as const) {
    settings
      .command(`${kind} <provider> [value]`)
      .option("--clear", "Use provider default")
      .action(async (provider, value, options) => {
        if (Boolean(value) === Boolean(options.clear))
          throw new Error("Supply a value or --clear, exclusively");
        const id = app.providers.adapter(provider).id;
        const previous = app.providerDefaults(id);
        await app.setProviderDefaults(
          id,
          kind === "model"
            ? value
              ? { model: value }
              : {}
            : { ...previous, reasoning: value },
        );
        output(settingsValue());
      });
  }
  const providers = program
    .command("providers")
    .description("Detect native providers and capabilities");
  providers
    .command("list")
    .action(async () => output(await app.detectProviders()));

  providers
    .command("models <provider>")
    .action(async (provider) => output(await app.modelCatalog(provider)));

  const projects = program
    .command("projects")
    .description("Group sessions and automations");
  projects.command("list").action(() => output(app.listProjects()));
  projects
    .command("memory <project>")
    .description("Show the project's persistent memory location")
    .action((id) => output(app.projectMemory(id)));
  projects
    .command("create <name>")
    .option("-d, --description <text>", "Description", "")
    .action((name, options) =>
      output(app.createProject(name, options.description)),
    );
  projects
    .command("edit <project>")
    .option("--name <name>")
    .option("--description <text>")
    .action((id, options) =>
      output(
        app.updateProject(id, {
          name: options.name,
          description: options.description,
        }),
      ),
    );
  projects
    .command("remove <project>")
    .requiredOption(
      "--yes",
      "Remove group; keep sessions, automations, and files",
    )
    .action((id) => {
      app.removeProject(id);
      output({ removed: id });
    });

  const agents = program
    .command("agents")
    .description("Manage Markdown-backed role definitions");
  agents.command("list").action(() => output(app.listAgents()));
  agents
    .command("show <agent>")
    .action((id) =>
      output({ ...app.agentDefinition(id), path: app.agentFile(id) }),
    );
  agents
    .command("create <name>")
    .requiredOption(
      "--instructions-file <path>",
      "Read Markdown instructions from file",
    )
    .option("-d, --description <text>", "Description", "")
    .action((name, options) =>
      output(
        app.createAgent(
          name,
          readFileSync(options.instructionsFile, "utf8"),
          options.description,
        ),
      ),
    );
  agents
    .command("edit <agent>")
    .description(
      "Open Markdown definition in $VISUAL/$EDITOR (executable path), default vi",
    )
    .action(async (id) => {
      const file = app.agentFile(id);
      const editor = process.env.VISUAL || process.env.EDITOR || "vi";
      const code = await runInteractive(editor, [file], process.cwd());
      if (code !== 0) throw new Error(`Editor exited ${code}`);
      app.syncAgent(id);
      output(app.agentDefinition(id));
    });

  const sessions = program
    .command("sessions")
    .description("Launch and resume native provider TUIs");
  sessions
    .command("new")
    .option("--project <name-or-id>")
    .option("--agent <name-or-id>")
    .option(
      "--provider <provider>",
      "Provider (defaults to saved preference or codex)",
    )
    .option(
      "--cwd <path>",
      "Working directory (defaults to saved preference or current directory)",
    )
    .option("--prompt <text>", "Initial task")
    .action(async (options) => {
      const session = await app.newSession(options);
      output(session);
      process.exitCode = session.exitCode ?? 0;
    });
  sessions
    .command("list")
    .option("--project <name-or-id>")
    .option("--provider <provider>")
    .option("--search <text>")
    .action((options) => {
      const projectId = options.project
        ? app.project(options.project).id
        : undefined;
      output(
        app
          .listSessions()
          .filter(
            (s) =>
              (!projectId || s.projectId === projectId) &&
              (!options.provider || s.provider === options.provider) &&
              (!options.search ||
                `${s.id} ${s.title ?? ""} ${s.cwd} ${s.status}`
                  .toLowerCase()
                  .includes(options.search.toLowerCase())),
          ),
      );
    });
  sessions
    .command("rename <id> <title>")
    .description("Rename a session locally and in its native provider")
    .action(async (id, title) => output(await app.renameSession(id, title)));
  sessions.command("show <id>").action((id) => output(app.session(id)));
  sessions.command("resume <id>").action(async (id) => {
    const session = await app.resumeSession(id);
    output(session);
    process.exitCode = session.exitCode ?? 0;
  });
  sessions
    .command("history <id>")
    .option("--cursor <cursor>", "Continuation cursor from previous page")
    .action(async (id, options) =>
      output(await app.history(id, options.cursor)),
    );
  resourceCommands(program, app);
  return program;
}
