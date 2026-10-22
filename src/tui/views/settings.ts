import type { ProviderId } from "../../lib/providers/types";
import { installWorker, workerStatus } from "../../lib/scheduler/systemd";
import { BRAND } from "../lib/constants";
import type { Command, ResourceContext, ResourceView, Row } from "../lib/types";
import { prettyPath } from "../utils/format";
export function settingsView(context: ResourceContext): ResourceView {
  const {
    app,
    preferredProvider,
    defaultDirectory,
    setForm,
    setNotice,
    setDefaultDirectory,
    setHomeDirectory,
    openForm,
    selectDefaultProvider,
  } = context;

  const defaultDirectoryForm = () =>
    openForm({
      title: "Default working directory",
      subtitle:
        "Leave empty to use the launch directory. Existing sessions and automations keep their directories.",
      fields: [
        { label: "Directory (optional)", value: defaultDirectory ?? "" },
      ],
      save: (values) => {
        const saved = app.setDefaultDirectory(values[0]);
        setDefaultDirectory(saved);
        setHomeDirectory(saved ?? process.cwd());
        setForm(null);
        setNotice("Default directory saved");
      },
    });
  const { schedulerInstall, schedulerStatus } = schedulerActions(context);
  const settingsRows: Row[] = [
    {
      id: "provider",
      name: "Default provider",
      glyph: "◇",
      meta: preferredProvider ?? "automatic",
      description: "Choose the remembered provider for new sessions",
      body: () => "Choose a provider with /edit or /provider.",
    },
    ...(["codex", "opencode", "agy"] as const).map((provider): Row => {
      const defaults = app.providerDefaults(provider);
      return {
        id: `defaults:${provider}`,
        name: `${provider} model defaults`,
        glyph: "◇",
        meta: defaults.model ?? "provider default",
        description: defaults.model
          ? `${defaults.model} · ${defaults.reasoning ?? "provider default reasoning"}`
          : "Use provider model and reasoning defaults",
        body: () => JSON.stringify(defaults, null, 2),
      };
    }),
    {
      id: "directory",
      name: "Default working directory",
      glyph: "▱",
      meta: defaultDirectory ? "custom" : "launch directory",
      description: defaultDirectory
        ? prettyPath(defaultDirectory)
        : `Use the directory ${BRAND} was launched from`,
      body: () => defaultDirectory ?? process.cwd(),
    },
    {
      id: "storage",
      name: "Storage paths",
      glyph: "▤",
      meta: "read only",
      description:
        "Data, configuration, cache, database, and global memory locations",
      body: () =>
        JSON.stringify(
          { ...app.paths, globalMemory: app.globalMemory().path },
          null,
          2,
        ),
    },
    {
      id: "scheduler",
      name: "Background scheduler",
      glyph: "◷",
      description: "Check status or install and start the systemd user service",
      body: () => "Use /scheduler status or /scheduler install.",
    },
  ];

  const defaultsProvider = (row: Row) =>
    row.id.startsWith("defaults:")
      ? (row.id.slice(9) as ProviderId)
      : undefined;
  const sectionCommands: Command[] = [];
  sectionCommands.push(
    {
      name: "scheduler status",
      description: "Check the persistent scheduler",
      group: "context",
      run: schedulerStatus,
    },
    {
      name: "scheduler install",
      description: "Install and start the user scheduler",
      group: "context",
      run: schedulerInstall,
    },
  );
  return {
    navigation: {
      name: "settings",
      description: "Session defaults, storage paths, and scheduler",
      group: "navigate",
      run: () => {
        context.openSection("settings");
      },
    },
    copy: {
      title: "Settings",
      noun: "setting",
      glyph: "⚙",
      empty: "No settings",
      hint: "Enter to configure",
    },
    rows: settingsRows,
    commands: (row) => {
      const contextCommands: Command[] = [];
      const provider = defaultsProvider(row);
      if (provider)
        contextCommands.push({
          name: "edit",
          description: `Edit ${provider} defaults`,
          group: "context",
          run: () => context.configureProviderDefaults(provider),
        });
      if (row.id === "provider" || row.id === "directory")
        contextCommands.push({
          name: "edit",
          description: `Edit ${row.name.toLowerCase()}`,
          group: "context",
          run:
            row.id === "provider"
              ? selectDefaultProvider
              : defaultDirectoryForm,
        });
      return contextCommands;
    },
    sectionCommands,
    creation: sectionCommands.find((command) =>
      command.name.startsWith("new "),
    ),
    open: (row) => {
      const provider = defaultsProvider(row);
      if (provider) {
        context.configureProviderDefaults(provider);
        return true;
      }
      if (row.id === "provider") {
        selectDefaultProvider();
        return true;
      }
      if (row.id === "directory") {
        defaultDirectoryForm();
        return true;
      }
      if (row.id === "scheduler") {
        schedulerStatus();
        return true;
      }
      return false;
    },
  };
}

export function schedulerActions({
  app,
  setConfirm,
  setNotice,
  setReport,
  perform,
}: ResourceContext) {
  const schedulerInstall = () =>
    setConfirm({
      message:
        "Install and start the persistent systemd user scheduler? It runs independently of this TUI.",
      action: () => {
        void perform(async () => {
          await installWorker(app.paths, true);
          setNotice("Persistent scheduler enabled");
        });
      },
    });
  const schedulerStatus = () => {
    void perform(async () => {
      setReport({
        title: "Scheduler status",
        body: String(await workerStatus()),
      });
    });
  };
  return { schedulerInstall, schedulerStatus };
}
