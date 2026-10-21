import { readFileSync } from "node:fs";
import { Command } from "commander";
import type { Application } from "../core/application";
import { runInteractive } from "../platform/process";
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
    .description("Show Agent OS storage paths")
    .action(() => output(app.paths));
  const providers = program
    .command("providers")
    .description("Detect native providers and capabilities");
  providers
    .command("list")
    .action(async () => output(await app.detectProviders()));

  const projects = program.command("projects").description("Manage workspaces");
  projects.command("list").action(() => output(app.listProjects()));
  projects
    .command("create <name> <directory>")
    .option("-d, --description <text>", "Description", "")
    .action((name, cwd, options) =>
      output(app.createProject(name, cwd, options.description)),
    );
  projects
    .command("edit <project>")
    .option("--name <name>")
    .option("--directory <path>")
    .option("--description <text>")
    .action((id, options) =>
      output(
        app.updateProject(id, {
          name: options.name,
          cwd: options.directory,
          description: options.description,
        }),
      ),
    );
  projects
    .command("remove <project>")
    .requiredOption("--yes", "Remove metadata; keep workspace files")
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
    .option("--provider <provider>", "Provider", "codex")
    .option(
      "--cwd <path>",
      "Working directory (defaults to project or current directory)",
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
                `${s.id} ${s.cwd} ${s.status}`
                  .toLowerCase()
                  .includes(options.search.toLowerCase())),
          ),
      );
    });
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
