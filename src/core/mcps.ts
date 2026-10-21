import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as TOML from "@iarna/toml";
import { and, eq } from "drizzle-orm";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";
import { z } from "zod";
import {
  atomicWrite,
  fingerprint,
  processIdentity,
  redact,
} from "../platform/files";
import {
  nativeConfiguration,
  nativeMcpPath,
  translateMcp,
} from "../providers/configuration";
import type { AppDatabase } from "../storage/database";
import { mcpInstalls, mcps } from "../storage/schema";
import { slugSchema } from "./skills";

const variable = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const mcpSchema = z.discriminatedUnion("transport", [
  z
    .object({
      name: slugSchema,
      transport: z.literal("stdio"),
      command: z.string().min(1),
      args: z.array(z.string()).default([]),
      envRefs: z.record(variable, variable).default({}),
    })
    .strict(),
  z
    .object({
      name: slugSchema,
      transport: z.literal("http"),
      url: z.url().refine((s) => {
        const u = new URL(s);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search
        );
      }, "Use a URL without credentials/query secrets"),
      bearerEnv: variable.optional(),
    })
    .strict(),
]);
export type McpDefinition = z.infer<typeof mcpSchema>;
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export const entryFingerprint = (v: unknown) => fingerprint(canonical(v));

function jsonDocument(text: string) {
  const errors: ParseError[] = [];
  const value: unknown = parse(text || "{}", errors, {
    allowTrailingComma: true,
  });
  if (errors.length)
    throw new Error(
      "Provider configuration contains invalid JSON; repair it before installing MCPs",
    );
  return z.record(z.string(), z.unknown()).parse(value);
}
export class McpService {
  constructor(
    private db: AppDatabase,
    private home = homedir(),
    private configHome = process.env.XDG_CONFIG_HOME || join(home, ".config"),
    private codexHome = process.env.CODEX_HOME || join(home, ".codex"),
  ) {}
  list() {
    return this.db
      .select()
      .from(mcps)
      .all()
      .map((m) => ({
        ...m,
        definition: mcpSchema.parse(JSON.parse(m.definition)),
      }));
  }
  get(id: string) {
    const m = this.list().find((v) => v.id === id || v.name === id);
    if (!m) throw new Error("MCP not found");
    return m;
  }
  register(input: unknown) {
    const d = mcpSchema.parse(input);
    if (redact(JSON.stringify(d)) !== JSON.stringify(d))
      throw new Error("Use credential references instead of credential values");
    if (
      d.transport === "stdio" &&
      d.args.some((s) =>
        /(?:--?(?:token|password|secret|api[-_]key)|Bearer\s|sk-)/i.test(s),
      )
    )
      throw new Error(
        "Do not put credentials in command arguments; use envRefs or native OAuth",
      );
    return this.db
      .insert(mcps)
      .values({ id: randomUUID(), name: d.name, definition: JSON.stringify(d) })
      .returning()
      .get();
  }
  update(id: string, input: unknown) {
    const m = this.get(id);
    const d = mcpSchema.parse(input);
    if (redact(JSON.stringify(d)) !== JSON.stringify(d))
      throw new Error("Use credential references instead of credential values");
    if (d.name !== m.name)
      throw new Error(
        "MCP names are immutable; register a new definition to rename",
      );
    if (
      d.transport === "stdio" &&
      d.args.some((s) => /--?(?:token|password|secret|api[-_]key)/i.test(s))
    )
      throw new Error("Use environment references for credentials");
    this.db
      .update(mcps)
      .set({ definition: JSON.stringify(d) })
      .where(eq(mcps.id, m.id))
      .run();
  }
  configPath(provider: string) {
    return nativeMcpPath(provider, this.home, this.configHome, this.codexHome);
  }

