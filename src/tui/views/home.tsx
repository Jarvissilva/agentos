import { useEffect, useRef } from "react";
import type { SessionLauncher, TerminalHandoff } from "../../core/application";
import { type Application, directory } from "../../core/application";
import type { ProviderId, ProviderInfo } from "../../providers/types";
import {
  Backdrop,
  CommandBox,
  Hints,
  Logo,
  Palette,
  Wordmark,
} from "../components";
import { clip, colors, prettyPath } from "../theme";
import type { Command, FormSpec, PaletteItem, Picker } from "../types";

interface HomeProps {
  active: boolean;
  terminalWidth: number;
  terminalHeight: number;
  commandOpen: boolean;
  picker: Picker | null;
  input: string;
  draft: string;
  busy: boolean;
  detecting: boolean;
  homeDirectory: string;
  selectedProvider?: string;
  modelSummary?: string;
  selectedProviderInfo?: ProviderInfo;
  composeAgent?: { name: string };
  composeProject?: { name: string };
  paletteProviders: PaletteItem[];
  paletteCommands: PaletteItem[];
  safeProvider: number;
  safeMenu: number;
  error: string;
  notice: string;
  setInput: (value: string) => void;
  setMenuSelected: (value: number) => void;
  setCommandOpen: (value: boolean) => void;
  updateDraft: (value: string) => void;
  submitHome: () => void;
}
export function Home({
  active,
  terminalWidth,
  terminalHeight,
  commandOpen,
  picker,
  input,
  draft,
  busy,
  detecting,
  homeDirectory,
  selectedProvider,
  modelSummary,
  selectedProviderInfo,
  composeAgent,
  composeProject,
  paletteProviders,
  paletteCommands,
  safeProvider,
  safeMenu,
  error,
  notice,
  setInput,
  setMenuSelected,
  setCommandOpen,
  updateDraft,
  submitHome,
}: HomeProps) {
  const width = terminalWidth;
  const height = terminalHeight;
  const commandWidth = Math.max(44, Math.min(72, width - 12));
  const paletteRows = Math.max(2, Math.min(7, height - 23));
  const paletteVisible = active && (commandOpen || picker !== null);
  return (
    <box
      width="100%"
      height="100%"
      backgroundColor={colors.bg}
      flexDirection="column"
      overflow="hidden"
    >
      <Backdrop />
      <box
        flexGrow={1}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={Math.min(7, Math.max(0, Math.floor(height / 5)))}
        zIndex={1}
      >
        {height >= 26 ? <Logo /> : null}
        <box marginTop={height >= 26 ? 1 : 0}>
          <Wordmark />
        </box>
        <box marginTop={2} width="100%" alignItems="center">
          <CommandBox
            key={
              active && picker
                ? "provider-search"
                : active && commandOpen
                  ? "command-search"
                  : "message-draft"
            }
            variant="hero"
            width={commandWidth}
            value={paletteVisible ? input : draft}
            prefix={active && commandOpen}
            placeholder={
              active && picker
                ? "Filter providers…"
                : active && commandOpen
                  ? "Type a command…"
                  : "What would you like to work on?"
            }
            focused={active && !busy}
            paletteOpen={paletteVisible}
            onInput={(value) => {
              if (!active) return;
              if (paletteVisible) {
                setInput(value);
                setMenuSelected(0);
              } else if (value.startsWith("/")) {
                setInput(value);
                setMenuSelected(0);
                setCommandOpen(true);
              } else updateDraft(value);
            }}
            onSubmit={() => {
              if (active) submitHome();
            }}
          />
        </box>
        <box width={commandWidth} height={1} marginTop={1} overflow="hidden">
          <text wrapMode="none">
            <span
              fg={
                selectedProviderInfo?.interactive
                  ? colors.accent
                  : colors.warning
              }
            >
              {selectedProvider
                ? `${selectedProvider} ▾${selectedProviderInfo?.interactive ? "" : " (unavailable)"}`
                : detecting
                  ? "Detecting providers…"
                  : "No provider available"}
            </span>
            <span
              fg={colors.muted}
            >{`   ${clip(prettyPath(homeDirectory), Math.max(12, commandWidth - 38))}   ${composeAgent?.name ?? "No agent"}   ${composeProject?.name ?? "No project"}`}</span>
          </text>
        </box>
        <box width={commandWidth} height={1} overflow="hidden">
          <text fg={colors.muted} wrapMode="none">
            {modelSummary ?? ""}
          </text>
        </box>
        {paletteVisible ? (
          <box marginTop={1} width="100%" alignItems="center" flexShrink={0}>
            <Palette
              items={picker ? paletteProviders : paletteCommands}
              selected={picker ? safeProvider : safeMenu}
              title={picker?.title}
              slash={!picker}
              width={commandWidth}
              maxRows={paletteRows}
              empty={picker ? "No providers match" : "No commands match"}
            />
          </box>
        ) : null}
        {(paletteVisible === false || height >= 26) && (
          <box marginTop={2} width="100%">
            <Hints
              items={[
                { key: "/", label: "commands" },
                { key: "Enter", label: paletteVisible ? "select" : "send" },
                { key: "Ctrl+P", label: "commands" },
              ]}
            />
          </box>
        )}
        <box height={1} marginTop={1} width={commandWidth}>
          <text
            fg={error ? colors.error : busy ? colors.accent : colors.success}
            wrapMode="none"
          >
            {active ? error || (busy ? "Working…" : notice) : ""}
          </text>
        </box>
      </box>
    </box>
  );
}

