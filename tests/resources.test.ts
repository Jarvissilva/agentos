import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { McpService } from "../src/modules/mcps/service";
import { SkillService } from "../src/modules/skills/service";
import { fixture } from "./helpers";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanups.splice(0)) close();
});
function setup() {
  const f = fixture();
  cleanups.push(() => f.close());
  return {
    ...f,
    skills: new SkillService(f.storage.db, f.paths, f.root),
    mcps: new McpService(
      f.storage.db,
      f.root,
      join(f.root, "config"),
      join(f.root, "codex"),
    ),
  };
}

test("shared native skill links are owned, repairable, and never replace user skills", () => {
  const f = setup();
  const skill = f.skills.create(
    "seo",
    "SEO research",
    "Follow native selection.",
  );
  f.skills.install(skill.id, "codex");
  f.skills.install(skill.id, "opencode");
  expect(f.skills.links(skill.id)).toHaveLength(1);
  expect(f.skills.links(skill.id)[0]?.status).toBe("linked");
  const path = join(f.root, ".agents/skills/seo");
  expect(readlinkSync(path)).toContain("agentos/skills/seo");
  unlinkSync(path);
  f.skills.install(skill.id, "codex");
  unlinkSync(path);
  mkdirSync(path);
  expect(() => f.skills.remove(skill.id)).toThrow("externally modified");
  expect(existsSync(f.skills.file(skill.id))).toBe(true);
});
test("skill imports reject symlinks and deleting a skill removes only its owned links", () => {
  const f = setup();
  const s = f.skills.create("developer", "Build things", "Read the project.");
  f.skills.install(s.id, "agy");
  const other = join(f.root, ".gemini/antigravity-cli/skills/independent");
  mkdirSync(other);
  f.skills.remove(s.id);
  expect(existsSync(other)).toBe(true);
  const source = join(f.root, "source");
  mkdirSync(source);
  writeFileSync(
    join(source, "SKILL.md"),
    "---\nname: imported\ndescription: Example\n---\nWork carefully.\n",
  );
  symlinkSync("/etc/hosts", join(source, "escape"));
  expect(() => f.skills.import(source)).toThrow("regular files");
});
test("JSONC MCP installation, update, disable, and removal preserve native configuration", () => {
  const f = setup();
  const file = f.mcps.configPath("opencode");
  mkdirSync(join(file, ".."), { recursive: true });
  const native =
    '{\n // keep this comment\n "theme": "native", "mcp": {"independent": {"type":"local", "command":["example"]}}\n}';
  writeFileSync(file, native);
  const m = f.mcps.register({
    name: "example",
    transport: "stdio",
    command: "example",
    envRefs: { API_TOKEN: "API_TOKEN" },
  });
  f.mcps.install(m.id, "opencode");
  expect(readFileSync(file, "utf8")).toContain("keep this comment");
  expect(readFileSync(file, "utf8")).toContain("{env:API_TOKEN}");
  f.mcps.install(m.id, "opencode", false);
  expect(readFileSync(file, "utf8")).toContain('"enabled": false');
  f.mcps.uninstall(m.id, "opencode");
  const content = readFileSync(file, "utf8");
  expect(content).toContain('"independent"');
  expect(content).not.toContain('"agentos-example"');
  expect(content).toContain('"theme": "native"');
});
test("TOML MCP edits preserve unrelated tables and refuse externally changed entries", () => {
  const f = setup();
  const file = f.mcps.configPath("codex");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    '# original\nmodel = "native"\n[mcp_servers.independent]\ncommand = "other"\n',
  );
  const m = f.mcps.register({
    name: "research",
    transport: "http",
    url: "https://example.com/mcp",
    bearerEnv: "MCP_TOKEN",
  });
  f.mcps.install(m.id, "codex");
  const original = readFileSync(file, "utf8");
  expect(original).toContain("bearer_token_env_var");
  writeFileSync(
    file,
    original.replace("https://example.com/mcp", "https://changed.example/mcp"),
  );
  expect(f.mcps.installations(m.id)[0]?.status).toBe("conflict");
  expect(() => f.mcps.remove(m.id)).toThrow("modified");
  // Ownership survives application renaming: older managed TOML boundaries remain editable.
  writeFileSync(file, original.replaceAll("# agentos ", "# Agent OS "));
  f.mcps.install(m.id, "codex");
  expect(readFileSync(file, "utf8")).toContain("# agentos begin");
  expect(readFileSync(file, "utf8")).not.toContain("# Agent OS begin");
  f.mcps.uninstall(m.id, "codex");
  expect(readFileSync(file, "utf8")).toContain("[mcp_servers.independent]");
});
test("MCP credential literals and unverified interpolation are rejected", () => {
  const f = setup();
  expect(() =>
    f.mcps.register({
      name: "bad",
      transport: "stdio",
      command: "example",
      env: { TOKEN: "secret" },
    }),
  ).toThrow();
  expect(() =>
    f.mcps.register({
      name: "bad",
      transport: "stdio",
      command: "example",
      args: ["--token", "secret"],
    }),
  ).toThrow("credentials");
  const m = f.mcps.register({
    name: "remote",
    transport: "http",
    url: "https://example.com/mcp",
    bearerEnv: "TOKEN",
  });
  expect(() => f.mcps.install(m.id, "agy")).toThrow("not verified");
});

test("changed central MCP definitions are marked outdated until explicitly reapplied", () => {
  const f = setup();
  const m = f.mcps.register({
    name: "updatable",
    transport: "stdio",
    command: "original",
  });
  f.mcps.install(m.id, "opencode");
  expect(f.mcps.installations(m.id)[0]?.status).toBe("installed");
  f.mcps.update(m.id, {
    name: "updatable",
    transport: "stdio",
    command: "updated",
  });
  expect(f.mcps.installations(m.id)[0]?.status).toBe("outdated");
  f.mcps.install(m.id, "opencode");
  expect(f.mcps.installations(m.id)[0]?.status).toBe("installed");
});
