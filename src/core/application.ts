import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { AutomationService } from "../automations/service";
import { atomicWrite, redact } from "../platform/files";
import {
  type AppPaths,
  errorMessage,
  expandPath,
  nameSchema,
} from "../platform/paths";
import { ProviderManager } from "../providers/manager";
import { providerDefaultsSchema, resolveModel } from "../providers/models";
import type {
  InteractiveRunner,
  ProviderConnection,
  ProviderDefaults,
  ProviderId,
  SessionOptions,
} from "../providers/types";
import type { AppDatabase } from "../storage/database";
import {
  agents,
  notifications,
  projects,
  providerMetadata,
  type Session,
  sessions,
} from "../storage/schema";
import { McpService } from "./mcps";
import { cleanSessionTitle, sessionTitle } from "./session-title";
import { SkillService } from "./skills";

const definitionSchema = z.object({
  name: nameSchema,
  description: z.string().default(""),
});
export function parseAgent(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match)
    throw new Error(
      "Agent requires YAML frontmatter between --- lines and Markdown instructions",
    );
  const metadata = definitionSchema.parse(parse(match[1] ?? ""));
  const instructions = z
    .string()
    .trim()
    .min(1, "Agent instructions cannot be empty")
    .parse(match[2]);
  return { ...metadata, instructions };
}

export function directory(input: string) {
  if (!input.trim()) throw new Error("Working directory is required");
  const cwd = realpathSync(expandPath(input));
  if (!statSync(cwd).isDirectory())
    throw new Error("Working directory must be a directory");
  return cwd;
}

