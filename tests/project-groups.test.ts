import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { commands } from "../src/cli/commands";
import { appPaths, initializePaths } from "../src/lib/platform/paths";
import { openDatabase } from "../src/lib/storage/database";
import { fixture } from "./helpers";

test("upgrading the previous schema preserves native identities, memberships, directories, and runs", () => {
  const root = mkdtempSync("/tmp/agentos-migration-");
  const paths = appPaths({ HOME: root });
  initializePaths(paths);
  const old = new Database(paths.database);
  try {
    old.exec("PRAGMA foreign_keys = ON");
    old.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)",
    );
    for (const migration of readMigrationFiles({
      migrationsFolder: join(import.meta.dir, "../src/lib/storage/migrations"),
    }).slice(0, 2)) {
      for (const statement of migration.sql) old.exec(statement);
      old
        .query(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(migration.hash, migration.folderMillis);
    }
    old
      .query(
        "INSERT INTO projects (id,name,description,cwd,created_at) VALUES (?,?,?,?,?)",
      )
      .run("p", "Business", "Group description", root, 123);
    old
      .query(
        "INSERT INTO sessions (id,provider,native_thread_id,native_session_id,provider_version,project_id,cwd,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "s",
        "codex",
        "thread",
        "native",
        "test",
        "p",
        root,
        "idle",
        123,
        124,
      );
    old
      .query(
        "INSERT INTO automations (id,name,slug,cwd,file,enabled,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run("a", "Maintenance", "maintenance", root, "/not-read.yaml", 1, 123);
    old
      .query(
        "INSERT INTO runs (id,automation_id,cwd,status,definition,started_at) VALUES (?,?,?,?,?,?)",
      )
      .run("r", "a", root, "completed", "{}", 123);
  } finally {
    old.close();
  }
  const migrated = openDatabase(paths);
  try {
    const client = migrated.db.$client;
    expect(client.query("SELECT * FROM projects").get()).toEqual({
      id: "p",
      name: "Business",
      description: "Group description",
      created_at: 123,
    });
    expect(
      client
        .query(
          "SELECT project_id, cwd, native_thread_id, native_session_id FROM sessions",
        )
        .get(),
    ).toEqual({
      project_id: "p",
      cwd: root,
      native_thread_id: "thread",
      native_session_id: "native",
    });
    expect(
      client.query("SELECT project_id, cwd FROM automations").get(),
    ).toEqual({ project_id: null, cwd: root });
    expect(client.query("SELECT status,cwd FROM runs").get()).toEqual({
      status: "completed",
      cwd: root,
    });
    client.query("UPDATE automations SET project_id = 'p'").run();
    client.query("DELETE FROM projects WHERE id = 'p'").run();
    expect(client.query("SELECT project_id FROM sessions").get()).toEqual({
      project_id: null,
    });
    expect(client.query("SELECT project_id FROM automations").get()).toEqual({
      project_id: null,
    });
    expect(client.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    migrated.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("automation grouping is optional metadata and leaves YAML, directories, schedules, and history untouched", () => {
  const f = fixture();
  try {
    const first = f.app.createProject("First");
    const second = f.app.createProject("Second");
    const save = (name: string, cwd: string) =>
      f.app.automations.save({
        name,
        slug: name,
        cwd,
        steps: [{ name: "Check", provider: "codex", prompt: "Check" }],
      });
    const one = save("one", f.root),
      two = save("two", process.cwd());
    const original = readFileSync(one.file, "utf8");
    const upcoming = f.app.automations.upcoming();
    f.app.automations.assignProject(one.id, first.id);
    f.app.automations.assignProject(two.id, first.name);
    expect(f.app.automations.get(one.id).cwd).toBe(f.root);
    expect(f.app.automations.get(two.id).cwd).toBe(process.cwd());
    f.app.automations.assignProject(one.id, second.name);
    expect(f.app.automations.get(one.id).projectId).toBe(second.id);
    f.app.automations.sync(one.id);
    expect(f.app.automations.get(one.id).projectId).toBe(second.id);
    expect(() => f.app.automations.assignProject(one.id, "missing")).toThrow();
    expect(readFileSync(one.file, "utf8")).toBe(original);
    expect(f.app.automations.upcoming()).toEqual(upcoming);
    f.app.automations.assignProject(one.id);
    expect(f.app.automations.get(one.id).projectId).toBeNull();
    f.app.removeProject(first.id);
    expect(f.app.automations.get(two.id).projectId).toBeNull();
    expect(f.app.automations.list()).toHaveLength(2);
  } finally {
    f.close();
  }
});

test("CLI creates directory-free groups, filters automations, and validates assignment arguments", async () => {
  const f = fixture();
  const original = console.log;
  const output: unknown[] = [];
  console.log = (text: string) => output.push(JSON.parse(text));
  const run = (...args: string[]) =>
    commands(f.app).exitOverride().parseAsync(args, { from: "user" });
  try {
    await run(
      "projects",
      "create",
      "Business",
      "--description",
      "Organize work",
    );
    expect(f.app.project("Business").description).toBe("Organize work");
    const a = f.app.automations.save({
      name: "Job",
      slug: "job",
      cwd: f.root,
      steps: [{ name: "Check", provider: "codex", prompt: "Check" }],
    });
    await run("automations", "project", a.id, "Business");
    await run("automations", "list", "--project", "Business");
    expect(output.at(-1)).toEqual([f.app.automations.get(a.id)]);
    await expect(run("automations", "project", a.id)).rejects.toThrow(
      "Supply a project",
    );
    await expect(
      run("automations", "project", a.id, "Business", "--clear"),
    ).rejects.toThrow("exclusively");
    await run("automations", "project", a.id, "--clear");
    await run("automations", "list", "--project", "Business");
    expect(output.at(-1)).toEqual([]);
  } finally {
    console.log = original;
    f.close();
  }
});
