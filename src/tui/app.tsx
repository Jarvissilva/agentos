import { createCliRenderer, type ScrollBoxRenderable } from "@opentui/core";
import {
  createRoot,
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Application, directory, type TerminalHandoff } from "../app";
import { redact } from "../lib/platform/files";
import { errorMessage } from "../lib/platform/paths";
import type {
  ModelCatalog,
  ProviderDefaults,
  ProviderId,
  ProviderInfo,
} from "../lib/providers/types";
import { matchCommands, matches } from "./commands";
import { Form, ModalSurface } from "./components";
import { ResourceModal } from "./components/resource-modal";
import { SessionTabs, type WorkspaceTabProps } from "./components/session-tabs";
import { BRAND } from "./constants";
import { useNewSession } from "./flows/new-session";
import { colors, plural } from "./theme";
import type {
  Command,
  Confirmation,
  FormSpec,
  GroupFilter,
  PaletteItem,
  Picker,
  PickerOption,
  Report,
  ResourceContext,
  ResourceView,
  Row,
  RunFilter,
  SectionKey,
  View,
} from "./types";
import { agentsView } from "./views/agents";
import { automationsView } from "./views/automations";
import { Home, homeCommands, useHomeLaunch } from "./views/home";
import { mcpsView } from "./views/mcps";
import { notificationsView } from "./views/notifications";
import { projectsView } from "./views/projects";
import { providersView, selectSessionProvider } from "./views/providers";
import { runsView } from "./views/runs";
import { sessionsView } from "./views/sessions";
import { settingsView } from "./views/settings";
import { skillsView } from "./views/skills";

export function App({ app }: { app: Application }) {
  return (
    <SessionTabs app={app}>
      {(props) => <Workspace app={app} {...props} />}
    </SessionTabs>
  );
}

