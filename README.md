# Agent OS

A local-first terminal application for projects, native AI providers, reusable roles, skills, MCP configuration, sessions, and scheduled automations. Bun + strict TypeScript + OpenTUI React + Commander + SQLite/Drizzle + Zod. No web service, inference loop, container, or external job infrastructure.

## Run

```sh
bun install --frozen-lockfile
bun run start
# Optional local CLI installation (keep this checkout available):
mkdir -p ~/.local/bin
ln -s "$PWD/src/index.ts" ~/.local/bin/agentos
agentos
```

Requires Linux, Bun >=1.3.14, and GNU coreutils (`stty`). Tested on Arch Linux with Bun 1.4.3, OpenTUI 0.6.6, Codex 0.163.0, OpenCode 2.0.29, and Agy 1.4.3. Log in and configure models with each provider's own CLI. Keep this source checkout and its dependencies available; this release runs from source and loads migrations relative to it.

Restart an already-open Agent OS instance to load newly added modules.

## Terminal interface

Navigation: Dashboard, Providers, Projects, Agents, Skills, MCPs, Sessions, Automations. The dashboard includes recent sessions/runs, upcoming schedules, failures, and unread local notifications. Opening a notification marks it read. There is no replacement provider chat UI.

| Key | Action |
| --- | --- |
| Arrows / Enter | Navigate / open |
| Tab | Switch sidebar/content focus; next field in forms |
| `/` | Search the current selector |
| Esc | Back / cancel form |
| Ctrl+Q | Quit Agent OS |
| `n` / `i` | New / import on applicable resource pages |
| Ctrl+S | Save form, including Markdown/YAML editors |
| Session details: `r`, `h` | Resume native TUI / retrieve history |
| Project details: `e`, `g`, `d` | Edit metadata / edit AGENTS.md / remove metadata |
| Agent details: `e`, `d` | Edit Markdown / delete role |
| Skill details: `e`, `l`, `x`, `d` | Edit / install / unlink / delete |
| MCP details: `e`, `l`, `t`, `x`, `d` | Edit / install or enable / disable / uninstall / delete |
| Automation details: `r`, `e`, `h`, `t`, `d` | Run / edit YAML / history / enable-disable / delete |
| Run details: `x`, `r` | Cancel / retry from first unsuccessful step |
| Automations page: `h`, `w`, `s` | Run history / install-start scheduler / scheduler status |

Native providers retain their own shortcuts and trust/approval screens. Terminal settings are saved/restored even after an abnormal provider/editor exit. `VISUAL`/`EDITOR` can name an executable or path; shell argument strings are deliberately not evaluated. Default editor: `vi`.

## Projects, roles, and sessions

```sh
agentos providers list
agentos projects create Wizyz ~/projects/wizyz --description "AI website builder"
agentos agents create Developer --instructions-file ./developer-instructions.md
agentos sessions new --project Wizyz --agent Developer --provider codex
agentos sessions list --project Wizyz
agentos sessions resume <agent-os-session-id>
agentos sessions history <agent-os-session-id> --cursor '<nextCursor>'
agentos projects instructions Wizyz --edit
agentos projects instructions Wizyz --file GEMINI.md
```

Use `bun src/index.ts ...` without linking. Direct commands print JSON; native interactive operations require a real terminal. `--help` lists commands and flags. Projects and agents are optional; projectless sessions use the launch directory or `--cwd`.

Roles are central Markdown files with `name`/`description` YAML frontmatter. Their instructions become an explicitly labeled initial native user message. They never replace default system/developer prompts or project instruction files, and are not reinserted on resume. Editing a role affects future sessions. Import an existing definition using `agents import <file>`.

Provider behavior:

- **Codex:** obtains exact IDs through a private App Server, persists an empty thread by setting its native name, closes the bootstrap server, then launches ordinary `codex resume`. Conversation retrieval uses native paginated thread history.
- **OpenCode v2:** creates a native session with an explicit working directory through its installed API CLI, then opens its official TUI. Background execution uses a private native server and verifies the persisted `outcome`; it never assumes that stream EOF means success. Other major versions are rejected.
- **Agy:** one harmless native headless initialization turn obtains a reliable conversation ID before launching its TUI. This can take time and uses native inference. History retrieval has no verified API and is explicitly unavailable; resume Agy to inspect its native history.

