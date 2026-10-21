import type { McpDefinition } from "./service";

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
