import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseAgent } from "../src/app";
import { appPaths } from "../src/lib/platform/paths";
import { openDatabase } from "../src/lib/storage/database";
import { fixture } from "./helpers";

const fixtures: ReturnType<typeof fixture>[] = [];
const setup = () => {
  const f = fixture();
  fixtures.push(f);
  return f;
};
afterEach(() => {
  for (const f of fixtures.splice(0)) f.close();
});

test("respects absolute XDG directories and ignores relative XDG values", () => {
  const paths = appPaths({
    HOME: "/tmp/example",
    XDG_DATA_HOME: "relative",
    XDG_CONFIG_HOME: "/tmp/config",
  });
  expect(paths.data).toBe("/tmp/example/.local/share/agentos");
  expect(paths.config).toBe("/tmp/config/agentos");
});

test("migrations are repeatable, data persists, and database permissions are private", () => {
  const f = setup();
  f.app.createProject("Example");
  const second = openDatabase(f.paths);
  try {
    expect(second.db.$client.query("SELECT name FROM projects").get()).toEqual({
      name: "Example",
    });
    expect(statSync(f.paths.database).mode & 0o777).toBe(0o600);
    expect(statSync(f.paths.data).mode & 0o777).toBe(0o700);
  } finally {
    second.close();
  }
});

test("projects are directory-free groups, edits validate, and removal preserves files", () => {
  const f = setup();
  const p = f.app.createProject("Project", "A business group");
  expect(p).not.toHaveProperty("cwd");
  expect(p.description).toBe("A business group");
  expect(() => f.app.createProject("Project")).toThrow();
  expect(() => f.app.updateProject(p.id, { name: "" })).toThrow();
  f.app.updateProject(p.id, { name: "Renamed", description: "Updated" });
  expect(f.app.project(p.id).description).toBe("Updated");
  f.app.createProject("Another group");
  f.app.removeProject(p.id);
  expect(existsSync(f.paths.data)).toBe(true);
  expect(f.app.listProjects()).toHaveLength(1);
});

test("an older application refuses a database migrated by a newer version", () => {
  const f = setup();
  f.storage.db.$client
    .query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
    .run("future", Date.now() + 1_000_000_000);
  expect(() => openDatabase(f.paths)).toThrow("newer agentos version");
});

test("Markdown agents preserve instructions, reflect file edits, and clean up failed creates", () => {
  const f = setup();
  const a = f.app.createAgent(
    "Developer",
    "# Instructions\n\nFollow the repository rules.",
  );
  const file = f.app.agentFile(a.id);
  const content = readFileSync(file, "utf8");
  expect(parseAgent(content).instructions).toBe(
    "# Instructions\n\nFollow the repository rules.",
  );
  expect(() => f.app.createAgent("Developer", "duplicate")).toThrow();
  writeFileSync(file, content.replace("Developer", "Maintainer"));
  f.app.syncAgent(a.id);
  expect(f.app.agent("Maintainer").id).toBe(a.id);
  unlinkSync(file);
  symlinkSync("/etc/hosts", file);
  expect(() => f.app.agentDefinition(a.id)).toThrow("regular file");
});

test("invalid agent definitions and unsafe names fail explicitly", () => {
  expect(() => parseAgent("No frontmatter")).toThrow();
  expect(() => parseAgent("---\nname: Example\n---\n   ")).toThrow();
  const f = setup();
  expect(() => f.app.createProject("bad\u001bname")).toThrow();
});

test("agentos reuses legacy storage locations without moving databases or references", () => {
  const f = setup();
  const dataRoot = join(f.root, "legacy-data");
  const configRoot = join(f.root, "legacy-config");
  const cacheRoot = join(f.root, "legacy-cache");
  for (const root of [dataRoot, configRoot, cacheRoot])
    mkdirSync(join(root, "agent-os"), { recursive: true });
  const database = join(dataRoot, "agent-os", "agent-os.db");
  writeFileSync(database, "existing database");
  const paths = appPaths({
    HOME: f.root,
    XDG_DATA_HOME: dataRoot,
    XDG_CONFIG_HOME: configRoot,
    XDG_CACHE_HOME: cacheRoot,
  });
  expect(paths.data).toBe(join(dataRoot, "agent-os"));
  expect(paths.config).toBe(join(configRoot, "agent-os"));
  expect(paths.cache).toBe(join(cacheRoot, "agent-os"));
  expect(paths.database).toBe(database);
  expect(paths.agents).toBe(join(dataRoot, "agent-os", "agents"));
  expect(readFileSync(database, "utf8")).toBe("existing database");
  expect(existsSync(join(dataRoot, "agentos"))).toBe(false);
});
