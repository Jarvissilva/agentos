import { afterEach, expect, spyOn, test } from "bun:test";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Application } from "../src/app";
import { commands } from "../src/cli/commands";
import { MemoryService } from "../src/modules/memory/service";
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

test("global memory is prepared once at startup and reused without replacing existing notes", () => {
  const f = setup();
  const memory = f.app.globalMemory();
  expect(memory).toEqual({
    project: "agentos",
    root: join(f.paths.data, "memory"),
    directory: "global",
    path: join(f.paths.data, "memory", "global"),
  });
  expect(statSync(memory.path).mode & 0o777).toBe(0o700);
  expect(readdirSync(memory.path)).toEqual([]);
  const note = join(memory.path, "preferences.md");
  writeFileSync(note, "Shared preference");
  const reopened = new Application(f.storage.db, f.paths);
  expect(reopened.globalMemory()).toEqual(memory);
  expect(readFileSync(note, "utf8")).toBe("Shared preference");
  const project = reopened.createProject("Work");
  reopened.updateProject(project.id, { name: "Renamed" });
  reopened.removeProject(project.id);
  expect(readFileSync(note, "utf8")).toBe("Shared preference");
});

test("native rules describe both scopes while launch context contains only project metadata", () => {
  const f = setup();
  const service = new MemoryService(f.paths);
  const rules = service.instructions();
  expect(rules).toContain(f.app.globalMemory().root);
  expect(rules).toContain('collection "agentos"');
  expect(rules).toContain("global memory only");
  expect(rules).toContain("respecting native permissions");
  expect(rules).toContain(
    "Do not copy project-specific details into global memory unless explicitly requested.",
  );
  expect(service.sessionContext()).toBeUndefined();
  const project = f.app.createProject("Work");
  const context = service.sessionContext(project);
  expect(
    JSON.parse(context?.replace("agentos memory context: ", "") ?? ""),
  ).toEqual({
    projectId: project.id,
    projectName: project.name,
    memoryRoot: f.app.globalMemory().root,
    projectDirectory: `projects/${project.id}`,
  });
  expect(context).not.toContain("Before working");
  expect(readdirSync(f.app.globalMemory().path)).toEqual([]);
  expect(readdirSync(f.app.projectMemory(project.id).path)).toEqual([]);
});

for (const kind of ["file", "symlink"] as const) {
  test(`a ${kind} at the global directory is rejected without overwriting data`, () => {
    const f = setup();
    const path = f.app.globalMemory().path;
    rmdirSync(path);
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    if (kind === "file") writeFileSync(path, "untouched");
    else symlinkSync(outside, path);
    expect(() => new Application(f.storage.db, f.paths)).toThrow("Memory path");
    expect(readdirSync(outside)).toEqual([]);
    if (kind === "file") expect(readFileSync(path, "utf8")).toBe("untouched");
  });
}

test("CLI exposes the global location without creating notes", async () => {
  const f = setup();
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((text) =>
    output.push(text),
  );
  cleanups.push(() => log.mockRestore());
  await commands(f.app).exitOverride().parseAsync(["memory"], { from: "user" });
  expect(JSON.parse(output[0] ?? "")).toEqual(f.app.globalMemory());
  expect(readdirSync(f.app.globalMemory().path)).toEqual([]);
});
