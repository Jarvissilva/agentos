import { readFileSync } from "node:fs";
import { createCliRenderer, type TextareaRenderable } from "@opentui/core";
import {
  createRoot,
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { parse, stringify } from "yaml";
import {
  type Application,
  parseAgent,
  type TerminalHandoff,
} from "../core/application";
import { redact } from "../platform/files";
import { errorMessage } from "../platform/paths";
import { runInteractive } from "../platform/process";
import type { ProviderInfo } from "../providers/types";
import { installWorker, workerStatus } from "../scheduler/systemd";

const colors = {
  bg: "#0b1019",
  panel: "#111b29",
  line: "#26374d",
  text: "#d6e1ef",
  muted: "#899bb2",
  accent: "#5ee0c1",
  error: "#ff9b9b",
};
const pages = [
  "Dashboard",
  "Providers",
  "Projects",
  "Agents",
  "Skills",
  "MCPs",
  "Sessions",
  "Automations",
] as const;
type Page = (typeof pages)[number];
type Choice = { name: string; description: string; action: () => void };
interface FormSpec {
  title: string;
  fields: { label: string; value: string; multiline?: boolean }[];
  save: (values: string[]) => void | Promise<void>;
}

function Form({
  spec,
  cancel,
  fail,
}: {
  spec: FormSpec;
  cancel: () => void;
  fail: (error: unknown) => void;
}) {
  const [values, setValues] = useState(spec.fields.map((f) => f.value));
  const [focus, setFocus] = useState(0);
  const textarea = useRef<TextareaRenderable>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await spec.save(values);
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };
  useKeyboard((key) => {
    if (key.name === "escape") cancel();
    if (key.name === "tab") {
      key.preventDefault();
      setFocus(
        (n) => (n + (key.shift ? values.length - 1 : 1)) % values.length,
      );
    }
    if (key.ctrl && key.name === "s") {
      key.preventDefault();
      void save();
    }
  });
  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      <text fg={colors.accent}>{spec.title}</text>
      <scrollbox flexGrow={1}>
        {spec.fields.map((field, index) => (
          <box key={field.label} flexDirection="column" marginBottom={1}>
            <text fg={focus === index ? colors.accent : colors.muted}>
              {field.label}
            </text>
            {field.multiline ? (
              <textarea
                ref={textarea}
                initialValue={field.value}
                height={8}
                focused={focus === index && !saving}
                backgroundColor={colors.panel}
                textColor={colors.text}
                onContentChange={() =>
                  setValues((old) =>
                    old.map((v, i) =>
                      i === index ? (textarea.current?.plainText ?? v) : v,
                    ),
                  )
                }
              />
            ) : (
              <input
                value={values[index] ?? ""}
                focused={focus === index && !saving}
                backgroundColor={colors.panel}
                textColor={colors.text}
                onInput={(text) =>
                  setValues((old) =>
                    old.map((v, i) => (i === index ? text : v)),
                  )
                }
                onSubmit={() => {
                  if (focus < values.length - 1) setFocus(focus + 1);
                  else void save();
                }}
              />
            )}
          </box>
        ))}
      </scrollbox>
      <text fg={colors.muted}>
        {saving ? "Saving…" : "Tab next field · Ctrl+S save · Esc cancel"}
      </text>
    </box>
  );
}

