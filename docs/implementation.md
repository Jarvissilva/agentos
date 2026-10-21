# V1 implementation and verification

All six planned milestones are implemented: foundation, native provider sessions, agents/skills, managed MCPs, automations/scheduling, dashboard/notifications/documentation. Provider-specific limitations remain explicit capability errors rather than simulated functionality.

## Modules

- `cli` and OpenTUI React `tui` call the same application services.
- `core` manages projects, Markdown roles, skill directories/owned links, MCP registry/installations, session metadata, and notifications.
- `providers` owns Codex, OpenCode v2, and Agy execution adapters, native formats/discovery paths, structured events, cancellation, and identity capture.
- `automations` owns validated human-editable definitions, native step execution, run/attempt/result persistence, retries, workspace exclusion, and schedule occurrence claims.
- `scheduler` generates and controls a systemd user worker. The worker remains useful without a running terminal UI.
- `storage` contains versioned Drizzle migrations. Supporting run files belong to their workspace, not a central artifact store.

## Native interfaces validated on 2026-10-21

| Provider | Version | Validated behavior |
| --- | --- | --- |
| Codex | 0.163.0 | Generated native protocol, Unix WebSocket metadata operations, named persistent threads, official TUI launch/resume, paginated history, JSONL background execution |
| OpenCode | 2.0.29 | Installed OpenAPI v2 schema, `/api/session` create/read/history, explicit session location, native TUI resume, standalone JSON background execution, persisted `outcome` |
| Agy | 1.4.3 | NDJSON init/result conversation IDs, headless execution, native conversation resume/trust UI; history API unavailable |

A real three-step workflow completed Codex → OpenCode → Agy in a selected temporary workspace. All steps persisted native IDs and the expected harmless responses. It used no tools and made no project changes. Agy startup/response latency was considerably longer than the other providers in that run; timeouts remain configurable.

Codex's complete project/agent/native-TUI/return/resume flow was validated in a PTY. OpenCode's native TUI resumed a persisted test session and returned its identical ID on exit. Agy's native UI accepted its stored ID and showed its ordinary workspace trust prompt; the broad temporary directory was declined rather than changing its trust/authentication configuration.

Two implementation findings changed the adapters:

1. Naming an empty Codex thread materializes its native persistence. Another client cannot reliably resume an unnamed memory-only thread. The interactive handoff uses ordinary native `codex resume`, avoiding stale completion display observed with a bootstrap-owned remote TUI.
2. OpenCode v2 differs from its older public examples. Its shared server can retain another location; background runs explicitly create/check the session location and use the supported standalone mode. Stream EOF alone is insufficient: persisted `outcome: succeeded` is required.

## Reliability checks

Automated tests cover database persistence/migrations/downgrade rejection, private permissions, canonical working directories, agent parsing, instruction preservation, native identity before handoff, resume ownership, stale-process recovery, Unix WebSocket errors, terminal restoration after abnormal exits, and OpenTUI navigation/forms/resizing.

Additional tests cover native completion verification, stdin argument safety, timeout process-group cleanup, native approval soft-denials, skill ownership/conflicts/import boundaries, JSONC comment preservation, TOML scope preservation, credential-reference validation, failed-step retry without replay, continued-session compatibility, cancellation, schedule uniqueness, missed occurrences, polling during active runs, and timezone-aware recurrence.

A separate worker-process test executes a persisted one-time schedule with no TUI and shuts down gracefully. The generated systemd unit passes `systemd-analyze --user verify`; the installed user worker is enabled and active.

MCP mutation tests use isolated temporary provider configurations. No existing native MCP entries, authentication settings, independently installed skills, user Git changes, or provider permission defaults are replaced. A temporary Agy discovery symlink was confirmed by its native `/skills` command, then removed. Native Codex and Agy MCP commands recognized isolated managed entries; OpenCode configuration inspection recognized its isolated managed definition.

## Explicit boundaries

- Agy obtains initial IDs through a real native initialization turn; it cannot provide a verified history API.
- Agy credential interpolation is not assumed. Native OAuth or a server-side persistent credential helper is required for authenticated servers there.
- Codex/OpenCode share a native skills directory, so changing an owned link affects both discovery paths.
- External native conversation switches/forks are not imported automatically.
- A successfully detached interactive terminal is not proof of task completion.
- Automatic event triggers/chaining, coordinating agents, inference/tool loops, memory engines, automatic Git actions, worktree isolation, web/cloud interfaces, multi-user access, and distributed jobs remain excluded.

## Primary references

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenCode server documentation](https://opencode.ai/docs/server/) — installed v2 OpenAPI was the authoritative wire contract for this installation
- [OpenCode skills](https://opencode.ai/docs/skills/)
- [OpenCode MCP configuration](https://opencode.ai/docs/mcp-servers/)
- [Agy structured execution](https://antigravity.google/docs/cli/headless/)
- [Agy MCP configuration](https://antigravity.google/docs/mcp/)
- [Agy skill locations](https://antigravity.google/docs/skills/)
- [OpenTUI React](https://github.com/anomalyco/opentui/tree/main/packages/react)
