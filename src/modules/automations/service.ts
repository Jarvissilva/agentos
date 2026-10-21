import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq } from "drizzle-orm";
import { parse, stringify } from "yaml";
import { atomicWrite, processIdentity, redact } from "../../lib/platform/files";
import type { AppPaths } from "../../lib/platform/paths";
import { errorMessage } from "../../lib/platform/paths";
import type { ProviderManager } from "../../lib/providers/manager";
import type { AppDatabase } from "../../lib/storage/database";
import {
  automationSteps,
  automations,
  directoryLocks,
  runLogs,
  runs,
  schedules,
  stepRuns,
} from "../../lib/storage/schema";
import type { AgentService } from "../agents/service";
import type { NotificationService } from "../notifications/service";
import type { ProjectService } from "../projects/service";
import {
  automationSchema,
  nextOccurrence,
  scheduleSchema,
  validateAutomation,
} from "./definition";

export class AutomationService {
  async launch(id: string, retryId?: string) {
    const a = this.get(id);
    this.definition(a.id);
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("../../index.ts", import.meta.url)),
        "automations",
        ...(retryId ? ["retry", retryId] : ["run", a.id]),
      ],
      {
        stdio: "ignore",
        detached: true,
        env: {
          ...process.env,
          XDG_DATA_HOME: join(this.paths.data, ".."),
          XDG_CONFIG_HOME: join(this.paths.config, ".."),
          XDG_CACHE_HOME: join(this.paths.cache, ".."),
        },
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return child.pid;
  }
  constructor(
    private db: AppDatabase,
    private paths: AppPaths,
    private providers: ProviderManager,
    private projects: ProjectService,
    private agents: AgentService,
    private notifications: NotificationService,
  ) {}
  private jobs = new Set<Promise<unknown>>();
  async drain() {
    await Promise.allSettled([...this.jobs]);
  }
  list() {
    return this.db.select().from(automations).all();
  }
  get(id: string) {
    const a = this.list().find(
      (a) => a.id === id || a.name === id || a.slug === id,
    );
    if (!a) throw new Error("Automation not found");
    return a;
  }
  assignProject(id: string, project?: string) {
    const automation = this.get(id);
    const projectId = project ? this.projects.project(project).id : null;
    return this.db
      .update(automations)
      .set({ projectId })
      .where(eq(automations.id, automation.id))
      .returning()
      .get();
  }
  definition(id: string) {
    const a = this.get(id);
    return validateAutomation(parse(readFileSync(a.file, "utf8")), a.file);
  }
  save(input: unknown, sourceFile?: string, existingId?: string) {
    const d = validateAutomation(input, sourceFile),
      existing = existingId ? this.get(existingId) : undefined;
    if (redact(JSON.stringify(d)) !== JSON.stringify(d))
      throw new Error(
        "Use native credential references instead of embedding credentials in automation definitions",
      );
    if (existing && existing.slug !== d.slug)
      throw new Error("Automation slug is immutable");
    const directory = join(this.paths.data, "automations", d.slug),
      file = join(directory, "automation.yaml");
    if (!existing && existsSync(directory))
      throw new Error("Managed automation directory already exists");
    const id = existing?.id ?? randomUUID();
    const original =
      existing && existsSync(file) ? readFileSync(file, "utf8") : "";
    atomicWrite(file, stringify(d), original);
    try {
      this.db.transaction(
        () => {
          if (existing)
            this.db
              .update(automations)
              .set({ name: d.name, cwd: d.cwd, enabled: d.enabled })
              .where(eq(automations.id, id))
              .run();
          else
            this.db
              .insert(automations)
              .values({
                id,
                name: d.name,
                slug: d.slug,
                cwd: d.cwd,
                file,
                enabled: d.enabled,
                createdAt: Date.now(),
              })
              .run();
          this.db
            .delete(automationSteps)
            .where(eq(automationSteps.automationId, id))
            .run();
          d.steps.forEach((s, ordinal) => {
            this.db
              .insert(automationSteps)
              .values({
                id: randomUUID(),
                automationId: id,
                ordinal,
                definition: JSON.stringify(s),
              })
              .run();
          });
          this.db
            .insert(schedules)
            .values({
              automationId: id,
              definition: JSON.stringify(d.schedule),
              enabled: d.enabled,
              nextAt: nextOccurrence(d.schedule),
            })
            .onConflictDoUpdate({
              target: schedules.automationId,
              set: {
                definition: JSON.stringify(d.schedule),
                enabled: d.enabled,
                nextAt: nextOccurrence(d.schedule),
              },
            })
            .run();
        },
        { behavior: "immediate" },
      );
    } catch (e) {
      if (existing) atomicWrite(file, original);
      else rmSync(directory, { recursive: true });
      throw e;
    }
    return this.get(id);
  }
  import(file: string) {
    return this.save(parse(readFileSync(file, "utf8")), file);
  }
  sync(id: string) {
    const a = this.get(id);
    return this.save(parse(readFileSync(a.file, "utf8")), a.file, a.id);
  }
  enable(id: string, enabled: boolean) {
    const a = this.get(id);
    const d = this.definition(id);
    d.enabled = enabled;
    return this.save(d, undefined, a.id);
  }
  remove(id: string) {
    const a = this.get(id);
    if (this.history(a.id).length)
      throw new Error(
        "Automation has run history; disable it to retain audit records",
      );
    this.db.delete(automations).where(eq(automations.id, a.id)).run();
    rmSync(join(this.paths.data, "automations", a.slug), {
      recursive: true,
    });
  }
  history(id?: string) {
    return id
      ? this.db
          .select()
          .from(runs)
          .where(eq(runs.automationId, this.get(id).id))
          .orderBy(desc(runs.startedAt))
          .all()
      : this.db.select().from(runs).orderBy(desc(runs.startedAt)).all();
  }
  runDetails(id: string) {
    const run = this.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) throw new Error("Run not found");
    return {
      ...run,
      steps: this.db
        .select()
        .from(stepRuns)
        .where(eq(stepRuns.runId, id))
        .all(),
      logs: this.db.select().from(runLogs).where(eq(runLogs.runId, id)).all(),
    };
  }
  notify(message: string, runId?: string) {
    this.notifications.notify(message, runId);
  }
  recover() {
    this.db.transaction(
      () => {
        for (const run of this.db
          .select()
          .from(runs)
          .where(eq(runs.status, "running"))
          .all()) {
          if (
            run.ownerPid &&
            run.ownerIdentity &&
            processIdentity(run.ownerPid) === run.ownerIdentity
          )
            continue;
          this.db
            .update(runs)
            .set({
              status: "interrupted",
              finishedAt: Date.now(),
              error: "Worker stopped before completion",
            })
            .where(eq(runs.id, run.id))
            .run();
          this.db
            .update(stepRuns)
            .set({ status: "interrupted", finishedAt: Date.now() })
            .where(
              and(eq(stepRuns.runId, run.id), eq(stepRuns.status, "running")),
            )
            .run();
          this.db
            .delete(directoryLocks)
            .where(eq(directoryLocks.runId, run.id))
            .run();
          this.notify(
            "Automation interrupted; retry requires an explicit action",
            run.id,
          );
        }
      },
      { behavior: "immediate" },
    );
  }
  claim(id: string, occurrence?: string, retryId?: string) {
    this.recover();
    const a = this.get(id);
    const previous = retryId ? this.runDetails(retryId) : undefined;
    if (
      previous &&
      (previous.automationId !== a.id ||
        !["failed", "attention", "interrupted", "canceled"].includes(
          previous.status,
        ))
    )
      throw new Error(
        "Only an unsuccessful run of this automation can be retried",
      );
    const d = previous
      ? automationSchema.parse(JSON.parse(previous.definition))
      : this.definition(a.id);
    d.cwd = realpathSync(d.cwd);
    return this.db.transaction(
      () => {
        if (
          occurrence &&
          this.db
            .select()
            .from(runs)
            .where(eq(runs.occurrence, occurrence))
            .get()
        )
          return null;
        const active = this.db
          .select()
          .from(runs)
          .where(and(eq(runs.automationId, a.id), eq(runs.status, "running")))
          .get();
        const conflict = this.db
          .select()
          .from(directoryLocks)
          .all()
          .some(
            (l) =>
              l.path === d.cwd ||
              l.path.startsWith(`${d.cwd}/`) ||
              d.cwd.startsWith(`${l.path}/`),
          );
        if (active || conflict) {
          const runId = randomUUID();
          this.db
            .insert(runs)
            .values({
              id: runId,
              automationId: a.id,
              cwd: d.cwd,
              status: "skipped",
              occurrence,
              definition: JSON.stringify(d),
              startedAt: Date.now(),
              finishedAt: Date.now(),
              error: "Automation or working directory is busy",
            })
            .run();
          this.notify("Automation occurrence skipped: workspace busy", runId);
          return null;
        }
        const runId = retryId ?? randomUUID();
        if (previous)
          this.db
            .update(runs)
            .set({
              status: "running",
              ownerPid: process.pid,
              ownerIdentity: processIdentity(process.pid),
              cancelRequested: false,
              finishedAt: null,
              error: null,
            })
            .where(eq(runs.id, runId))
            .run();
        else
          this.db
            .insert(runs)
            .values({
              id: runId,
              automationId: a.id,
              cwd: d.cwd,
              status: "running",
              occurrence,
              definition: JSON.stringify(d),
              ownerPid: process.pid,
              ownerIdentity: processIdentity(process.pid),
              startedAt: Date.now(),
            })
            .run();
        this.db.insert(directoryLocks).values({ path: d.cwd, runId }).run();
        return { runId, definition: d, automation: a };
      },
      { behavior: "immediate" },
    );
  }
  cancel(id: string) {
    this.runDetails(id);
    this.db
      .update(runs)
      .set({ cancelRequested: true })
      .where(and(eq(runs.id, id), eq(runs.status, "running")))
      .run();
  }
  async run(
    id: string,
    options: {
      occurrence?: string;
      retryId?: string;
      signal?: AbortSignal;
    } = {},
  ) {
    const claim = this.claim(id, options.occurrence, options.retryId);
    if (!claim) return null;
    return this.executeClaim(claim, options);
  }
  private async executeClaim(
    claim: NonNullable<ReturnType<AutomationService["claim"]>>,
    options: { signal?: AbortSignal } = {},
  ) {
    const { runId, definition: d, automation: a } = claim;
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const poll = setInterval(() => {
      if (
        this.db.select().from(runs).where(eq(runs.id, runId)).get()
          ?.cancelRequested
      )
        controller.abort();
    }, 500);
    try {
      const support = join(d.cwd, ".agentos", a.slug, "runs", runId);
      for (const part of [
        join(d.cwd, ".agentos"),
        join(d.cwd, ".agentos", a.slug),
        join(d.cwd, ".agentos", a.slug, "runs"),
        support,
      ]) {
        if (
          existsSync(part) &&
          (!lstatSync(part).isDirectory() || lstatSync(part).isSymbolicLink())
        )
          throw new Error(
            "Supporting directory contains a non-directory or symbolic link",
          );
      }
      mkdirSync(support, { recursive: true, mode: 0o700 });
      const ignore = join(d.cwd, ".gitignore");
      const before = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
      const alreadyIgnored =
        existsSync(join(d.cwd, ".git")) &&
        Boolean(Bun.which("git")) &&
        Bun.spawnSync(["git", "check-ignore", "--quiet", "--", ".agentos/"], {
          cwd: d.cwd,
          stdout: "ignore",
          stderr: "ignore",
        }).exitCode === 0;
      if (
        existsSync(join(d.cwd, ".git")) &&
        !alreadyIgnored &&
        !before
          .split(/\r?\n/)
          .some((line) => [".agentos/", "/.agentos/"].includes(line.trim()))
      )
        atomicWrite(
          ignore,
          `${before}${before.endsWith("\n") || !before ? "" : "\n"}.agentos/\n`,
          before,
        );
      let previousText = "",
        previousId: string | undefined;
      for (let ordinal = 0; ordinal < d.steps.length; ordinal++) {
        const step = d.steps[ordinal];
        if (!step) continue;
        const succeeded = this.db
          .select()
          .from(stepRuns)
          .where(
            and(
              eq(stepRuns.runId, runId),
              eq(stepRuns.ordinal, ordinal),
              eq(stepRuns.status, "completed"),
            ),
          )
          .get();
        if (succeeded) {
          previousText = succeeded.result ?? "";
          previousId = succeeded.nativeId ?? undefined;
          continue;
        }
        if (step.session === "previous" && !previousId)
          throw new Error(
            "Previous step has no compatible native session identity",
          );
        const adapter = this.providers.adapter(step.provider);
        if (!adapter.execute)
          throw new Error(
            `${step.provider} does not support background execution`,
          );
        for (let retry = 0; retry <= step.retries; retry++) {
          if (controller.signal.aborted) throw new Error("Execution canceled");
          const stepId = randomUUID();
          const attempt =
            this.db
              .select()
              .from(stepRuns)
              .where(
                and(eq(stepRuns.runId, runId), eq(stepRuns.ordinal, ordinal)),
              )
              .all().length + 1;
          this.db
            .insert(stepRuns)
            .values({
              id: stepId,
              runId,
              ordinal,
              attempt,
              status: "running",
              provider: step.provider,
              startedAt: Date.now(),
            })
            .run();
          try {
            const instructions =
              step.agent && step.session === "new"
                ? this.agents.agentDefinition(step.agent).instructions
                : "";
            const prompt = `${instructions ? `agentos role instructions:\n${instructions}\n\n` : ""}${step.prompt}\n\nSupporting files directory: ${support}${step.includePrevious ? `\n\nPrevious step result (excerpt):\n${previousText.slice(-12000)}` : ""}`;
            const result = await adapter.execute({
              cwd: d.cwd,
              prompt,
              nativeId: step.session === "previous" ? previousId : undefined,
              signal: controller.signal,
              timeoutMs: step.timeoutSeconds * 1000,
              onIdentity: (nativeId) =>
                this.db
                  .update(stepRuns)
                  .set({ nativeId })
                  .where(eq(stepRuns.id, stepId))
                  .run(),
              onEvent: (event) =>
                this.db
                  .insert(runLogs)
                  .values({
                    runId,
                    step: ordinal,
                    message: redact(event).slice(0, 200),
                    createdAt: Date.now(),
                  })
                  .run(),
            });
            previousText = redact(result.text);
            previousId = result.nativeId;
            this.db
              .update(stepRuns)
              .set({
                status: "completed",
                nativeId: result.nativeId,
                result: previousText,
                finishedAt: Date.now(),
              })
              .where(eq(stepRuns.id, stepId))
              .run();
            break;
          } catch (error) {
            this.db
              .update(stepRuns)
              .set({
                status: "failed",
                error: redact(errorMessage(error)),
                finishedAt: Date.now(),
              })
              .where(eq(stepRuns.id, stepId))
              .run();
            if (
              retry >= step.retries ||
              controller.signal.aborted ||
              /requires attention/i.test(errorMessage(error))
            )
              throw error;
          }
        }
      }
      this.db
        .update(runs)
        .set({ status: "completed", finishedAt: Date.now() })
        .where(eq(runs.id, runId))
        .run();
      this.notify(`Automation completed: ${a.name}`, runId);
    } catch (error) {
      const message = redact(errorMessage(error));
      const status = controller.signal.aborted
        ? "canceled"
        : /requires attention/i.test(message)
          ? "attention"
          : "failed";
      this.db
        .update(runs)
        .set({ status, error: message, finishedAt: Date.now() })
        .where(eq(runs.id, runId))
        .run();
      this.notify(`Automation ${status}: ${a.name}`, runId);
    } finally {
      clearInterval(poll);
      options.signal?.removeEventListener("abort", abort);
      this.db
        .delete(directoryLocks)
        .where(eq(directoryLocks.runId, runId))
        .run();
    }
    return this.runDetails(runId);
  }
  upcoming() {
    return this.db
      .select()
      .from(schedules)
      .where(eq(schedules.enabled, true))
      .all();
  }
  async tick(now = Date.now(), signal?: AbortSignal) {
    this.recover();
    for (const row of this.upcoming()) {
      if (row.nextAt === null || row.nextAt > now) continue;
      try {
        const claim = this.db.transaction(
          () => {
            const current = this.db
              .select()
              .from(schedules)
              .where(
                and(
                  eq(schedules.automationId, row.automationId),
                  eq(schedules.nextAt, row.nextAt ?? 0),
                ),
              )
              .get();
            if (!current) return null;
            const spec = scheduleSchema.parse(JSON.parse(row.definition));
            this.db
              .update(schedules)
              .set({
                nextAt:
                  spec.kind === "interval"
                    ? (row.nextAt ?? now) +
                      (Math.floor(
                        (now - (row.nextAt ?? now)) /
                          (spec.everySeconds * 1000),
                      ) +
                        1) *
                        spec.everySeconds *
                        1000
                    : nextOccurrence(spec, now),
              })
              .where(eq(schedules.automationId, row.automationId))
              .run();
            const occurrence = `${row.automationId}:${row.nextAt}`;
            if (now - (row.nextAt ?? now) > 60_000) {
              const a = this.get(row.automationId),
                runId = randomUUID();
              this.db
                .insert(runs)
                .values({
                  id: runId,
                  automationId: a.id,
                  cwd: a.cwd,
                  status: "skipped",
                  occurrence,
                  definition: JSON.stringify(this.definition(a.id)),
                  startedAt: now,
                  finishedAt: now,
                  error: "Scheduled occurrence missed while worker was offline",
                })
                .run();
              this.notify("Scheduled occurrence skipped after downtime", runId);
              return null;
            }
            return this.claim(row.automationId, occurrence);
          },
          { behavior: "immediate" },
        );
        if (claim) {
          const job = this.executeClaim(claim, { signal });
          this.jobs.add(job);
          void job.finally(() => this.jobs.delete(job)).catch(() => {});
        }
      } catch (error) {
        this.db
          .update(schedules)
          .set({ enabled: false })
          .where(eq(schedules.automationId, row.automationId))
          .run();
        this.notify(
          `Schedule disabled; requires attention: ${errorMessage(error)}`,
        );
      }
    }
  }
}
