import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export interface AppPaths {
  data: string;
  config: string;
  cache: string;
  database: string;
  agents: string;
}

export function sourceCheckoutDirectory(sourceUrl = import.meta.url): string {
  try {
    const root = realpathSync(fileURLToPath(new URL("../../../", sourceUrl)));
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );
    if (
      manifest.name !== "agentos" ||
      !statSync(join(root, "src/index.ts")).isFile() ||
      !statSync(join(root, "src/tui/app.tsx")).isFile()
    )
      throw new Error("Invalid source checkout");
    return root;
  } catch {
    throw new Error(
      "AgentOS source checkout is unavailable. Restore the checkout containing the running source files and retry /builder.",
    );
  }
}

export function appPaths(env: NodeJS.ProcessEnv = process.env): AppPaths {
  const home = env.HOME || homedir();
  const xdg = (key: string, fallback: string) => {
    const value = env[key];
    return value && isAbsolute(value) ? value : join(home, fallback);
  };
  // Reuse legacy locations in place: owned links and definition references are absolute.
  const location = (root: string) => {
    const canonical = join(root, "agentos");
    const legacy = join(root, "agent-os");
    return !existsSync(canonical) && existsSync(legacy) ? legacy : canonical;
  };
  const data = location(xdg("XDG_DATA_HOME", ".local/share"));
  const database = join(data, "agentos.db");
  const legacyDatabase = join(data, "agent-os.db");
  return {
    data,
    config: location(xdg("XDG_CONFIG_HOME", ".config")),
    cache: location(xdg("XDG_CACHE_HOME", ".cache")),
    database:
      !existsSync(database) && existsSync(legacyDatabase)
        ? legacyDatabase
        : database,
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

export function directory(input: string) {
  if (!input.trim()) throw new Error("Working directory is required");
  const cwd = realpathSync(expandPath(input));
  if (!statSync(cwd).isDirectory())
    throw new Error("Working directory must be a directory");
  return cwd;
}
