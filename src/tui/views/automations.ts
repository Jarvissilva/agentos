import { stringify } from "yaml";
import { colors, prettyPath } from "../theme";
import type { Command, ResourceContext, ResourceView, Row } from "../types";
import { resourceForms } from "./forms";
import { schedulerActions } from "./settings";
export function automationsView(context: ResourceContext): ResourceView {
  const {
    app,
    projectFilter,
    setView,
    setSelected,
    setForm,
    setNotice,
    setConfirm,
    setRunFilter,
    refresh,
    fail,
    openForm,
    openSection,
  } = context;
  const { yamlForm, membershipForm } = resourceForms(context);
  const projects = app.listProjects();
  const automations = app.automations.list();
  const upcoming = app.automations.upcoming();
  const projectById = new Map(projects.map((project) => [project.id, project]));

  const newAutomationForm = () =>
    yamlForm(
      "New automation",
      "Background agent runs with an optional native schedule",
      {
        version: 1,
        name: "My automation",
        slug: "my-automation",
        cwd: process.cwd(),
        schedule: { kind: "manual" },
        steps: [
          {
            name: "Execute",
            provider: "codex",
            prompt: "",
          },
        ],
      },
      (value) => {
        const target = app.automations.save(value);
        setSelected(0);
        setView({ kind: "detail", section: "automations", id: target.id });
      },
    );
  const deleteAutomation = (id: string) =>
    setConfirm({
      message:
        "Delete this automation? Runs must be retained; disable it if history exists.",
      action: () => {
        app.automations.remove(id);
        setView({ kind: "section", section: "automations" });
        setSelected(0);
        setNotice("Automation deleted");
      },
    });
  const runAutomation = automationLauncher(context);
  const toggleAutomation = (id: string) => {
    try {
      const automation = app.automations.get(id);
      app.automations.enable(id, !automation.enabled);
      setNotice(`Automation ${automation.enabled ? "disabled" : "enabled"}`);
      refresh();
    } catch (value) {
      fail(value);
    }
  };
  const automationRows: Row[] = automations
    .filter(
      (automation) =>
        !projectFilter || automation.projectId === projectFilter.id,
    )
    .map((automation) => {
      const next = upcoming.find(
        (schedule) => schedule.automationId === automation.id,
      )?.nextAt;
      return {
        id: automation.id,
        name: automation.name,
        meta: automation.enabled ? "enabled" : "disabled",
        glyph: automation.enabled ? "●" : "○",
        glyphColor: automation.enabled ? colors.success : colors.dim,
        description: next
          ? `Next ${new Date(next).toLocaleString()} · ${prettyPath(automation.cwd)}`
          : prettyPath(automation.cwd),
        body: () => {
          const definition = app.automations.definition(automation.id);
          return `Project   ${automation.projectId ? (projectById.get(automation.projectId)?.name ?? "None") : "None"}\n\n${stringify(definition)}${
            next ? `\nNext run   ${new Date(next).toLocaleString()}` : ""
          }`;
        },
      };
    });
  const importForm = () => {
    openForm({
      title: "Import automation",
      subtitle: "Import a YAML or Markdown definition file",
      fields: [
        {
          label: "Definition file",
          value: "",
        },
      ],
      save: (values) => {
        const path = values[0] ?? "";

        const target = app.automations.import(path);
        setSelected(0);
        setView({
          kind: "detail",
          section: "automations",
          id: target.id,
        });
        setForm(null);
        setNotice("Import complete");
        refresh();
      },
    });
  };
  const { schedulerInstall, schedulerStatus } = schedulerActions(context);
  const sectionCommands: Command[] = [];
  sectionCommands.push(
    {
      name: "new automation",
      description: "Create a scheduled background automation",
      group: "create",
      run: newAutomationForm,
    },
    {
      name: "import automation",
      description: "Import an automation YAML definition",
      group: "create",
      run: () => importForm(),
    },
    {
      name: "scheduler install",
      description: "Install the persistent user scheduler",
      group: "create",
      run: schedulerInstall,
    },
    {
      name: "scheduler status",
      description: "Check the persistent scheduler",
      group: "create",
      run: schedulerStatus,
    },
  );
  return {
    navigation: {
      name: "automations",
      description: "Scheduled and background runs",
      group: "navigate",
      run: () => {
        context.openSection("automations");
      },
    },
    copy: {
      title: "Automations",
      noun: "automation",
      glyph: "◷",
      empty: "No automations",
      hint: "Run /new automation or /import automation",
    },
    rows: automationRows,
    commands: (row) => {
      const contextCommands: Command[] = [];
      contextCommands.push({
        name: "project",
        description: "Assign, change, or clear the project group",
        group: "context",
        run: () => membershipForm("automations", row.id),
      });
      contextCommands.push(
        {
          name: "run",
          description: `Run ${row.name} in the background`,
          group: "context",
          run: () => runAutomation(row.id),
        },
        {
          name: "runs",
          description: `Show run history for ${row.name}`,
          group: "context",
          run: () => {
            const automation = app.automations.get(row.id);
            setRunFilter({ automationId: row.id, name: automation.name });
            openSection("runs");
          },
        },
        {
          name: "toggle",
          description: `Enable or disable ${row.name}`,
          group: "context",
          run: () => toggleAutomation(row.id),
        },
        {
          name: "edit",
          description: `Edit ${row.name} YAML`,
          group: "context",
          run: () => {
            yamlForm(
              "Edit automation",
              "Schedules refresh when the definition is saved",
              app.automations.definition(row.id),
              (value) => {
                app.automations.save(value, undefined, row.id);
              },
            );
          },
        },
        {
          name: "delete",
          description: `Delete ${row.name}`,
          group: "context",
          run: () => deleteAutomation(row.id),
        },
      );

      return contextCommands;
    },
    sectionCommands,
    creation: sectionCommands.find((command) =>
      command.name.startsWith("new "),
    ),
  };
}

export function automationLauncher({
  app,
  perform,
  setNotice,
}: ResourceContext) {
  const runAutomation = (id: string, retryId?: string) => {
    void perform(async () => {
      const pid = await app.automations.launch(id, retryId);
      setNotice(`Background execution started · PID ${pid}`);
    });
  };
  return runAutomation;
}
