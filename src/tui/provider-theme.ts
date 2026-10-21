import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as TOML from "@iarna/toml";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";
import { atomicWrite } from "../lib/platform/files";
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

const scopes = [
  ["comment", colors.muted],
  ["keyword, storage", colors.accent],
  ["string", colors.success],
  ["constant.numeric, constant.language", colors.warning],
  ["entity.name.function, support.function", "#9ddbdc"],
  ["entity.name.type, support.type", "#c6b5e9"],
  ["invalid", colors.error],
];
export const codexTheme = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>name</key><string>Agentos</string><key>settings</key><array>
<dict><key>settings</key><dict><key>foreground</key><string>${colors.text}</string><key>background</key><string>${colors.bg}</string><key>selection</key><string>${colors.selection}</string><key>caret</key><string>${colors.accent}</string></dict></dict>
${scopes.map(([scope, color]) => `<dict><key>scope</key><string>${scope}</string><key>settings</key><dict><key>foreground</key><string>${color}</string></dict></dict>`).join("\n")}
</array></dict></plist>\n`;

function read(file: string) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}
function jsonSetting(file: string, path: string[], value: unknown) {
  const original = read(file);
  const errors: ParseError[] = [];
  const document = parse(original || "{}", errors);
  if (
    errors.length ||
    !document ||
    typeof document !== "object" ||
    Array.isArray(document)
  )
    throw new Error(`Invalid settings: ${file}`);
  const next = applyEdits(
    original || "{}",
    modify(original || "{}", path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
  if (next !== original) atomicWrite(file, next, original);
}

// Explicit setup, never performed implicitly by a session or an automation.
// Only theme keys change; JSON comments and all unrelated TOML values survive.
export function configureProviderThemes(env: NodeJS.ProcessEnv = process.env) {
  const home = env.HOME || homedir();
  const codex = env.CODEX_HOME || join(home, ".codex");
  const config = join(codex, "config.toml");
  const original = read(config);
  const before = TOML.parse(original);
  let next: string;
  const section = /^\[tui\][ \t]*(?:#.*)?$/m.exec(original);
  if (section) {
    const start = section.index + section[0].length;
    const rest = original.slice(start);
    const end = rest.search(/^\[/m);
    const body = end === -1 ? rest : rest.slice(0, end);
    const replacement = /^[ \t]*theme[ \t]*=/m.test(body)
      ? body.replace(/^([ \t]*theme[ \t]*=)[^\n]*/m, '$1 "agentos"')
      : `\ntheme = "agentos"${body}`;
    next =
      original.slice(0, start) +
      replacement +
      (end === -1 ? "" : rest.slice(end));
  } else {
    next = `${original}\n[tui]\ntheme = "agentos"\n`;
  }
  const after = TOML.parse(next);
  const withoutTheme = (doc: TOML.JsonMap) => {
    const tui = doc.tui;
    if (
      tui &&
      typeof tui === "object" &&
      !Array.isArray(tui) &&
      !(tui instanceof Date)
    ) {
      delete tui.theme;
      if (!Object.keys(tui).length) delete doc.tui;
    }
    return doc;
  };
  if (
    JSON.stringify(withoutTheme(before)) !== JSON.stringify(withoutTheme(after))
  )
    throw new Error(
      "Cannot safely update Codex theme; check tui configuration",
    );
  atomicWrite(join(codex, "themes/agentos.tmTheme"), codexTheme);
  if (next !== original) atomicWrite(config, next, original);
  const openCodeConfig = join(
    env.XDG_CONFIG_HOME || join(home, ".config"),
    "opencode/cli.json",
  );
  jsonSetting(openCodeConfig, ["theme", "name"], "system");
  jsonSetting(openCodeConfig, ["theme", "mode"], "dark");
  jsonSetting(
    join(home, ".gemini/antigravity-cli/settings.json"),
    ["colorScheme"],
    "terminal",
  );
  return [
    config,
    openCodeConfig,
    join(home, ".gemini/antigravity-cli/settings.json"),
  ] as const;
}
