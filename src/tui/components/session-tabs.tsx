import { type BoxRenderable, EmbeddedTerminalRenderable } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Application, SessionLauncher } from "../../app";
import {
  type EmbeddedCommand,
  EmbeddedProcess,
} from "../../lib/platform/embedded-process";
import { errorMessage } from "../../lib/platform/paths";
import type { Session } from "../../lib/storage/schema";
import { sessionLabel } from "../../modules/sessions/title";
import { colors } from "../theme";
import { providerThemeSequence } from "../theme/provider";
import { clip } from "../utils/format";

interface Invocation {
  session: Session;
  command: EmbeddedCommand;
  resolve: (code: number) => void;
  reject: (error: unknown) => void;
}
interface Tab {
  id: number;
  invocation?: Invocation;
  started?: boolean;
  ended?: boolean;
  endedAt?: number;
  error?: string;
  dashboard?: boolean;
  unread?: boolean;
}
export interface WorkspaceTabProps {
  active: boolean;
  attached: boolean;
  sessionLauncher: SessionLauncher;
  activateSession: (id: string) => boolean;
  /** Timestamp of the most recent provider exit for this tab, if any. */
  endedAt?: number;
  /** Provider exit error text, when the embedded session failed or exited non-zero. */
  endedError?: string;
}