interface HomeCommandsProps {
  app: Application;
  openForm: (spec: FormSpec) => void;
  homeDirectory: string;
  setHomeDirectory: (value: string) => void;
  setForm: (value: FormSpec | null) => void;
  composeProject?: { name: string };
  composeAgent?: { name: string };
  setHomeProject: (id?: string) => void;
  setHomeAgent: (id?: string) => void;
}
export function homeCommands({
  app,
  openForm,
  homeDirectory,
  setHomeDirectory,
  setForm,
  composeProject,
  composeAgent,
  setHomeProject,
  setHomeAgent,
}: HomeCommandsProps): Command[] {
  return [
    {
      name: "directory",
      description: "Set the working directory for your next message",
      group: "context",
      run: () =>
        openForm({
          title: "Session working directory",
          fields: [{ label: "Working directory", value: homeDirectory }],
          save: (values) => {
            setHomeDirectory(directory(values[0] ?? ""));
            setForm(null);
          },
        }),
    },
    ...(["project", "agent"] as const).map((kind) => ({
      name: kind,
      description: `Choose an optional ${kind} for your next message`,
      group: "context" as const,
      run: () =>
        openForm({
          title: `Session ${kind}`,
          subtitle: "Enter a name or ID; leave empty for none",
          fields: [
            {
              label:
                kind === "project" ? "Project (optional)" : "Agent (optional)",
              value:
                (kind === "project"
                  ? composeProject?.name
                  : composeAgent?.name) ?? "",
            },
          ],
          save: (values) => {
            const name = values[0]?.trim();
            const id = name
              ? kind === "project"
                ? app.project(name).id
                : app.agent(name).id
              : undefined;
            if (kind === "project") setHomeProject(id);
            else setHomeAgent(id);
            setForm(null);
          },
        }),
    })),
  ];
}
interface HomeLaunchProps {
  app: Application;
  busy: boolean;
  detecting: boolean;
  draft: string;
  selectedProviderInfo?: ProviderInfo;
  homeDirectory: string;
  composeProject?: { id: string };
  composeAgent?: { id: string };
  setPreferredProvider: (id: ProviderId) => void;
  handoff: TerminalHandoff;
  sessionLauncher?: SessionLauncher;
  attached?: boolean;
  currentDraft?: () => string;
  perform: (run: () => Promise<unknown>) => Promise<void>;
  fail: (error: unknown) => void;
  updateDraft: (value: string) => void;
  onSaved: (id: string) => void;
}

export function useHomeLaunch({
  app,
  busy,
  detecting,
  draft,
  selectedProviderInfo,
  homeDirectory,
  composeProject,
  composeAgent,
  setPreferredProvider,
  handoff,
  sessionLauncher,
  attached,
  currentDraft,
  perform,
  fail,
  updateDraft,
  onSaved,
}: HomeLaunchProps) {
  const homeStarting = useRef(false);
  const launchedDraft = useRef<string | undefined>(undefined);
  const latest = useRef({ currentDraft, updateDraft });
  latest.current = { currentDraft, updateDraft };
  useEffect(() => {
    if (
      attached &&
      homeStarting.current &&
      launchedDraft.current !== undefined
    ) {
      const { currentDraft, updateDraft } = latest.current;
      if (!currentDraft || currentDraft() === launchedDraft.current)
        updateDraft("");
      launchedDraft.current = undefined;
    }
  }, [attached]);
  return () => {
    if (busy || homeStarting.current) return;
    if (!draft.trim()) return;
    if (detecting) {
      fail(new Error("Detecting providers; please wait."));
      return;
    }
    if (!selectedProviderInfo?.interactive) {
      fail(
        new Error(
          selectedProviderInfo?.reason ??
            "No interactive provider available. Use /provider or /providers to inspect installation status.",
        ),
      );
      return;
    }
    homeStarting.current = true;
    launchedDraft.current = draft;
    void perform(async () => {
      try {
        app.setPreferredProvider(selectedProviderInfo.id);
        setPreferredProvider(selectedProviderInfo.id);
        const session = await app.newSession(
          {
            provider: selectedProviderInfo.id,
            cwd: homeDirectory,
            project: composeProject?.id,
            agent: composeAgent?.id,
            prompt: draft,
          },
          handoff,
          sessionLauncher,
        );
        if (session.status === "failed")
          throw new Error(
            session.error ?? "Native provider exited unsuccessfully",
          );
        if (!currentDraft || currentDraft() === draft) updateDraft("");
        onSaved(session.id);
      } finally {
        homeStarting.current = false;
        launchedDraft.current = undefined;
      }
    });
  };
}
