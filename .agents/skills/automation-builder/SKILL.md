---
name: automation-builder
description: Author, import, inspect, edit, schedule, run, cancel, retry, or remove AgentOS YAML automations through existing interfaces. Use for sequential native-provider workflows and their scheduler/history, not for a new execution engine or generic OS cron jobs.
---

# AgentOS automations

Inspect `agentos automations list`, `show <name-or-id-or-slug>`, and
`agentos paths` before changing an existing workflow. From an unlinked checkout,
replace `agentos` with `bun src/index.ts`. Use the validated YAML interfaces and
existing worker, not direct database writes or a separate scheduler. Native
providers own inference, credentials, tools, permissions, and conversation state.
Creating or inspecting a definition does not require executing it.

## YAML contract

Read the [schemas and path/continuation validator](../../../src/modules/automations/definition.ts)
when authoring. Top-level fields are `version: 1`, `name`, `slug`, `cwd`, optional
`enabled` (default true), `schedule` (default manual), and `steps` (1–100).
Unknown top-level and step fields are rejected. Names are trimmed, 1–100
characters without controls; slugs use lowercase letters/digits separated by
hyphens, at most 64 characters. The managed slug is immutable. The working
directory must exist and is canonicalized; use an explicit absolute path.
Project membership is optional metadata assigned separately with
`automations project <automation> <project>` or `--clear`, never a YAML field.

Steps run sequentially and require `name`, `provider` (`codex`, `opencode`, or
`agy`), and exactly one of nonempty `prompt` or `promptFile`. Optional fields:

- `agent`: an already registered role name or ID.
- `session`: `new` (default) or `previous`. Continuing requires an immediately
  preceding step with the same provider and exactly the same agent reference.
  The first step cannot continue a session; retries reuse saved run state.
- `includePrevious`: default false; include a bounded excerpt of the preceding
  result. This is distinct from continuing a native session. Shared workspace
  files are also available to later steps.
- `timeoutSeconds`: integer 10–86400, default 3600.
- `retries`: integer 0–3, default 0. Avoid repeating steps with uncertain external
  side effects; native approval denials must not be bypassed.

## Working definition

Save as `automation.yaml` in the checkout to review; `cwd: .` resolves from the
importing process's working directory, not from the YAML file's directory. For
another target replace it with that target's absolute directory:

```yaml
version: 1
name: Repository review
slug: repository-review
cwd: .
enabled: false
schedule: { kind: manual }
steps:
  - name: Inspect
    provider: codex
    prompt: Inspect the repository and report the relevant checks. Do not edit files.
    timeoutSeconds: 600
    retries: 0
  - name: Summarize
    provider: codex
    session: previous
    prompt: Summarize the findings and unresolved risks. Do not edit files.
    timeoutSeconds: 600
    retries: 0
```

Importing validates and copies a normalized definition to central storage:

```sh
agentos automations import ./automation.yaml
agentos automations show repository-review
agentos automations edit repository-review
agentos automations schedules
```

Use `/new automation` or `/import automation` in the TUI. On a selected
automation, `/edit` validates/saves its YAML and refreshes steps/schedules.
CLI `edit` calls `app.automations.sync(id)` after the editor succeeds; application
code uses `app.automations.save(value, sourceFile?, existingId?)` for deliberate
updates. Reimport is not an upsert. Do not edit files without syncing metadata.

For file-based prompts replace a step's `prompt` with, for example,
`promptFile: prompts/review.md`, create that nonempty UTF-8 file under the YAML
directory, and import the definition file. Paths, including symlink targets,
must stay inside the definition directory. Import normalizes prompt text into
managed YAML; subsequent edits to the original prompt file do not update it.

## Scheduling and execution

Choose one schedule object:

```yaml
schedule: { kind: manual }
# Or one of these alternatives:
# schedule: { kind: once, at: '2026-12-01T09:00:00+05:30' }
# schedule: { kind: interval, everySeconds: 3600 }
# schedule: { kind: cron, expression: '0 9 * * 1', timezone: Asia/Kolkata }
```

Intervals require at least 60 seconds. Once dates require an ISO datetime with
an offset; use a future date to get a future occurrence. Cron uses five fields
(minute, hour, day, month, weekday) and an IANA timezone; specify the timezone
explicitly rather than depending on the host default. `0 9 * * *` is daily,
`0 9 * * 1` weekly, `0 9 1 * *` monthly. Check `automations schedules` after saving.

Enable/disable controls scheduled execution; it does not prevent an explicit
manual run or cancel an active run. Use the controls appropriate to the request:

```sh
agentos automations enable repository-review
agentos automations disable repository-review
agentos automations run repository-review
agentos automations history repository-review
```

`run` executes in the foreground in the CLI; TUI `/run` starts the existing
background launch path. Inspect a returned run ID with
`automations run-details <run-id>`; use `automations cancel <run-id>` to request
cancellation or `automations retry <run-id>` for an unsuccessful run. Retry uses
the original definition snapshot and skips completed steps; inspect saved
results and side effects before retrying. TUI `/runs` opens history, with `/cancel`
and `/retry` on the selected run. Default retries are zero, not an unlimited loop.

Only one run per automation and conflicting canonical workspace can execute at
once, including nested directories. Overlaps are skipped rather than queued.
Recovery releases stale locks without automatically replaying uncertain work.
Late missed schedule occurrences are skipped, not caught up. Invalid edited
schedules are disabled with a notice until corrected and saved.

Scheduling requires the existing worker. To inspect it use
`agentos automations service-status`. When the user requests persistent scheduling,
use `agentos automations install-service --start` (TUI `/scheduler install`);
`automations stop-service` disables/stops it. `automations worker` is the foreground
alternative. Keep the source checkout available; do not create a second cron job.
The optional private XDG `worker.env` is a systemd EnvironmentFile, not a provider
login mechanism. Do not change native credentials or permission policy to make
an unattended run succeed.

Results, attempts, IDs, logs, and schedule state persist in SQLite. Supporting
directories live at `.agentos/<slug>/runs/<run-id>/` in the workspace. Remove an
unused automation with `automations remove <name> --yes` only when requested;
history prevents deletion, so disable workflows whose audit records must remain.

## Implementation references

- [Automation schemas and validation](../../../src/modules/automations/definition.ts)
- [Service: save/import/sync, scheduling, run snapshots, retry/cancel, and history](../../../src/modules/automations/service.ts)
- [CLI automation commands and foreground worker](../../../src/cli/resources.ts)
- [TUI automation actions](../../../src/tui/views/automations.ts) and [run controls](../../../src/tui/views/runs.ts)
- [Systemd user-service integration](../../../src/lib/scheduler/systemd.ts)
- [Native background execution](../../../src/lib/providers/execution.ts)
