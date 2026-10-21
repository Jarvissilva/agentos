import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseAgent } from "../src/core/application";
import { appPaths } from "../src/platform/paths";
import { openDatabase } from "../src/storage/database";
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
  expect(paths.data).toBe("/tmp/example/.local/share/agent-os");
  expect(paths.config).toBe("/tmp/config/agent-os");
});

test("migrations are repeatable, data persists, and database permissions are private", () => {
  const f = setup();
  f.app.createProject("Example", f.root);
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

test("project paths are canonical, edits validate, removal preserves files", () => {
  const f = setup();
  const alias = join(f.root, "alias");
  symlinkSync(f.paths.data, alias);
  const p = f.app.createProject("Project", alias);
  expect(p.cwd).toBe(f.paths.data);
  expect(() => f.app.createProject("Duplicate", f.paths.data)).toThrow();
  expect(() =>
    f.app.updateProject(p.id, { cwd: "/missing-agentos-directory" }),
  ).toThrow();
  f.app.updateProject(p.id, { name: "Renamed" });
  f.app.removeProject(p.id);
  expect(existsSync(f.paths.data)).toBe(true);
  expect(f.app.listProjects()).toHaveLength(0);
});

test("an older application refuses a database migrated by a newer version", () => {
  const f = setup();
  f.storage.db.$client
    .query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
    .run("future", Date.now() + 1_000_000_000);
  expect(() => openDatabase(f.paths)).toThrow("newer Agent OS version");
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
  expect(() => f.app.createProject("bad\u001bname", f.root)).toThrow();
});
