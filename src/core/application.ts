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
import type { ProviderConnection } from "../providers/types";
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

function directory(input: string) {
  const cwd = realpathSync(expandPath(input));
  if (!statSync(cwd).isDirectory())
    throw new Error("Working directory must be a directory");
  return cwd;
}

// Include boot and process start identities, so PID reuse never claims that an
// interrupted session still belongs to a live Agent OS instance.
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
export class Application {
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
  instructionFile(project: string, kind = "AGENTS.md") {
    if (!["AGENTS.md", "GEMINI.md", "CLAUDE.md"].includes(kind))
      throw new Error("Unsupported instruction filename");
    return join(this.project(project).cwd, kind);
  }
  readInstructions(project: string, kind?: string) {
    const file = this.instructionFile(project, kind);
    try {
      if (!lstatSync(file).isFile())
        throw new Error("Instruction file must be a regular file");
      return readFileSync(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw e;
    }
  }
  saveInstructions(project: string, text: string, kind?: string) {
    const file = this.instructionFile(project, kind);
    atomicWrite(file, text, this.readInstructions(project, kind));
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
  createProject(name: string, cwd: string, description = "") {
    return this.db
      .insert(projects)
      .values({
        id: randomUUID(),
        name: nameSchema.parse(name),
        cwd: directory(cwd),
        description,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  }
  updateProject(
    id: string,
    input: { name?: string; cwd?: string; description?: string },
  ) {
    const existing = this.project(id);
    return this.db
      .update(projects)
      .set({
        ...input,
        name:
          input.name === undefined
            ? existing.name
            : nameSchema.parse(input.name),
        cwd: input.cwd === undefined ? existing.cwd : directory(input.cwd),
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
  session(id: string) {
    const result = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .get();
    if (!result) throw new Error(`Session not found: ${id}`);
    return result;
  }

  async newSession(
    input: {
      project?: string;
      agent?: string;
      provider?: string;
      cwd?: string;
      prompt?: string;
    },
    handoff: TerminalHandoff = (run) => run(),
  ) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        "Starting a native session requires an interactive terminal",
      );
    const project = input.project ? this.project(input.project) : undefined;
    const agent = input.agent ? this.agent(input.agent) : undefined;
    const definition = agent ? this.agentDefinition(agent.id) : undefined;
    const cwd = directory(input.cwd ?? project?.cwd ?? process.cwd());
    const adapter = this.providers.adapter(input.provider ?? "codex");
    const info = await adapter.detect();
    if (!info.interactive)
      throw new Error(info.reason ?? "Provider cannot launch native sessions");
    const id = randomUUID();
    const now = Date.now();
    this.db
      .insert(sessions)
      .values({
        id,
        provider: adapter.id,
        providerVersion: info.version ?? "unknown",
        cwd,
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
    try {
      connection = await adapter.connect(cwd);
      const native = await connection.create(cwd);
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
      const prompt = definition
        ? `Agent OS role: ${definition.name}\n\n${definition.instructions}\n\n${input.prompt || "Use this role for this conversation and wait for my task."}`
        : input.prompt;
      const active = connection;
      await this.attach(
        id,
        () => active.launch(native.threadId, cwd, prompt),
        handoff,
      );
      return this.session(id);
    } catch (error) {
      this.failed(id, error);
      throw error;
    } finally {
      await connection?.close();
    }
  }

  async resumeSession(id: string, handoff: TerminalHandoff = (run) => run()) {
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
        "This session is already open in another Agent OS instance",
      );
    let connection: ProviderConnection | undefined;
    try {
      connection = await this.providers.adapter(row.provider).connect(cwd);
      await connection.resume(row.nativeThreadId);
      const active = connection;
      await this.attach(
        id,
        () => active.launch(row.nativeThreadId ?? "", cwd),
        handoff,
      );
      return this.session(id);
    } catch (error) {
      this.failed(id, error);
      throw error;
    } finally {
      await connection?.close();
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