// Include boot and process start identities, so PID reuse never claims that an
// interrupted session still belongs to a live agentos instance.
function processIdentity(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${start}`;
  } catch {
    return null;
  }
}

export type TerminalHandoff = (
  operation: () => Promise<number>,
) => Promise<number>;
export type SessionLauncher = ((
  session: Session,
  ...args: Parameters<InteractiveRunner>
) => Promise<number>) & { preflight?: (provider: ProviderId) => void };

export class Application {
  private readonly interactiveOperations = new Set<Promise<Session>>();
  private readonly sessionListeners = new Set<() => void>();
  private syncingTitles?: Promise<number>;
  readonly skills: SkillService;
  readonly mcps: McpService;
  readonly automations: AutomationService;
  constructor(
    readonly db: AppDatabase,
    readonly paths: AppPaths,
    readonly providers = new ProviderManager(),
  ) {
    this.skills = new SkillService(db, paths);
    this.mcps = new McpService(db);
    this.automations = new AutomationService(this);
  }
  private readPreferences() {
    const file = join(this.paths.config, "preferences.json");
    try {
      if (!lstatSync(file).isFile())
        throw new Error("Preferences must be a regular file");
      const text = readFileSync(file, "utf8");
      const value = z
        .object({
          provider: z.enum(["codex", "opencode", "agy"]).optional(),
          defaultDirectory: z.string().min(1).optional(),
          providerDefaults: z
            .object({
              codex: providerDefaultsSchema.optional(),
              opencode: providerDefaultsSchema.optional(),
              agy: providerDefaultsSchema.optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .parse(JSON.parse(text));
      return { file, text, value };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { file, text: "", value: {} };
      throw error;
    }
  }
  providerDefaults(provider: ProviderId): ProviderDefaults {
    return this.readPreferences().value.providerDefaults?.[provider] ?? {};
  }
  async modelCatalog(provider: string, cwd?: string) {
    const adapter = this.providers.adapter(provider);
    if (!adapter.models)
      throw new Error(`${provider} model discovery is unavailable`);
    return adapter.models(cwd);
  }
  async validateProviderDefaults(
    provider: ProviderId,
    defaults: ProviderDefaults,
    cwd?: string,
  ): Promise<SessionOptions> {
    providerDefaultsSchema.parse(defaults);
    return defaults.model
      ? resolveModel(await this.modelCatalog(provider, cwd), defaults)
      : {};
  }
  async setProviderDefaults(provider: ProviderId, defaults: ProviderDefaults) {
    this.providers.adapter(provider);
    const parsed = providerDefaultsSchema.parse(defaults);
    await this.validateProviderDefaults(provider, parsed);
    const { file, text, value } = this.readPreferences();
    atomicWrite(
      file,
      `${JSON.stringify({ ...value, providerDefaults: { ...value.providerDefaults, [provider]: parsed } }, null, 2)}\n`,
      text,
    );
  }
  preferredProvider() {
    return this.readPreferences().value.provider;
  }
  setPreferredProvider(provider: ProviderId) {
    this.providers.adapter(provider);
    const { file, text, value } = this.readPreferences();
    atomicWrite(
      file,
      `${JSON.stringify({ ...value, provider }, null, 2)}\n`,
      text,
    );
  }
  defaultDirectory() {
    return this.readPreferences().value.defaultDirectory;
  }
  setDefaultDirectory(input?: string) {
    const { file, text, value } = this.readPreferences();
    const defaultDirectory = input?.trim() ? directory(input) : undefined;
    atomicWrite(
      file,
      `${JSON.stringify({ ...value, defaultDirectory }, null, 2)}\n`,
      text,
    );
    return defaultDirectory;
  }
  async detectProviders() {
    const list = await this.providers.list();
    for (const p of list)
      this.db
        .insert(providerMetadata)
        .values({
          id: p.id,
          metadata: JSON.stringify(p),
          checkedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: providerMetadata.id,
          set: { metadata: JSON.stringify(p), checkedAt: Date.now() },
        })
        .run();
    return list;
  }
  listNotifications() {
    return this.db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(100)
      .all();
  }
  readNotification(id: string) {
    this.db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, id))
      .run();
  }
  removeAgent(id: string) {
    const a = this.agent(id);
    const file = this.agentFile(id);
    unlinkSync(file);
    this.db.delete(agents).where(eq(agents.id, a.id)).run();
  }
  instructionFile(session: string, kind = "AGENTS.md") {
    if (!["AGENTS.md", "GEMINI.md", "CLAUDE.md"].includes(kind))
      throw new Error("Unsupported instruction filename");
    return join(this.session(session).cwd, kind);
  }
  readInstructions(session: string, kind?: string) {
    const file = this.instructionFile(session, kind);
    try {
      if (!lstatSync(file).isFile())
        throw new Error("Instruction file must be a regular file");
      return readFileSync(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw e;
    }
  }
  saveInstructions(session: string, text: string, kind?: string) {
    const file = this.instructionFile(session, kind);
    atomicWrite(file, text, this.readInstructions(session, kind));
  }

  listProjects() {
    return this.db.select().from(projects).orderBy(projects.name).all();
  }
  project(id: string) {
    const result = this.listProjects().find(
      (p) => p.id === id || p.name === id,
    );
    if (!result) throw new Error(`Project not found: ${id}`);
    return result;
  }
  createProject(name: string, description = "") {
    return this.db
      .insert(projects)
      .values({
        id: randomUUID(),
        name: nameSchema.parse(name),
        description,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  }
  updateProject(id: string, input: { name?: string; description?: string }) {
    const existing = this.project(id);
    return this.db
      .update(projects)
      .set({
        ...input,
        name:
          input.name === undefined
            ? existing.name
            : nameSchema.parse(input.name),
      })
      .where(eq(projects.id, existing.id))
      .returning()
      .get();
  }
  removeProject(id: string) {
    this.db
      .delete(projects)
      .where(eq(projects.id, this.project(id).id))
      .run();
  }

  listAgents() {
    return this.db.select().from(agents).orderBy(agents.name).all();
  }
  agent(id: string) {
    const result = this.listAgents().find((a) => a.id === id || a.name === id);
    if (!result) throw new Error(`Agent not found: ${id}`);
    return result;
  }
  agentFile(id: string) {
    const record = this.agent(id);
    if (basename(record.file) !== record.file)
      throw new Error("Invalid managed agent path");
    const file = join(this.paths.agents, record.file);
    if (!lstatSync(file).isFile())
      throw new Error(
        "Managed agent must be a regular file, not a symbolic link",
      );
    return file;
  }
  agentDefinition(id: string) {
    return parseAgent(readFileSync(this.agentFile(id), "utf8"));
  }
  createAgent(name: string, instructions: string, description = "") {
    const metadata = definitionSchema.parse({ name, description });
    const body = z.string().trim().min(1).parse(instructions);
    const file = `${
      metadata.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "agent"
    }-${randomUUID().slice(0, 8)}.md`;
    const path = join(this.paths.agents, file);
    writeFileSync(path, `---\n${stringify(metadata)}---\n\n${body}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    try {
      return this.db
        .insert(agents)
        .values({ id: randomUUID(), ...metadata, file, createdAt: Date.now() })
        .returning()
        .get();
    } catch (error) {
      unlinkSync(path);
      throw error;
    }
  }
  syncAgent(id: string) {
    const record = this.agent(id);
    const definition = this.agentDefinition(record.id);
    this.db
      .update(agents)
      .set({ name: definition.name, description: definition.description })
      .where(eq(agents.id, record.id))
      .run();
  }

  recoverSessions() {
    for (const session of this.db
      .select()
      .from(sessions)
      .where(inArray(sessions.status, ["starting", "attached", "ready"]))
      .all()) {
      if (
        session.ownerPid &&
        session.ownerStart &&
        processIdentity(session.ownerPid) === session.ownerStart
      )
        continue;
      this.db
        .update(sessions)
        .set({
          status: "interrupted",
          ownerPid: null,
          ownerStart: null,
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(sessions.id, session.id),
            eq(sessions.status, session.status),
            session.ownerPid === null
              ? isNull(sessions.ownerPid)
              : eq(sessions.ownerPid, session.ownerPid),
            session.ownerStart === null
              ? isNull(sessions.ownerStart)
              : eq(sessions.ownerStart, session.ownerStart),
          ),
        )
        .run();
    }
  }
  listSessions() {
    return this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt))
      .all();
  }
  onSessionsChanged(listener: () => void) {
    this.sessionListeners.add(listener);
    return () => {
      this.sessionListeners.delete(listener);
    };
  }
  private sessionsChanged() {
    for (const listener of this.sessionListeners) {
      try {
        listener();
      } catch {
        // A failed UI listener must not roll back the stored title.
      }
    }
  }
  private applySessionTitle(
    session: Pick<Session, "id" | "title">,
    input: string | null | undefined,
  ) {
    const title = cleanSessionTitle(input);
    if (!title || title === session.title) return false;
    this.db
      .update(sessions)
      .set({ title })
      .where(eq(sessions.id, session.id))
      .run();
    this.sessionsChanged();
    return true;
  }
  async renameSession(id: string, input: string) {
    const session = this.session(id);
    const title = sessionTitle(input);
    if (!title) throw new Error("Session title cannot be empty");
    if (session.nativeThreadId) {
      const connection = await this.providers
        .adapter(session.provider)
        .connect(session.cwd);
      try {
        if (connection.rename)
          await connection.rename(session.nativeThreadId, title);
      } finally {
        await connection.close();
      }
    }
    const updated = this.db
      .update(sessions)
      .set({ title })
      .where(eq(sessions.id, session.id))
      .returning()
      .get();
    this.sessionsChanged();
    return updated;
  }
  async syncSessionName(id: string) {
    const session = this.session(id);
    if (!session.nativeThreadId) return false;
    const connection = await this.providers
      .adapter(session.provider)
      .connect(session.cwd);
    try {
      if (!connection.readTitle) return false;
      try {
        const title = await connection.readTitle(session.nativeThreadId);
        return this.applySessionTitle(session, title);
      } catch {
        return false;
      }
    } finally {
      await connection.close();
    }
  }
  async syncSessionNames() {
    if (this.syncingTitles) return this.syncingTitles;
    this.syncingTitles = (async () => {
      const groups = new Map<
        string,
        { provider: ProviderId; cwd: string; sessions: Session[] }
      >();
      for (const session of this.listSessions()) {
        if (!session.nativeThreadId) continue;
        const key = `${session.provider}\u0000${session.cwd}`;
        const group = groups.get(key);
        if (group) group.sessions.push(session);
        else
          groups.set(key, {
            provider: session.provider as ProviderId,
            cwd: session.cwd,
            sessions: [session],
          });
      }
      let changed = 0;
      await Promise.allSettled(
        [...groups.values()].map(async (group) => {
          const connection = await this.providers
            .adapter(group.provider)
            .connect(group.cwd);
          try {
            if (!connection.readTitle) return;
            for (const session of group.sessions) {
              try {
                const title = await connection.readTitle(
                  session.nativeThreadId ?? "",
                );
                if (this.applySessionTitle(session, title)) changed++;
              } catch {
                // Keep the last known title when a provider is temporarily unavailable.
              }
            }
          } finally {
            await connection.close();
          }
        }),
      );
      return changed;
    })();
    try {
      return await this.syncingTitles;
    } finally {
      this.syncingTitles = undefined;
    }
  }
  assignSessionProject(id: string, project?: string) {
    const session = this.session(id);
    const projectId = project ? this.project(project).id : null;
    return this.db
      .update(sessions)
      .set({ projectId })
      .where(eq(sessions.id, session.id))
      .returning()
      .get();
  }
  session(id: string) {
    const result = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .get();
    if (!result) throw new Error(`Session not found: ${id}`);
    return result;
  }

  newSession(...args: Parameters<Application["createSession"]>) {
    return this.trackInteractive(this.createSession(...args));
  }
  private trackInteractive(operation: Promise<Session>) {
    this.interactiveOperations.add(operation);
    void operation.then(
      () => this.interactiveOperations.delete(operation),
      () => this.interactiveOperations.delete(operation),
    );
    return operation;
  }
  async settleInteractiveSessions() {
    await Promise.allSettled([...this.interactiveOperations]);
  }
  private async createSession(
    input: {
      project?: string;
      agent?: string;
      provider?: string;
      cwd?: string;
      prompt?: string;
    },
    handoff: TerminalHandoff = (run) => run(),
    launcher?: SessionLauncher,
  ) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        "Starting a native session requires an interactive terminal",
      );
    const project = input.project ? this.project(input.project) : undefined;
    const agent = input.agent ? this.agent(input.agent) : undefined;
    const definition = agent ? this.agentDefinition(agent.id) : undefined;
    const prompt = definition
      ? `agentos role: ${definition.name}\n\n${definition.instructions}\n\n${input.prompt || "Use this role for this conversation and wait for my task."}`
      : input.prompt;
    const title = sessionTitle(input.prompt);
    const cwd = directory(
      input.cwd ?? this.defaultDirectory() ?? process.cwd(),
    );
    const adapter = this.providers.adapter(
      input.provider ?? this.preferredProvider() ?? "codex",
    );
    launcher?.preflight?.(adapter.id);
    const info = await adapter.detect();
    if (!info.interactive)
      throw new Error(info.reason ?? "Provider cannot launch native sessions");
    const options = await this.validateProviderDefaults(
      adapter.id,
      this.providerDefaults(adapter.id),
      cwd,
    );
    const id = randomUUID();
    const now = Date.now();
    this.db
      .insert(sessions)
      .values({
        id,
        provider: adapter.id,
        providerVersion: info.version ?? "unknown",
        cwd,
        title: title ?? null,
        projectId: project?.id,
        agentId: agent?.id,
        agentHash: definition
          ? createHash("sha256").update(definition.instructions).digest("hex")
          : null,
        status: "starting",
        ownerPid: process.pid,
        ownerStart: processIdentity(process.pid),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    let connection: ProviderConnection | undefined;
    let completed = false;
    let needsTitleSync = false;
    try {
      connection = await adapter.connect(cwd);
      const native = await connection.create(cwd, options, title);
      this.db
        .update(sessions)
        .set({
          nativeThreadId: native.threadId,
          nativeSessionId: native.sessionId,
          status: "ready",
          updatedAt: Date.now(),
        })
        .where(eq(sessions.id, id))
        .run();
      const active = connection;
      await this.attach(
        id,
        () =>
          active.launch(
            native.threadId,
            cwd,
            prompt,
            options,
            launcher
              ? (command, args, directory) =>
                  launcher(this.session(id), command, args, directory)
              : undefined,
          ),
        handoff,
      );
      if (connection.readTitle) {
        try {
          this.applySessionTitle(
            this.session(id),
            await connection.readTitle(native.threadId),
          );
        } catch {
          // Codex closes its metadata connection before the native TUI runs.
          needsTitleSync = true;
        }
      }
      completed = true;
      return this.session(id);
    } catch (error) {
      this.failed(id, error);
      throw error;
    } finally {
      await connection?.close();
      if (completed && needsTitleSync)
        void this.syncSessionName(id).catch(() => {
          // The stored title remains usable when the provider cannot report it.
        });
    }
  }

  resumeSession(...args: Parameters<Application["reopenSession"]>) {
    return this.trackInteractive(this.reopenSession(...args));
  }
  private async reopenSession(
    id: string,
    handoff: TerminalHandoff = (run) => run(),
    launcher?: SessionLauncher,
  ) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        "Resuming a native session requires an interactive terminal",
      );
    this.recoverSessions();
    const row = this.session(id);
    if (!row.nativeThreadId)
      throw new Error(
        "This session has no native thread ID; create a new session",
      );
    launcher?.preflight?.(this.providers.adapter(row.provider).id);
    const cwd = directory(row.cwd);
    const claimed = this.db
      .update(sessions)
      .set({
        status: "starting",
        ownerPid: process.pid,
        ownerStart: processIdentity(process.pid),
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(sessions.id, id),
          notInArray(sessions.status, ["starting", "ready", "attached"]),
        ),
      )
      .returning()
      .get();
    if (!claimed)
      throw new Error(
        "This session is already open in another agentos instance",
      );
    let connection: ProviderConnection | undefined;
    let completed = false;
    let needsTitleSync = false;
    try {
      connection = await this.providers.adapter(row.provider).connect(cwd);
      await connection.resume(row.nativeThreadId);
      const active = connection;
      await this.attach(
        id,
        () =>
          active.launch(
            row.nativeThreadId ?? "",
            cwd,
            undefined,
            undefined,
            launcher
              ? (command, args, directory) =>
                  launcher(this.session(id), command, args, directory)
              : undefined,
          ),
        handoff,
      );
      if (connection.readTitle) {
        try {
          this.applySessionTitle(
            this.session(id),
            await connection.readTitle(row.nativeThreadId),
          );
        } catch {
          // Codex closes its metadata connection before the native TUI runs.
          needsTitleSync = true;
        }
      }
      completed = true;
      return this.session(id);
    } catch (error) {
      this.failed(id, error);
      throw error;
    } finally {
      await connection?.close();
      if (completed && needsTitleSync)
        void this.syncSessionName(id).catch(() => {
          // The stored title remains usable when the provider cannot report it.
        });
    }
  }

  async history(id: string, cursor?: string) {
    const session = this.session(id);
    if (!session.nativeThreadId)
      throw new Error("No native history is associated with this session");
    const connection = await this.providers.adapter(session.provider).connect();
    try {
      const history = await connection.history(session.nativeThreadId, cursor);
      return JSON.parse(redact(JSON.stringify(history)));
    } finally {
      await connection.close();
    }
  }
  private async attach(
    id: string,
    launch: () => Promise<number>,
    handoff: TerminalHandoff,
  ) {
    this.db
      .update(sessions)
      .set({ status: "attached", error: null, updatedAt: Date.now() })
      .where(eq(sessions.id, id))
      .run();
    const exitCode = await handoff(launch);
    this.db
      .update(sessions)
      .set({
        status: exitCode === 0 ? "idle" : "interrupted",
        exitCode,
        ownerPid: null,
        ownerStart: null,
        updatedAt: Date.now(),
      })
      .where(eq(sessions.id, id))
      .run();
    if (exitCode !== 0 && exitCode !== 130) {
      throw new Error(
        `Native provider exited ${exitCode}; session metadata was preserved`,
      );
    }
  }
  private failed(id: string, error: unknown) {
    this.automations.notify(
      "Provider session failed; inspect its session details",
    );
    this.db
      .update(sessions)
      .set({
        status: "failed",
        error: redact(errorMessage(error)),
        ownerPid: null,
        ownerStart: null,
        updatedAt: Date.now(),
      })
      .where(eq(sessions.id, id))
      .run();
  }
}

export type { Session };
