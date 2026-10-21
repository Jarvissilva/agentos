import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import * as TOML from "@iarna/toml";
import { EmbeddedTerminalRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { parse } from "jsonc-parser";
import {
  configureProviderThemes,
  providerThemeSequence,
} from "../src/tui/provider-theme";

test("provider themes preserve native settings, comments, modes and custom paths", () => {
  const home = mkdtempSync("/tmp/agentos-theme-");
  const env = {
    HOME: home,
    CODEX_HOME: join(home, "codex"),
    XDG_CONFIG_HOME: join(home, "config"),
  };
  const codex = join(env.CODEX_HOME, "config.toml");
  const openCode = join(env.XDG_CONFIG_HOME, "opencode/cli.json");
  const agy = join(home, ".gemini/antigravity-cli/settings.json");
  try {
    for (const file of [codex, openCode, agy])
      mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(
      codex,
      '# keep\nmodel = "existing"\n[tui]\ntheme = "old"\nnotifications = false\n[other]\nenabled = true\n',
      { mode: 0o640 },
    );
    writeFileSync(
      openCode,
      '{\n// keep\n"theme":{"name":"old","mode":"light","other":true},"keybinds":{"foo":"bar"}\n}',
      { mode: 0o600 },
    );
    writeFileSync(agy, '{"agentMode":"plan", "colorScheme":"light"}', {
      mode: 0o600,
    });
    configureProviderThemes(env);
    expect(TOML.parse(readFileSync(codex, "utf8"))).toEqual({
      model: "existing",
      tui: { theme: "agentos", notifications: false },
      other: { enabled: true },
    });
    expect(readFileSync(codex, "utf8")).toContain("# keep");
    expect(readFileSync(openCode, "utf8")).toContain("// keep");
    expect(parse(readFileSync(openCode, "utf8"))).toEqual({
      theme: { name: "system", mode: "dark", other: true },
      keybinds: { foo: "bar" },
    });
    expect(JSON.parse(readFileSync(agy, "utf8"))).toEqual({
      agentMode: "plan",
      colorScheme: "terminal",
    });
    expect(statSync(codex).mode & 0o777).toBe(0o640);
    const syntax = join(env.CODEX_HOME, "themes/agentos.tmTheme");
    expect(statSync(syntax).mode & 0o777).toBe(0o600);
    expect(readFileSync(syntax, "utf8")).toContain("#b4cff1");
    const first = [codex, openCode, agy].map((file) =>
      readFileSync(file, "utf8"),
    );
    configureProviderThemes(env);
    expect(
      [codex, openCode, agy].map((file) => readFileSync(file, "utf8")),
    ).toEqual(first);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("provider theme setup creates private settings and refuses malformed settings", () => {
  const home = mkdtempSync("/tmp/agentos-theme-");
  try {
    const files = configureProviderThemes({ HOME: home });
    for (const file of files) expect(statSync(file).mode & 0o777).toBe(0o600);
    const config = files[0];
    writeFileSync(
      config,
      'tui = { theme = "original", notifications = true }\n',
    );
    expect(() => configureProviderThemes({ HOME: home })).toThrow();
    expect(readFileSync(config, "utf8")).toBe(
      'tui = { theme = "original", notifications = true }\n',
    );
    writeFileSync(config, "");
    const openCode = files[1];
    writeFileSync(openCode, '{"broken":');
    expect(() => configureProviderThemes({ HOME: home })).toThrow(
      "Invalid settings",
    );
    expect(readFileSync(openCode, "utf8")).toBe('{"broken":');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("embedded providers discover the host foreground, background and ANSI accent", async () => {
  const { renderer } = await createTestRenderer({ width: 30, height: 6 });
  let response = "";
  const terminal = new EmbeddedTerminalRenderable(renderer, {
    width: 30,
    height: 6,
    onData: (bytes) => {
      response += new TextDecoder().decode(bytes);
    },
  });
  try {
    renderer.root.add(terminal);
    terminal.write(providerThemeSequence);
    terminal.write("\x1b]10;?\x07\x1b]11;?\x07\x1b]4;4;?\x07");
    expect(response).toContain("10;rgb:e8e8/eeee/f8f8");
    expect(response).toContain("11;rgb:0404/0707/0d0d");
    expect(response).toContain("4;4;rgb:b4b4/cfcf/f1f1");
  } finally {
    renderer.destroy();
  }
});
