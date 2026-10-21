import { colors, plural, prettyPath } from "../theme";
import type { Command, ResourceContext, ResourceView, Row } from "../types";
export function projectsView(context: ResourceContext): ResourceView {
  const {
    app,
    setView,
    setSelected,
    setForm,
    setNotice,
    setConfirm,
    refresh,
    openForm,
    openSection,
  } = context;

  const projects = app.listProjects();
  const sessions = app.listSessions();
  const automations = app.automations.list();

  const projectForm = (id?: string) => {
    const project = id ? app.project(id) : undefined;
    openForm({
      title: project ? "Edit project" : "New project",
      subtitle: "Group sessions and automations",
      fields: [
        { label: "Name", value: project?.name ?? "" },
        { label: "Description", value: project?.description ?? "" },
      ],
      save: (values) => {
        const target = project
          ? app.updateProject(project.id, {
              name: values[0] ?? "",
              description: values[1] ?? "",
            })
          : app.createProject(values[0] ?? "", values[1] ?? "");
        setForm(null);
        setSelected(0);
        setView({ kind: "detail", section: "projects", id: target.id });
        setNotice(project ? "Project updated" : "Project created");
        refresh();
      },
    });
  };
  const deleteProject = (id: string) =>
    setConfirm({
      message: "Remove this project's metadata? Workspace files are preserved.",
      action: () => {
        app.removeProject(id);
        setView({ kind: "section", section: "projects" });
        setSelected(0);
        setNotice("Project removed");
      },
    });
  const projectRows: Row[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    meta: plural(
      sessions.filter((s) => s.projectId === project.id).length,
      "session",
    ),
    glyph: "▱",
    glyphColor: colors.accentDim,
    description: project.description || "No description",
    body: () => {
      const current = app.project(project.id);
      return [
        current.description || "No description",
        "",
        `Sessions    ${sessions.filter((s) => s.projectId === project.id).length}`,
        ...sessions
          .filter((s) => s.projectId === project.id)
          .map(
            (s) =>
              `  ${s.provider} · ${prettyPath(s.cwd)} · ${s.id.slice(0, 8)}`,
          ),
        `Automations ${automations.filter((a) => a.projectId === project.id).length}`,
        ...automations
          .filter((a) => a.projectId === project.id)
          .map((a) => `  ${a.name} · ${prettyPath(a.cwd)}`),
        `ID          ${current.id}`,
        "",
        "Use /sessions or /automations to browse this group",
      ].join("\n");
    },
  }));

  const sectionCommands: Command[] = [];
  sectionCommands.push({
    name: "new project",
    description: "Create a group for sessions and automations",
    group: "create",
    run: () => projectForm(),
  });
  return {
    navigation: {
      name: "projects",
      description: "Groups for sessions and automations",
      group: "navigate",
      run: () => {
        context.openSection("projects");
      },
    },
    copy: {
      title: "Projects",
      noun: "project",
      glyph: "▱",
      empty: "No projects yet",
      hint: "Run /new project to create a group",
    },
    rows: projectRows,
    commands: (row) => {
      const contextCommands: Command[] = [];
      contextCommands.push(
        {
          name: "sessions",
          description: `Browse sessions in ${row.name}`,
          group: "context",
          run: () => openSection("sessions", { id: row.id, name: row.name }),
        },
        {
          name: "automations",
          description: `Browse automations in ${row.name}`,
          group: "context",
          run: () => openSection("automations", { id: row.id, name: row.name }),
        },
        {
          name: "edit",
          description: `Edit ${row.name} metadata`,
          group: "context",
          run: () => projectForm(row.id),
        },
        {
          name: "delete",
          description: `Remove ${row.name} metadata`,
          group: "context",
          run: () => deleteProject(row.id),
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
