# Security policy

AgentOS is an early release. Security fixes target the latest published release;
older releases have no maintenance guarantee.

## Reporting a vulnerability

On [Jarvissilva/agentos](https://github.com/Jarvissilva/agentos/security/advisories),
open **Report a vulnerability** to submit a private report. Include the affected version,
reproduction steps, impact, and a minimal example with synthetic credentials.
Do not include real tokens, private conversations, or personal provider files.

If private reporting is unavailable, open an issue asking maintainers to provide
a private contact channel, without disclosing vulnerability details. Maintainers
must enable GitHub private vulnerability reporting before the first public release.

## Security boundaries

AgentOS runs locally with the current user's filesystem and process permissions.
Native providers own authentication, inference, tools, and approval policies.
Imported roles, skills, MCP servers, and automation prompts can direct native
providers to perform work; review resources and trust their source before use.
Memory folders and project groups are organizational, not access-control boundaries.

Keep credentials in native provider authentication or external credential helpers.
Use references in MCP definitions. Do not embed secrets in prompts, URLs, or command
arguments. Logs and redaction cannot guarantee removal of every secret. See the
[README](README.md#mcps-and-credentials) for provider-specific behavior.
