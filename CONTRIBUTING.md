# Contributing to AgentOS

AgentOS is an early Linux application. Discuss substantial behavior or architecture
changes in an issue before implementing them. For bugs, include reproduction
steps, expected and actual behavior, Linux distribution, terminal, Bun version,
and relevant native provider versions. Remove credentials and private conversation
content from reports.

## Development

Install the prerequisites in the [README](README.md#run-from-a-source-checkout),
then run:

```sh
bun install --frozen-lockfile
bun run check
```

The full tests also require `python3` and `tmux`, plus permission to create Unix
sockets, PTYs, and child-process pipes. Restricted sandboxes may fail integration
tests even when those tools are present. Run those tests on a normal Linux host;
do not remove assertions or silently skip failures to accommodate a sandbox.
Tests use temporary storage and fake native providers; personal provider
credentials are not needed.

Follow [AGENTS.md](AGENTS.md) for architecture and development conventions. Keep
changes focused, preserve native provider trust and authentication, and use existing
resource services rather than editing database rows. Avoid adding dependencies
without a concrete need.

For an intentional persistence change, update the schema, run `bun run db:generate`,
and include the generated SQL and metadata. Never rewrite existing migrations.
Add meaningful tests for changed behavior. Run `bun run check` and review the diff
before submitting a pull request. Explain the problem, resulting behavior, and
verification; report environmental failures separately.

## Security and releases

Use the private reporting process in [SECURITY.md](SECURITY.md) for vulnerabilities.
Maintainers should follow the [release checklist](docs/releasing.md) before publishing.
