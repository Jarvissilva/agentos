import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { AppPaths } from "../platform/paths";
import { initializePaths } from "../platform/paths";
import * as schema from "./schema";

export function openDatabase(paths: AppPaths) {
  initializePaths(paths);
  const previous = process.umask(0o077);
  try {
    const sqlite = new Database(paths.database, { create: true, strict: true });
    try {
      chmodSync(paths.database, 0o600);
      sqlite.exec(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
      );
      const migrationConfig = {
        migrationsFolder: fileURLToPath(
          new URL("../../drizzle", import.meta.url),
        ),
      };
      if (
        sqlite
          .query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
          )
          .get()
      ) {
        const latest = sqlite
          .query<{ created_at: number }, []>(
            "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
          )
          .get();
        const supported = Math.max(
          ...readMigrationFiles(migrationConfig).map((m) => m.folderMillis),
        );
        if (latest && latest.created_at > supported)
          throw new Error(
            "This database belongs to a newer Agent OS version. Upgrade Agent OS before opening it.",
          );
      }
      const db = drizzle(sqlite, { schema });
      migrate(db, migrationConfig);
      return { db, close: () => sqlite.close() };
    } catch (error) {
      sqlite.close();
      throw error;
    }
  } finally {
    process.umask(previous);
  }
}

export type AppDatabase = ReturnType<typeof openDatabase>["db"];
