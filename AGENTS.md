# AgentOS repository guide

AgentOS is a local-first terminal workspace for native AI providers and reusable
resources. It runs from this source checkout using Bun, strict TypeScript,
OpenTUI React, Commander, SQLite/Drizzle, Zod, and YAML. Keep the source checkout
and dependencies available at runtime.

## Ownership and architecture

Native Codex, OpenCode, and Agy own inference, authentication, model execution,
tools, permissions, approval screens, and conversations. AgentOS coordinates
their documented interfaces; it does not implement a replacement chat UI or
inference engine. Do not bypass native trust or authentication. Agents are role
definitions, not independent execution engines. Skills are discovered by native
providers, not injected into prompts.

- `src/index.ts` starts the application; `src/app.ts` composes application services.
- `src/modules/` owns resource behavior independently of the UI and CLI.
- `src/tui/` contains the React shell, shared command palette, resource views,
  forms, and embedded session tabs. `src/cli/commands.ts` and
  `src/cli/resources.ts` expose the corresponding command interfaces.
- `src/lib/providers/` contains native adapters, model discovery and execution;
  `src/lib/platform/` handles paths, files, processes, and embedded terminals.
- `src/lib/storage/schema.ts`, `database.ts`, and `migrations/` own persistence.
  `src/lib/scheduler/systemd.ts` integrates the persistent automation worker.
- `tests/` uses Bun tests, temporary storage, fake providers, and terminal
  renderers. `tests/helpers.ts` provides an isolated application fixture.

## Core resources

- **Memory** (`src/modules/memory/service.ts`) prepares `<data>/memory/global/`
  on startup without writing or replacing notes. Shared recall/save rules are
  explicitly installed with `memory install <provider>` into native global
  instruction files; never edit them at startup or session launch. Installation
  preserves existing text and rejects altered or malformed managed blocks.
  Project launches add only a small JSON context line; ungrouped launches leave
  task text unchanged. Resume/continuation never reinserts memory context.
  Keep shared preferences in `global/` and project details in
  `projects/<project-id>/`. Native providers own reads, writes, and permissions.
  Global rules also affect standalone provider sessions. Project removal never
  deletes memories.
- **Projects** (`src/modules/projects/service.ts`) are optional organizational
  groups. They do not own workspace directories or instruction files. Creation
  prepares `<data>/memory/projects/<project-id>/`; existing projects prepare it
  on first use in a new session or automation run. New native project sessions
  receive scoped memory metadata; resume never reinserts it. Renames retain
  the memory path. Removing a project clears memberships while preserving
  sessions, automations, workspace files, and memories. Basic Memory's `agentos`
  root must match `<data>/memory` to use MCP tools for these notes; native file
  tools remain subject to native permissions. These folders are organizational,
  not access-control boundaries.
- **Sessions** (`src/modules/sessions/service.ts`) store native IDs, provider,
  directory, title, optional project/agent, and attachment metadata. Resume uses
  the stored provider and directory without reinserting role instructions or new
  model overrides. Native names remain authoritative where supported. Session
  attachment status does not prove task completion.
- **Agents** (`src/modules/agents/definition.ts` and `service.ts`) are managed
  Markdown with YAML `name` and optional `description` frontmatter and a nonempty
  instruction body. Instructions become a labeled initial native user message
  for new sessions, preserving native system/developer and project instructions.
  Editing/syncing a role affects future sessions.
- **Skills** (`src/modules/skills/service.ts`) are directories with `SKILL.md`,
  YAML `name` and `description` frontmatter, and Markdown instructions. Managed
  names use lowercase letters/digits separated by hyphens. Import rejects
  symlinks and special files. Install/status/uninstall track owned discovery
  links and protect externally owned or modified files. Project-local skills
  belong in `.agents/skills/<name>/SKILL.md`; do not centrally import or globally
  install repository guidance just to make Builder discover it.
- **MCPs** (`src/modules/mcps/service.ts` and `configuration.ts`) store validated
  central definitions and track fingerprinted native installations. Explicit
  installation writes owned entries using the exact registered name, preserving
  unrelated native configuration. Existing automatically prefixed entries are
  renamed on explicit reinstall/enable/disable, with ownership and collision
  checks; never rename them at startup. Use credential references, never embedded
  secrets. Do not overwrite conflicting external entries.
