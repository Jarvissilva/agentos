import { BRAND } from "../lib/constants";
import type { ListRowData } from "../lib/types";
import { colors } from "../theme";
import { clip } from "../utils/format";
export function SectionHeader({
  title,
  detail,
  right,
  width,
}: {
  title: string;
  detail?: string;
  right: string;
  width: number;
}) {
  return (
    <box flexDirection="column" flexShrink={0}>
      <box
        height={1}
        flexDirection="row"
        paddingLeft={2}
        paddingRight={2}
        gap={0}
        overflow="hidden"
      >
        <text fg={colors.accent}>◈</text>
        <text fg={colors.dim}>{` ${BRAND}`}</text>
        <text fg={colors.faint}>{"  /  "}</text>
        <text fg={colors.text} wrapMode="none">
          <b>{title}</b>
        </text>
        {detail ? (
          <>
            <text fg={colors.faint}>{"  /  "}</text>
            <text fg={colors.textSoft} wrapMode="none">
              {clip(detail, Math.max(10, width - 52))}
            </text>
          </>
        ) : null}
        <box flexGrow={1} />
        <text fg={colors.muted} wrapMode="none">
          {right}
        </text>
      </box>
      <box height={1} paddingLeft={2} paddingRight={2}>
        <text
          fg={colors.line}
          wrapMode="none"
        >{`${"─".repeat(Math.max(0, width - 4))}`}</text>
      </box>
    </box>
  );
}

export function ListRow({
  row,
  selected,
  contentWidth,
}: {
  row: ListRowData;
  selected: boolean;
  contentWidth: number;
}) {
  const meta = clip(
    row.meta ?? "",
    Math.min(28, Math.max(10, contentWidth / 3)),
  );
  const nameWidth = Math.max(10, contentWidth - meta.length - 6);
  return (
    <box
      height={2}
      marginBottom={1}
      flexDirection="column"
      backgroundColor={selected ? colors.selection : colors.bg}
      paddingLeft={1}
      paddingRight={1}
      overflow="hidden"
    >
      <box height={1} flexDirection="row" gap={1}>
        <text fg={selected ? colors.accent : colors.faint}>
          {selected ? "▌" : " "}
        </text>
        {row.glyph ? (
          <text fg={row.glyphColor ?? colors.accentDim}>{row.glyph}</text>
        ) : null}
        <text fg={selected ? colors.accentBright : colors.text} wrapMode="none">
          {selected ? (
            <b>{clip(row.name, nameWidth)}</b>
          ) : (
            clip(row.name, nameWidth)
          )}
        </text>
        <box flexGrow={1} />
        {meta ? (
          <text fg={selected ? colors.accentDim : colors.muted} wrapMode="none">
            {meta}
          </text>
        ) : null}
      </box>
      {row.description ? (
        <box height={1} paddingLeft={2}>
          <text fg={selected ? colors.textSoft : colors.dim} wrapMode="none">
            {clip(row.description, Math.max(8, contentWidth - 4))}
          </text>
        </box>
      ) : null}
    </box>
  );
}

export function EmptyState({
  glyph,
  title,
  hint,
}: {
  glyph: string;
  title: string;
  hint: string;
}) {
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      gap={1}
    >
      <text fg={colors.accentDim}>{glyph}</text>
      <text fg={colors.text}>{title}</text>
      <text fg={colors.muted}>{hint}</text>
    </box>
  );
}

export function ActionLine({ actions }: { actions: string[] }) {
  return (
    <box height={1} paddingLeft={2} overflow="hidden">
      <text wrapMode="none">
        <span fg={colors.faint}>{"Actions   "}</span>
        {actions.map((action, index) => (
          <span key={action}>
            <span fg={colors.accentDim}>/</span>
            <span fg={colors.muted}>{action}</span>
            {index < actions.length - 1 ? (
              <span fg={colors.faint}>{"   "}</span>
            ) : null}
          </span>
        ))}
      </text>
    </box>
  );
}
