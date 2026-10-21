import { prettyPath, relativeTime, statusMark } from "../theme";
import type { Command, ResourceContext, ResourceView, Row } from "../types";
import { automationLauncher } from "./automations";
export function runsView(context: ResourceContext): ResourceView {
  const { app, runFilter, setNotice, refresh, fail } = context;

  const automations = app.automations.list();
  const runs = app.automations.history();
  const automationById = new Map(
    automations.map((automation) => [automation.id, automation]),
  );

  const cancelRun = (id: string) => {
    try {
      app.automations.cancel(id);
      setNotice("Cancellation requested");
      refresh();
    } catch (value) {
      fail(value);
    }
  };
  const runAutomation = automationLauncher(context);
  const filteredRuns = runFilter
    ? runs.filter((run) => run.automationId === runFilter.automationId)
    : runs;
  const runRows: Row[] = filteredRuns.map((run) => {
    const automation = automationById.get(run.automationId);
    const mark = statusMark(run.status);
    return {
      id: run.id,
      name: automation?.name ?? "Unknown automation",
      meta: run.status,
      glyph: mark.glyph,
      glyphColor: mark.color,
      description: `${prettyPath(run.cwd)} · ${relativeTime(run.startedAt)} · ${run.id.slice(0, 8)}`,
      body: () => JSON.stringify(app.automations.runDetails(run.id), null, 2),
    };
  });

  const sectionCommands: Command[] = [];

  return {
    navigation: {
      name: "runs",
      description: "All background execution history",
      group: "navigate",
      run: () => {
        context.setRunFilter(null);
        context.openSection("runs");
      },
    },
    copy: {
      title: "Runs",
      noun: "run",
      glyph: "▸",
      empty: "No runs yet",
      hint: "Run an automation with /run",
    },
    rows: runRows,
    commands: (row) => {
      const contextCommands: Command[] = [];
      const run = filteredRuns.find((item) => item.id === row.id);
      if (run) {
        contextCommands.push(
          {
            name: "cancel",
            description: `Cancel ${row.name} run`,
            group: "context",
            run: () => cancelRun(run.id),
          },
          {
            name: "retry",
            description: `Retry ${row.name} from the first unsuccessful step`,
            group: "context",
            run: () => runAutomation(run.automationId, run.id),
          },
        );
      }

      return contextCommands;
    },
    sectionCommands,
    creation: sectionCommands.find((command) =>
      command.name.startsWith("new "),
    ),
  };
}
