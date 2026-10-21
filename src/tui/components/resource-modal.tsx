import type { ScrollBoxRenderable } from "@opentui/core";
import type { ReactNode, RefObject } from "react";
import { redact } from "../../platform/files";
import { errorMessage } from "../../platform/paths";
import type { ProviderInfo } from "../../providers/types";
import { colors } from "../theme";
import type {
  Command,
  Confirmation,
  PaletteItem,
  Picker,
  Report,
  ResourceView,
  Row,
  SectionKey,
  View,
} from "../types";
import {
  ActionLine,
  CommandBox,
  Confirm,
  EmptyState,
  Hints,
  ListRow,
  ModalSurface,
  Palette,
  SectionHeader,
} from ".";

interface ResourceModalProps {
  interactive?: boolean;
  backdrop: ReactNode;
  modalWidth: number;
  modalHeight: number;
  width: number;
  height: number;
  commandOpen: boolean;
  isPicker: boolean;
  filteredProviders: PaletteItem[];
  filteredCommands: Command[];
  safeSelected: number;
  rows: Row[];
  view: View;
  detailRow?: Row;
  report: Report | null;
  contextCommands: Command[];
  headerTitle: string;
  headerDetail?: string;
  headerRight: string;
  confirm: Confirmation | null;
  detailScroll: RefObject<ScrollBoxRenderable | null>;
  activeCopy: ResourceView["copy"] | null;
  activeSection?: SectionKey;
  providers: ProviderInfo[];
  paletteProviders: PaletteItem[];
  paletteCommands: PaletteItem[];
  safeProvider: number;
  safeMenu: number;
  picker: Picker | null;
  input: string;
  promptVisible: boolean;
  setInput: (value: string) => void;
  setMenuSelected: (value: number) => void;
  submitView: () => void;
  error: string;
  busy: boolean;
  notice: string;
  creationCommand?: Command;
}
export function ResourceModal({
  interactive = true,
  backdrop,
  modalWidth,
  modalHeight,
  width,
  height,
  commandOpen,
  isPicker,
  filteredProviders,
  filteredCommands,
  safeSelected,
  rows,
  view,
  detailRow,
  report,
  contextCommands,
  headerTitle,
  headerDetail,
  headerRight,
  confirm,
  detailScroll,
  activeCopy,
  activeSection,
  providers,
  paletteProviders,
  paletteCommands,
  safeProvider,
  safeMenu,
  picker,
  input,
  promptVisible,
  setInput,
  setMenuSelected,
  submitView,
  error,
  busy,
  notice,
  creationCommand,
}: ResourceModalProps) {
  const commandBarWidth = Math.max(48, Math.min(88, width - 8));
  const paletteRows = Math.max(1, Math.min(8, height - 12));
  const paletteVisible = commandOpen || isPicker;
  const paletteHeight = paletteVisible
    ? Math.max(
        1,
        Math.min(
          isPicker ? filteredProviders.length : filteredCommands.length,
          paletteRows,
        ),
      ) +
      2 +
      (isPicker ? 1 : 0)
    : 0;
  const listCapacity = Math.max(
    1,
    Math.floor((height - 9 - (paletteVisible ? paletteHeight + 2 : 0)) / 3),
  );
  const listStart = Math.max(
    0,
    Math.min(
      safeSelected - Math.floor(listCapacity / 2),
      Math.max(0, rows.length - listCapacity),
    ),
  );
  const visibleRows = rows.slice(listStart, listStart + listCapacity);
  const contentWidth = width - 4;

  let body = "";
  if (view.kind === "detail" && detailRow) {
    try {
      body = detailRow.body();
    } catch (value) {
      body = redact(errorMessage(value));
    }
  }
  if (report) body = report.body;
  if (view.kind === "detail" && !detailRow && !report)
    body = "This item no longer exists. Press Esc to go back.";

  const contextActions = contextCommands
    .map((command) => command.name)
    .slice(0, 5);
  const canRename =
    report === null &&
    activeSection === "sessions" &&
    contextCommands.some((command) => command.name === "rename");

  const detailMode = view.kind === "detail" || report !== null;

  return (
    <ModalSurface backdrop={backdrop} width={modalWidth} height={modalHeight}>
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

        {confirm ? (
          <Confirm message={confirm.message} width={width} />
        ) : detailMode ? (
          <box
            flexGrow={1}
            flexDirection="column"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            overflow="hidden"
          >
            {body ? (
              <scrollbox
                ref={detailScroll}
                flexGrow={1}
                focused={interactive && !commandOpen && !isPicker}
                scrollbarOptions={{ visible: false }}
              >
                <text fg={colors.textSoft} wrapMode="word">
                  {body}
                </text>
              </scrollbox>
            ) : (
              <EmptyState
                glyph="◇"
                title="Nothing to show"
                hint="Press Esc to go back"
              />
            )}
          </box>
        ) : (
          <box
            flexGrow={1}
            flexDirection="column"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            overflow="hidden"
          >
            {visibleRows.length ? (
              visibleRows.map((row, index) => (
                <ListRow
                  key={row.id}
                  row={row}
                  selected={
                    view.kind === "section" &&
                    listStart + index === safeSelected
                  }
                  contentWidth={contentWidth}
                />
              ))
            ) : (
              <EmptyState
                glyph={activeCopy?.glyph ?? "◇"}
                title={
                  activeSection === "providers" && providers.length === 0
                    ? "Detecting providers…"
                    : (activeCopy?.empty ?? "Nothing here")
                }
                hint={activeCopy?.hint ?? "Press / to browse commands"}
              />
            )}
          </box>
        )}

        {paletteVisible ? (
          <box
            width="100%"
            alignItems="center"
            marginTop={1}
            flexShrink={0}
            paddingLeft={2}
            paddingRight={2}
          >
            <Palette
              items={isPicker ? paletteProviders : paletteCommands}
              selected={isPicker ? safeProvider : safeMenu}
              width={commandBarWidth}
              maxRows={paletteRows}
              empty={
                isPicker
                  ? "No choices match this search"
                  : "No commands match this search"
              }
              slash={!isPicker}
              title={isPicker ? picker?.title : undefined}
            />
          </box>
        ) : null}

        {confirm ? null : (
          <>
            <box height={1} paddingLeft={2} paddingRight={2} flexShrink={0}>
              <text fg={colors.line} wrapMode="none">
                {"─".repeat(Math.max(0, width - 4))}
              </text>
            </box>
            <CommandBox
              variant="bar"
              width={width}
              value={input}
              placeholder={isPicker ? "Search choices…" : "Type a command…"}
              focused={promptVisible && !confirm}
              paletteOpen={paletteVisible}
              onInput={(value) => {
                setInput(value);
                setMenuSelected(0);
              }}
              onSubmit={submitView}
            />
          </>
        )}

        <box flexDirection="column" flexShrink={0}>
          {confirm ? (
            <>
              <box height={1} paddingLeft={2}>
                <text fg={colors.muted} wrapMode="none">
                  Choose an option to continue
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
                    { key: "y", label: "yes" },
                    { key: "n", label: "no" },
                    { key: "Esc", label: "close" },
                  ]}
                />
              </box>
            </>
          ) : (
            <>
              {error || busy || notice ? (
                <box
                  height={1}
                  paddingLeft={2}
                  paddingRight={2}
                  overflow="hidden"
                >
                  <text
                    fg={
                      error
                        ? colors.error
                        : busy
                          ? colors.accent
                          : colors.success
                    }
                    wrapMode="none"
                  >
                    {error || (busy ? "Working…" : notice)}
                  </text>
                </box>
              ) : contextActions.length ? (
                <ActionLine actions={contextActions} />
              ) : (
                <box height={1} paddingLeft={2} overflow="hidden">
                  <text fg={colors.faint} wrapMode="none">
                    Press / to browse every command
                  </text>
                </box>
              )}
              <box
                width="100%"
                paddingLeft={2}
                paddingRight={2}
                paddingBottom={1}
              >
                <Hints
                  items={[
                    ...(creationCommand ? [{ key: "n", label: "new" }] : []),
                    ...(canRename ? [{ key: "r", label: "rename" }] : []),
                    { key: "/", label: "commands" },
                    ...(width >= 78
                      ? [{ key: "↑↓", label: detailMode ? "scroll" : "move" }]
                      : []),
                    ...(detailMode ? [] : [{ key: "↵", label: "open" }]),
                    { key: "Esc", label: "back" },
                  ]}
                />
              </box>
            </>
          )}
        </box>
      </box>
    </ModalSurface>
  );
}
