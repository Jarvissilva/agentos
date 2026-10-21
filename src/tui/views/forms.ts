import { parse, stringify } from "yaml";
import type { ResourceContext } from "../types";
export function resourceForms({
  app,
  openForm,
  setForm,
  setNotice,
  refresh,
}: ResourceContext) {
  const yamlForm = (
    title: string,
    subtitle: string,
    value: unknown,
    save: (value: unknown) => void,
  ) => {
    openForm({
      title,
      subtitle,
      fields: [
        {
          label: "Definition (YAML)",
          value: stringify(value),
          multiline: true,
        },
      ],
      save: (values) => {
        save(parse(values[0] ?? ""));
        setForm(null);
        setNotice(`${title} saved`);
        refresh();
      },
    });
  };
  const membershipForm = (section: "sessions" | "automations", id: string) => {
    const record =
      section === "sessions" ? app.session(id) : app.automations.get(id);
    const project = record.projectId
      ? app.project(record.projectId)
      : undefined;
    openForm({
      title: "Assign project",
      subtitle: "Enter a project name or ID; leave empty to remove membership",
      fields: [{ label: "Project (optional)", value: project?.name ?? "" }],
      save: (values) => {
        const project = values[0]?.trim() || undefined;
        if (section === "sessions") app.assignSessionProject(id, project);
        else app.automations.assignProject(id, project);
        setForm(null);
        setNotice(project ? "Project assigned" : "Project membership cleared");
        refresh();
      },
    });
  };
  return { yamlForm, membershipForm };
}