Managed session status describes preparation/terminal attachment, not task completion. `idle` means the native TUI exited successfully; its native daemon may still be working. Conversations opened with native `/new` or `/fork` are not automatically imported. A process-identity guard prevents simultaneous managed attachment and recovers stale records after interruption.

Project removal preserves workspace files. Instructions are edited only by an explicit action. Agent deletion preserves native conversations and existing session metadata.

## Skills

```sh
agentos skills create seo --description 'SEO research' --instructions-file ./seo.md
agentos skills import ./my-existing-skill
agentos skills install seo codex
agentos skills install seo agy
agentos skills status seo
agentos skills discover opencode
agentos skills edit seo
agentos skills uninstall seo codex
agentos skills remove seo --yes
```

Managed directories live centrally under the Agent OS data directory. Codex and OpenCode share `~/.agents/skills`; installing/unlinking there affects both providers. Agy uses `~/.gemini/antigravity-cli/skills`. Managed installation records track exact symlink targets. Existing independently installed files/links are never adopted or replaced; external modifications become conflicts. Missing owned links can be repaired by installing again. Directory imports reject symlinks and special files. Providers decide which skills to load; Agent OS never injects their contents into sessions.

## MCPs and credentials

Register a YAML or JSON definition:

```yaml
name: research
transport: stdio
command: /absolute/path/to/mcp-server
args: []
envRefs:
  API_TOKEN: API_TOKEN
```

Or use a remote server:

```yaml
name: analytics
transport: http
url: https://example.com/mcp
# Optional for Codex/OpenCode bearer authentication:
bearerEnv: ANALYTICS_TOKEN
```

```sh
agentos mcps register ./research.yaml
agentos mcps install research codex
agentos mcps install research opencode
agentos mcps status research
agentos mcps disable research codex
agentos mcps update research ./updated-research.yaml
agentos mcps install research codex   # Explicitly apply the changed definition
agentos mcps uninstall research codex
```

Native entry names are prefixed `agentos-`. Global files:

- Codex: `$CODEX_HOME/config.toml`, default `~/.codex/config.toml`.
- OpenCode: `$XDG_CONFIG_HOME/opencode/opencode.json` or an existing `opencode.jsonc`. Having both is treated as a precedence conflict.
- Agy: `~/.gemini/config/mcp_config.json`.

JSONC edits preserve other entries/comments. TOML edits use bounded managed blocks and verify that unrelated configuration survives. Fingerprints protect external modifications during update/removal. Deletion removes only owned installations. Installations work when providers are launched outside Agent OS, subject to normal native configuration precedence.

Definitions accept references, not plaintext environment/header credential fields. Never embed credentials in command arguments or URLs. Configure a persistent shell/OS environment, native OAuth, or an MCP server credential helper independently of Agent OS. Codex env references retain the same variable names; OpenCode supports its documented native interpolation. **Agy environment and bearer interpolation are unverified and rejected**; use native OAuth or a server that obtains credentials through a persistent helper. No provider authentication is modified.

## Automations

Create/edit/import an automation in the TUI, or import YAML:

```yaml
version: 1
name: PythonDex weekly review
slug: pythondex-review
cwd: /home/you/projects/pythondex
schedule:
  kind: cron
  expression: '0 9 * * 0'
  timezone: Asia/Kolkata
steps:
  - name: Research
    provider: codex
    agent: SEO Researcher
    prompt: Analyze recent SEO performance. Report improvement opportunities.
    timeoutSeconds: 3600
    retries: 0
  - name: Draft
    provider: opencode
    agent: Content Writer
    includePrevious: true
    prompt: Prepare a draft using the research. Do not publish it.
```

The working directory must exist. Agents must be registered names/IDs. `promptFile: prompts/analyze.md` can replace `prompt` when importing; it must stay inside the definition directory. Imported prompt text is normalized into the managed, editable YAML, so its source can subsequently move.

