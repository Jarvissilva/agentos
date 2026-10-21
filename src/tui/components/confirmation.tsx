import { colors } from "../theme";
export function Confirm({
  message,
  width,
}: {
  message: string;
  width: number;
}) {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" padding={1}>
      <box
        width={Math.max(40, Math.min(66, width - 12))}
        border
        borderStyle="rounded"
        borderColor={colors.warning}
        backgroundColor={colors.panel}
        padding={2}
        flexDirection="column"
        gap={1}
      >
        <text fg={colors.warning}>
          <b>Confirm</b>
        </text>
        <text fg={colors.textSoft} wrapMode="word">
          {message}
        </text>
        <text>
          <span bg={colors.chip} fg={colors.textSoft}>
            {" y "}
          </span>
          <span fg={colors.muted}>{" yes    "}</span>
          <span bg={colors.chip} fg={colors.textSoft}>
            {" n "}
          </span>
          <span fg={colors.muted}>{" cancel"}</span>
        </text>
      </box>
    </box>
  );
}