  private readEntry(provider: string, text: string, entry: string): unknown {
    const doc =
      nativeConfiguration(provider).format === "toml"
        ? TOML.parse(text)
        : jsonDocument(text);
    const section = doc[nativeConfiguration(provider).section];
    return section && typeof section === "object"
      ? (section as Record<string, unknown>)[entry]
      : undefined;
  }
  installations(id: string) {
    const m = this.get(id);
    return this.db
      .select()
      .from(mcpInstalls)
      .where(eq(mcpInstalls.mcpId, m.id))
      .all()
      .map((i) => {
        try {
          const entry = this.readEntry(
            i.provider,
            existsSync(i.path) ? readFileSync(i.path, "utf8") : "",
            i.entry,
          );
          let needsUpdate = false;
          if (
            entry !== undefined &&
            entryFingerprint(entry) === i.fingerprint
          ) {
            try {
              const current = z.record(z.string(), z.unknown()).parse(entry);
              const disabledFlag = nativeConfiguration(i.provider).disabledFlag;
              const enabled = disabledFlag
                ? current.disabled !== true
                : current.enabled !== false;
              const desired = {
                ...translateMcp(m.definition, i.provider),
                ...(disabledFlag ? { disabled: !enabled } : { enabled }),
              };
              needsUpdate = entryFingerprint(desired) !== i.fingerprint;
            } catch {
              needsUpdate = true;
            }
          }
          return {
            ...i,
            status:
              entry === undefined
                ? "missing"
                : entryFingerprint(entry) === i.fingerprint
                  ? needsUpdate
                    ? "outdated"
                    : "installed"
                  : "conflict",
          };
        } catch {
          return { ...i, status: "conflict" };
        }
      });
  }
  install(id: string, provider: string, enabled = true) {
    const m = this.get(id),
      entry = `agentos-${m.name}`,
      path = this.configPath(provider);
    const value = {
      ...translateMcp(m.definition, provider),
      ...(nativeConfiguration(provider).disabledFlag
        ? { disabled: !enabled }
        : { enabled }),
    };
    const existing = this.db
      .select()
      .from(mcpInstalls)
      .where(
        and(eq(mcpInstalls.mcpId, m.id), eq(mcpInstalls.provider, provider)),
      )
      .get();
    this.change(path, provider, entry, existing?.fingerprint, value);
    this.db
      .insert(mcpInstalls)
      .values({
        id: existing?.id ?? randomUUID(),
        mcpId: m.id,
        provider,
        path,
        entry,
        fingerprint: entryFingerprint(value),
      })
      .onConflictDoUpdate({
        target: mcpInstalls.id,
        set: { fingerprint: entryFingerprint(value) },
      })
      .run();
  }
  uninstall(id: string, provider: string) {
    const m = this.get(id);
    const i = this.db
      .select()
      .from(mcpInstalls)
      .where(
        and(eq(mcpInstalls.mcpId, m.id), eq(mcpInstalls.provider, provider)),
      )
      .get();
    if (!i) throw new Error("No managed installation for this provider");
    this.change(i.path, provider, i.entry, i.fingerprint);
    this.db.delete(mcpInstalls).where(eq(mcpInstalls.id, i.id)).run();
  }
  remove(id: string) {
    const m = this.get(id);
    if (this.installations(id).some((i) => i.status === "conflict"))
      throw new Error(
        "Resolve modified native entries before deleting this MCP",
      );
    for (const i of this.installations(id)) this.uninstall(id, i.provider);
    this.db.delete(mcps).where(eq(mcps.id, m.id)).run();
  }
  private change(
    path: string,
    provider: string,
    entry: string,
    owned?: string,
    value?: Record<string, unknown>,
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const lock = `${path}.agentos-lock`;
    try {
      mkdirSync(lock, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!lstatSync(lock).isDirectory() || lstatSync(lock).isSymbolicLink())
        throw new Error("MCP configuration lock was modified externally");
      let owner: { pid: number; identity: string };
      try {
        owner = z
          .object({ pid: z.number().int(), identity: z.string() })
          .parse(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")));
      } catch {
        throw new Error(
          "MCP configuration is locked; inspect its .agentos-lock directory before removing a stale lock",
        );
      }
      if (processIdentity(owner.pid) === owner.identity)
        throw new Error(
          "MCP configuration is being updated by another Agent OS process",
        );
      rmSync(lock, { recursive: true });
      mkdirSync(lock, { mode: 0o700 });
    }
    writeFileSync(
      join(lock, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        identity: processIdentity(process.pid),
      }),
      { mode: 0o600 },
    );
    try {
      const original = existsSync(path) ? readFileSync(path, "utf8") : "";
      const old = this.readEntry(provider, original, entry);
      if (old !== undefined && (!owned || entryFingerprint(old) !== owned))
        throw new Error(
          "Native MCP entry exists or was modified externally; no changes made",
        );
      let next: string;
      if (nativeConfiguration(provider).format === "toml") {
        const start = `# Agent OS begin ${entry}\n`,
          end = `# Agent OS end ${entry}\n`;
        const begin = original.indexOf(start),
          finish = original.indexOf(end);
        if (old !== undefined && (begin < 0 || finish < begin))
          throw new Error(
            "Managed TOML boundaries were modified; refusing to edit",
          );
        const without =
          begin >= 0 && finish >= begin
            ? original.slice(0, begin) + original.slice(finish + end.length)
            : original;
        const block = value
          ? TOML.stringify({ mcp_servers: { [entry]: value } } as TOML.JsonMap)
          : "";
        next = without + (value ? `\n${start}${block}${end}` : "");
        const beforeDoc = TOML.parse(original),
          afterDoc = TOML.parse(next);
        // Verify that removing our block did not remove unrelated native entries.
        const removeEntry = (doc: TOML.JsonMap) => {
          const root = doc.mcp_servers as TOML.JsonMap | undefined;
          if (root) {
            delete root[entry];
            if (!Object.keys(root).length) delete doc.mcp_servers;
          }
          return doc;
        };
        if (
          entryFingerprint(removeEntry(beforeDoc)) !==
          entryFingerprint(removeEntry(afterDoc))
        )
          throw new Error(
            "Managed TOML block contains unrelated changes; refusing to edit",
          );
      } else {
        next = applyEdits(
          original || "{}\n",
          modify(
            original || "{}\n",
            [nativeConfiguration(provider).section, entry],
            value,
            { formattingOptions: { insertSpaces: true, tabSize: 2 } },
          ),
        );
      }
      atomicWrite(path, next, original);
    } finally {
      rmSync(lock, { recursive: true });
    }
  }
}
