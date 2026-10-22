import { colors } from "./theme";

// Keep ANSI meanings (errors, success, warnings) while matching the host UI.
export const providerPalette = [
  colors.bg,
  colors.error,
  colors.success,
  colors.warning,
  colors.accent,
  "#c6b5e9",
  "#9ddbdc",
  colors.textSoft,
  colors.muted,
  "#ffbbc0",
  "#b3efd0",
  "#f5dbb1",
  colors.accentBright,
  "#dfcef8",
  "#bceff0",
  colors.text,
];
export const providerThemeSequence =
  `\x1b]10;${colors.text}\x07\x1b]11;${colors.bg}\x07\x1b]12;${colors.accent}\x07` +
  providerPalette
    .map((color, index) => `\x1b]4;${index};${color}\x07`)
    .join("");