- **Automations** (`src/modules/automations/definition.ts` and `service.ts`) use
  validated version 1 YAML with an existing `cwd`, slug, schedule, and sequential
  steps. Schedules support manual, once, interval, and five-field cron with a
  timezone. Each step selects a native provider, optional agent, prompt or local
  prompt file, timeout, and retries. Continuing the previous session requires
  the same provider and agent. The worker persists run snapshots, attempts,
  directory locks, cancellation, logs, and schedule state; systemd integration
  is explicit. Do not run an automation merely to inspect its definition.
- **Providers/settings** (`src/modules/settings/service.ts` and
  `src/lib/providers/`) manage detection and preferences. Saved model/reasoning
  settings apply to new interactive sessions; an unavailable selected provider
  must report an error rather than silently switching.
- **Runs/notifications** (`src/modules/automations/service.ts` and
  `src/modules/notifications/service.ts`) expose execution history, results,
  retry/cancel controls, and local read/unread notices.

Use existing services, TUI forms, and CLI commands to create/import, inspect,
edit/sync, install/uninstall, enable/disable, run/cancel/retry, and remove
resources. Read `--help` and the schemas before authoring definitions. Do not
edit database rows directly to manage resources.

`/builder` is a shared AgentOS palette action opening a fresh normal session in
the running source checkout, with the selected/default provider and its saved
model settings. It has no inherited Home agent/project or initial task. Preserve
Home drafts and directory selections. Earlier work resumes through Sessions.
There is no Builder module, session type, database migration, or shell command.

## Local storage

Run `agentos paths` (or `bun src/index.ts paths`) for resolved AgentOS locations.
`src/lib/platform/paths.ts` uses absolute XDG roots with these defaults:

- Config: `$XDG_CONFIG_HOME/agentos` or `~/.config/agentos`.
  `preferences.json` holds the provider, default directory, and per-provider
  model/reasoning preferences, not provider credentials.
- Data: `$XDG_DATA_HOME/agentos` or `~/.local/share/agentos`.
  `agentos.db` stores resource indexes, project memberships, native session IDs,
  attachment state, provider detection metadata, managed skill links, MCP
  definitions/installations, automation steps/schedules/runs/logs, and notices.
  It is not the authoritative native conversation store.
- Managed definitions: `agents/*.md`, `skills/<name>/SKILL.md` plus supporting
  files, and `automations/<slug>/automation.yaml` under the data directory.
  Imported prompt files are normalized into managed automation YAML.
- Cache: `$XDG_CACHE_HOME/agentos` or `~/.cache/agentos`; keep cache separate from
  durable definitions and metadata. Legacy `agent-os` locations/database names
  are reused in place where present; do not move them casually because owned
  links can contain absolute paths.

Native provider storage remains provider-owned. Codex uses its own home
(`CODEX_HOME`, normally `~/.codex`); OpenCode and Agy retain their native stores
and configuration. Consult adapters for exact runtime paths. Managed skills
install into shared `~/.agents/skills` for Codex/OpenCode and
`~/.gemini/antigravity-cli/skills` for Agy. MCP targets are Codex's
`config.toml`, OpenCode's XDG `opencode/opencode.json` or existing `.jsonc`, and
Agy's `~/.gemini/config/mcp_config.json`. Use ownership-aware services for
changes. Repository-local skill discovery needs no prompt injection, global
installation, or provider configuration changes.

## Development conventions and verification

Inspect existing code first. Follow existing architecture, naming, formatting,
and strict types; prefer simple solutions and reuse. Fix root causes with focused
changes. Preserve existing behavior and user changes; avoid unrelated refactors,
unnecessary dependencies, and type suppressions. Never commit, push, or rewrite
git history unless explicitly requested.

Run `bun run typecheck`, `bun run lint`, relevant `bun test <files>`, and the full
`bun test` suite (or `bun run check`). Isolate storage and mock native processes
for tests; do not use personal provider credentials/configuration. Distinguish
pre-existing/environment failures from regressions. Review the final git diff
for accidental changes, regressions, and dead code, then report changes and
verification briefly.

Change `src/lib/storage/schema.ts` only for an intentional persistence change;
run `bun run db:generate`, inspect and retain the generated SQL and metadata.
Migrations are applied automatically on database open; do not rewrite existing
migration history. Before upgrades, stop the worker and application and back up
the data directory and native provider storage. A live SQLite backup must account
for WAL files.
