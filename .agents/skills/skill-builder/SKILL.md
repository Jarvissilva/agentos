---
name: skill-builder
description: Create, import, inspect, edit, sync, install, or remove AgentOS skills and repository-local SKILL.md directories. Use for skill authoring and managed discovery links in AgentOS; do not use for agent roles, automation definitions, or provider configuration changes.
---

# AgentOS skill authoring

Choose scope from the request before writing. Repository-specific guidance lives
at `.agents/skills/<name>/SKILL.md` in the target checkout. Reusable user-managed
skills live under AgentOS's central data directory and use the Skills interfaces.
Use `agentos paths` and `agentos skills list` to inspect the current installation.
From an unlinked checkout, replace `agentos` with `bun src/index.ts`.

Keep these Builder skills repository-local. Native discovery reads their
frontmatter and loads instructions when relevant; do not inject them into session
prompts, globally install them, or alter provider configuration to expose them.
Discovery is documented by [Codex](https://learn.chatgpt.com/docs/build-skills),
[OpenCode](https://dev.opencode.ai/v2/docs/skills/), and
[Agy](https://www.agy.dev/docs/skills/).

## Directory format and example

Each skill is a directory with an uppercase `SKILL.md`. Begin with YAML
frontmatter containing `name` and `description`, followed by Markdown
instructions. AgentOS names match `[a-z0-9]+(?:-[a-z0-9]+)*`, at most 64 characters;
descriptions contain 1–1024 trimmed characters. Use a nonempty body, keep the
directory name equal to the skill name, and make the description identify when
the skill applies. Add scripts, references, or assets only when the workflow
needs them; link supporting files relative to the skill directory.

For example, create `.agents/skills/release-review/SKILL.md` in a project:

```markdown
---
name: release-review
description: Review a proposed release for missing checks and user-visible compatibility changes. Use when preparing release notes or reviewing release readiness.
---

Inspect the proposed diff and the project's release instructions.
Summarize user-visible changes and identify compatibility or migration concerns.
Run the relevant existing checks and report unresolved failures.
Prepare release notes when requested. Publishing requires a request to publish.
```

That project-local skill needs no AgentOS registration. Edit its source directly
and validate its frontmatter with `parseSkill(text)`. AgentOS's `skills discover`
command inspects configured **user-level** roots; it is not a project-local
discovery validator. Provider discovery controls whether a local skill appears.

## Managed skills

When the user asks for a centrally managed reusable skill, import a directory
containing `SKILL.md` and any needed supporting files:

```sh
agentos skills import ./release-review
agentos skills list
agentos skills show release-review
agentos skills edit release-review
agentos skills status release-review
```

Alternatively use `agentos skills create release-review --description '<when to use it>'
--instructions-file ./release-review-instructions.md` on one shell line; that
file contains just the instruction body. Choose create or import, not both for
the same name. Imports copy regular files/directories and reject symlinks and
special files. They are not live links to the source directory.

`skills edit` validates and syncs the managed file after the editor succeeds;
application code uses `app.skills.file(id)` and `app.skills.sync(id)`. A managed
skill's name is fixed to its directory: import under a new name to rename it.
TUI equivalents are `/new skill`, `/import skill`, `/skills`, then `/edit`.

Only install when the requested scope includes native user-level availability:

```sh
agentos skills install release-review codex
agentos skills status release-review
agentos skills discover codex
agentos skills uninstall release-review codex
```

Codex and OpenCode share the managed installation root `~/.agents/skills`;
installing or unlinking there affects both providers. Agy's managed root is
`~/.gemini/antigravity-cli/skills`. These links affect standalone native launches
too. TUI `/install` and `/uninstall` use the same ownership-aware service.

Status distinguishes linked, missing, broken, and conflicting links. Reinstall
can restore a missing owned link. Inspect broken targets before repair. Existing
external files/links are never adopted or overwritten; if an owned link was
changed externally, report the conflict and preserve it. Do not force-replace a
link or edit ownership records to make installation succeed.

When deletion is requested, `agentos skills remove release-review --yes` removes
the central directory and its owned links; `/delete` on the selected skill does
the same with confirmation. Conflicting links prevent removal. Removing a
repository-local skill means editing that checkout, not invoking managed remove.

## Implementation references

- [parseSkill, slugSchema, and SkillService lifecycle/ownership checks](../../../src/modules/skills/service.ts)
- [Native skill roots](../../../src/lib/providers/configuration.ts)
- [CLI skill commands](../../../src/cli/resources.ts)
- [TUI skill forms, discovery, and installation](../../../src/tui/views/skills.ts)
