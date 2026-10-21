# agentos

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

Requires Linux, Bun >=1.3.14, GNU coreutils (`stty`), and util-linux (`setsid`) for embedded provider terminals. Tested on Arch Linux with Bun 1.4.3, OpenTUI 0.6.6, Codex 0.163.0, OpenCode 2.0.29, and Agy 1.4.3. Log in and configure models with each provider's own CLI. Keep this source checkout and its dependencies available; this release runs from source and loads migrations relative to it.

Restart an already-open agentos instance to load newly added modules.

## Terminal interface

agentos opens on a centered home screen with a message input. Type a task and press Enter to start a native provider session with that message. The selected provider, model and reasoning defaults, working directory, agent, and project appear beneath the input. Use `/provider` to choose an available provider; the last choice is remembered in `$XDG_CONFIG_HOME/agentos/preferences.json`. Without a saved choice, agentos prefers Codex when available, then the first available provider. An unavailable saved provider stays visible until you choose another.

Use `/directory`, `/agent`, and `/project` on the home screen to configure the next session. Directory starts from the saved default, or where agentos was launched; agent and project default to none. The home context selections belong to each session tab and last for the current application instance. Use `/settings` to change persistent defaults. Resource lists, details, creation forms, and the session wizard open as centered modals over the home screen. Press `n` on Sessions, Projects, Agents, Skills, MCPs, or Automations to create an item. The shortcut is inactive in text inputs, selectors, and confirmation dialogs (`n` still cancels a confirmation). Every screen, resource, and action is reachable through the `/` command palette — there are no sidebar tabs or page-specific shortcuts to memorize. Press `/` in an empty home input, or Ctrl+P while drafting, to open the palette, type to filter commands by name or description, and press Enter to run the highlighted command. Commands prioritize exact names and name prefixes; otherwise actions for the item currently selected appear first. Closing commands, switching providers, or a launch error preserves your message. Slashes inside a message (such as paths) remain ordinary text. Empty messages do not launch sessions.

| Key | Action |
| --- | --- |
| `/` in an empty home input / `/` on resource pages | Open the command palette |
| Ctrl+P | Open commands while preserving the message draft |
| Up / `k`, Down / `j` | Move through the palette, a list, or the session wizard; scroll a detail view |
| Left / `h` | Back one level (detail → list → home) |
| Right / `l` | Open the selected row in list views |
| Enter | Send the home message / run a command / open a row |
| Esc | Close the palette, cancel a form, or go back |
| `n` | Create an item in the current resource modal |
| Tab | Next field in a form |
| `y` / `n` | Confirm / cancel a destructive action |
| Ctrl+S | Save a form, including Markdown/YAML editors |
| Ctrl+Q | Quit agentos |

Resource modals show the available shortcut hints. The vim aliases (`h`, `j`, `k`, `l`) are inactive while an input is focused — in the palette, wizard, picker, forms, or the home command box — so those letters can always be typed into a filter or field. Arrow keys always work.

Commands include:

| Group | Commands |
| --- | --- |
| Context | Home: `/directory`, `/agent`, `/project`; resources: `/project`, `/open`, `/resume`, `/history`, `/edit`, `/instructions`, `/delete`, `/install`, `/uninstall`, `/disable`, `/run`, `/runs`, `/toggle`, `/cancel`, `/retry` |
| Create | `/new project`, `/new agent`, `/new skill`, `/new mcp`, `/new automation`, `/new session`, `/import agent\|skill\|mcp\|automation` |
| Navigate | `/settings`, `/sessions`, `/projects`, `/automations`, `/agents`, `/skills`, `/mcps`, `/providers`, `/runs`, `/notifications` |
| System | `/provider`, `/back`, `/home`, `/help`, `/refresh`, `/scheduler install`, `/scheduler status`, `/quit` |

