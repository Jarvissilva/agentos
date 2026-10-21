import { basename } from "node:path";
import { relativeTime, sessionMark } from "../theme";
import type { Command, ResourceContext, ResourceView, Row } from "../types";
import { resourceForms } from "./forms";
export function sessionsView(context: ResourceContext): ResourceView {
  const {
    app,
    projectFilter,
    setForm,
    setNotice,
    setReport,
    refresh,
    perform,
    handoff,
    sessionLauncher,
    activateSession,
    openForm,
    startSession,
  } = context;
  const { membershipForm } = resourceForms(context);
  const projects = app.listProjects();
  const agents = app.listAgents();
  const sessions = app.listSessions();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  const instructionsForm = (id: string) => {
    openForm({
      title: "Session workspace instructions",
      subtitle: "AGENTS.md is read by native providers in this workspace",
      fields: [
        {
          label: "AGENTS.md",
          value: app.readInstructions(id),
          multiline: true,
        },
      ],
      save: (values) => {
        app.saveInstructions(id, values[0] ?? "");
        setForm(null);
        setNotice("Instructions saved");
        refresh();
      },
    });
  };
  const showHistory = (id: string) => {
    void perform(async () => {
      const history = await app.history(id);
      setReport({
        title: "Native history · latest 20 turns",
        body: JSON.stringify(history, null, 2),
      });
      setNotice("Native history loaded");
    });
  };
  const resumeSession = (id: string) => {
    if (activateSession?.(id)) return;
    void perform(async () => {
      await app.resumeSession(
        id,
        sessionLauncher ? (run) => run() : handoff,
        sessionLauncher,
      );
      setNotice("Session resumed");
    });
  };
  const sessionRows: Row[] = sessions
    .filter(
      (session) => !projectFilter || session.projectId === projectFilter.id,
    )
    .map((session) => {
      const project = session.projectId
        ? projectById.get(session.projectId)
        : undefined;
      const agent = session.agentId
        ? agentById.get(session.agentId)
        : undefined;
      const mark = sessionMark(session.status);
      return {
        id: session.id,
        name: project?.name ?? basename(session.cwd),
        meta: session.status,
        glyph: mark.glyph,
        glyphColor: mark.color,
        description: `${session.provider}${agent ? ` · ${agent.name}` : ""} · ${relativeTime(session.updatedAt)} · ${session.id.slice(0, 8)}`,
        body: () =>
          JSON.stringify(
            {
              ...app.session(session.id),
              project: project?.name ?? null,
              agent: agent?.name ?? null,
            },
            null,
            2,
          ),
      };
    });

  const creation: Command = {
    name: "new session",
    description: "Launch a native provider session",
    group: "navigate",
    run: startSession,
  };
  return {
    navigation: {
      name: "sessions",
      description: "Resume and inspect native sessions",
      group: "navigate",
      run: () => {
        context.openSection("sessions");
      },
    },
    copy: {
      title: "Sessions",
      noun: "session",
      glyph: "◇",
      empty: "No sessions yet",
      hint: "Run /new session to launch a native provider",
    },
    rows: sessionRows,
    commands: (row) => {
      const contextCommands: Command[] = [];
      contextCommands.push({
        name: "project",
        description: "Assign, change, or clear the project group",
        group: "context",
        run: () => membershipForm("sessions", row.id),
      });
      contextCommands.push(
        {
          name: "instructions",
          description: `Edit AGENTS.md for ${row.name}`,
          group: "context",
          run: () => instructionsForm(row.id),
        },
        {
          name: "resume",
          description: `Resume ${row.name} in its native TUI`,
          group: "context",
          run: () => resumeSession(row.id),
        },
        {
          name: "history",
          description: `Load native history for ${row.name}`,
          group: "context",
          run: () => showHistory(row.id),
        },
      );

      return contextCommands;
    },
    sectionCommands: [],
    creation,
  };
}
