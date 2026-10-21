import { afterEach, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { commands } from "../src/cli/commands";
import { fixture } from "./helpers";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function setup() {
  const f = fixture();
  cleanups.push(() => f.close());
  return f;
}

test("project memory is private, stable on rename, and isolated from other project names", () => {
  const f = setup();
  const first = f.app.createProject("../work / 💡");
  const second = f.app.createProject("work");
  const memory = f.app.projectMemory(first.name);
  expect(memory).toEqual({
    project: "agentos",
    root: join(f.paths.data, "memory"),
    directory: `projects/${first.id}`,
    path: join(f.paths.data, "memory", "projects", first.id),
  });
  expect(statSync(memory.path).mode & 0o777).toBe(0o700);
  expect(statSync(memory.root).mode & 0o777).toBe(0o700);
  expect(statSync(join(memory.root, "projects")).mode & 0o777).toBe(0o700);
  writeFileSync(join(memory.path, "decision.md"), "A durable decision");
  f.app.updateProject(first.id, { name: "Renamed" });
  expect(f.app.projectMemory("Renamed")).toEqual(memory);
  expect(readdirSync(f.app.projectMemory(second.id).path)).toEqual([]);
  expect(() => f.app.createProject("Renamed")).toThrow();
  expect(readdirSync(join(memory.root, "projects"))).toHaveLength(2);
  expect(readdirSync(f.root).sort()).toEqual(["cache", "config", "data"]);
});

test("deleting a project preserves its memories and reusing its name starts with a new folder", () => {
  const f = setup();
  const first = f.app.createProject("Work");
  const memory = f.app.projectMemory(first.id);
  const note = join(memory.path, "decision.md");
  writeFileSync(note, "Keep this memory");
  f.app.removeProject(first.id);
  expect(readFileSync(note, "utf8")).toBe("Keep this memory");
  const next = f.app.createProject("Work");
  expect(f.app.projectMemory(next.id).path).not.toBe(memory.path);
  expect(readdirSync(f.app.projectMemory(next.id).path)).toEqual([]);
  expect(() => f.app.projectMemory(first.id)).toThrow("Project not found");
});

for (const obstruction of ["file", "root-link", "projects-link"] as const) {
  test(`memory ${obstruction} fails creation without leaving project metadata or writing outside storage`, () => {
    const f = setup();
    const root = join(f.paths.data, "memory");
    rmdirSync(join(root, "global"));
    rmdirSync(root);
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    if (obstruction === "file") writeFileSync(root, "untouched");
    else if (obstruction === "root-link") symlinkSync(outside, root);
    else {
      mkdirSync(root);
      symlinkSync(outside, join(root, "projects"));
    }
    expect(() => f.app.createProject("Blocked")).toThrow("Memory path");
    expect(f.app.listProjects()).toEqual([]);
    expect(readdirSync(outside)).toEqual([]);
    if (obstruction === "file")
      expect(readFileSync(root, "utf8")).toBe("untouched");
  });
}

test("CLI project creation prepares memory and memory command exposes its location without writing notes", async () => {
  const f = setup();
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((text) =>
    output.push(text),
  );
  cleanups.push(() => log.mockRestore());
  const run = (...args: string[]) =>
    commands(f.app).exitOverride().parseAsync(args, { from: "user" });
  await run("projects", "create", "Work");
  const memory = f.app.projectMemory("Work");
  expect(existsSync(memory.path)).toBe(true);
  await run("projects", "memory", "Work");
  expect(JSON.parse(output.at(-1) ?? "")).toEqual(memory);
  expect(readdirSync(memory.path)).toEqual([]);
  await run("projects", "remove", "Work", "--yes");
  expect(existsSync(memory.path)).toBe(true);
});
