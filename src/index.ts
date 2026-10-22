#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import {
  registerInstallationProcess,
  updateCommand,
} from "./lib/platform/installation";

let storage: { close(): void } | undefined;
let unregister: (() => void) | undefined;
try {
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (process.argv[2] === "update") {
    await updateCommand(root, process.argv.slice(3));
  } else {
    unregister = registerInstallationProcess(root);
    const [{ Application }, { commands }, { appPaths }, { openDatabase }] =
      await Promise.all([
        import("./app"),
        import("./cli/commands"),
        import("./lib/platform/paths"),
        import("./lib/storage/database"),
      ]);
    const paths = appPaths();
    const database = openDatabase(paths);
    storage = database;
    const app = new Application(database.db, paths);
    app.recoverSessions();
    await commands(app).parseAsync();
  }
} catch (error) {
  const [{ redact }, { errorMessage }] = await Promise.all([
    import("./lib/platform/files"),
    import("./lib/platform/paths"),
  ]);
  console.error(`agentos: ${redact(errorMessage(error))}`);
  process.exitCode = 1;
} finally {
  storage?.close();
  unregister?.();
}
