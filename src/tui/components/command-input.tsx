import { colors } from "../theme";
export function CommandBox({
  width,
  value,
  placeholder,
  focused,
  paletteOpen,
  onSubmit,
  onInput,
  variant,
  prefix = true,
}: {
  width: number;
  value: string;
  placeholder: string;
  focused: boolean;
  paletteOpen: boolean;
  onSubmit: () => void;
  onInput: (value: string) => void;
  variant: "hero" | "bar";
  prefix?: boolean;
}) {
  const showSlash = prefix && !value.startsWith("/");
  if (variant === "hero")
    return (
      <box
        width={width}
        height={3}
        backgroundColor={colors.panel}
        flexDirection="row"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        gap={1}
      >
        {showSlash ? (
          <text fg={colors.accent}>
            <b>/</b>
          </text>
        ) : null}
        <box flexGrow={1} height={1}>
          <input
            width="100%"
            value={value}
            placeholder={placeholder}
            focused={focused}
            onInput={onInput}
            onSubmit={onSubmit}
            backgroundColor={colors.panel}
            focusedBackgroundColor={colors.panel}
            textColor={colors.text}
            focusedTextColor={colors.text}
            placeholderColor={colors.dim}
            cursorColor={colors.accentBright}
          />
        </box>
        <text fg={focused ? colors.accent : colors.dim}>
          {paletteOpen ? "↵" : "→"}
        </text>
      </box>
    );

  return (
    <box
      height={1}
      backgroundColor={colors.bgRaised}
      flexDirection="row"
      alignItems="center"
      paddingLeft={2}
      paddingRight={2}
      gap={1}
      overflow="hidden"
    >
      <text fg={focused ? colors.accent : colors.accentDim}>▌</text>
      {focused ? (
        <>
          {showSlash ? <text fg={colors.accent}>/</text> : null}
          <box flexGrow={1} height={1}>
            <input
              width="100%"
              value={value}
              placeholder={placeholder}
              focused={focused}
              onInput={onInput}
              onSubmit={onSubmit}
              backgroundColor={colors.bgRaised}
              focusedBackgroundColor={colors.bgRaised}
              textColor={colors.text}
              focusedTextColor={colors.text}
              placeholderColor={colors.dim}
              cursorColor={colors.accentBright}
            />
          </box>
          <text fg={colors.dim}>{paletteOpen ? "↵" : "esc"}</text>
        </>
      ) : (
        <>
          <text fg={colors.dim}>/</text>
          <text fg={colors.dim}>{placeholder}</text>
          <box flexGrow={1} />
        </>
      )}
    </box>
  );
}
