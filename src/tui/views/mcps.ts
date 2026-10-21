import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { colors } from "../theme";
import type { Command, ResourceContext, ResourceView, Row } from "../types";
import { resourceForms } from "./forms";
export function mcpsView(context: ResourceContext): ResourceView {
  const {
    app,
    setView,
    setSelected,
    setForm,
    setNotice,
    setConfirm,
    refresh,
    openForm,
    openPicker,
  } = context;
  const { yamlForm } = resourceForms(context);
  const mcps = app.mcps.list();

  const newMcpForm = () =>
    yamlForm(
      "Register MCP",
      "Use credential references, never plaintext secrets",
      {
        name: "my-server",
        transport: "stdio",
        command: "",
        args: [],
        envRefs: {},
      },
      (value) => {
        const target = app.mcps.register(value);
        setSelected(0);
        setView({ kind: "detail", section: "mcps", id: target.id });
      },
    );
  const deleteMcp = (id: string) =>
    setConfirm({
      message: "Delete this MCP and its owned installations?",
      action: () => {
        app.mcps.remove(id);
        setView({ kind: "section", section: "mcps" });
        setSelected(0);
        setNotice("MCP deleted");
      },
    });
  const mcpRows: Row[] = mcps.map((mcp) => ({
    id: mcp.id,
    name: mcp.name,
    meta: mcp.definition.transport,
    glyph: "⬡",
    glyphColor: colors.accentDim,
    description:
      mcp.definition.transport === "stdio"
        ? mcp.definition.command
        : mcp.definition.url,
    body: () =>
      `${stringify(mcp.definition)}\n${JSON.stringify(app.mcps.installations(mcp.id), null, 2)}`,
  }));
  const importForm = () => {
    openForm({
      title: "Import mcp",
      subtitle: "Import a YAML or Markdown definition file",
      fields: [
        {
          label: "Definition file",
          value: "",
        },
      ],
      save: (values) => {
        const path = values[0] ?? "";

        const target = app.mcps.register(parse(readFileSync(path, "utf8")));
        setSelected(0);
        setView({ kind: "detail", section: "mcps", id: target.id });
        setForm(null);
        setNotice("Import complete");
        refresh();
      },
    });
  };

  const sectionCommands: Command[] = [];
  sectionCommands.push(
    {
      name: "new mcp",
      description: "Register an MCP server definition",
      group: "create",
      run: newMcpForm,
    },
    {
      name: "import mcp",
      description: "Import an MCP YAML definition",
      group: "create",
      run: () => importForm(),
    },
  );
  return {
    navigation: {
      name: "mcps",
      description: "Model context protocol servers",
      group: "navigate",
      run: () => {
        context.openSection("mcps");
      },
    },
    copy: {
      title: "MCP servers",
      noun: "server",
      glyph: "⬡",
      empty: "No MCP servers",
      hint: "Run /new mcp or /import mcp",
    },
    rows: mcpRows,
    commands: (row) => {
      const contextCommands: Command[] = [];
      contextCommands.push(
        {
          name: "edit",
          description: `Edit ${row.name} definition`,
          group: "context",
          run: () => {
            const mcp = app.mcps.get(row.id);
            yamlForm(
              "Edit MCP",
              "Use credential references, never plaintext secrets",
              mcp.definition,
              (value) => {
                app.mcps.update(row.id, value);
              },
            );
          },
        },
        {
          name: "install",
          description: `Install ${row.name} for a provider`,
          group: "context",
          run: () =>
            openPicker(`Install ${row.name}`, (provider) => {
              app.mcps.install(row.id, provider);
              setNotice(`MCP installed for ${provider}`);
            }),
        },
        {
          name: "disable",
          description: `Write ${row.name} disabled for a provider`,
          group: "context",
          run: () =>
            openPicker(`Disable ${row.name}`, (provider) => {
              app.mcps.install(row.id, provider, false);
              setNotice(`MCP disabled for ${provider}`);
            }),
        },
        {
          name: "uninstall",
          description: `Uninstall ${row.name} from a provider`,
          group: "context",
          run: () =>
            openPicker(`Uninstall ${row.name}`, (provider) => {
              app.mcps.uninstall(row.id, provider);
              setNotice(`MCP uninstalled for ${provider}`);
            }),
        },
        {
          name: "delete",
          description: `Delete ${row.name}`,
          group: "context",
          run: () => deleteMcp(row.id),
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
