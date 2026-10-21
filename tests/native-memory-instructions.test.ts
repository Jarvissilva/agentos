import { afterEach, expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
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
  return {
    ...f,
    memory: new MemoryService(
      f.paths,
      f.root,
      join(f.root, "native-config"),
      join(f.root, "native-codex"),
    ),
  };
}
for (const provider of ["codex", "opencode", "agy"] as const) {
  test(`${provider} native memory installation preserves instructions and is idempotent`, () => {
    const f = setup();
    const path = f.memory.nativePath(provider);
    expect(existsSync(path)).toBe(false);
    mkdirSync(dirname(path), { recursive: true });
    const original = "# Existing rules\n\nKeep my instructions exactly.";
    writeFileSync(path, original, { mode: 0o600 });
    expect(f.memory.installNative(provider)).toEqual({
      provider,
      path,
      status: "installed",
    });
    const installed = readFileSync(path, "utf8");
    expect(installed).toStartWith(`${original}\n\n`);
    expect(installed).toContain(f.memory.instructions());
    expect(installed).toContain('collection "agentos"');
    f.memory.installNative(provider);
    expect(readFileSync(path, "utf8")).toBe(installed);
    expect(installed.match(/<!-- agentos memory begin -->/g)).toHaveLength(1);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    writeFileSync(
      path,
      installed.replace("Before working", "My edited rule before working"),
    );
    const modified = readFileSync(path, "utf8");
    expect(() => f.memory.installNative(provider)).toThrow(
      "instructions differ",
    );
    expect(readFileSync(path, "utf8")).toBe(modified);
  });
}

test("native instruction paths use explicit provider roots and prefer nonempty Codex overrides", () => {
  const f = setup();
  expect(f.memory.nativePath("codex")).toBe(
    join(f.root, "native-codex", "AGENTS.md"),
  );
  expect(f.memory.nativePath("opencode")).toBe(
    join(f.root, "native-config", "opencode", "AGENTS.md"),
  );
  expect(f.memory.nativePath("agy")).toBe(join(f.root, ".gemini", "GEMINI.md"));
  const override = join(f.root, "native-codex", "AGENTS.override.md");
  mkdirSync(dirname(override));
  writeFileSync(override, " \n");
  expect(f.memory.nativePath("codex")).toEndWith("/AGENTS.md");
  writeFileSync(override, "My override rules");
  f.memory.installNative("codex");
  expect(readFileSync(override, "utf8")).toStartWith("My override rules");
  expect(readFileSync(override, "utf8")).toContain("## AgentOS memory");
  expect(existsSync(join(dirname(override), "AGENTS.md"))).toBe(false);
});

for (const text of [
  "<!-- agentos memory begin -->\nunfinished",
  "<!-- agentos memory end -->",
  "<!-- agentos memory begin --><!-- agentos memory end --><!-- agentos memory begin -->",
]) {
  test("malformed managed blocks are preserved and rejected", () => {
    const f = setup();
    const path = f.memory.nativePath("opencode");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    expect(() => f.memory.installNative("opencode")).toThrow(
      "instructions differ",
    );
    expect(readFileSync(path, "utf8")).toBe(text);
  });
}

test("native instruction installation refuses symbolic links and unknown providers", () => {
  const f = setup();
  const path = f.memory.nativePath("agy");
  const outside = join(f.root, "outside.md");
  writeFileSync(outside, "Do not change");
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(outside, path);
  expect(() => f.memory.installNative("agy")).toThrow("regular file");
  expect(readFileSync(outside, "utf8")).toBe("Do not change");
  expect(() => f.memory.installNative("unknown")).toThrow("Unknown provider");
});

test("CLI explicitly installs native memory rules without exposing them in task prompts", async () => {
  const f = setup();
  const installer = spyOn(
    f.app,
    "installMemoryInstructions",
  ).mockImplementation((provider) => f.memory.installNative(provider));
  const output: string[] = [];
  const log = spyOn(console, "log").mockImplementation((text) =>
    output.push(text),
  );
  cleanups.push(
    () => installer.mockRestore(),
    () => log.mockRestore(),
  );
  await commands(f.app)
    .exitOverride()
    .parseAsync(["memory", "install", "opencode"], { from: "user" });
  expect(JSON.parse(output[0] ?? "")).toEqual({
    provider: "opencode",
    path: f.memory.nativePath("opencode"),
    status: "installed",
  });
  expect(readFileSync(f.memory.nativePath("opencode"), "utf8")).toContain(
    f.memory.instructions(),
  );
});
