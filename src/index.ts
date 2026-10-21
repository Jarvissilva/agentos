#!/usr/bin/env bun
import { commands } from "./cli/commands";
import { Application } from "./core/application";
import { redact } from "./platform/files";
import { appPaths, errorMessage } from "./platform/paths";
import { openDatabase } from "./storage/database";

let storage: ReturnType<typeof openDatabase> | undefined;
try {
  const paths = appPaths();
  storage = openDatabase(paths);
  const app = new Application(storage.db, paths);
  app.recoverSessions();
  await commands(app).parseAsync();
} catch (error) {
  console.error(`Agent OS: ${redact(errorMessage(error))}`);
  process.exitCode = 1;
} finally {
  storage?.close();
}