export function SessionTabs({
  app,
  children,
}: {
  app: Application;
  children: (props: WorkspaceTabProps) => ReactNode;
}) {
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1 }]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [activeId, setActiveId] = useState(1);
  const [, setRevision] = useState(0);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const nextId = useRef(2);
  const processes = useRef(new Map<number, EmbeddedProcess>());
  const alive = useRef(true);
  const update = (id: number, patch: Partial<Tab>) =>
    setTabs((items) => {
      const current = items.find((tab) => tab.id === id);
      if (
        !current ||
        Object.entries(patch).every(
          ([key, value]) => current[key as keyof Tab] === value,
        )
      )
        return items;
      return items.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab));
    });
  useEffect(
    () => () => {
      alive.current = false;
      for (const child of processes.current.values()) child.disconnect();
    },
    [],
  );
  useEffect(
    () =>
      app.onSessionsChanged(() => {
        setTabs((items) => {
          let changed = false;
          const next = items.map((tab) => {
            if (!tab.invocation) return tab;
            try {
              const session = app.session(tab.invocation.session.id);
              changed = true;
              return {
                ...tab,
                invocation: { ...tab.invocation, session },
              };
            } catch {
              return tab;
            }
          });
          return changed ? next : items;
        });
        setRevision((value) => value + 1);
      }),
    [app],
  );
  const select = (id: number) => {
    setActiveId(id);
    update(id, { unread: false });
  };
  const create = () => {
    const id = nextId.current++;
    setTabs((items) => [...items, { id }]);
    setActiveId(id);
  };
  const close = () => {
    const id = activeRef.current;
    processes.current.get(id)?.disconnect();
    processes.current.delete(id);
    const items = tabsRef.current;
    const index = items.findIndex((tab) => tab.id === id);
    const remaining = items.filter((tab) => tab.id !== id);
    if (!remaining.length) {
      const fresh = { id: nextId.current++ };
      setTabs([fresh]);
      setActiveId(fresh.id);
    } else {
      const next = remaining[Math.min(index, remaining.length - 1)];
      setTabs(remaining);
      if (next) setActiveId(next.id);
    }
  };
  useKeyboard((key) => {
    if (key.eventType === "release") return;
    let handled = true;
    if (key.ctrl && key.name === "t") create();
    else if (key.ctrl && key.name === "w") close();
    else if (key.ctrl && key.name === "q") renderer.destroy();
    else if ((key.ctrl || key.meta) && /^[1-9]$/.test(key.name)) {
      const tab = tabsRef.current[Number(key.name) - 1];
      if (tab) select(tab.id);
    } else if (key.ctrl && (key.name === "pageup" || key.name === "pagedown")) {
      const items = tabsRef.current;
      const index = items.findIndex((tab) => tab.id === activeRef.current);
      const tab =
        items[
          (index + (key.name === "pageup" ? -1 : 1) + items.length) %
            items.length
        ];
      if (tab) select(tab.id);
    } else if (key.name === "f2") {
      const tab = tabsRef.current.find((tab) => tab.id === activeRef.current);
      if (tab?.invocation) {
        update(tab.id, { dashboard: !tab.dashboard });
        void app.syncSessionNames().catch(() => {
          // The dashboard remains usable when a provider title cannot be read.
        });
      }
    } else handled = false;
    if (handled) {
      key.preventDefault();
      key.stopPropagation();
    }
  });
  const activateSession = (id: string) => {
    const existing = tabsRef.current.find(
      (tab) => tab.invocation?.session.id === id && !tab.ended,
    );
    if (!existing) return false;
    select(existing.id);
    update(existing.id, { dashboard: false });
    return true;
  };
  const launch = (tabId: number): SessionLauncher =>
    Object.assign(
      (session: Session, command: string, args: string[], cwd: string) => {
        if (!alive.current)
          return Promise.reject(
            new Error(
              "Agentos has closed; resume the saved session to continue",
            ),
          );
        const current = tabsRef.current.find((tab) => tab.id === tabId);
        if (!current)
          return Promise.reject(
            new Error(
              "Session tab was closed; resume the saved session to continue",
            ),
          );
        let target = tabId;
        if (current.invocation && !current.ended) {
          target = nextId.current++;
          setTabs((items) => [...items, { id: target }]);
        }
        const id = target;
        return new Promise<number>((resolve, reject) => {
          update(id, {
            invocation: {
              session,
              command: {
                command,
                args,
                cwd,
                ...(session.provider === "agy"
                  ? {
                      persistent: {
                        database: app.paths.database,
                        sessionId: session.id,
                      },
                    }
                  : {}),
              },
              resolve,
              reject,
            },
            started: false,
            ended: false,
            error: undefined,
            dashboard: false,
            endedAt: undefined,
          });
          setActiveId(id);
        });
      },
      {
        preflight: (provider: string) => {
          if (!Bun.which("setsid", { PATH: process.env.PATH }))
            throw new Error(
              "Embedded provider terminals require setsid from util-linux. Install util-linux and retry.",
            );
          if (
            provider === "agy" &&
            !Bun.which("tmux", { PATH: process.env.PATH })
          )
            throw new Error(
              "Agy embedded tabs require tmux to keep tasks running after exit. Install tmux and retry.",
            );
        },
      },
    );
  const cellWidth = Math.max(
    12,
    Math.min(27, Math.floor((width - 2) / Math.min(tabs.length, 4))),
  );
  const capacity = Math.max(1, Math.floor((width - 2) / cellWidth));
  const tabName = (session: Session) => {
    let projectName: string | undefined;
    try {
      projectName = session.projectId
        ? app.project(session.projectId).name
        : undefined;
    } catch {
      projectName = undefined;
    }
    return sessionLabel(session, projectName);
  };
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const first = Math.max(0, activeIndex - capacity + 1);
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={colors.bg}
    >
      <box height={1} flexShrink={0} flexDirection="row" overflow="hidden">
        {tabs.slice(first, first + capacity).map((tab, offset) => (
          <box
            key={tab.id}
            width={cellWidth}
            backgroundColor={
              tab.id === activeId ? colors.selection : colors.panel
            }
            onMouse={(event) => {
              if (event.type === "down") select(tab.id);
            }}
          >
            <text
              fg={tab.id === activeId ? colors.accent : colors.muted}
              wrapMode="none"
            >
              {clip(
                `${first + offset + 1} ${tab.invocation ? `${tab.invocation.session.provider} · ${tabName(tab.invocation.session)}` : "New session"}${tab.unread ? " •" : ""}${tab.ended ? " ○" : ""}`,
                cellWidth - 1,
              )}
            </text>
          </box>
        ))}
      </box>
      <box flexGrow={1} width="100%" overflow="hidden">
        {tabs.map((tab) => (
          <box
            key={tab.id}
            visible={tab.id === activeId}
            width="100%"
            height="100%"
            position="absolute"
            top={0}
            left={0}
          >
            <box
              width="100%"
              height="100%"
              visible={!tab.invocation || !!tab.dashboard}
            >
              {children({
                active:
                  tab.id === activeId && (!tab.invocation || !!tab.dashboard),
                attached: !!tab.started,
                sessionLauncher: launch(tab.id),
                activateSession,
                endedAt: tab.endedAt,
                endedError: tab.error,
              })}
            </box>
            {tab.invocation ? (
              <box
                width="100%"
                height="100%"
                visible={!tab.dashboard}
                position="absolute"
                top={0}
                left={0}
                flexDirection="column"
              >
                <TerminalPane
                  invocation={tab.invocation}
                  active={tab.id === activeId && !tab.dashboard}
                  register={(child) => processes.current.set(tab.id, child)}
                  started={() => update(tab.id, { started: true })}
                  output={() => {
                    if (activeRef.current !== tab.id)
                      update(tab.id, { unread: true });
                  }}
                  ended={(error) => {
                    if (!alive.current) return;
                    update(tab.id, {
                      ended: true,
                      error,
                      dashboard: true,
                      endedAt: Date.now(),
                    });
                  }}
                />
                {tab.error ? (
                  <box height={1} flexShrink={0}>
                    <text fg={colors.error} wrapMode="none">
                      {tab.error}
                    </text>
                  </box>
                ) : null}
              </box>
            ) : null}
          </box>
        ))}
      </box>
    </box>
  );
}

