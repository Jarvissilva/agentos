#!/usr/bin/env bun
import { Application } from "./app";
import { commands } from "./cli/commands";
import { redact } from "./lib/platform/files";
import { appPaths, errorMessage } from "./lib/platform/paths";
import { openDatabase } from "./lib/storage/database";

let storage: ReturnType<typeof openDatabase> | undefined;
try {
  const paths = appPaths();
  storage = openDatabase(paths);
  const app = new Application(storage.db, paths);
  app.recoverSessions();
  await commands(app).parseAsync();
} catch (error) {
  console.error(`agentos: ${redact(errorMessage(error))}`);
  process.exitCode = 1;
} finally {
  storage?.close();
}
