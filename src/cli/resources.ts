import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { parse } from "yaml";
import { type Application, parseAgent } from "../app";
import { runInteractive } from "../lib/platform/process";
import {
  installWorker,
  stopWorker,
  workerStatus,
} from "../lib/scheduler/systemd";
export async function editFile(file: string, cwd = process.cwd()) {
  const code = await runInteractive(
    process.env.VISUAL || process.env.EDITOR || "vi",
    [file],
    cwd,
  );
  if (code !== 0) throw new Error(`Editor exited ${code}`);
}
export function resourceCommands(program: Command, app: Application) {
  const output = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  const agents = program.commands.find((c) => c.name() === "agents");
  agents?.command("import <file>").action((file) => {
    const definition = parseAgent(readFileSync(file, "utf8"));
    output(
      app.createAgent(
        definition.name,
        definition.instructions,
        definition.description,
      ),
    );
  });
  agents
    ?.command("remove <agent>")
    .requiredOption("--yes")
    .action((id) => {
      app.removeAgent(id);
      output({ removed: id });
    });
  const sessions = program.commands.find((c) => c.name() === "sessions");
  sessions
    ?.command("instructions <id>")
    .option("--file <name>", "Instruction filename", "AGENTS.md")
    .option("--edit")
    .action(async (id, options) => {
      if (options.edit) {
        const content = app.readInstructions(id, options.file);
        app.saveInstructions(id, content, options.file);
        await editFile(
          app.instructionFile(id, options.file),
          app.session(id).cwd,
        );
      } else console.log(app.readInstructions(id, options.file));
    });
  const skills = program
    .command("skills")
    .description(
      "Manage native SKILL.md directories and owned discovery links",
    );
  skills.command("list").action(() => output(app.skills.list()));
  skills
    .command("show <skill>")
    .action((id) => console.log(readFileSync(app.skills.file(id), "utf8")));
  skills
    .command("create <name>")
    .requiredOption("--description <text>")
    .requiredOption("--instructions-file <path>")
    .action((name, o) =>
      output(
        app.skills.create(
          name,
          o.description,
          readFileSync(o.instructionsFile, "utf8"),
        ),
      ),
    );
  skills
    .command("import <directory>")
    .action((dir) => output(app.skills.import(dir)));
  skills.command("edit <skill>").action(async (id) => {
    await editFile(app.skills.file(id));
    app.skills.sync(id);
  });
  skills.command("install <skill> <provider>").action((id, provider) => {
    app.skills.install(id, provider);
    output(app.skills.links(id));
  });
  skills
    .command("uninstall <skill> <provider>")
    .action((id, provider) => app.skills.uninstall(id, provider));
  skills.command("status <skill>").action((id) => output(app.skills.links(id)));
  skills
    .command("discover <provider>")
    .action((p) => output(app.skills.discover(p)));
  skills
    .command("remove <skill>")
    .requiredOption("--yes")
    .action((id) => app.skills.remove(id));
  const mcps = program
    .command("mcps")
    .description(
      "Manage central MCP definitions and owned global installations",
    );
  mcps.command("list").action(() => output(app.mcps.list()));
  mcps
    .command("register <file>")
    .action((file) =>
      output(app.mcps.register(parse(readFileSync(file, "utf8")))),
    );
  mcps
    .command("update <mcp> <file>")
    .action((id, file) =>
      app.mcps.update(id, parse(readFileSync(file, "utf8"))),
    );
  mcps
    .command("install <mcp> <provider>")
    .option("--disabled")
    .action((id, provider, o) => app.mcps.install(id, provider, !o.disabled));
  mcps
    .command("install-all <mcp>")
    .description("Install one MCP across available supported providers")
    .action(async (id) => {
      const result = await app.installMcpAll(id);
      output(result);
      if (!result.success) process.exitCode = 1;
    });
  mcps
    .command("enable <mcp> <provider>")
    .action((id, p) => app.mcps.install(id, p, true));
  mcps
    .command("disable <mcp> <provider>")
    .action((id, p) => app.mcps.install(id, p, false));
  mcps
    .command("uninstall <mcp> <provider>")
    .action((id, p) => app.mcps.uninstall(id, p));
  mcps
    .command("status <mcp>")
    .action((id) => output(app.mcps.installations(id)));
  mcps
    .command("remove <mcp>")
    .requiredOption("--yes")
    .action((id) => app.mcps.remove(id));
  const automations = program
    .command("automations")
    .description("Manual and persistent scheduled native provider workflows");
  automations
    .command("list")
    .option("--project <name-or-id>")
    .action((options) => {
      const projectId = options.project
        ? app.project(options.project).id
        : undefined;
      output(
        app.automations
          .list()
          .filter((a) => !projectId || a.projectId === projectId),
      );
    });
  for (const [command, assign] of [
    [
      sessions,
      (id: string, project?: string) => app.assignSessionProject(id, project),
    ],
    [
      automations,
      (id: string, project?: string) =>
        app.automations.assignProject(id, project),
    ],
  ] as const) {
    command
      ?.command("project <id> [project]")
      .option("--clear", "Remove project membership")
      .action((id, project, options) => {
        if (Boolean(project) === Boolean(options.clear))
          throw new Error("Supply a project or --clear, exclusively");
        output(assign(id, project));
      });
  }
  automations
    .command("import <file>")
    .action((file) => output(app.automations.import(file)));
  automations
    .command("show <name>")
    .action((id) => output(app.automations.definition(id)));
  automations.command("edit <name>").action(async (id) => {
    await editFile(app.automations.get(id).file);
    output(app.automations.sync(id));
  });
  const run = async (id: string, retryId?: string) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      const r = await app.automations.run(id, {
        retryId,
        signal: controller.signal,
      });
      output(r);
      if (r && r.status !== "completed") process.exitCode = 1;
    } finally {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
    }
  };
  automations.command("run <name>").action((id) => run(id));
  automations
    .command("retry <run-id>")
    .action((id) => run(app.automations.runDetails(id).automationId, id));
  automations
    .command("cancel <run-id>")
    .action((id) => app.automations.cancel(id));
  automations
    .command("history [name]")
    .action((id) => output(app.automations.history(id)));
  automations
    .command("run-details <run-id>")
    .action((id) => output(app.automations.runDetails(id)));
  automations.command("enable <name>").action((id) => {
    output(app.automations.enable(id, true));
  });
  automations.command("disable <name>").action((id) => {
    output(app.automations.enable(id, false));
  });
  automations
    .command("remove <name>")
    .requiredOption("--yes")
    .action((id) => app.automations.remove(id));
  automations
    .command("schedules")
    .action(() => output(app.automations.upcoming()));
  automations
    .command("worker")
    .description("Run the persistent scheduler in the foreground")
    .action(async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      process.on("SIGINT", abort);
      process.on("SIGTERM", abort);
      try {
        app.automations.recover();
        while (!controller.signal.aborted) {
          await app.automations.tick(Date.now(), controller.signal);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, 1000);
            function done() {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", done);
              resolve();
            }
            controller.signal.addEventListener("abort", done, { once: true });
            if (controller.signal.aborted) done();
          });
        }
        await app.automations.drain();
      } finally {
        process.off("SIGINT", abort);
        process.off("SIGTERM", abort);
      }
    });
  automations
    .command("install-service")
    .option("--start", "Enable and start the user service")
    .action(async (o) => output(await installWorker(app.paths, o.start)));
  automations
    .command("stop-service")
    .action(async () => output(await stopWorker()));
  automations
    .command("service-status")
    .action(async () => output(await workerStatus()));
  const notifications = program.command("notifications");
  notifications.command("list").action(() => output(app.listNotifications()));
  notifications.command("read <id>").action((id) => app.readNotification(id));
}
