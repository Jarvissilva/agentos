import type { KeyEvent } from "@opentui/core";
import { useEffect, useState } from "react";
import { type Application, directory } from "../../app";
import type { ProviderInfo } from "../../lib/providers/types";
import {
  CommandBox,
  EmptyState,
  Form,
  Hints,
  ListRow,
  SectionHeader,
} from "../components";
import type { Wizard, WizardOption } from "../lib/types";
import { colors } from "../theme";
import { clip } from "../utils/format";
import { matches } from "../utils/search";

const wizardSteps = ["project", "directory", "agent", "provider"] as const;
interface NewSessionProps {
  active: boolean;
  inputActive?: boolean;
  app: Application;
  providers: ProviderInfo[];
  defaultDirectory?: string;
  width: number;
  height: number;
  busy: boolean;
  error: string;
  notice: string;
  fail: (error: unknown) => void;
  setError: (error: string) => void;
  cancel: () => void;
  launch: (
    project?: string,
    agent?: string,
    provider?: string,
    cwd?: string,
  ) => void;
}
// Keep this hook mounted in the shell so resizing cannot discard the current step.
export function useNewSession({
  active,
  inputActive = true,
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
  cancel,
  launch,
}: NewSessionProps) {
  const [wizard, setWizard] = useState<Wizard>({ step: "project" });
  const [input, setInput] = useState("");
  const [menuSelected, setMenuSelected] = useState(0);
  const projects = app.listProjects();
  const agents = app.listAgents();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const back = () => {
    setError("");
    setInput("");
    setMenuSelected(0);
    if (wizard.step === "provider") setWizard({ ...wizard, step: "agent" });
    else if (wizard.step === "agent")
      setWizard({ ...wizard, step: "directory" });
    else if (wizard.step === "directory")
      setWizard({ ...wizard, step: "project" });
    else cancel();
    return;
  };
  const wizardProject = wizard?.projectId
    ? projectById.get(wizard.projectId)
    : undefined;
  const wizardAgent = wizard?.agentId
    ? agentById.get(wizard.agentId)
    : undefined;

  const wizardOptions: WizardOption[] = [];
  if (wizard.step === "project") {
    wizardOptions.push({
      id: "none",
      name: "No project",
      meta: "optional",
      glyph: "○",
      description: "Continue without a group",
      choose: () => {
        setWizard({
          step: "directory",
          cwd: defaultDirectory ?? process.cwd(),
        });
        setInput("");
        setMenuSelected(0);
      },
    });
    for (const project of projects) {
      wizardOptions.push({
        id: project.id,
        name: project.name,
        meta: "project",
        glyph: "▱",
        description: project.description || "Group sessions and automations",
        choose: () => {
          setWizard({
            step: "directory",
            cwd: defaultDirectory ?? process.cwd(),
            projectId: project.id,
          });
          setInput("");
          setMenuSelected(0);
        },
      });
    }
  } else if (wizard.step === "agent") {
    wizardOptions.push({
      id: "none",
      name: "No agent",
      meta: "native",
      glyph: "○",
      description: "Use native provider instructions",
      choose: () => {
        setWizard({ ...wizard, step: "provider", agentId: undefined });
        setInput("");
        setMenuSelected(0);
      },
    });
    for (const agent of agents) {
      wizardOptions.push({
        id: agent.id,
        name: agent.name,
        meta: "role",
        glyph: "◈",
        description: agent.description || "No description",
        choose: () => {
          setWizard({ ...wizard, step: "provider", agentId: agent.id });
          setInput("");
          setMenuSelected(0);
        },
      });
    }
  } else if (wizard.step === "provider") {
    for (const provider of providers.filter((item) => item.interactive)) {
      wizardOptions.push({
        id: provider.id,
        name: provider.id,
        meta: provider.version ? clip(provider.version, 18) : "native",
        glyph: "●",
        description:
          provider.reason ?? "Open the provider's native terminal interface",
        choose: () =>
          launch(wizard.projectId, wizard.agentId, provider.id, wizard.cwd),
      });
    }
  }

  const filteredWizard = wizardOptions.filter((option) =>
    matches(
      `${option.name} ${option.meta ?? ""} ${option.description ?? ""}`,
      input,
    ),
  );
  const safeWizard = Math.max(
    0,
    Math.min(menuSelected, filteredWizard.length - 1),
  );

  const stepIndex = wizardSteps.indexOf(wizard.step);
  const wizardDetail =
    wizard.step === "project"
      ? "choose a project"
      : wizard.step === "agent"
        ? (wizardProject?.name ?? "no project")
        : (wizardAgent?.name ?? "native instructions");

  const chooseWizard = () => {
    const option = filteredWizard[safeWizard];
    if (!option) return;
    option.choose();
  };

  const moveWizard = (delta: number) => {
    if (filteredWizard.length === 0) return;
    setMenuSelected(
      (safeWizard + delta + filteredWizard.length) % filteredWizard.length,
    );
  };

  const wizardEmpty =
    wizard.step === "provider" && providers.length === 0
      ? "Detecting providers…"
      : wizard.step === "provider"
        ? "No interactive providers detected"
        : "No matches";

  const headerTitle = "New session";
  const headerDetail = wizardDetail;
  const headerRight = `${stepIndex + 1} / 4`;
  const handleKey = (key: KeyEvent) => {
    if (!active || busy || wizard.step === "directory") return;
    if (key.name === "escape") {
      key.preventDefault();
      back();
    }
    if (key.name === "up") {
      key.preventDefault();
      moveWizard(-1);
    }
    if (key.name === "down") {
      key.preventDefault();
      moveWizard(1);
    }
  };
  useEffect(() => {
    if (!active) {
      setWizard({ step: "project" });
      setInput("");
      setMenuSelected(0);
    }
  }, [active]);
  const render = () => {
    if (wizard.step === "directory")
      return (
        <box
          width="100%"
          height="100%"
          backgroundColor={colors.bg}
          flexDirection="column"
        >
          <SectionHeader
            title="New session"
            detail="choose a working directory"
            right="2 / 4"
            width={width}
          />
          <Form
            active={inputActive}
            embedded
            availableWidth={width}
            availableHeight={height}
            spec={{
              title: "Session working directory",
              subtitle: wizardProject
                ? `Group: ${wizardProject.name}`
                : "No project group",
              fields: [
                {
                  label: "Working directory",
                  value: wizard.cwd ?? process.cwd(),
                },
              ],
              save: (values) => {
                const cwd = directory(values[0] ?? "");
                setWizard({ ...wizard, step: "agent", cwd });
                setInput("");
                setMenuSelected(0);
                setError("");
              },
            }}
            cancel={back}
            fail={fail}
            error={error}
            clearError={() => setError("")}
          />
        </box>
      );

    {
      const capacity = Math.max(1, Math.floor((height - 10) / 3));
      const start = Math.max(
        0,
        Math.min(
          safeWizard - Math.floor(capacity / 2),
          Math.max(0, filteredWizard.length - capacity),
        ),
      );
      const visible = filteredWizard.slice(start, start + capacity);
      const contentWidth = width - 4;
      return (
        <box
          width="100%"
          height="100%"
          backgroundColor={colors.bg}
          flexDirection="column"
          overflow="hidden"
        >
          <SectionHeader
            title={headerTitle}
            detail={headerDetail}
            right={headerRight}
            width={width}
          />
          <box
            flexDirection="column"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            flexGrow={1}
            overflow="hidden"
          >
            <box height={1} marginBottom={1}>
              <text fg={colors.muted} wrapMode="none">
                {wizard.step === "project"
                  ? "Choose an optional group for this session."
                  : wizard.step === "agent"
                    ? "Choose a reusable role, or use the provider's native instructions."
                    : "Choose the native provider whose terminal interface should open."}
              </text>
            </box>
            {visible.length ? (
              visible.map((option) => {
                const absolute = filteredWizard.indexOf(option);
                return (
                  <ListRow
                    key={option.id}
                    row={{
                      id: option.id,
                      name: option.name,
                      meta: option.meta,
                      description: option.description,
                      glyph: option.glyph,
                      glyphColor: colors.accentDim,
                    }}
                    selected={absolute === safeWizard}
                    contentWidth={contentWidth}
                  />
                );
              })
            ) : (
              <EmptyState
                glyph="◇"
                title={wizardEmpty}
                hint={
                  wizard.step === "provider"
                    ? "Configure codex, opencode, or agy, then retry"
                    : "Esc to go back, or type a different search"
                }
              />
            )}
          </box>
          <box height={1} paddingLeft={2} paddingRight={2}>
            <text fg={colors.line} wrapMode="none">
              {"─".repeat(Math.max(0, width - 4))}
            </text>
          </box>
          <CommandBox
            variant="bar"
            width={width}
            value={input}
            placeholder={`Filter ${wizard.step ?? ""}s…`}
            focused={inputActive && !busy}
            paletteOpen={false}
            prefix={false}
            onInput={(value) => {
              setInput(value);
              setMenuSelected(0);
            }}
            onSubmit={chooseWizard}
          />
          <box flexDirection="column" flexShrink={0}>
            <box height={1} paddingLeft={2} paddingRight={2} overflow="hidden">
              <text
                fg={
                  error ? colors.error : busy ? colors.accent : colors.success
                }
                wrapMode="none"
              >
                {error || (busy ? "Working…" : notice)}
              </text>
            </box>
            <box
              width="100%"
              paddingLeft={2}
              paddingRight={2}
              paddingBottom={1}
            >
              <Hints
                items={[
                  { key: "↑↓", label: "move" },
                  { key: "Enter", label: "select" },
                  { key: "Esc", label: "back" },
                ]}
              />
            </box>
          </box>
        </box>
      );
    }
  };
  return { render, handleKey };
}