```sh
agentos automations import ./automation.yaml
agentos automations run pythondex-review
agentos automations history pythondex-review
agentos automations run-details <run-id>
agentos automations cancel <run-id>
agentos automations retry <run-id>
agentos automations edit pythondex-review
agentos automations disable pythondex-review
agentos automations schedules
```

Steps run sequentially. The default is a new native session. `session: previous` continues only an immediately preceding step with the same provider and agent. `includePrevious: true` passes a bounded result excerpt; long conversation histories are not copied. Files in the shared working directory are also available natively.

Runs preserve their definition snapshot, successful step results, native IDs, errors, and attempt history. Retrying an unsuccessful run skips every completed step. Default: no automatic retries and a 60-minute per-step timeout; each step may choose up to three retries. Cancellation is propagated to owned provider processes and escalated if necessary. Native approval denials become attention states rather than silently granting permission.

Only one run per automation and one run per conflicting canonical workspace can execute at once. Overlaps are recorded as skipped and never queued. Nested working directories also conflict. Interrupted workers release stale locks on recovery, without automatically repeating uncertain side effects.

Main outputs/code changes remain in the workspace. Supporting directories are `.agentos/<slug>/runs/<run-id>/`; metadata, event-type logs, and bounded text results live in SQLite. Repository `.gitignore` is appended when necessary; existing contents are preserved. Nothing automatically commits, pushes, deploys, or publishes. Automations with run history are disabled rather than deleted, preserving the audit trail.

### Schedule forms

```yaml
schedule: { kind: manual }
# or
schedule: { kind: interval, everySeconds: 3600 }
# or
schedule: { kind: once, at: '2026-12-01T09:00:00+05:30' }
# or a timezone-aware five-field cron expression:
schedule: { kind: cron, expression: '0 9 * * *', timezone: Asia/Kolkata }
```

Daily: `0 9 * * *`; weekly: `0 9 * * 0`; monthly: `0 9 1 * *`. Fixed intervals have a minimum of 60 seconds. A past one-time date has no future occurrence. Occurrences missed by more than a minute while offline are recorded as skipped; there is no catch-up queue. Invalid edited schedules are disabled with a notification until corrected and saved again. Save definition changes through the editor command/TUI to refresh schedule metadata.

### Persistent worker

```sh
agentos automations install-service --start
agentos automations service-status
journalctl --user -u agentos.service
agentos automations stop-service
# Foreground alternative:
agentos automations worker
```

The systemd user service runs independently of the TUI and restarts on failure. It uses absolute Bun/source paths, private file creation, and explicit XDG paths. Keep the checkout installed. User services normally run while your user manager is active; enabling login lingering is an optional separate OS administration decision.

Optional `~/.config/agent-os/worker.env` is a systemd EnvironmentFile for explicitly maintained service-only variables; keep it `0600`. It does not configure credentials for native providers launched from other shells. Native permission policies still apply to unattended execution.

## Persistence, validation, and development

Data defaults to `~/.local/share/agent-os`: `agent-os.db`, `agents/`, `skills/`, and `automations/<slug>/automation.yaml`. Configuration/cache directories respect absolute XDG values. Application directories are private (`0700`); database and new instruction files use `0600`. SQLite uses WAL, foreign keys, transactions, migrations, and downgrade detection. Provider conversations remain in native storage.

Raw provider stdout/stderr and full conversation archives are not copied into run logs. Logs contain event types; known environment credential values and bearer strings are redacted from results/errors. Keep credentials out of authored prompts and definitions.

Before upgrades, stop the scheduler, close Agent OS instances, and back up its data directory plus native provider storage. Do not copy only a live SQLite database without its WAL. Install pinned dependencies, restart the application to apply migrations, then restart the scheduler. Invalid edited files remain available for correction.

```sh
bun run check                    # Strict TypeScript, Biome, tests
bun run dev                      # Watch mode; use start for native sessions
bun run drizzle-kit generate     # After intentional schema edits
```

Application services are independent of the TUI. Native execution and configuration formats live under `providers/`; storage/migrations, OS process handling, and scheduling remain separate. Tests isolate their databases/configs and mock provider processes; real provider validation is recorded in [implementation notes](docs/implementation.md).
