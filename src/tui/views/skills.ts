import { readFileSync } from "node:fs";
import { runInteractive } from "../../platform/process";
import { colors } from "../theme";
import type { Command, ResourceContext, ResourceView, Row } from "../types";
export function skillsView(context: ResourceContext): ResourceView {
  const {
    app,
    setView,
    setSelected,
    setForm,
    setNotice,
    setConfirm,
    setReport,
    refresh,
    perform,
    handoff,
    openForm,
    openPicker,
  } = context;

  const skills = app.skills.list();

  const skillForm = () => {
    openForm({
      title: "New skill",
      subtitle: "A provider-native skill with a managed SKILL.md",
      fields: [
        { label: "Name (lowercase-hyphenated)", value: "" },
        { label: "Description", value: "" },
        { label: "Instructions", value: "", multiline: true },
      ],
      save: (values) => {
        const target = app.skills.create(
          values[0] ?? "",
          values[1] ?? "",
          values[2] ?? "",
        );
        setForm(null);
        setSelected(0);
        setView({ kind: "detail", section: "skills", id: target.id });
        setNotice("Skill created");
        refresh();
      },
    });
  };
  const deleteSkill = (id: string) =>
    setConfirm({
      message: "Delete this managed skill and its owned links?",
      action: () => {
        app.skills.remove(id);
        setView({ kind: "section", section: "skills" });
        setSelected(0);
        setNotice("Skill deleted");
      },
    });
  const editSkill = (id: string) => {
    void perform(async () => {
      const result = await handoff(() =>
        runInteractive(
          process.env.VISUAL || process.env.EDITOR || "vi",
          [app.skills.file(id)],
          process.cwd(),
        ),
      );
      if (result !== 0) throw new Error(`Editor exited ${result}`);
      app.skills.sync(id);
      setNotice("Skill updated");
    });
  };
  const skillRows: Row[] = skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    meta: "skill",
    glyph: "✦",
    glyphColor: colors.accentDim,
    description: skill.description || "No description",
    body: () => {
      const links = app.skills.links(skill.id);
      return `${readFileSync(app.skills.file(skill.id), "utf8")}\n${JSON.stringify(links, null, 2)}`;
    },
  }));
  const importForm = () => {
    openForm({
      title: "Import skill",
      subtitle: "Import a directory containing SKILL.md",
      fields: [
        {
          label: "Skill directory",
          value: "",
        },
      ],
      save: (values) => {
        const path = values[0] ?? "";

        const target = app.skills.import(path);
        setSelected(0);
        setView({ kind: "detail", section: "skills", id: target.id });
        setForm(null);
        setNotice("Import complete");
        refresh();
      },
    });
  };

  const sectionCommands: Command[] = [];
  sectionCommands.push(
    {
      name: "new skill",
      description: "Create a managed SKILL.md",
      group: "create",
      run: skillForm,
    },
    {
      name: "import skill",
      description: "Import a skill directory",
      group: "create",
      run: () => importForm(),
    },
    {
      name: "discover skills",
      description: "Inspect a provider's native skill directories",
      group: "create",
      run: () =>
        openPicker("Discover native skills", (provider) => {
          setReport({
            title: `Native skills · ${provider}`,
            body: JSON.stringify(app.skills.discover(provider), null, 2),
          });
        }),
    },
  );
  return {
    navigation: {
      name: "skills",
      description: "Provider-native skill links",
      group: "navigate",
      run: () => {
        context.openSection("skills");
      },
    },
    copy: {
      title: "Skills",
      noun: "skill",
      glyph: "✦",
      empty: "No managed skills",
      hint: "Run /new skill or /import skill",
    },
    rows: skillRows,
    commands: (row) => {
      const contextCommands: Command[] = [];
      contextCommands.push(
        {
          name: "edit",
          description: `Edit ${row.name} SKILL.md`,
          group: "context",
          run: () => editSkill(row.id),
        },
        {
          name: "install",
          description: `Link ${row.name} for a provider`,
          group: "context",
          run: () =>
            openPicker(`Install ${row.name}`, (provider) => {
              app.skills.install(row.id, provider);
              setNotice(`Skill linked for ${provider}`);
            }),
        },
        {
          name: "uninstall",
          description: `Unlink ${row.name} from a provider`,
          group: "context",
          run: () =>
            openPicker(`Uninstall ${row.name}`, (provider) => {
              app.skills.uninstall(row.id, provider);
              setNotice(`Skill unlinked for ${provider}`);
            }),
        },
        {
          name: "delete",
          description: `Delete ${row.name}`,
          group: "context",
          run: () => deleteSkill(row.id),
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
