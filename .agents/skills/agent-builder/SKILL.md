---
name: agent-builder
description: Create, import, inspect, edit, sync, or remove AgentOS reusable agent roles. Use for requests about AgentOS role definitions and their instructions, not provider-native subagents or changes to the AgentOS execution engine.
---

# AgentOS agent roles

Work through the existing AgentOS interfaces. An agent is a managed Markdown
role; it does not own a provider, model, project, or directory. Start by inspecting
`agentos agents list` and, for an existing role, `agentos agents show <name-or-id>`.
Use `bun src/index.ts` in place of `agentos` when working from an unlinked checkout.
Run `agentos paths` to locate this user's managed storage.

## Definition and example

An imported file must have YAML frontmatter between `---` lines followed by a
nonempty Markdown instruction body. `name` is required, trimmed, 1–100 characters,
with no control characters; `description` is an optional string. Names must be
unique among managed agents. Do not add provider/model fields to this format.

Save this as `reviewer.md`:

```markdown
---
name: Repository Reviewer
description: Review focused source changes with evidence from the repository
---

Inspect the relevant source and repository instructions before reviewing.
Report actionable bugs with file references and explain their consequences.
Run relevant checks when available. Do not edit source unless asked to fix it.
```

Import and inspect it:

```sh
agentos agents import ./reviewer.md
agentos agents show 'Repository Reviewer'
agentos agents edit 'Repository Reviewer'
```

Alternatively, create a role from a file containing **only the Markdown body**:

```sh
agentos agents create 'Repository Reviewer' --description 'Review focused source changes with evidence from the repository' --instructions-file ./review-instructions.md
```

Choose create or import for a new role; importing is a copy into central storage,
not a live link to the source file. Importing again is not an update operation.
The TUI equivalents are `/new agent`, `/import agent`, and `/agents`, then `/edit`
on the selected role. Native editors use `VISUAL`/`EDITOR` as an executable path.

## Editing, use, and removal

`agents edit` opens the managed definition and calls `app.syncAgent(id)` after a
successful editor exit. In application code use `app.agentFile(id)` to locate it,
`parseAgent(text)` to validate authored content, and `app.syncAgent(id)` after a
deliberate managed-file edit. Do not update database rows directly. Invalid
definitions must be corrected before using the role.

The Home `/agent` selector, session wizard, or `sessions new --agent <name-or-id>`
selects a role for a new session. Instructions become an explicitly labeled
initial native user message; they do not replace native system/developer prompts
or workspace instruction files. Native providers still own inference,
authentication, tools, permissions, and conversations. Role changes affect new
sessions; resume does not reinsert instructions. `/builder` itself starts without
a selected role or initial task.

When removal is requested, inspect the target, then use
`agentos agents remove 'Repository Reviewer' --yes` or `/delete` on that role in
the TUI. This removes the managed definition; existing native conversations and
session metadata are preserved. Avoid manual deletion of definition/index pairs.

## Implementation references

- [Definition parser and metadata schema](../../../src/modules/agents/definition.ts)
- [Agent service: createAgent, agentDefinition, agentFile, syncAgent, removeAgent](../../../src/modules/agents/service.ts)
- [Role injection and normal session resume](../../../src/modules/sessions/service.ts)
- [CLI create/show/edit](../../../src/cli/commands.ts) and [import/remove](../../../src/cli/resources.ts)
- [TUI role forms and commands](../../../src/tui/views/agents.ts)
