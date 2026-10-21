import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  file: text("file").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  nativeThreadId: text("native_thread_id"),
  nativeSessionId: text("native_session_id"),
  providerVersion: text("provider_version").notNull(),
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  agentId: text("agent_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  agentHash: text("agent_hash"),
  cwd: text("cwd").notNull(),
  status: text("status", {
    enum: ["starting", "ready", "attached", "idle", "failed", "interrupted"],
  }).notNull(),
  ownerPid: integer("owner_pid"),
  ownerStart: text("owner_start"),
  exitCode: integer("exit_code"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Project = typeof projects.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Session = typeof sessions.$inferSelect;

export const providerMetadata = sqliteTable("provider_metadata", {
  id: text("id").primaryKey(),
  metadata: text("metadata").notNull(),
  checkedAt: integer("checked_at").notNull(),
});
export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  directory: text("directory").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const skillLinks = sqliteTable("skill_links", {
  path: text("path").primaryKey(),
  skillId: text("skill_id")
    .notNull()
    .references(() => skills.id),
  provider: text("provider").notNull(),
  target: text("target").notNull(),
});
export const mcps = sqliteTable("mcps", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  definition: text("definition").notNull(),
});
export const mcpInstalls = sqliteTable("mcp_installs", {
  id: text("id").primaryKey(),
  mcpId: text("mcp_id")
    .notNull()
    .references(() => mcps.id),
  provider: text("provider").notNull(),
  path: text("path").notNull(),
  entry: text("entry").notNull(),
  fingerprint: text("fingerprint").notNull(),
});
export const automations = sqliteTable("automations", {
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  cwd: text("cwd").notNull(),
  file: text("file").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});
export const automationSteps = sqliteTable("automation_steps", {
  id: text("id").primaryKey(),
  automationId: text("automation_id")
    .notNull()
    .references(() => automations.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  definition: text("definition").notNull(),
});
export const schedules = sqliteTable("schedules", {
  automationId: text("automation_id")
    .primaryKey()
    .references(() => automations.id, { onDelete: "cascade" }),
  definition: text("definition").notNull(),
  nextAt: integer("next_at"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  automationId: text("automation_id")
    .notNull()
    .references(() => automations.id),
  cwd: text("cwd").notNull(),
  status: text("status").notNull(),
  occurrence: text("occurrence").unique(),
  definition: text("definition").notNull(),
  ownerPid: integer("owner_pid"),
  ownerIdentity: text("owner_identity"),
  cancelRequested: integer("cancel_requested", { mode: "boolean" })
    .notNull()
    .default(false),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  error: text("error"),
});
export const stepRuns = sqliteTable("step_runs", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  ordinal: integer("ordinal").notNull(),
  attempt: integer("attempt").notNull(),
  status: text("status").notNull(),
  provider: text("provider").notNull(),
  nativeId: text("native_id"),
  result: text("result"),
  error: text("error"),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
});
export const directoryLocks = sqliteTable("directory_locks", {
  path: text("path").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
});
export const runLogs = sqliteTable("run_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  step: integer("step"),
  message: text("message").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  message: text("message").notNull(),
  runId: text("run_id"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});
