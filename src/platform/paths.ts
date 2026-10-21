import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

export interface AppPaths {
  data: string;
  config: string;
  cache: string;
  database: string;
  agents: string;
}

export function appPaths(env: NodeJS.ProcessEnv = process.env): AppPaths {
  const home = env.HOME || homedir();
  const xdg = (key: string, fallback: string) => {
    const value = env[key];
    return value && isAbsolute(value) ? value : join(home, fallback);
  };
  const data = join(xdg("XDG_DATA_HOME", ".local/share"), "agent-os");
  return {
    data,
    config: join(xdg("XDG_CONFIG_HOME", ".config"), "agent-os"),
    cache: join(xdg("XDG_CACHE_HOME", ".cache"), "agent-os"),
    database: join(data, "agent-os.db"),
    agents: join(data, "agents"),
  };
}

export function initializePaths(paths: AppPaths): void {
  for (const dir of [paths.data, paths.config, paths.cache, paths.agents]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
}

export function expandPath(value: string): string {
  return resolve(
    value === "~"
      ? homedir()
      : value.startsWith("~/")
        ? join(homedir(), value.slice(2))
        : value,
  );
}

export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (v) =>
      [...v].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
    "Name contains control characters",
  );

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
