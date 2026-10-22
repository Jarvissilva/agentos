# agentos

A local-first terminal application for projects, native AI providers, reusable roles, skills, MCP configuration, sessions, and scheduled automations. Bun + strict TypeScript + OpenTUI React + Commander + SQLite/Drizzle + Zod. No web service, inference loop, container, or external job infrastructure.

## Install on Linux

The installer sets up AgentOS and installs Bun 1.4.3 through [Bun's official installer](https://bun.sh/docs/installation) when Bun is missing. An existing stable Bun >=1.3.14 is reused. Install `curl`, `tar`, `gzip`, GNU coreutils (`stty`), and util-linux (`setsid`) using your distribution's package manager first; installing Bun also requires `unzip`.

Install from [Jarvissilva/agentos](https://github.com/Jarvissilva/agentos). The installer resolves the latest published GitHub release, not the development branch; maintainers must publish a release before this command can install AgentOS.

```sh
curl -fsSL https://raw.githubusercontent.com/Jarvissilva/agentos/main/scripts/install.sh | bash
```

To choose a release, replace `bash` above with `bash -s -- --version v0.1.0`. To inspect the installer before executing it, download `scripts/install.sh` and run `bash install.sh`. The default repository is `Jarvissilva/agentos`; use `--repo OWNER/REPO` or `AGENTOS_REPOSITORY` to install a fork. Run without `sudo` as the user who will use AgentOS.

The installer keeps the source and dependencies in `~/.local/lib/agentos` and creates `~/.local/bin/agentos`. It prints the absolute launch command and shell-specific PATH instructions if needed. It preserves the directory you launch from. Existing installation directories and command paths, including symlinks, are refused rather than replaced. Downloads and dependency installation finish in a temporary directory before the command is published; failed setup removes temporary AgentOS files. Bun installed by its official installer remains available even if AgentOS installation fails.

Then run:

```sh
agentos
```

Install at least one supported native provider (Codex, OpenCode, or Agy) and sign in through its own CLI before starting provider sessions. The installer checks for providers but does not install them or manage their credentials. Agy also requires `tmux`. Scheduler setup remains optional and explicit; see [Persistent worker](#persistent-worker).

### Upgrade or remove an installer installation

This installer supports fresh installation only; it does not update a running application. Before replacing an installation, close AgentOS, stop the scheduler if used, and back up the AgentOS data directory and native provider storage as described under [Persistence, validation, and development](#persistence-validation-and-development).

For an installation created by this installer, remove its launcher and application files:

```sh
rm -- "$HOME/.local/bin/agentos"
rm -rf -- "$HOME/.local/lib/agentos"
```

For an upgrade, run the installer again with the desired release, start AgentOS to apply migrations, and reinstall/start the scheduler if previously used. If a new installation fails, reinstall the previous release before restarting; after database migrations, restoring the pre-upgrade backup may be necessary. For removal, stop after deleting the application files. These commands preserve settings, databases, memory, managed resources, caches, Bun, and native provider storage. Check `agentos paths` before removal if you also want to locate your data. Do not apply these removal instructions to a different installation layout.

## Run from a source checkout

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

agentos opens on a centered home screen with a message input. Type a task and press Enter to start a native provider session with that message. The first message also seeds a short session title (up to 60 characters), shown in Sessions and tab labels. Provider-native names remain authoritative and are synchronized with AgentOS; renames in AgentOS are written back to Codex and OpenCode. The selected provider, model and reasoning defaults, working directory, agent, and project appear beneath the input. Use `/provider` to choose an available provider; the last choice is remembered in `$XDG_CONFIG_HOME/agentos/preferences.json`. Without a saved choice, agentos prefers Codex when available, then the first available provider. An unavailable saved provider stays visible until you choose another.

Use `/directory`, `/agent`, and `/project` on the home screen to configure the next session. Directory starts from the saved default, or where agentos was launched; agent and project default to none. The home context selections belong to each session tab and last for the current application instance. Use `/settings` to change persistent defaults. Resource lists, details, creation forms, and the session wizard open as centered modals over the home screen. Press `n` on Sessions, Projects, Agents, Skills, MCPs, or Automations to create an item. The shortcut is inactive in text inputs, selectors, and confirmation dialogs (`n` still cancels a confirmation). Every screen, resource, and action is reachable through the `/` command palette — there are no sidebar tabs or page-specific shortcuts to memorize. Press `/` in an empty home input, or Ctrl+P while drafting, to open the palette, type to filter commands by name or description, and press Enter to run the highlighted command. Commands prioritize exact names and name prefixes; otherwise actions for the item currently selected appear first. Closing commands, switching providers, or a launch error preserves your message. Slashes inside a message (such as paths) remain ordinary text. Empty messages do not launch sessions.

| Key | Action |
| --- | --- |
| `/` in an empty home input / `/` on resource pages | Open the command palette |
| Ctrl+P | Open commands while preserving the message draft |
| Up / `k`, Down / `j` | Move through the palette, a list, or the session wizard; scroll a detail view |
| Left / `h` | Back one level (detail → list → home); in Sessions, Left moves the project filter |
| Right / `l` | Open the selected row in list views; in Sessions, Right moves the project filter |
| Enter | Send the home message / run a command / open a row; in Sessions, resume the selected session directly |
| Esc | Close the palette, cancel a form, or go back |
| `n` | Create an item in the current resource modal |
| `r` | Rename the selected session in Sessions |
| Tab | Next field in a form |
| `y` / `n` | Confirm / cancel a destructive action |
| Ctrl+S | Save a form, including Markdown/YAML editors |
| Ctrl+Q | Quit agentos |

Resource modals show the available shortcut hints. The vim aliases (`h`, `j`, `k`, `l`) are inactive while an input is focused — in the palette, wizard, picker, forms, or the home command box — so those letters can always be typed into a filter or field. Arrow keys always work.

Commands include:

| Group | Commands |
| --- | --- |
| Context | Home: `/directory`, `/agent`, `/project`; resources: `/rename`, `/project`, `/details`, `/open`, `/resume`, `/history`, `/edit`, `/instructions`, `/delete`, `/install`, `/uninstall`, `/disable`, `/run`, `/runs`, `/toggle`, `/cancel`, `/retry` |
| Create | `/new project`, `/new agent`, `/new skill`, `/new mcp`, `/new automation`, `/new session`, `/import agent\|skill\|mcp\|automation` |
| Navigate | `/settings`, `/sessions`, `/projects`, `/automations`, `/agents`, `/skills`, `/mcps`, `/providers`, `/runs`, `/notifications` |
| System | `/builder`, `/provider`, `/back`, `/home`, `/help`, `/refresh`, `/scheduler install`, `/scheduler status`, `/quit` |

`/help` lists every command available on the current screen, including context actions for the selected row. `/new session` runs a four-step wizard: choose a project group (or none), enter the working directory, choose an agent (or none), then choose a provider. Destructive commands ask for `y`/`n` confirmation. Opening a notification marks it read. There is no replacement provider chat UI.

Use `/builder` from the AgentOS command palette on Home or any resource screen to start a fresh normal session in this source checkout, even when AgentOS was launched from another directory. It opens the selected provider's native interface with its saved model settings and no initial task, agent role, or project. Home drafts and directory selections are preserved. An unavailable selected provider reports an error; choose another with `/provider`. The checkout must remain available. To continue earlier Builder work, open `/sessions` and press Enter or use `/resume` on its saved session; resume uses the stored provider and directory. `/builder` always creates a new session. There is no separate `agentos builder` shell command.

The checkout includes repository-local [agent-builder](.agents/skills/agent-builder/SKILL.md), [skill-builder](.agents/skills/skill-builder/SKILL.md), and [automation-builder](.agents/skills/automation-builder/SKILL.md) skills for managing those resources through existing interfaces. They use native provider skill discovery; no global installation or provider configuration changes are needed. Ask the native provider to create or update an AgentOS role, skill, or automation, or name the relevant skill explicitly.

Native providers retain their own shortcuts and trust/approval screens, except for the agentos tab shortcuts listed below. Terminal settings are saved/restored even after an abnormal provider/editor exit. `VISUAL`/`EDITOR` can name an executable or path; shell argument strings are deliberately not evaluated. Default editor: `vi`.

## Embedded session tabs

Interactive sessions launched in the agentos TUI now open the provider’s own interface inside an embedded terminal, beneath a persistent tab bar. Switching tabs leaves other provider interfaces running. Every blank tab retains its own message draft, directory, agent, project, forms, and navigation state while agentos is open.

- **Ctrl+T:** open a blank session tab; enter a task to launch its provider.
- **Ctrl+1–9:** select a tab. **Alt+1–9** and **Ctrl+PageUp/PageDown** are alternatives when a terminal cannot distinguish Ctrl+number keys. Tabs can also be clicked.
- **Ctrl+W:** close the tab and detach its terminal frontend. This does not delete its saved conversation or explicitly stop its background service.
- **F2:** switch between the provider terminal and that tab’s agentos dashboard. Provider slash commands remain provider commands; open the dashboard to use agentos commands. Opening the dashboard also synchronizes provider session names. When the provider exits on its own — for example after its `/exit` — the tab returns to the agentos home screen automatically and shows the outcome in the status line; press F2 to view the ended terminal until you close it.
- **Ctrl+Q:** quit agentos and disconnect embedded frontends. Codex and OpenCode use their native background services; agentos does not shut those services down. Continuation depends on those provider services being enabled and running, and pending approvals can still require your attention.

A dot on an inactive tab indicates new terminal output, not confirmed task completion. Exiting a provider, or a failed launch, returns that tab to the home screen and marks the tab ended; the ended or disconnected terminal stays available behind F2 until closed with Ctrl+W. To reconnect after restarting agentos, open Sessions and use `/resume`; resuming a session already open in another tab selects that tab. Saved model defaults still apply only when creating a session.

**Agy requires `tmux` for embedded tabs.** Agentos uses a private socket and configuration, separate from your personal tmux server, to keep each Agy terminal alive after tab or application exit. Resuming from the agentos TUI reconnects to the same running terminal. Agentos does not install tmux or register Agy’s remote-control daemon. Stop work using the provider’s own controls before detaching when you want it to stop. These background processes survive UI exit, not machine shutdown.

Direct CLI commands such as `agentos sessions new` and `sessions resume` retain their ordinary native terminal handoff. External editors still temporarily suspend the agentos display. No inference is needed to render the embedded terminal itself.

Embedded terminals use agentos’s navy background, pale blue accents, and semantic ANSI colors. Native provider themes remain controlled by each provider’s own settings.

## Projects, roles, and sessions

```sh
agentos providers list
agentos projects create Wizyz --description "AI website builder"
agentos agents create Developer --instructions-file ./developer-instructions.md
agentos sessions new --project Wizyz --cwd ~/projects/wizyz --agent Developer --provider codex
agentos sessions list --project Wizyz
agentos sessions rename <agentos-session-id> "Checkout fix"
agentos sessions resume <agentos-session-id>
agentos sessions history <agentos-session-id> --cursor '<nextCursor>'
agentos sessions instructions <session-id> --edit
agentos sessions instructions <session-id> --file GEMINI.md
```

Use `bun src/index.ts ...` without linking. Direct commands print JSON; native interactive operations require a real terminal. `--help` lists commands and flags. Projects and agents are optional. Projects are organizational groups, with a name and description; they do not own workspace directories or instruction files. Every session uses its own working directory: the TUI asks for one, and the CLI uses `--cwd`, the saved default directory, or the launch directory. Automations keep their independently configured `cwd`.

Roles are central Markdown files with `name`/`description` YAML frontmatter. Their instructions become an explicitly labeled initial native user message. They never replace default system/developer prompts or project instruction files, and are not reinserted on resume. Editing a role affects future sessions. Import an existing definition using `agents import <file>`.

Provider behavior:

- **Codex:** obtains exact IDs through a private App Server, persists the native thread by setting its name from the first prompt, closes the bootstrap server, then launches ordinary `codex resume`. Promptless sessions are materialized without inventing a name so Codex can assign its own title after the first turn. Conversation retrieval uses native paginated thread history.
- **OpenCode v2:** creates a native session through its installed API CLI with an explicit working directory and, when present, the first prompt as its title, then opens its official TUI. Background execution uses a private native server and verifies the persisted `outcome`; it never assumes that stream EOF means success. Other major versions are rejected.
- **Agy:** one harmless native headless initialization turn obtains a reliable conversation ID before launching its TUI. Titles are stored in AgentOS only because Agy has no documented native session-name API. This can take time and uses native inference. History retrieval has no verified API and is explicitly unavailable; resume Agy to inspect its native history.

Managed session status describes preparation/terminal attachment, not task completion. `idle` means the native TUI exited successfully; its native daemon may still be working. Conversations opened with native `/new` or `/fork` are not automatically imported. A process-identity guard prevents simultaneous managed attachment and recovers stale records after interruption.

Project details show their sessions and automations. From a project, `/sessions` and `/automations` open filtered lists; use `/home` to return to global navigation. Sessions also show a filter strip at the top with `All` followed by each project name; move between filters with Left/Right and press Enter to open (resume) the selected session. `/details` still opens the session's metadata view. On a session or automation, `/project` assigns a group by name or ID; leave its field empty to clear membership. Grouping is SQLite metadata and is not part of automation YAML.

```bash
agentos sessions project <session-id> Wizyz
agentos sessions project <session-id> --clear
agentos automations project <name> Wizyz
agentos automations project <name> --clear
agentos sessions list --project Wizyz
agentos automations list --project Wizyz
```

AgentOS creates `<AgentOS data>/memory/global/` on startup if missing and reuses it without replacing existing notes. This folder holds shared preferences and knowledge useful across projects. `agentos memory` prints its Basic Memory project, root, directory, and absolute path; Settings → Storage paths also shows the global memory location. Creating the folder does not create notes or a new Basic Memory collection.

Each project automatically gets a private notes folder at `<AgentOS data>/memory/projects/<project-id>/`. Project IDs keep memory paths stable across renames and separate projects that reuse a deleted name. Existing projects get their folder when first used in a new session or automation run. Project details show the path; `agentos projects memory <project>` prints the Basic Memory project, root, notes directory, and absolute path without changing files.

Install the shared rules once into each provider's native global instruction file:

```sh
agentos memory install codex
agentos memory install opencode
agentos memory install agy
```

The explicit installer appends a marked block while preserving existing content. Repeated installation is idempotent; edited, malformed, or differing managed blocks are preserved and reported for review. Installation honors `CODEX_HOME` and OpenCode's XDG config directory. Codex uses a nonempty `AGENTS.override.md` when present, otherwise `AGENTS.md`; OpenCode uses its global `AGENTS.md`, and Agy uses `~/.gemini/GEMINI.md`. AgentOS does not edit these files automatically at startup or on session launch. These global rules also apply to standalone native provider sessions. Start fresh native sessions after installation.

The persistent rules request recall of relevant global notes and saving of durable shared preferences. A new project session supplies only a short `agentos memory context:` JSON line containing the selected project ID/name, memory root, and notes directory before the task. Ungrouped sessions pass through the original task without memory text. New native automation sessions follow the same convention; resuming or continuing a native session never reinserts context. Roles remain labeled initial user instructions. Project reassignment is metadata only: start a new session to use a different project's memory context.

The native agent performs memory reads and writes subject to its tools and permissions. Shared rules keep project-specific details in the selected project folder and use global memory only when no context is provided. Configure Basic Memory's `agentos` collection to use `<AgentOS data>/memory`. Rules instruct agents to verify that root before using MCP tools, or use native Markdown file tools in the applicable folders if unavailable or mismatched. Global and project folders are organizational scopes within one collection, not access-control boundaries. Creating a project does not install rules, reconfigure Basic Memory, or create a note or collection.


Project removal clears memberships and preserves sessions, automations, histories, workspace files, and memories. Global memory is shared and remains untouched by project creation, renaming, or removal. Preserved memories remain at the path shown before removal and can be removed separately on explicit request. Group reassignment never changes working directories. On upgrade, existing project IDs and session memberships are retained; previous project directory fields are removed, existing session/automation directories remain intact, and automations start ungrouped. Instructions are edited only by an explicit action on a session, using its directory (`/instructions`). Agent deletion preserves native conversations and existing session metadata.

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
agentos mcps install-all research     # Install this MCP across available providers
agentos mcps status research
agentos mcps disable research codex
agentos mcps update research ./updated-research.yaml
agentos mcps install research codex   # Explicitly apply the changed definition
agentos mcps uninstall research codex
```

Registration and import only save the MCP definition. Use `/install all` on a
selected MCP in the TUI, or `mcps install-all <mcp>`, to install it across detected,
supported providers. Each provider is reported as installed, skipped, or failed;
successful installations remain if another provider fails. The CLI exits with a
failure status if any installation fails or none succeeds. Start fresh provider
sessions after installation.

Native MCP entries use the exact registered name, and skills use their exact skill name. Existing MCP installations with an automatically added `agentos-` prefix remain usable and uninstallable; status shows them as outdated. The next install, enable, or disable action safely replaces the owned prefixed entry with the registered name. Existing external entries with that name and externally modified owned entries are preserved and reported as conflicts. No names change at startup. Global files:

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

Data defaults to `~/.local/share/agentos`: `agentos.db`, `agents/`, `skills/`, `automations/<slug>/automation.yaml`, `memory/global/`, and `memory/projects/<project-id>/`. Configuration/cache directories respect absolute XDG values. Application directories are private (`0700`); database and new instruction files use `0600`. SQLite uses WAL, foreign keys, transactions, migrations, and downgrade detection. Provider conversations remain in native storage.

Raw provider stdout/stderr and full conversation archives are not copied into run logs. Logs contain event types; known environment credential values and bearer strings are redacted from results/errors. Keep credentials out of authored prompts and definitions.

Before upgrades, stop the scheduler, close agentos instances, and back up its data directory plus native provider storage. Do not copy only a live SQLite database without its WAL. Install pinned dependencies, restart the application to apply migrations, then restart the scheduler. Invalid edited files remain available for correction.

```sh
bun run check                    # Strict TypeScript, Biome, tests
bun run dev                      # Watch mode; use start for native sessions
bun run db:generate              # After intentional schema edits
```

Drizzle migration history is committed in `src/lib/storage/migrations` and applied automatically when the database opens.

Application services live under `src/modules/` and are independent of the TUI and CLI. `src/app.ts` coordinates those services. Terminal UI lives under `src/tui/`, and CLI commands under `src/cli/`. Infrastructure lives under `src/lib/`: native provider integrations in `providers/`, database and migrations in `storage/`, OS process handling in `platform/`, and systemd integration in `scheduler/`. Tests isolate their databases/configs and mock provider processes. Full integration tests also require `python3`, `tmux`, and permission to create Unix sockets, PTYs, and child-process pipes.

See [Contributing](CONTRIBUTING.md) for development expectations, the [security policy](SECURITY.md) for private vulnerability reporting, and the [release checklist](docs/releasing.md) for publication and clean-machine validation.

AgentOS is available under the [MIT License](LICENSE).
