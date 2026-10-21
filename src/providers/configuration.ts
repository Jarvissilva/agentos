import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpDefinition } from "../core/mcps";

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
export function translateMcp(
  d: McpDefinition,
  provider: string,
): Record<string, unknown> {
  if (provider === "codex") {
    if (d.transport === "http")
      return {
        url: d.url,
        ...(d.bearerEnv ? { bearer_token_env_var: d.bearerEnv } : {}),
      };
    if (Object.entries(d.envRefs).some(([key, value]) => key !== value))
      throw new Error(
        "Codex env references must retain their original variable names",
      );
    return {
      command: d.command,
      args: d.args,
      ...(Object.keys(d.envRefs).length
        ? { env_vars: Object.keys(d.envRefs) }
        : {}),
    };
  }
  if (provider === "opencode")
    return d.transport === "http"
      ? {
          type: "remote",
          url: d.url,
          ...(d.bearerEnv
            ? { headers: { Authorization: `Bearer {env:${d.bearerEnv}}` } }
            : {}),
        }
      : {
          type: "local",
          command: [d.command, ...d.args],
          environment: Object.fromEntries(
            Object.entries(d.envRefs).map(([k, v]) => [k, `{env:${v}}`]),
          ),
        };
  if (provider === "agy") {
    if (d.transport === "http") {
      if (d.bearerEnv)
        throw new Error(
          "Agy bearer environment interpolation is not verified. Use native OAuth or a credential helper MCP instead.",
        );
      return { serverUrl: d.url };
    }
    if (Object.keys(d.envRefs).length)
      throw new Error(
        "Agy MCP environment forwarding is not verified. Use native OAuth or a server-side credential helper.",
      );
    return { command: d.command, args: d.args };
  }
  throw new Error("Unknown MCP provider");
}
