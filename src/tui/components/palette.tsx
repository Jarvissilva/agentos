import type { PaletteItem } from "../lib/types";
import { colors } from "../theme";
export function Palette({
  items,
  selected,
  width,
  maxRows,
  empty,
  slash = true,
  title,
}: {
  items: PaletteItem[];
  selected: number;
  width: number;
  maxRows: number;
  empty: string;
  slash?: boolean;
  title?: string;
}) {
  const maxVisible = Math.max(1, Math.min(maxRows, items.length || 1));
  const start = Math.max(
    0,
    Math.min(
      selected - Math.floor(maxVisible / 2),
      Math.max(0, items.length - maxVisible),
    ),
  );
  const visible = items.slice(start, start + maxVisible);
  const nameWidth = slash
    ? width < 58
      ? 15
      : 19
    : Math.min(
        width - 9,
        Math.max(21, ...items.map((item) => item.name.length + 2)),
      );

  return (
    <box
      width={width}
      border
      borderStyle="rounded"
      borderColor={colors.lineBright}
      backgroundColor={colors.panel}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      {title ? (
        <box height={1} paddingLeft={1}>
          <text fg={colors.muted} wrapMode="none">
            {title}
          </text>
        </box>
      ) : null}
      {visible.length ? (
        visible.map((item, index) => {
          const absolute = start + index;
          const active = absolute === selected;
          return (
            <box
              key={item.name}
              height={1}
              flexDirection="row"
              backgroundColor={active ? colors.selection : colors.panel}
              overflow="hidden"
            >
              <text fg={active ? colors.accent : colors.faint}>
                {active ? "▌" : " "}
              </text>
              <text
                width={nameWidth}
                fg={active ? colors.accent : colors.accentDim}
                wrapMode="none"
              >
                {active ? (
                  <b>{slash ? `/${item.name}` : item.name}</b>
                ) : slash ? (
                  `/${item.name}`
                ) : (
                  item.name
                )}
              </text>
              <box flexGrow={1} height={1}>
                <text
                  fg={active ? colors.textSoft : colors.muted}
                  wrapMode="none"
                >
                  {item.description}
                </text>
              </box>
              <text fg={active ? colors.accent : colors.panel}>
                {active ? "↵" : " "}
              </text>
            </box>
          );
        })
      ) : (
        <box height={1} flexDirection="row">
          <text fg={colors.faint}> </text>
          <text fg={colors.muted}>{empty}</text>
        </box>
      )}
    </box>
  );
}
