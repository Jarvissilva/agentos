import { existsSync } from "node:fs";
import { join } from "node:path";

const configuration = {
  codex: { format: "toml", section: "mcp_servers", disabledFlag: false },
  opencode: { format: "jsonc", section: "mcp", disabledFlag: false },
  agy: { format: "jsonc", section: "mcpServers", disabledFlag: true },
} as const;
export function nativeConfiguration(provider: string) {
  if (provider !== "codex" && provider !== "opencode" && provider !== "agy")
    throw new Error("Unknown provider");
  return configuration[provider];
}
export function nativeMcpPath(
  provider: string,
  home: string,
  configHome: string,
  codexHome: string,
) {
  nativeConfiguration(provider);
  if (provider === "codex") return join(codexHome, "config.toml");
  if (provider === "agy") return join(home, ".gemini/config/mcp_config.json");
  const json = join(configHome, "opencode/opencode.json"),
    jsonc = join(configHome, "opencode/opencode.jsonc");
  if (existsSync(json) && existsSync(jsonc))
    throw new Error(
      "Both OpenCode JSON and JSONC configs exist; resolve precedence before installation",
    );
  return existsSync(jsonc) ? jsonc : json;
}
export function nativeSkillRoots(provider: string, home: string): string[] {
  nativeConfiguration(provider);
  if (provider === "agy") return [join(home, ".gemini/antigravity-cli/skills")];
  if (provider === "opencode")
    return [
      join(home, ".agents/skills"),
      join(home, ".config/opencode/skills"),
      join(home, ".claude/skills"),
    ];
  return [
    join(home, ".agents/skills"),
    join(home, ".codex/skills"),
    join(home, ".codex/skills/.system"),
  ];
}