function Workspace({
  app,
  active: tabActive,
  attached,
  sessionLauncher,
  activateSession,
  endedAt,
  endedError,
}: { app: Application } & WorkspaceTabProps) {
  const renderer = useRenderer();
  const { width: terminalWidth, height: screenHeight } =
    useTerminalDimensions();
  const terminalHeight = Math.max(1, screenHeight - 1);
  const [view, setView] = useState<View>({ kind: "home" });
  const [selected, setSelected] = useState(0);
  const [projectFilter, setProjectFilter] = useState<GroupFilter | null>(null);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const updateDraft = useCallback((value: string) => {
    draftRef.current = value;
    setDraft(value);
  }, []);
  const [preferredProvider, setPreferredProvider] = useState<ProviderId>();
  const [detecting, setDetecting] = useState(true);
  const [homeDirectory, setHomeDirectory] = useState(process.cwd());
  const [defaultDirectory, setDefaultDirectory] = useState<string>();
  const [homeProject, setHomeProject] = useState<string>();
  const [homeAgent, setHomeAgent] = useState<string>();
  const [commandOpen, setCommandOpen] = useState(false);
  const [menuSelected, setMenuSelected] = useState(0);
  const pickerEpoch = useRef(0);
  const handledEnd = useRef(0);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [wizard, setWizard] = useState(false);
  const [form, setForm] = useState<FormSpec | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [runFilter, setRunFilter] = useState<RunFilter | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const detailScroll = useRef<ScrollBoxRenderable | null>(null);
  const modalWidth = Math.min(88, terminalWidth - 8);
  const modalHeight = Math.min(34, terminalHeight - 4);
  const width = modalWidth - 2;
  const height = modalHeight - 2;

  const fail = useCallback((value: unknown) => {
    setError(redact(errorMessage(value)));
    setNotice("");
  }, []);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  void revision;

  useEffect(() => {
    let active = true;
    try {
      setPreferredProvider(app.preferredProvider());
      const savedDirectory = app.defaultDirectory();
      setDefaultDirectory(savedDirectory);
      if (savedDirectory) setHomeDirectory(directory(savedDirectory));
    } catch (error) {
      fail(error);
    }
    void app
      .detectProviders()
      .then((items) => {
        if (active) setProviders(items);
      })
      .catch((error) => {
        if (active) fail(error);
      })
      .finally(() => {
        if (active) setDetecting(false);
      });
    return () => {
      active = false;
    };
  }, [app, fail]);

  useEffect(() => {
    const interval = setInterval(() => {
      app.recoverSessions();
      app.automations.recover();
      refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [app, refresh]);

  useEffect(() => {
    if (attached) setBusy(false);
  }, [attached]);

  const handoff: TerminalHandoff = async (run) => {
    await renderer.suspend();
    try {
      return await run();
    } finally {
      await renderer.resume();
    }
  };

  const perform = async (run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
      refresh();
    } catch (value) {
      fail(value);
    } finally {
      setBusy(false);
    }
  };

  const closePrompt = () => {
    pickerEpoch.current++;
    setCommandOpen(false);
    setPicker(null);
    setInput("");
    setMenuSelected(0);
  };

  const clearFeedback = () => {
    setError("");
    setNotice("");
  };

  const openHome = () => {
    setView({ kind: "home" });
    setSelected(0);
    setReport(null);
    setRunFilter(null);
    setProjectFilter(null);
    clearFeedback();
    closePrompt();
  };

  // A provider exit (for example the provider's own /exit) returns this tab to
  // the home screen and surfaces the outcome in the status line.
  useEffect(() => {
    if (!endedAt || handledEnd.current === endedAt) return;
    handledEnd.current = endedAt;
    pickerEpoch.current++;
    setCommandOpen(false);
    setPicker(null);
    setInput("");
    setMenuSelected(0);
    setView({ kind: "home" });
    setSelected(0);
    setReport(null);
    setRunFilter(null);
    setProjectFilter(null);
    setError("");
    setNotice("");
    if (endedError) setError(redact(endedError));
    else setNotice("Session ended");
  }, [endedAt, endedError]);

  const openSection = (section: SectionKey, group?: GroupFilter) => {
    if (section === "sessions")
      void app.syncSessionNames().catch(() => {
        // Provider title sync must never block opening the session list.
      });
    setProjectFilter(group ?? null);
    setView({ kind: "section", section });
    setSelected(0);
    setReport(null);
    clearFeedback();
    closePrompt();
  };

  const openCommands = () => {
    pickerEpoch.current++;
    setPicker(null);
    setCommandOpen(true);
    setInput("");
    setMenuSelected(0);
    setError("");
  };

  const openPicker = (
    title: string,
    action: (provider: string) => void,
    interactiveOnly = false,
    options?: PickerOption[],
  ) => {
    pickerEpoch.current++;
    setCommandOpen(false);
    setPicker({ title, action, interactiveOnly, options });
    setInput("");
    setMenuSelected(0);
    setError("");
  };

  const back = () => {
    clearFeedback();
    if (report) {
      setReport(null);
      return;
    }
    if (commandOpen || picker) {
      closePrompt();
      return;
    }
    if (view.kind === "detail") {
      setView({ kind: "section", section: view.section });
      return;
    }
    if (view.kind === "section") {
      if (
        projectFilter &&
        (view.section === "sessions" || view.section === "automations")
      ) {
        setView({ kind: "detail", section: "projects", id: projectFilter.id });
        setProjectFilter(null);
        return;
      }
      if (view.section === "runs" && runFilter) {
        const id = runFilter.automationId;
        setRunFilter(null);
        setView({ kind: "detail", section: "automations", id });
        return;
      }
      openHome();
      return;
    }
    setInput("");
  };

  const openForm = (spec: FormSpec) => {
    clearFeedback();
    setForm(spec);
  };

  const startSession = () => {
    setWizard(true);
    setInput("");
    setMenuSelected(0);
    clearFeedback();
  };
  const configureProviderDefaults = (provider: ProviderId) => {
    const save = (defaults: ProviderDefaults) => {
      void perform(async () => {
        await app.setProviderDefaults(provider, defaults);
        setNotice(`${provider} defaults saved`);
      });
    };
    const showModels = (catalog?: ModelCatalog, discoveryError?: unknown) => {
      openPicker(
        `${provider} model`,
        (id) => {
          if (id === "default") {
            save({});
            return;
          }
          if (id === "retry") {
            load();
            return;
          }
          if (id === "loading") {
            load();
            return;
          }
          const model = catalog?.models.find((m) => `model:${m.id}` === id);
          if (!model || !catalog) return;
          // Keep both selections local until the second picker is confirmed.
          openPicker(
            `${provider} ${catalog.reasoningLabel} · ${model.id}`,
            (reasoning) => {
              save({
                model: model.id,
                ...(reasoning === "default"
                  ? {}
                  : { reasoning: reasoning.slice(10) }),
              });
            },
            false,
            [
              {
                id: "default",
                name: "Use provider default",
                description: `Default ${catalog.reasoningLabel} for ${model.id}`,
              },
              ...model.reasoning.map((r) => ({
                id: `reasoning:${r.id}`,
                name: r.id,
                description: r.description ?? catalog.reasoningLabel,
              })),
            ],
          );
        },
        false,
        [
          {
            id: "default",
            name: "Use provider default",
            description: "Clear both model and reasoning overrides",
          },
          ...(catalog
            ? catalog.models.map((m) => ({
                id: `model:${m.id}`,
                name: m.id,
                description: m.name,
              }))
            : []),
          ...(catalog?.models.length
            ? []
            : [
                {
                  id: catalog ? "retry" : discoveryError ? "retry" : "loading",
                  name: catalog
                    ? "No models available · Retry"
                    : discoveryError
                      ? "Discovery failed · Retry"
                      : "Loading models…",
                  description: discoveryError
                    ? redact(errorMessage(discoveryError))
                    : "Discover installed provider capabilities",
                },
              ]),
        ],
      );
      if (discoveryError) fail(discoveryError);
    };
    const load = () => {
      showModels();
      const epoch = pickerEpoch.current;
      void app
        .modelCatalog(provider)
        .then((catalog) => {
          if (pickerEpoch.current === epoch) showModels(catalog);
        })
        .catch((error) => {
          if (pickerEpoch.current === epoch) showModels(undefined, error);
        });
    };
    load();
  };
  const resourceContext: ResourceContext = {
    app,
    providers,
    preferredProvider,
    setPreferredProvider,
    defaultDirectory,
    projectFilter,
    runFilter,
    setView,
    setSelected,
    setForm,
    setNotice,
    setConfirm,
    setReport,
    setRunFilter,
    setProjectFilter,
    setDefaultDirectory,
    setHomeDirectory,
    refresh,
    fail,
    perform,
    handoff,
    openForm,
    openPicker,
    openSection,
    configureProviderDefaults,
    sessionLauncher,
    activateSession,
    selectDefaultProvider: () => selectDefaultProvider(),
    startSession,
  };
  const resources: Record<SectionKey, ResourceView> = {
    sessions: sessionsView(resourceContext),
    projects: projectsView(resourceContext),
    agents: agentsView(resourceContext),
    skills: skillsView(resourceContext),
    mcps: mcpsView(resourceContext),
    providers: providersView(resourceContext),
    automations: automationsView(resourceContext),
    runs: runsView(resourceContext),
    notifications: notificationsView(resourceContext),
    settings: settingsView(resourceContext),
  };

  const activeSection =
    view.kind === "section" || view.kind === "detail"
      ? view.section
      : undefined;
  const rows = activeSection ? resources[activeSection].rows : [];
  const safeSelected = Math.max(0, Math.min(selected, rows.length - 1));
  const selectedRow = rows[safeSelected];
  const detailRow =
    view.kind === "detail" ? rows.find((row) => row.id === view.id) : undefined;
  const contextRow = view.kind === "detail" ? detailRow : selectedRow;
  const activeCopy = activeSection ? resources[activeSection].copy : null;
  const activeFilters = activeSection
    ? resources[activeSection].filters
    : undefined;
  const activeFilterIndex = activeSection
    ? (resources[activeSection].filterIndex ?? 0)
    : 0;
  const notificationsUnread = app
    .listNotifications()
    .filter((item) => !item.read).length;

  const projects = app.listProjects();
  const agents = app.listAgents();

  // ----- wizards -----------------------------------------------------------

  const launch = (
    project?: string,
    agent?: string,
    provider = "codex",
    cwd?: string,
  ) => {
    setWizard(false);
    setProjectFilter(null);
    setInput("");
    setMenuSelected(0);
    void perform(async () => {
      const session = await app.newSession(
        { project, agent, provider, cwd },
        (run) => run(),
        sessionLauncher,
      );
      setView({ kind: "section", section: "sessions" });
      setSelected(0);
      setNotice(`Session saved · ${session.id.slice(0, 8)}`);
    });
  };

  const newSession = useNewSession({
    active: wizard,
    inputActive: tabActive,
    app,
    providers,
    defaultDirectory,
    width,
    height,
    busy,
    error,
    notice,
    fail,
    setError,
    cancel: () => {
      setWizard(false);
      clearFeedback();
    },
    launch,
  });

  const providerOptions: { id: string; name: string; description: string }[] =
    picker?.options ??
    (providers.length
      ? providers.map((provider) => ({
          id: provider.id,
          name: provider.id,
          description:
            provider.reason ??
            provider.version ??
            (provider.interactive
              ? "ready"
              : provider.installed
                ? "detected"
                : "not installed"),
        }))
      : ["codex", "opencode", "agy"].map((id) => ({
          id,
          name: id,
          description: "detect on use",
        })));
  const filteredProviders = providerOptions.filter((option) =>
    matches(`${option.name} ${option.description}`, input),
  );
  const safeProvider = Math.max(
    0,
    Math.min(menuSelected, filteredProviders.length - 1),
  );

  const chooseProvider = () => {
    if (!picker) return;
    const option = filteredProviders[safeProvider];
    if (!option) return;
    if (
      picker.interactiveOnly &&
      !providers.find((provider) => provider.id === option.id)?.interactive
    ) {
      fail(
        new Error(
          providers.find((provider) => provider.id === option.id)?.reason ??
            "Provider is unavailable. Install it and use /refresh.",
        ),
      );
      return;
    }
    const action = picker.action;
    closePrompt();
    try {
      action(option.id);
      refresh();
    } catch (value) {
      fail(value);
    }
  };

  const selectedProvider =
    preferredProvider ??
    providers.find(
      (provider) => provider.id === "codex" && provider.interactive,
    )?.id ??
    providers.find((provider) => provider.interactive)?.id;
  const selectedProviderInfo = providers.find(
    (provider) => provider.id === selectedProvider,
  );
  const composeProject = projects.find((project) => project.id === homeProject);
  const composeAgent = agents.find((agent) => agent.id === homeAgent);

  const selectDefaultProvider = () => selectSessionProvider(resourceContext);

  const openRow = (section: SectionKey, row: Row) => {
    if (resources[section].open?.(row)) return;
    setView({ kind: "detail", section, id: row.id });
    setReport(null);
    clearFeedback();
  };
  const contextCommands: Command[] =
    activeSection && contextRow
      ? [
          ...(view.kind === "section"
            ? [
                {
                  name: "open",
                  description: `Open ${contextRow.name}`,
                  group: "context" as const,
                  run: () => openRow(activeSection, contextRow),
                },
              ]
            : []),
          ...resources[activeSection].commands(contextRow),
        ]
      : [];
  const sectionCommands = activeSection
    ? resources[activeSection].sectionCommands
    : [];

  const navigationCommands: Command[] = [
    resources.settings.navigation,
    ...(resources.sessions.creation ? [resources.sessions.creation] : []),
    ...(
      [
        "sessions",
        "projects",
        "automations",
        "agents",
        "skills",
        "mcps",
        "providers",
        "runs",
        "notifications",
      ] as const
    ).map((section) => resources[section].navigation),
  ];

  const systemCommands: Command[] = [
    {
      name: "provider",
      description: "Choose the provider for your next message",
      group: "system",
      run: selectDefaultProvider,
    },
  ];
  if (view.kind === "home")
    systemCommands.push(
      ...homeCommands({
        app,
        openForm,
        homeDirectory,
        setHomeDirectory,
        setForm,
        composeProject,
        composeAgent,
        setHomeProject,
        setHomeAgent,
      }),
    );
  if (view.kind !== "home" || report || wizard)
    systemCommands.push({
      name: "back",
      description: "Return to the previous screen",
      group: "system",
      run: back,
    });
  if (view.kind !== "home" || report)
    systemCommands.push({
      name: "home",
      description: "Return to the launch screen",
      group: "system",
      run: openHome,
    });
  systemCommands.push(
    {
      name: "help",
      description: "Browse every command",
      group: "system",
      run: openCommands,
    },
    {
      name: "refresh",
      description: "Re-detect providers and reload data",
      group: "system",
      run: () => {
        void perform(async () => {
          setProviders(await app.detectProviders());
          app.recoverSessions();
          await app.syncSessionNames();
          setNotice("Reloaded");
        });
      },
    },
    {
      name: "quit",
      description: `Exit ${BRAND}`,
      group: "system",
      run: () => renderer.destroy(),
    },
  );

  const seen = new Set<string>();
  const commands = [
    ...contextCommands,
    ...sectionCommands,
    ...navigationCommands,
    ...systemCommands,
  ].filter((command) => {
    if (seen.has(command.name)) return false;
    seen.add(command.name);
    return true;
  });

  const creationCommand = activeSection
    ? resources[activeSection].creation
    : undefined;

  const filteredCommands = matchCommands(commands, input);
  const safeMenu = Math.max(
    0,
    Math.min(menuSelected, filteredCommands.length - 1),
  );

  const runCommand = (command: Command) => {
    closePrompt();
    clearFeedback();
    try {
      command.run();
    } catch (value) {
      fail(value);
    }
  };

  const isPicker = picker !== null;
  const promptVisible = commandOpen || isPicker;

  const activeRowForDetail = detailRow;
  const detailTitle =
    report?.title ??
    activeRowForDetail?.name ??
    (view.kind === "detail" ? view.id : undefined);
  const headerDetail =
    detailTitle ??
    (activeSection === "sessions" || activeSection === "automations"
      ? projectFilter?.name
      : undefined) ??
    (activeSection === "runs" ? runFilter?.name : undefined);
  const headerTitle = activeCopy?.title ?? BRAND;
  const headerRight = `${plural(rows.length, activeCopy?.noun ?? "item")}${notificationsUnread && activeSection !== "notifications" ? `  ·  ${notificationsUnread} unread` : ""}`;

  const moveList = (delta: number) => {
    if (rows.length === 0) return;
    setSelected((safeSelected + delta + rows.length) % rows.length);
  };

  const moveCommand = (delta: number) => {
    if (filteredCommands.length === 0) return;
    setMenuSelected(
      (safeMenu + delta + filteredCommands.length) % filteredCommands.length,
    );
  };

  const moveProvider = (delta: number) => {
    if (filteredProviders.length === 0) return;
    setMenuSelected(
      (safeProvider + delta + filteredProviders.length) %
        filteredProviders.length,
    );
  };

  const sendHomeMessage = useHomeLaunch({
    app,
    busy,
    detecting,
    draft,
    selectedProviderInfo,
    homeDirectory,
    composeProject,
    composeAgent,
    setPreferredProvider,
    handoff: (run) => run(),
    sessionLauncher,
    attached,
    currentDraft: () => draftRef.current,
    perform,
    fail,
    updateDraft,
    onSaved: (id) => {
      setProjectFilter(null);
      setView({ kind: "section", section: "sessions" });
      setSelected(0);
      setNotice(`Session saved · ${id.slice(0, 8)}`);
    },
  });

  const submitHome = () => {
    if (busy) return;
    if (picker) {
      chooseProvider();
      return;
    }
    if (commandOpen) {
      const command = filteredCommands[safeMenu];
      if (command) runCommand(command);
      return;
    }
    sendHomeMessage();
  };

  const submitView = () => {
    if (isPicker) {
      chooseProvider();
      return;
    }
    if (commandOpen) {
      const command = filteredCommands[safeMenu];
      if (command) runCommand(command);
      return;
    }
    openCommands();
  };

  const paletteCommands: PaletteItem[] = filteredCommands.map((command) => ({
    name: command.name,
    description: command.description,
  }));
  const paletteProviders: PaletteItem[] = filteredProviders.map((option) => ({
    name: option.name,
    description: option.description,
  }));

  useKeyboard((key) => {
    if (!tabActive || key.defaultPrevented) return;
    try {
      if (key.ctrl && key.name === "q" && !busy) {
        renderer.destroy();
        return;
      }
      if (busy || form) return;
      if (wizard) {
        newSession.handleKey(key);
        return;
      }
      if (confirm) {
        if (key.name === "y") {
          key.preventDefault();
          try {
            confirm.action();
            refresh();
          } catch (value) {
            fail(value);
          }
          setConfirm(null);
        }
        if (key.name === "n" || key.name === "escape") {
          key.preventDefault();
          setConfirm(null);
        }
        return;
      }
      if (key.ctrl && key.name === "p") {
        key.preventDefault();
        openCommands();
        return;
      }
      if (commandOpen) {
        if (key.name === "escape") {
          key.preventDefault();
          closePrompt();
          return;
        }
        if (key.name === "up") {
          key.preventDefault();
          moveCommand(-1);
          return;
        }
        if (key.name === "down") {
          key.preventDefault();
          moveCommand(1);
          return;
        }
        return;
      }
      if (isPicker) {
        if (key.name === "escape") {
          key.preventDefault();
          closePrompt();
          return;
        }
        if (key.name === "up") {
          key.preventDefault();
          moveProvider(-1);
          return;
        }
        if (key.name === "down") {
          key.preventDefault();
          moveProvider(1);
          return;
        }
        return;
      }
      if (key.name === "escape") {
        key.preventDefault();
        back();
        return;
      }
      if (view.kind === "home") {
        if (key.name === "/" && !draftRef.current) {
          key.preventDefault();
          openCommands();
        }
        return;
      }
      if (key.name === "/") {
        key.preventDefault();
        openCommands();
        return;
      }
      const detailVisible = report !== null || view.kind === "detail";
      const plain = !key.ctrl && !key.meta && !key.super;

      if (plain && key.name === "n" && creationCommand) {
        key.preventDefault();
        runCommand(creationCommand);
        return;
      }

      if (
        plain &&
        key.name === "r" &&
        activeSection === "sessions" &&
        report === null
      ) {
        const rename = contextCommands.find(
          (command) => command.name === "rename",
        );
        if (rename) {
          key.preventDefault();
          runCommand(rename);
          return;
        }
      }

      if (
        plain &&
        !detailVisible &&
        (key.name === "left" || key.name === "right")
      ) {
        const section = view.kind === "section" ? activeSection : undefined;
        const filters = section ? resources[section].filters : undefined;
        if (section && filters && filters.length > 1) {
          key.preventDefault();
          const current = resources[section].filterIndex ?? 0;
          const next =
            (current + (key.name === "right" ? 1 : -1) + filters.length) %
            filters.length;
          resources[section].selectFilter?.(next);
          return;
        }
      }

      if (plain && (key.name === "left" || key.name === "h")) {
        key.preventDefault();
        back();
        return;
      }

      if (detailVisible) {
        if (plain && key.name === "j") {
          key.preventDefault();
          detailScroll.current?.scrollBy(1);
          return;
        }
        if (plain && key.name === "k") {
          key.preventDefault();
          detailScroll.current?.scrollBy(-1);
          return;
        }
        return;
      }

      if (view.kind === "section") {
        if (key.name === "up" || (plain && key.name === "k")) {
          key.preventDefault();
          moveList(-1);
          return;
        }
        if (key.name === "down" || (plain && key.name === "j")) {
          key.preventDefault();
          moveList(1);
          return;
        }
        if (
          key.name === "return" ||
          (plain && (key.name === "right" || key.name === "l"))
        ) {
          key.preventDefault();
          if (activeSection && selectedRow) openRow(activeSection, selectedRow);
        }
      }
    } catch (value) {
      fail(value);
    }
  });

  const renderHome = (active: boolean) => (
    <Home
      active={active && tabActive}
      terminalWidth={terminalWidth}
      terminalHeight={terminalHeight}
      commandOpen={commandOpen}
      picker={picker}
      input={input}
      draft={draft}
      busy={busy}
      detecting={detecting}
      homeDirectory={homeDirectory}
      selectedProvider={selectedProvider}
      modelSummary={
        selectedProvider
          ? (() => {
              const defaults = app.providerDefaults(selectedProvider);
              return defaults.model
                ? `${defaults.model} · ${defaults.reasoning ?? "provider default"}`
                : "Provider model default";
            })()
          : undefined
      }
      selectedProviderInfo={selectedProviderInfo}
      composeAgent={composeAgent}
      composeProject={composeProject}
      paletteProviders={paletteProviders}
      paletteCommands={paletteCommands}
      safeProvider={safeProvider}
      safeMenu={safeMenu}
      error={error}
      notice={notice}
      setInput={setInput}
      setMenuSelected={setMenuSelected}
      setCommandOpen={setCommandOpen}
      updateDraft={updateDraft}
      submitHome={submitHome}
    />
  );

  // ----- render ------------------------------------------------------------

  if (terminalWidth < 65 || terminalHeight < 18)
    return (
      <box padding={1}>
        <text fg={colors.text}>
          Resize the terminal to at least 65 columns × 18 rows. Ctrl+Q quits.
        </text>
      </box>
    );

  if (form)
    return (
      <ModalSurface
        backdrop={renderHome(false)}
        width={modalWidth}
        height={modalHeight}
      >
        <box
          width="100%"
          height="100%"
          backgroundColor={colors.bg}
          flexDirection="column"
        >
          <Form
            embedded
            active={tabActive}
            availableWidth={width}
            availableHeight={height}
            spec={form}
            cancel={() => {
              setForm(null);
              setError("");
            }}
            fail={fail}
            error={error}
            clearError={() => setError("")}
          />
        </box>
      </ModalSurface>
    );

  if (wizard)
    return (
      <ModalSurface
        backdrop={renderHome(false)}
        width={modalWidth}
        height={modalHeight}
      >
        {newSession.render()}
      </ModalSurface>
    );

  if (view.kind === "home") return renderHome(true);
  return (
    <ResourceModal
      backdrop={renderHome(false)}
      modalWidth={modalWidth}
      modalHeight={modalHeight}
      width={width}
      height={height}
      commandOpen={commandOpen}
      isPicker={isPicker}
      filteredProviders={filteredProviders}
      filteredCommands={filteredCommands}
      safeSelected={safeSelected}
      rows={rows}
      view={view}
      detailRow={detailRow}
      report={report}
      contextCommands={contextCommands}
      headerTitle={headerTitle}
      headerDetail={headerDetail}
      headerRight={headerRight}
      confirm={confirm}
      detailScroll={detailScroll}
      activeCopy={activeCopy}
      activeSection={activeSection}
      filters={activeFilters}
      filterIndex={activeFilterIndex}
      providers={providers}
      paletteProviders={paletteProviders}
      paletteCommands={paletteCommands}
      safeProvider={safeProvider}
      safeMenu={safeMenu}
      picker={picker}
      input={input}
      interactive={tabActive}
      promptVisible={promptVisible && tabActive}
      setInput={setInput}
      setMenuSelected={setMenuSelected}
      submitView={submitView}
      error={error}
      busy={busy}
      notice={notice}
      creationCommand={creationCommand}
    />
  );
}

export async function startTui(app: Application) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      `${BRAND} TUI requires an interactive terminal; use agentos --help for direct commands`,
    );
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);
  try {
    root.render(<App app={app} />);
    await renderer.closed;
  } finally {
    root.unmount();
    renderer.destroy();
    await app.settleInteractiveSessions();
  }
}
