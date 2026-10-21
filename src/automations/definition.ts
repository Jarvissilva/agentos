import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import { slugSchema } from "../core/skills";
import { inside } from "../platform/files";
import { expandPath, nameSchema } from "../platform/paths";
export const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("once"), at: z.iso.datetime({ offset: true }) }),
  z.object({
    kind: z.literal("interval"),
    everySeconds: z.number().int().min(60),
  }),
  z.object({
    kind: z.literal("cron"),
    expression: z.string().min(1),
    timezone: z
      .string()
      .default(Intl.DateTimeFormat().resolvedOptions().timeZone),
  }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;
export function nextOccurrence(s: Schedule, after = Date.now()): number | null {
  if (s.kind === "manual") return null;
  if (s.kind === "once")
    return Date.parse(s.at) > after ? Date.parse(s.at) : null;
  if (s.kind === "interval") return after + s.everySeconds * 1000;
  if (s.expression.trim().split(/\s+/).length !== 5)
    throw new Error(
      "Use a five-field cron expression (minute hour day month weekday)",
    );
  return CronExpressionParser.parse(s.expression, {
    currentDate: new Date(after),
    tz: s.timezone,
  })
    .next()
    .getTime();
}
export const stepSchema = z
  .object({
    name: nameSchema,
    provider: z.enum(["codex", "opencode", "agy"]),
    agent: z.string().optional(),
    prompt: z.string().min(1).optional(),
    promptFile: z.string().optional(),
    session: z.enum(["new", "previous"]).default("new"),
    includePrevious: z.boolean().default(false),
    timeoutSeconds: z.number().int().min(10).max(86400).default(3600),
    retries: z.number().int().min(0).max(3).default(0),
  })
  .strict()
  .refine(
    (v) => Boolean(v.prompt) !== Boolean(v.promptFile),
    "Supply either prompt or promptFile",
  );
export const automationSchema = z
  .object({
    version: z.literal(1).default(1),
    name: nameSchema,
    slug: slugSchema,
    cwd: z.string().min(1),
    enabled: z.boolean().default(true),
    schedule: scheduleSchema.default({ kind: "manual" }),
    steps: z.array(stepSchema).min(1).max(100),
  })
  .strict();
export type AutomationDefinition = z.infer<typeof automationSchema>;
export function validateAutomation(
  input: unknown,
  sourceFile?: string,
): AutomationDefinition {
  const d = automationSchema.parse(input);
  d.cwd = realpathSync(expandPath(d.cwd));
  if (!statSync(d.cwd).isDirectory())
    throw new Error("Automation requires an existing working directory");
  nextOccurrence(d.schedule);
  for (let i = 0; i < d.steps.length; i++) {
    const step = d.steps[i];
    if (!step) continue;
    if (step.session === "previous") {
      const p = d.steps[i - 1];
      if (!p || p.provider !== step.provider || p.agent !== step.agent)
        throw new Error(
          "A continued step must follow the same provider and agent",
        );
    }
    if (step.promptFile) {
      if (!sourceFile)
        throw new Error("promptFile requires importing a definition file");
      const root = dirname(realpathSync(sourceFile));
      const file = realpathSync(inside(root, step.promptFile));
      if (!file.startsWith(`${resolve(root)}/`) || !existsSync(file))
        throw new Error("Prompt file escapes definition directory");
      step.prompt = readFileSync(file, "utf8");
      delete step.promptFile;
    }
  }
  return d;
}
