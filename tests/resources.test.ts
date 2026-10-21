import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import * as TOML from "@iarna/toml";
import { applyEdits, modify, parse } from "jsonc-parser";
import { nativeConfiguration } from "../src/lib/providers/configuration";
import type { ProviderId } from "../src/lib/providers/types";
import { mcpInstalls } from "../src/lib/storage/schema";
import { translateMcp } from "../src/modules/mcps/configuration";
import { entryFingerprint, McpService } from "../src/modules/mcps/service";
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

const providers: ProviderId[] = ["codex", "opencode", "agy"];
function nativeEntries(file: string, provider: ProviderId) {
  const text = readFileSync(file, "utf8");
  const doc = provider === "codex" ? TOML.parse(text) : parse(text);
  return (doc[nativeConfiguration(provider).section] ?? {}) as Record<
    string,
    unknown
  >;
}

function legacyInstallation(f: ReturnType<typeof setup>, provider: ProviderId) {
  const mcp = f.mcps.register({
    name: "research",
    transport: "stdio",
    command: "example",
  });
  const entry = "agentos-research";
  const file = f.mcps.configPath(provider);
  const value = {
    ...translateMcp(f.mcps.get(mcp.id).definition, provider),
    ...(provider === "agy" ? { disabled: false } : { enabled: true }),
  };
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    provider === "codex"
      ? `# keep this comment\nmodel = "native"\n[mcp_servers.independent]\ncommand = "other"\n\n# Agent OS begin ${entry}\n${TOML.stringify({ mcp_servers: { [entry]: value } } as TOML.JsonMap)}# Agent OS end ${entry}\n`
      : `{
  // keep this comment
  "theme": "native",
  "${nativeConfiguration(provider).section}": {
    "independent": {"command": "other"},
    "${entry}": ${JSON.stringify(value)}
  }
}\n`,
  );
  // Seed the installation record produced by releases that prefixed MCP names.
  f.storage.db
    .insert(mcpInstalls)
    .values({
      id: "legacy-install",
      mcpId: mcp.id,
      provider,
      path: file,
      entry,
      fingerprint: entryFingerprint(value),
    })
    .run();
  return { mcp, file, entry, value };
}