`/help` lists every command available on the current screen, including context actions for the selected row. `/new session` runs a four-step wizard: choose a project group (or none), enter the working directory, choose an agent (or none), then choose a provider. Destructive commands ask for `y`/`n` confirmation. Opening a notification marks it read. There is no replacement provider chat UI.

Native providers retain their own shortcuts and trust/approval screens, except for the agentos tab shortcuts listed below. Terminal settings are saved/restored even after an abnormal provider/editor exit. `VISUAL`/`EDITOR` can name an executable or path; shell argument strings are deliberately not evaluated. Default editor: `vi`.

## Embedded session tabs

Interactive sessions launched in the agentos TUI now open the provider’s own interface inside an embedded terminal, beneath a persistent tab bar. Switching tabs leaves other provider interfaces running. Every blank tab retains its own message draft, directory, agent, project, forms, and navigation state while agentos is open.

- **Ctrl+T:** open a blank session tab; enter a task to launch its provider.
- **Ctrl+1–9:** select a tab. **Alt+1–9** and **Ctrl+PageUp/PageDown** are alternatives when a terminal cannot distinguish Ctrl+number keys. Tabs can also be clicked.
- **Ctrl+W:** close the tab and detach its terminal frontend. This does not delete its saved conversation or explicitly stop its background service.
- **F2:** switch between the provider terminal and that tab’s agentos dashboard. Provider slash commands remain provider commands; open the dashboard to use agentos commands.
- **Ctrl+Q:** quit agentos and disconnect embedded frontends. Codex and OpenCode use their native background services; agentos does not shut those services down. Continuation depends on those provider services being enabled and running, and pending approvals can still require your attention.

A dot on an inactive tab indicates new terminal output, not confirmed task completion. Exited or disconnected terminals remain visible until closed. To reconnect after restarting agentos, open Sessions and use `/resume`; resuming a session already open in another tab selects that tab. Saved model defaults still apply only when creating a session.

**Agy requires `tmux` for embedded tabs.** Agentos uses a private socket and configuration, separate from your personal tmux server, to keep each Agy terminal alive after tab or application exit. Resuming from the agentos TUI reconnects to the same running terminal. Agentos does not install tmux or register Agy’s remote-control daemon. Stop work using the provider’s own controls before detaching when you want it to stop. These background processes survive UI exit, not machine shutdown.

Direct CLI commands such as `agentos sessions new` and `sessions resume` retain their ordinary native terminal handoff. External editors still temporarily suspend the agentos display. No inference is needed to render the embedded terminal itself.

Embedded terminals use agentos’s navy background, pale blue accents, and semantic ANSI colors. Run `bun run theme:providers` once to select matching native themes: a custom Codex syntax theme, OpenCode’s `system` theme in dark mode, and Agy’s `terminal` color scheme. This updates only theme settings in the native user configuration files (so those selections also affect standalone provider launches), preserves unrelated settings and permissions, and respects `CODEX_HOME` and `XDG_CONFIG_HOME`. Restart provider frontends to pick up theme changes; an existing Agy terminal retained by tmux keeps its current appearance until restarted. Codex’s native syntax theme covers code and diffs; its other UI colors follow terminal capabilities.

