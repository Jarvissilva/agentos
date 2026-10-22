import { readFileSync } from "node:fs";
import { parseAgent } from "../../app";
import { runInteractive } from "../../lib/platform/process";
import type { Command, ResourceContext, ResourceView, Row } from "../lib/types";
import { colors } from "../theme";
export function agentsView(context: ResourceContext): ResourceView {
  const {
    app,
    setView,
    setSelected,
    setForm,
    setNotice,
    setConfirm,
    refresh,
    perform,
    handoff,
    openForm,
  } = context;

  const agents = app.listAgents();

  const agentForm = () => {
    openForm({
      title: "New agent",
      subtitle: "A reusable role for native provider sessions",
      fields: [
        { label: "Name", value: "" },
        { label: "Description", value: "" },
        { label: "Instructions", value: "", multiline: true },
      ],
      save: (values) => {
        const target = app.createAgent(
          values[0] ?? "",
          values[2] ?? "",
          values[1] ?? "",
        );
        setForm(null);
        setSelected(0);
        setView({ kind: "detail", section: "agents", id: target.id });
        setNotice("Agent created");
        refresh();
      },
    });
  };
  const deleteAgent = (id: string) =>
    setConfirm({
      message: "Delete this managed role definition?",
      action: () => {
        app.removeAgent(id);
        setView({ kind: "section", section: "agents" });
        setSelected(0);
        setNotice("Agent deleted");
      },
    });
  const editAgent = (id: string) => {
    void perform(async () => {
      const file = app.agentFile(id);
      const result = await handoff(() =>
        runInteractive(
          process.env.VISUAL || process.env.EDITOR || "vi",
          [file],
          process.cwd(),
        ),
      );
      if (result !== 0) throw new Error(`Editor exited ${result}`);
      app.syncAgent(id);
      setNotice("Agent updated");
    });
  };
  const agentRows: Row[] = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    meta: "role",
    glyph: "◈",
    glyphColor: colors.accentDim,
    description: agent.description || "No description",
    body: () => {
      const definition = app.agentDefinition(agent.id);
      return `${definition.instructions}\n\n— ${app.agentFile(agent.id)}`;
    },
  }));
  const importForm = () => {
    openForm({
      title: "Import agent",
      subtitle: "Import a YAML or Markdown definition file",
      fields: [
        {
          label: "Definition file",
          value: "",
        },
      ],
      save: (values) => {
        const path = values[0] ?? "";

        const definition = parseAgent(readFileSync(path, "utf8"));
        const target = app.createAgent(
          definition.name,
          definition.instructions,
          definition.description,
        );
        setSelected(0);
        setView({ kind: "detail", section: "agents", id: target.id });
        setForm(null);
        setNotice("Import complete");
        refresh();
      },
    });
  };

  const sectionCommands: Command[] = [];
  sectionCommands.push(
    {
      name: "new agent",
      description: "Create a reusable role",
      group: "create",
      run: agentForm,
    },
    {
      name: "import agent",
      description: "Import an agent Markdown definition",
      group: "create",
      run: () => importForm(),
    },
  );
  return {
    navigation: {
      name: "agents",
      description: "Reusable roles and instructions",
      group: "navigate",
      run: () => {
        context.openSection("agents");
      },
    },
    copy: {
      title: "Agents",
      noun: "agent",
      glyph: "◈",
      empty: "No agents yet",
      hint: "Run /new agent to create a reusable role",
    },
    rows: agentRows,
    commands: (row) => {
      const contextCommands: Command[] = [];
      contextCommands.push(
        {
          name: "edit",
          description: `Edit ${row.name} Markdown`,
          group: "context",
          run: () => editAgent(row.id),
        },
        {
          name: "delete",
          description: `Delete ${row.name}`,
          group: "context",
          run: () => deleteAgent(row.id),
        },
      );

      return contextCommands;
    },
    sectionCommands,
    creation: sectionCommands.find((command) =>
      command.name.startsWith("new "),
    ),
  };
}