function addExternalEntry(
  file: string,
  provider: ProviderId,
  name: string,
  value: Record<string, unknown>,
) {
  const original = readFileSync(file, "utf8");
  writeFileSync(
    file,
    provider === "codex"
      ? original +
          TOML.stringify({ mcp_servers: { [name]: value } } as TOML.JsonMap)
      : applyEdits(
          original,
          modify(
            original,
            [nativeConfiguration(provider).section, name],
            value,
            {},
          ),
        ),
  );
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
  expect(f.skills.links(skill.id)[0]?.path).toBe(path);
  expect(existsSync(join(f.root, ".agents/skills/agentos-seo"))).toBe(false);
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
  expect(nativeEntries(file, "opencode")).not.toHaveProperty("example");
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

test.each(providers)(
  "%s installs exact MCP names, including intentional prefixes",
  (provider) => {
    const f = setup();
    for (const name of ["research", "agentos-research"]) {
      const m = f.mcps.register({
        name,
        transport: "stdio",
        command: "example",
      });
      f.mcps.install(m.id, provider);
      f.mcps.install(m.id, provider);
      const entries = nativeEntries(f.mcps.configPath(provider), provider);
      expect(entries).toHaveProperty(name);
      expect(entries).not.toHaveProperty(`agentos-${name}`);
      expect(f.mcps.installations(m.id)).toHaveLength(1);
      expect(f.mcps.installations(m.id)[0]?.entry).toBe(name);
      expect(f.mcps.installations(m.id)[0]?.status).toBe("installed");
      f.mcps.uninstall(m.id, provider);
      expect(
        nativeEntries(f.mcps.configPath(provider), provider),
      ).not.toHaveProperty(name);
    }
  },
);

test.each(providers)(
  "%s renames legacy MCPs on install/disable and retains ownership",
  (provider) => {
    const f = setup();
    const { mcp, file, entry } = legacyInstallation(f, provider);
    expect(f.mcps.installations(mcp.id)[0]?.status).toBe("outdated");
    f.mcps.install(mcp.id, provider, false);
    const entries = nativeEntries(file, provider);
    expect(entries).not.toHaveProperty(entry);
    expect(entries.research).toEqual({
      ...translateMcp(f.mcps.get(mcp.id).definition, provider),
      ...(provider === "agy" ? { disabled: true } : { enabled: false }),
    });
    const record = f.mcps.installations(mcp.id)[0];
    expect(record?.id).toBe("legacy-install");
    expect(record?.entry).toBe("research");
    expect(record?.path).toBe(file);
    expect(record?.fingerprint).toBe(entryFingerprint(entries.research));
    expect(record?.status).toBe("installed");
    f.mcps.install(mcp.id, provider, true);
    const enabled = nativeEntries(file, provider).research;
    expect(enabled).toHaveProperty(
      provider === "agy" ? "disabled" : "enabled",
      provider !== "agy",
    );
    f.mcps.uninstall(mcp.id, provider);
    expect(nativeEntries(file, provider)).toEqual({
      independent: { command: "other" },
    });
    expect(readFileSync(file, "utf8")).toContain("keep this comment");
    expect(readFileSync(file, "utf8")).toContain(
      provider === "codex" ? 'model = "native"' : '"theme": "native"',
    );
    expect(f.mcps.installations(mcp.id)).toHaveLength(0);
  },
);

test.each(providers)(
  "%s can uninstall legacy MCPs before renaming",
  (provider) => {
    const f = setup();
    const { mcp, file, entry } = legacyInstallation(f, provider);
    f.mcps.uninstall(mcp.id, provider);
    expect(nativeEntries(file, provider)).not.toHaveProperty(entry);
    expect(f.mcps.installations(mcp.id)).toHaveLength(0);
  },
);

test.each(providers)(
  "%s refuses matching external destinations without removing legacy MCPs",
  (provider) => {
    const f = setup();
    const { mcp, file, value } = legacyInstallation(f, provider);
    addExternalEntry(file, provider, "research", value);
    const original = readFileSync(file, "utf8");
    const record = f.mcps.installations(mcp.id)[0];
    expect(() => f.mcps.install(mcp.id, provider)).toThrow(
      "exists or was modified",
    );
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(f.mcps.installations(mcp.id)[0]).toEqual(record);
    // A matching external entry is also protected without an old installation.
    f.mcps.uninstall(mcp.id, provider);
    const external = readFileSync(file, "utf8");
    expect(() => f.mcps.install(mcp.id, provider)).toThrow(
      "exists or was modified",
    );
    expect(readFileSync(file, "utf8")).toBe(external);
    expect(f.mcps.installations(mcp.id)).toHaveLength(0);
  },
);

test.each(providers)(
  "%s preserves externally modified legacy MCPs",
  (provider) => {
    const f = setup();
    const { mcp, file } = legacyInstallation(f, provider);
    const changed = readFileSync(file, "utf8").replaceAll(
      "example",
      "changed-command",
    );
    writeFileSync(file, changed);
    expect(f.mcps.installations(mcp.id)[0]?.status).toBe("conflict");
    expect(() => f.mcps.install(mcp.id, provider)).toThrow(
      "modified externally",
    );
    expect(() => f.mcps.uninstall(mcp.id, provider)).toThrow(
      "modified externally",
    );
    expect(readFileSync(file, "utf8")).toBe(changed);
    expect(f.mcps.installations(mcp.id)[0]?.entry).toBe("agentos-research");
  },
);

test.each(providers)(
  "%s restores a missing legacy MCP using its exact name",
  (provider) => {
    const f = setup();
    const { mcp, file } = legacyInstallation(f, provider);
    unlinkSync(file);
    expect(f.mcps.installations(mcp.id)[0]?.status).toBe("missing");
    f.mcps.install(mcp.id, provider);
    expect(Object.keys(nativeEntries(file, provider))).toEqual(["research"]);
    expect(f.mcps.installations(mcp.id)[0]?.status).toBe("installed");
  },
);

test.each(providers)(
  "%s keeps legacy installation metadata when config is malformed or cannot be written",
  (provider) => {
    const f = setup();
    const { mcp, file } = legacyInstallation(f, provider);
    const original = readFileSync(file, "utf8");
    writeFileSync(file, "{invalid");
    expect(() => f.mcps.install(mcp.id, provider)).toThrow();
    expect(readFileSync(file, "utf8")).toBe("{invalid");
    expect(f.mcps.installations(mcp.id)[0]?.entry).toBe("agentos-research");
    writeFileSync(file, original);
    const target = join(f.root, "external-config");
    renameSync(file, target);
    symlinkSync(target, file);
    expect(() => f.mcps.install(mcp.id, provider)).toThrow("non-regular file");
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(f.mcps.installations(mcp.id)[0]?.entry).toBe("agentos-research");
    expect(existsSync(`${file}.agentos-lock`)).toBe(false);
  },
);

test.each(providers)(
  "%s rolls back config renames if installation metadata cannot be saved",
  (provider) => {
    const f = setup();
    const { mcp, file } = legacyInstallation(f, provider);
    const original = readFileSync(file, "utf8");
    const record = f.mcps.installations(mcp.id)[0];
    f.storage.db.$client.exec(
      "CREATE TRIGGER reject_mcp_update BEFORE UPDATE ON mcp_installs BEGIN SELECT RAISE(ABORT, 'test metadata failure'); END",
    );
    expect(() => f.mcps.install(mcp.id, provider)).toThrow(
      "test metadata failure",
    );
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(f.mcps.installations(mcp.id)[0]).toEqual(record);
    expect(existsSync(`${file}.agentos-lock`)).toBe(false);
  },
);

test("failed first-install metadata writes do not leave a native configuration behind", () => {
  const f = setup();
  const m = f.mcps.register({
    name: "research",
    transport: "stdio",
    command: "example",
  });
  const file = f.mcps.configPath("codex");
  f.storage.db.$client.exec(
    "CREATE TRIGGER reject_mcp_insert BEFORE INSERT ON mcp_installs BEGIN SELECT RAISE(ABORT, 'test metadata failure'); END",
  );
  expect(() => f.mcps.install(m.id, "codex")).toThrow("test metadata failure");
  expect(existsSync(file)).toBe(false);
  expect(f.mcps.installations(m.id)).toHaveLength(0);
});

test("legacy TOML rename refuses unrelated changes inside the managed block", () => {
  const f = setup();
  const { mcp, file, entry } = legacyInstallation(f, "codex");
  const changed = readFileSync(file, "utf8").replace(
    `# Agent OS end ${entry}`,
    `[features]\nindependent = true\n# Agent OS end ${entry}`,
  );
  writeFileSync(file, changed);
  expect(() => f.mcps.install(mcp.id, "codex")).toThrow("unrelated changes");
  expect(readFileSync(file, "utf8")).toBe(changed);
  expect(f.mcps.installations(mcp.id)[0]?.entry).toBe(entry);
});