export function App({ app }: { app: Application }) {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [page, setPage] = useState<Page>("Dashboard");
  const [focus, setFocus] = useState<"nav" | "content" | "search">("nav");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [form, setForm] = useState<FormSpec | null>(null);
  const [wizard, setWizard] = useState<{
    stage: "project" | "agent" | "provider";
    agent?: string;
    project?: string;
  } | null>(null);
  const [detail, setDetail] = useState<{
    title: string;
    body: string;
    sessionId?: string;
    projectId?: string;
    agentId?: string;
    skillId?: string;
    mcpId?: string;
    automationId?: string;
    runId?: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    message: string;
    action: () => void;
  } | null>(null);
  const [actionMenu, setActionMenu] = useState<{
    title: string;
    choices: Choice[];
  } | null>(null);
  const fail = useCallback((value: unknown) => {
    setError(redact(errorMessage(value)));
    setNotice("");
  }, []);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    void app
      .detectProviders()
      .then((items) => {
        if (active) setProviders(items);
      })
      .catch(fail);
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
  const navigate = (next: Page) => {
    setActionMenu(null);
    setPage(next);
    setDetail(null);
    setWizard(null);
    setQuery("");
    setError("");
  };
  const newSession = () => {
    setWizard({ stage: "project" });
    setDetail(null);
    setQuery("");
    setFocus("content");
  };
  const launch = (project?: string, agent?: string, provider = "codex") => {
    setWizard(null);
    void perform(async () => {
      const session = await app.newSession(
        { project, agent, provider },
        handoff,
      );
      navigate("Sessions");
      setNotice(`Session saved · ${session.id}`);
    });
  };
  const projectForm = (id?: string) => {
    const project = id ? app.project(id) : undefined;
    setForm({
      title: project ? "Edit project" : "New project",
      fields: [
        { label: "Name", value: project?.name ?? "" },
        { label: "Working directory", value: project?.cwd ?? process.cwd() },
        { label: "Description", value: project?.description ?? "" },
      ],
      save: (v) => {
        if (project)
          app.updateProject(project.id, {
            name: v[0] ?? "",
            cwd: v[1] ?? "",
            description: v[2] ?? "",
          });
        else app.createProject(v[0] ?? "", v[1] ?? "", v[2]);
        setForm(null);
        setDetail(null);
        refresh();
      },
    });
  };
  const newAgent = () =>
    setForm({
      title: "New agent",
      fields: [
        { label: "Name", value: "" },
        { label: "Description", value: "" },
        { label: "Instructions", value: "", multiline: true },
      ],
      save: (v) => {
        app.createAgent(v[0] ?? "", v[2] ?? "", v[1]);
        setForm(null);
        refresh();
      },
    });

  const yamlForm = (
    title: string,
    value: unknown,
    save: (v: unknown) => void,
  ) =>
    setForm({
      title,
      fields: [
        {
          label: "Definition (YAML)",
          value: stringify(value),
          multiline: true,
        },
      ],
      save: (v) => {
        save(parse(v[0] ?? ""));
        setForm(null);
        setDetail(null);
        refresh();
      },
    });
  const chooseProvider = (action: (provider: string) => void) => {
    setQuery("");
    setFocus("content");
    setActionMenu({
      title: "Select provider",
      choices: ["codex", "opencode", "agy"].map((provider) => ({
        name: provider,
        description: "Use native global configuration",
        action: () => {
          try {
            action(provider);
            setActionMenu(null);
            refresh();
          } catch (error) {
            fail(error);
          }
        },
      })),
    });
  };
  const importForm = () =>
    setForm({
      title: `Import ${page}`,
      fields: [
        {
          label: page === "Skills" ? "Skill directory" : "Definition file",
          value: "",
        },
      ],
      save: (v) => {
        const path = v[0] ?? "";
        if (page === "Skills") app.skills.import(path);
        else if (page === "Agents") {
          const definition = parseAgent(readFileSync(path, "utf8"));
          app.createAgent(
            definition.name,
            definition.instructions,
            definition.description,
          );
        } else if (page === "MCPs")
          app.mcps.register(parse(readFileSync(path, "utf8")));
        else app.automations.import(path);
        setForm(null);
        refresh();
      },
    });
  const showRuns = (id?: string) => {
    setDetail(null);
    setQuery("");
    setActionMenu({
      title: "Automation runs",
      choices: app.automations.history(id).map((r) => ({
        name: `${r.status} · ${new Date(r.startedAt).toLocaleString()}`,
        description: r.id,
        action: () => {
          setActionMenu(null);
          setDetail({
            title: "Automation run",
            body: JSON.stringify(app.automations.runDetails(r.id), null, 2),
            runId: r.id,
          });
        },
      })),
    });
  };
  const launchAutomation = async (id: string, retryId?: string) => {
    const pid = await app.automations.launch(id, retryId);
    setNotice(`Background execution started · PID ${pid}`);
    refresh();
  };
  useKeyboard((key) => {
    try {
      if (key.ctrl && key.name === "q" && !busy) {
        renderer.destroy();
        return;
      }
      if (busy || form) return;
      if (confirm) {
        if (key.name === "y") {
          try {
            confirm.action();
            setDetail(null);
            refresh();
          } catch (value) {
            fail(value);
          }
          setConfirm(null);
        }
        if (key.name === "n" || key.name === "escape") setConfirm(null);
        return;
      }
      if (key.name === "escape") {
        setActionMenu(null);
        setDetail(null);
        setWizard(null);
        setQuery("");
        setFocus("nav");
        setError("");
        return;
      }
      if (key.name === "tab") {
        key.preventDefault();
        setFocus((f) => (f === "nav" ? "content" : "nav"));
        return;
      }
      if (focus === "search") {
        if (key.name === "return") setFocus("content");
        return;
      }
      if (key.name === "/" && !detail) {
        key.preventDefault();
        setFocus("search");
        return;
      }
      if (key.name === "n") {
        if (page === "Projects") projectForm();
        if (page === "Agents") newAgent();
        if (page === "Skills")
          setForm({
            title: "New skill",
            fields: [
              { label: "Name (lowercase-hyphenated)", value: "" },
              { label: "Description", value: "" },
              { label: "Instructions", value: "", multiline: true },
            ],
            save: (v) => {
              app.skills.create(v[0] ?? "", v[1] ?? "", v[2] ?? "");
              setForm(null);
              refresh();
            },
          });
        if (page === "MCPs")
          yamlForm(
            "Register MCP",
            {
              name: "my-server",
              transport: "stdio",
              command: "",
              args: [],
              envRefs: {},
            },
            (v) => {
              app.mcps.register(v);
            },
          );
        if (page === "Automations")
          yamlForm(
            "New automation",
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
            (v) => {
              app.automations.save(v);
            },
          );
        if (page === "Sessions" || page === "Dashboard") newSession();
      }
      if (
        key.name === "i" &&
        ["Agents", "Skills", "MCPs", "Automations"].includes(page)
      )
        importForm();
      if (key.name === "w" && page === "Automations")
        setConfirm({
          message:
            "Install and start the persistent systemd user scheduler? [y/n]",
          action: () => {
            void perform(async () => {
              await installWorker(app.paths, true);
              setNotice("Persistent scheduler enabled");
            });
          },
        });
      if (key.name === "s" && page === "Automations")
        void perform(async () => {
          setNotice(await workerStatus());
        });
      if (key.name === "g" && detail?.projectId) {
        const id = detail.projectId;
        setForm({
          title: "Project instructions",
          fields: [
            {
              label: "AGENTS.md",
              value: app.readInstructions(id),
              multiline: true,
            },
          ],
          save: (v) => {
            app.saveInstructions(id, v[0] ?? "");
            setForm(null);
          },
        });
      }
      if (key.name === "l" && detail?.skillId)
        chooseProvider((p) => app.skills.install(detail.skillId ?? "", p));
      if (key.name === "x" && detail?.skillId)
        chooseProvider((p) => app.skills.uninstall(detail.skillId ?? "", p));
      if (key.name === "e" && detail?.skillId)
        void perform(async () => {
          const id = detail.skillId ?? "";
          await handoff(() =>
            runInteractive(
              process.env.VISUAL || process.env.EDITOR || "vi",
              [app.skills.file(id)],
              process.cwd(),
            ),
          );
          app.skills.sync(id);
          setDetail(null);
        });
      if (key.name === "d" && detail?.skillId)
        setConfirm({
          message: "Delete this managed skill and its owned links? [y/n]",
          action: () => app.skills.remove(detail.skillId ?? ""),
        });
      if (key.name === "e" && detail?.mcpId)
        yamlForm("Edit MCP", app.mcps.get(detail.mcpId).definition, (v) =>
          app.mcps.update(detail.mcpId ?? "", v),
        );
      if (key.name === "l" && detail?.mcpId)
        chooseProvider((p) => app.mcps.install(detail.mcpId ?? "", p));
      if (key.name === "x" && detail?.mcpId)
        chooseProvider((p) => app.mcps.uninstall(detail.mcpId ?? "", p));
      if (key.name === "t" && detail?.mcpId)
        chooseProvider((p) => app.mcps.install(detail.mcpId ?? "", p, false));
      if (key.name === "d" && detail?.mcpId)
        setConfirm({
          message: "Delete this MCP and its owned installations? [y/n]",
          action: () => app.mcps.remove(detail.mcpId ?? ""),
        });
      if (key.name === "r" && detail?.automationId)
        void perform(() => launchAutomation(detail.automationId ?? ""));
      if (key.name === "e" && detail?.automationId)
        yamlForm(
          "Edit automation",
          app.automations.definition(detail.automationId),
          (v) => {
            app.automations.save(v, undefined, detail.automationId);
          },
        );
      if (key.name === "h" && detail?.automationId)
        showRuns(detail.automationId);
      if (key.name === "h" && page === "Automations" && !detail) showRuns();
      if (key.name === "t" && detail?.automationId) {
        app.automations.enable(
          detail.automationId,
          !app.automations.get(detail.automationId).enabled,
        );
        refresh();
      }
      if (key.name === "d" && detail?.automationId)
        setConfirm({
          message:
            "Delete this automation? Runs must be retained; disable if history exists. [y/n]",
          action: () => app.automations.remove(detail.automationId ?? ""),
        });
      if (key.name === "x" && detail?.runId) {
        app.automations.cancel(detail.runId);
        refresh();
      }
      if (key.name === "r" && detail?.runId)
        void perform(() =>
          launchAutomation(
            app.automations.runDetails(detail.runId ?? "").automationId,
            detail.runId,
          ),
        );
      if (key.name === "d" && detail?.agentId)
        setConfirm({
          message: "Delete this managed role definition? [y/n]",
          action: () => app.removeAgent(detail.agentId ?? ""),
        });
      if (key.name === "r" && detail?.sessionId)
        void perform(() => app.resumeSession(detail.sessionId ?? "", handoff));
      if (key.name === "h" && detail?.sessionId)
        void perform(async () => {
          const history = await app.history(detail.sessionId ?? "");
          setDetail({
            ...detail,
            title: "Native history · latest 20 turns",
            body: JSON.stringify(history, null, 2),
          });
        });
      if (key.name === "e" && detail?.projectId) projectForm(detail.projectId);
      if (key.name === "d" && detail?.projectId)
        setConfirm({
          message:
            "Remove this project's metadata? Workspace files are preserved. [y/n]",
          action: () => app.removeProject(detail.projectId ?? ""),
        });
      if (key.name === "e" && detail?.agentId)
        void perform(async () => {
          const id = detail.agentId ?? "";
          const file = app.agentFile(id);
          const result = await handoff(() =>
            runInteractive(
              process.env.VISUAL || process.env.EDITOR || "vi",
              [file],
              process.cwd(),
            ),
          );
          if (result !== 0) throw new Error(`Editor exited ${result}`);
          app.syncAgent(id);
          setDetail(null);
        });
    } catch (error) {
      fail(error);
    }
  });

  // Database reads are synchronous and small; refresh on metadata changes and
  // the lightweight status interval, without introducing a second state store.
  void revision;
  const projects = app.listProjects();
  const agents = app.listAgents();
  const sessions = app.listSessions();
  const choices: Choice[] = [];
  if (actionMenu) {
    choices.push(...actionMenu.choices);
  } else if (wizard?.stage === "project") {
    choices.push({
      name: "No project",
      description: process.cwd(),
      action: () => {
        setWizard({ stage: "agent" });
        setQuery("");
      },
    });
    for (const p of projects)
      choices.push({
        name: p.name,
        description: p.cwd,
        action: () => {
          setWizard({ stage: "agent", project: p.id });
          setQuery("");
        },
      });
  } else if (wizard?.stage === "agent") {
    choices.push({
      name: "No agent",
      description: "Use native provider instructions",
      action: () => {
        setWizard({ ...wizard, stage: "provider" });
        setQuery("");
      },
    });
    for (const a of agents)
      choices.push({
        name: a.name,
        description: a.description,
        action: () => {
          setWizard({ ...wizard, stage: "provider", agent: a.id });
          setQuery("");
        },
      });
  } else if (wizard?.stage === "provider") {
    for (const p of providers.filter((p) => p.interactive))
      choices.push({
        name: p.id,
        description: p.reason ?? p.version ?? "",
        action: () => launch(wizard.project, wizard.agent, p.id),
      });
  } else if (page === "Dashboard") {
    choices.push({
      name: "Start a native session",
      description: "Choose a project and optional agent",
      action: newSession,
    });
    const allRuns = app.automations.history();
    const dashboardRuns = [
      ...allRuns.filter((r) => r.status === "running"),
      ...allRuns
        .filter((r) =>
          ["failed", "attention", "interrupted"].includes(r.status),
        )
        .slice(0, 3),
      ...allRuns.filter((r) => r.status === "completed").slice(0, 5),
    ];
    for (const run of dashboardRuns)
      choices.push({
        name: `${app.automations.get(run.automationId).name} · ${run.status}`,
        description: `${run.cwd} · ${new Date(run.startedAt).toLocaleString()}`,
        action: () =>
          setDetail({
            title: "Automation run",
            body: JSON.stringify(app.automations.runDetails(run.id), null, 2),
            runId: run.id,
          }),
      });
    for (const schedule of app.automations
      .upcoming()
      .filter((s) => s.nextAt !== null)
      .slice(0, 3))
      choices.push({
        name: `Upcoming · ${app.automations.get(schedule.automationId).name}`,
        description: new Date(schedule.nextAt ?? 0).toLocaleString(),
        action: () => {
          navigate("Automations");
        },
      });
    for (const note of app
      .listNotifications()
      .filter((n) => !n.read)
      .slice(0, 5))
      choices.push({
        name: `● ${note.message}`,
        description: new Date(note.createdAt).toLocaleString(),
        action: () => {
          app.readNotification(note.id);
          refresh();
        },
      });
    for (const s of sessions.slice(0, 5))
      choices.push({
        name: `${projects.find((p) => p.id === s.projectId)?.name ?? "No project"} · ${s.status}`,
        description: `${s.provider} · ${s.cwd}`,
        action: () => {
          navigate("Sessions");
          setDetail({
            title: "Session",
            body: JSON.stringify(s, null, 2),
            sessionId: s.id,
          });
        },
      });
  } else if (page === "Providers") {
    for (const p of providers)
      choices.push({
        name: `${p.id} · ${p.interactive ? "ready" : p.installed ? "detected" : "missing"}`,
        description: p.reason ?? p.version ?? "",
        action: () =>
          setDetail({ title: p.id, body: JSON.stringify(p, null, 2) }),
      });
  } else if (page === "Projects") {
    for (const p of projects)
      choices.push({
        name: p.name,
        description: p.cwd,
        action: () =>
          setDetail({
            title: p.name,
            body: `${p.description}\n\n${p.cwd}\n\nID: ${p.id}`,
            projectId: p.id,
          }),
      });
  } else if (page === "Agents") {
    for (const a of agents)
      choices.push({
        name: a.name,
        description: a.description,
        action: () => {
          try {
            const definition = app.agentDefinition(a.id);
            setDetail({
              title: definition.name,
              body: `${definition.description}\n\n${definition.instructions}\n\n${app.agentFile(a.id)}`,
              agentId: a.id,
            });
          } catch (value) {
            fail(value);
          }
        },
      });
  } else if (page === "Skills") {
    for (const skill of app.skills.list())
      choices.push({
        name: skill.name,
        description: skill.description,
        action: () => {
          try {
            setDetail({
              title: skill.name,
              body:
                readFileSync(app.skills.file(skill.id), "utf8") +
                "\n\n" +
                JSON.stringify(app.skills.links(skill.id), null, 2),
              skillId: skill.id,
            });
          } catch (error) {
            fail(error);
          }
        },
      });
    choices.push({
      name: "Discover native skills",
      description: "Inspect provider-native discovery directories",
      action: () =>
        chooseProvider((p) => {
          setDetail({
            title: "Native skills",
            body: JSON.stringify(app.skills.discover(p), null, 2),
          });
        }),
    });
  } else if (page === "MCPs") {
    for (const m of app.mcps.list())
      choices.push({
        name: m.name,
        description: m.definition.transport,
        action: () =>
          setDetail({
            title: m.name,
            body:
              stringify(m.definition) +
              "\n" +
              JSON.stringify(app.mcps.installations(m.id), null, 2),
            mcpId: m.id,
          }),
      });
  } else if (page === "Automations") {
    for (const a of app.automations.list())
      choices.push({
        name: `${a.name} · ${a.enabled ? "enabled" : "disabled"}`,
        description: a.cwd,
        action: () => {
          try {
            setDetail({
              title: a.name,
              body: stringify(app.automations.definition(a.id)),
              automationId: a.id,
            });
          } catch (error) {
            fail(error);
          }
        },
      });
  } else {
    for (const s of sessions)
      choices.push({
        name: `${projects.find((p) => p.id === s.projectId)?.name ?? "No project"} · ${s.status}`,
        description: `${s.provider} · ${new Date(s.createdAt).toLocaleString()} · ${s.id}`,
        action: () =>
          setDetail({
            title: "Session",
            body: JSON.stringify(s, null, 2),
            sessionId: s.id,
          }),
      });
  }
  const filtered = choices.filter((c) =>
    `${c.name} ${c.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  let detailBody = detail?.body ?? "";
  try {
    if (detail?.sessionId && detail.title === "Session")
      detailBody = JSON.stringify(app.session(detail.sessionId), null, 2);
    else if (detail?.runId)
      detailBody = JSON.stringify(
        app.automations.runDetails(detail.runId),
        null,
        2,
      );
    else if (detail?.skillId)
      detailBody =
        readFileSync(app.skills.file(detail.skillId), "utf8") +
        "\n\n" +
        JSON.stringify(app.skills.links(detail.skillId), null, 2);
    else if (detail?.mcpId)
      detailBody =
        stringify(app.mcps.get(detail.mcpId).definition) +
        "\n" +
        JSON.stringify(app.mcps.installations(detail.mcpId), null, 2);
    else if (detail?.automationId)
      detailBody = stringify(app.automations.definition(detail.automationId));
  } catch (error) {
    detailBody = redact(errorMessage(error));
  }
  if (width < 65 || height < 18)
    return (
      <box padding={1}>
        <text fg={colors.text}>
          Agent OS needs at least 65 columns × 18 rows. Resize the terminal.
          Ctrl+Q quits.
        </text>
      </box>
    );
  return (
    <box
      width="100%"
      height="100%"
      backgroundColor={colors.bg}
      flexDirection="column"
      padding={1}
    >
      <box height={3} flexDirection="row" justifyContent="space-between">
        <text fg={colors.accent}>
          <b>◈ AGENT OS</b>
        </text>
        <text fg={colors.muted}>local workspace · v0.1</text>
      </box>
      <box flexDirection="row" flexGrow={1} gap={2}>
        <box
          width={23}
          flexDirection="column"
          border
          borderColor={focus === "nav" ? colors.accent : colors.line}
          padding={1}
          gap={1}
        >
          <text fg={colors.muted}>WORKSPACE</text>
          <select
            focused={focus === "nav" && !form && !busy && !confirm}
            height={Math.min(8, Math.max(3, height - 16))}
            options={pages.map((name) => ({ name, description: "" }))}
            selectedIndex={pages.indexOf(page)}
            showDescription={false}
            selectedBackgroundColor={colors.line}
            selectedTextColor={colors.accent}
            textColor={colors.text}
            backgroundColor={colors.bg}
            onSelect={(index) => {
              const next = pages[index];
              if (next) {
                navigate(next);
                setFocus("content");
              }
            }}
          />
          <box flexGrow={1} />
          {height >= 25 && (
            <text
              fg={colors.muted}
            >{`${providers.filter((p) => p.interactive).length} provider ready\n${projects.length} projects\n${sessions.length} sessions`}</text>
          )}
        </box>
        <box
          flexGrow={1}
          flexDirection="column"
          border
          borderColor={focus !== "nav" ? colors.accent : colors.line}
          padding={1}
          gap={1}
        >
          {form ? (
            <Form spec={form} cancel={() => setForm(null)} fail={fail} />
          ) : (
            <>
              <text fg={colors.accent}>
                <b>
                  {wizard
                    ? `New session · select ${wizard.stage}`
                    : (actionMenu?.title ?? detail?.title ?? page)}
                </b>
              </text>
              {page === "Dashboard" && !wizard && !detail && (
                <text
                  fg={colors.muted}
                >{`Native providers. Your projects. Persistent sessions.\n${sessions.filter((s) => s.status === "attached").length} attached · ${sessions.filter((s) => s.status === "failed").length} failed launches`}</text>
              )}
              {detail && !actionMenu ? (
                <scrollbox flexGrow={1} focused={focus === "content"}>
                  <text fg={colors.text}>{detailBody}</text>
                </scrollbox>
              ) : (
                <>
                  <input
                    placeholder="/ search"
                    value={query}
                    focused={focus === "search"}
                    onInput={setQuery}
                    backgroundColor={colors.panel}
                    textColor={colors.text}
                  />
                  {filtered.length ? (
                    <select
                      key={`${page}-${wizard?.stage ?? "list"}-${query}`}
                      options={filtered}
                      focused={focus === "content" && !busy && !confirm}
                      flexGrow={1}
                      selectedBackgroundColor={colors.line}
                      selectedTextColor={colors.accent}
                      textColor={colors.text}
                      descriptionColor={colors.muted}
                      backgroundColor={colors.bg}
                      showScrollIndicator
                      onSelect={(index) => {
                        try {
                          filtered[index]?.action();
                        } catch (error) {
                          fail(error);
                        }
                      }}
                    />
                  ) : (
                    <text fg={colors.muted}>
                      {providers.length === 0 && page === "Providers"
                        ? "Detecting providers…"
                        : "No entries. Press n to create one where supported."}
                    </text>
                  )}
                </>
              )}
              <text fg={colors.muted}>
                {detail?.sessionId
                  ? "r resume · h history · Esc back"
                  : detail?.projectId
                    ? "e edit · g instructions · d remove · Esc back"
                    : detail?.agentId
                      ? "e edit · d remove · Esc back"
                      : detail?.skillId
                        ? "e edit · l install · x unlink · d delete"
                        : detail?.mcpId
                          ? "e edit · l install/enable · t disable · x uninstall · d delete"
                          : detail?.automationId
                            ? "r run · e edit · h history · t toggle · d delete"
                            : detail?.runId
                              ? "x cancel · r retry · Esc back"
                              : page === "Automations"
                                ? "n new · i import · h runs · w scheduler install · s status"
                                : ["Skills", "MCPs", "Agents"].includes(page)
                                  ? "n new · i import · Enter open"
                                  : "Enter open · n new · / search"}
              </text>
            </>
          )}
        </box>
      </box>
      <box minHeight={2} marginTop={1} flexDirection="column">
        <text fg={error ? colors.error : colors.accent}>
          {error || confirm?.message || (busy ? "Working…" : notice)}
        </text>
        <text fg={colors.muted}>
          Tab switch focus · ↑↓ navigate · Esc back · Ctrl+Q quit
        </text>
      </box>
    </box>
  );
}

export async function startTui(app: Application) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Agent OS TUI requires an interactive terminal; use agentos --help for direct commands",
    );
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);
  try {
    root.render(<App app={app} />);
    await renderer.closed;
  } finally {
    root.unmount();
    renderer.destroy();
  }
}