Native theme references: [Codex](https://learn.chatgpt.com/docs/cli-customization), [OpenCode](https://dev.opencode.ai/v2/docs/cli/theme/), [Agy](https://www.agy.dev/docs/cli/reference/).

## Projects, roles, and sessions

```sh
agentos providers list
agentos projects create Wizyz --description "AI website builder"
agentos agents create Developer --instructions-file ./developer-instructions.md
agentos sessions new --project Wizyz --cwd ~/projects/wizyz --agent Developer --provider codex
agentos sessions list --project Wizyz
agentos sessions resume <agentos-session-id>
agentos sessions history <agentos-session-id> --cursor '<nextCursor>'
agentos sessions instructions <session-id> --edit
agentos sessions instructions <session-id> --file GEMINI.md
```

Use `bun src/index.ts ...` without linking. Direct commands print JSON; native interactive operations require a real terminal. `--help` lists commands and flags. Projects and agents are optional. Projects are organizational groups, with a name and description; they do not own directories or instruction files. Every session uses its own working directory: the TUI asks for one, and the CLI uses `--cwd`, the saved default directory, or the launch directory. Automations keep their independently configured `cwd`.

Roles are central Markdown files with `name`/`description` YAML frontmatter. Their instructions become an explicitly labeled initial native user message. They never replace default system/developer prompts or project instruction files, and are not reinserted on resume. Editing a role affects future sessions. Import an existing definition using `agents import <file>`.

Provider behavior:

- **Codex:** obtains exact IDs through a private App Server, persists an empty thread by setting its native name, closes the bootstrap server, then launches ordinary `codex resume`. Conversation retrieval uses native paginated thread history.
- **OpenCode v2:** creates a native session with an explicit working directory through its installed API CLI, then opens its official TUI. Background execution uses a private native server and verifies the persisted `outcome`; it never assumes that stream EOF means success. Other major versions are rejected.
- **Agy:** one harmless native headless initialization turn obtains a reliable conversation ID before launching its TUI. This can take time and uses native inference. History retrieval has no verified API and is explicitly unavailable; resume Agy to inspect its native history.

Managed session status describes preparation/terminal attachment, not task completion. `idle` means the native TUI exited successfully; its native daemon may still be working. Conversations opened with native `/new` or `/fork` are not automatically imported. A process-identity guard prevents simultaneous managed attachment and recovers stale records after interruption.

Project details show their sessions and automations. From a project, `/sessions` and `/automations` open filtered lists; use `/home` to return to global navigation. On a session or automation, `/project` assigns a group by name or ID; leave its field empty to clear membership. Grouping is SQLite metadata and is not part of automation YAML.

```bash
agentos sessions project <session-id> Wizyz
agentos sessions project <session-id> --clear
agentos automations project <name> Wizyz
agentos automations project <name> --clear
agentos sessions list --project Wizyz
agentos automations list --project Wizyz
```

Project removal clears memberships and preserves sessions, automations, histories, and workspace files. Group reassignment never changes working directories. On upgrade, existing project IDs and session memberships are retained; previous project directory fields are removed, existing session/automation directories remain intact, and automations start ungrouped. Instructions are edited only by an explicit action on a session, using its directory (`/instructions`). Agent deletion preserves native conversations and existing session metadata.

## Settings

Open `/settings` for a centered settings modal. Enter opens the selected setting; `/edit` edits provider, directory, and per-provider model defaults. Storage paths are read-only. The background scheduler entry checks status; `/scheduler install` asks before installing and starting the systemd user service.

The provider choice and default working directory persist in the private XDG configuration file. Leave the default directory empty to use the launch directory. Defaults apply to future sessions, including the native session wizard and CLI; explicit `--provider` and `--cwd` override them. Existing sessions and automation directories are unchanged. The home `/directory` command changes only the current launch context.

```bash
agentos settings show
agentos settings provider opencode
agentos settings directory ~/projects/wizyz
agentos settings directory --clear
```

Each provider has its own **model defaults** entry. Enter opens a searchable model picker, followed by that model’s advertised reasoning effort (Codex), variant (OpenCode), or effort (Agy). The pair saves after the second selection; Escape cancels without saving. Choose **Use provider default** in the model picker to clear both overrides, or in the reasoning picker to leave reasoning to the provider. Changing the model resets the reasoning choice.

Catalogs are discovered on demand from the installed provider: Codex App Server `model/list` (all pages), OpenCode `/api/model` (enabled models and variants), and `agy models` plus its CLI effort choices. Discovery failures and empty catalogs offer retry, and you can still clear overrides when discovery fails. OpenCode model IDs include the provider prefix, such as `openrouter/organization/model`; copy the exact ID from the catalog.

```bash
agentos providers models codex
agentos providers models opencode
agentos providers models agy
agentos settings model codex <model-id-from-catalog>
agentos settings reasoning codex <effort-from-catalog>
agentos settings model opencode <provider-id/model-id-from-catalog>
agentos settings reasoning opencode <variant-from-catalog>
agentos settings model agy <model-id-from-catalog>
agentos settings reasoning agy <effort-from-catalog>
agentos settings reasoning codex --clear
agentos settings model codex --clear
```

`settings show` includes `providerDefaults`, keyed by provider with optional `model` and `reasoning` values. These preferences apply only to **new interactive sessions** started from Home, the session wizard, or `sessions new`. Settings are validated against current capabilities before session creation; unavailable models or reasoning choices produce an error and preserve the Home draft. Resuming sessions and running automations retain their existing behavior. Agentos does not rewrite provider configuration or authentication. With no overrides, the provider selects its native defaults.

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

Managed directories live centrally under the agentos data directory. Codex and OpenCode share `~/.agents/skills`; installing/unlinking there affects both providers. Agy uses `~/.gemini/antigravity-cli/skills`. Managed installation records track exact symlink targets. Existing independently installed files/links are never adopted or replaced; external modifications become conflicts. Missing owned links can be repaired by installing again. Directory imports reject symlinks and special files. Providers decide which skills to load; agentos never injects their contents into sessions.

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

JSONC edits preserve other entries/comments. TOML edits use bounded managed blocks and verify that unrelated configuration survives. Fingerprints protect external modifications during update/removal. Deletion removes only owned installations. Installations work when providers are launched outside agentos, subject to normal native configuration precedence.

Definitions accept references, not plaintext environment/header credential fields. Never embed credentials in command arguments or URLs. Configure a persistent shell/OS environment, native OAuth, or an MCP server credential helper independently of agentos. Codex env references retain the same variable names; OpenCode supports its documented native interpolation. **Agy environment and bearer interpolation are unverified and rejected**; use native OAuth or a server that obtains credentials through a persistent helper. No provider authentication is modified.

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

Optional `~/.config/agentos/worker.env` is a systemd EnvironmentFile for explicitly maintained service-only variables; keep it `0600`. It does not configure credentials for native providers launched from other shells. Native permission policies still apply to unattended execution.

## Persistence, validation, and development

Existing installations continue using their legacy `agent-os/` directories and `agent-os.db` in place, preserving saved data, managed links, and native configuration ownership. `agentos paths` shows the locations in use. No data is moved automatically.

Data defaults to `~/.local/share/agentos`: `agentos.db`, `agents/`, `skills/`, and `automations/<slug>/automation.yaml`. Configuration/cache directories respect absolute XDG values. Application directories are private (`0700`); database and new instruction files use `0600`. SQLite uses WAL, foreign keys, transactions, migrations, and downgrade detection. Provider conversations remain in native storage.

Raw provider stdout/stderr and full conversation archives are not copied into run logs. Logs contain event types; known environment credential values and bearer strings are redacted from results/errors. Keep credentials out of authored prompts and definitions.

Before upgrades, stop the scheduler, close agentos instances, and back up its data directory plus native provider storage. Do not copy only a live SQLite database without its WAL. Install pinned dependencies, restart the application to apply migrations, then restart the scheduler. Invalid edited files remain available for correction.

```sh
bun run check                    # Strict TypeScript, Biome, tests
bun run dev                      # Watch mode; use start for native sessions
bun run db:generate              # After intentional schema edits
```

Drizzle migration history is committed in `src/storage/migrations` and applied automatically when the database opens.

Application services are independent of the TUI. Native execution and configuration formats live under `providers/`; storage/migrations, OS process handling, and scheduling remain separate. Tests isolate their databases/configs and mock provider processes; real provider validation is recorded in [implementation notes](docs/implementation.md).