function TerminalPane({
  invocation,
  active,
  register,
  started,
  output,
  ended,
}: {
  invocation: Invocation;
  active: boolean;
  register: (child: EmbeddedProcess) => void;
  started: () => void;
  output: () => void;
  ended: (error?: string) => void;
}) {
  const renderer = useRenderer();
  const host = useRef<BoxRenderable | null>(null);
  const terminal = useRef<EmbeddedTerminalRenderable | null>(null);
  const [viewport, setViewport] = useState<{
    columns: number;
    rows: number;
  } | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const ready = viewport !== null;
  const measure = () => {
    const parent = host.current;
    if (!parent || parent.width < 1 || parent.height < 1) return;
    const columns = Math.floor(parent.width);
    const rows = Math.floor(parent.height);
    setViewport((previous) =>
      previous?.columns === columns && previous.rows === rows
        ? previous
        : { columns, rows },
    );
  };
  const activeRef = useRef(active);
  activeRef.current = active;
  const callbacks = useRef({ register, started, output, ended });
  callbacks.current = { register, started, output, ended };
  useEffect(() => {
    const parent = host.current;
    const size = viewportRef.current;
    if (!ready || !parent || !size) return;
    let child: EmbeddedProcess | undefined;
    let screen: EmbeddedTerminalRenderable | undefined;
    let disposed = false;
    try {
      screen = new EmbeddedTerminalRenderable(renderer, {
        id: `terminal-${invocation.session.id}`,
        width: size.columns,
        height: size.rows,
        cols: size.columns,
        rows: size.rows,
        maxScrollback: 1024 * 1024,
        onData: (bytes) => child?.write(bytes),
        onTerminalResize: (cols, rows) => child?.resize(cols, rows),
      });
      // Set defaults before providers query terminal colors during startup.
      screen.write(providerThemeSequence);
      terminal.current = screen;
      parent.add(screen);
      const surface = screen;
      child = new EmbeddedProcess(
        invocation.command,
        size.columns,
        size.rows,
        (bytes) => {
          if (!disposed) {
            surface.write(bytes);
            callbacks.current.output();
          }
        },
      );
      callbacks.current.register(child);
      const process = child;
      void process
        .start()
        .then(() => {
          if (disposed) return;
          callbacks.current.started();
          if (activeRef.current) surface.focus();
          void process.exited.then((code) => {
            invocation.resolve(code);
            if (!disposed)
              callbacks.current.ended(
                code !== 0
                  ? `Provider exited ${code}; resume the saved conversation to retry`
                  : undefined,
              );
          });
        })
        .catch((error) => {
          process.disconnect();
          invocation.reject(error);
          if (!disposed) callbacks.current.ended(errorMessage(error));
        });
    } catch (error) {
      invocation.reject(error);
      callbacks.current.ended(errorMessage(error));
    }
    return () => {
      disposed = true;
      child?.disconnect();
      // Also settle a pending launch when closed before PTY startup completes.
      invocation.resolve(0);
      terminal.current = null;
      if (screen && !screen.isDestroyed) {
        parent.remove(screen);
        screen.destroy();
      }
    };
  }, [invocation, renderer, ready]);
  useEffect(() => {
    if (!viewport || !terminal.current) return;
    // Let the emulator adopt its new grid before onTerminalResize changes the
    // PTY. Otherwise the provider can redraw into the previous-sized grid.
    terminal.current.width = viewport.columns;
    terminal.current.height = viewport.rows;
  }, [viewport]);
  useEffect(() => {
    if (active) terminal.current?.focus();
    else terminal.current?.blur();
  }, [active]);
  return (
    <box
      width="100%"
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      border
      borderStyle="single"
      borderColor={colors.lineBright}
      padding={0}
      flexDirection="column"
      overflow="hidden"
    >
      <box
        ref={host}
        width="100%"
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        overflow="hidden"
        onSizeChange={measure}
      />
    </box>
  );
}
