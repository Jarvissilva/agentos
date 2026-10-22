import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const installer = resolve(import.meta.dir, "../scripts/install.sh");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture(options: { bun?: boolean; missing?: string } = {}) {
  const root = mkdtempSync("/tmp/agentos-installer-");
  roots.push(root);
  // Exercise shell quoting without allowing command substitutions to execute.
  const home = join(root, "home with spaces ' $dollar `literal`");
  const bin = join(root, "bin");
  const release = join(root, "release");
  for (const path of [home, bin, release]) mkdirSync(path);
  for (const tool of [
    "bash",
    "uname",
    "tar",
    "gzip",
    "stty",
    "setsid",
    "unzip",
    "mkdir",
    "mktemp",
    "rm",
    "rmdir",
    "chmod",
    "mv",
    "ln",
    "cat",
  ]) {
    if (tool !== options.missing)
      symlinkSync(`/usr/bin/${tool}`, join(bin, tool));
  }
  const script = (name: string, content: string) =>
    writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${content}\n`, {
      mode: 0o755,
    });
  const bunScript = `#!/bin/bash
set -eu
case "$1" in
  */runtime.ts|*/installation.ts) exec "$TEST_REAL_BUN" "$@" ;;
  --version) printf '%s\\n' "\${TEST_BUN_VERSION:-1.4.3}" ;;
  install)
    [[ "$2" == --frozen-lockfile ]]
    [[ -f package.json && -f bun.lock ]]
    [[ "\${TEST_INSTALL_FAIL:-}" != 1 ]]
    mkdir node_modules
    ;;
  *)
    printf '%s\\n' "$PWD" "$@" > "$TEST_LAUNCH_LOG"
    ;;
esac
`;
  const bunFixture = join(root, "fake-bun");
  writeFileSync(bunFixture, bunScript, { mode: 0o755 });
  if (options.bun !== false) symlinkSync(bunFixture, join(bin, "bun"));
  const bootstrap = join(root, "bootstrap.sh");
  writeFileSync(
    bootstrap,
    `#!/bin/bash
[[ "$1" == bun-v1.4.3 ]] || exit 1
mkdir -p "$BUN_INSTALL/bin"
cat "$TEST_BUN_FIXTURE" > "$BUN_INSTALL/bin/bun"
chmod 755 "$BUN_INSTALL/bin/bun"
`,
  );
  for (const file of [
    "package.json",
    "bun.lock",
    "src/index.ts",
    "src/tui/app.tsx",
    "src/lib/platform/installation.ts",
    "src/lib/storage/migrations/meta/_journal.json",
  ]) {
    const path = join(release, "agentos-0.1.0", file);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(
      path,
      file === "package.json"
        ? JSON.stringify({ name: "agentos", version: "0.1.0" })
        : file === "src/lib/platform/installation.ts"
          ? readFileSync(resolve("src/lib/platform/installation.ts"), "utf8")
          : "{}",
    );
  }
  const archive = join(root, "release.tar.gz");
  const tar = Bun.spawnSync([
    "/usr/bin/tar",
    "-czf",
    archive,
    "-C",
    release,
    "agentos-0.1.0",
  ]);
  expect(tar.exitCode).toBe(0);
  script(
    "curl",
    `output=
url=
while (($#)); do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --write-out|--proto|--proto-redir) shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$TEST_DOWNLOAD_LOG"
case "$url" in
  */releases/latest) printf 'https://github.com/example/agentos/releases/tag/v0.1.0' ;;
  */archive/refs/tags/*.tar.gz)
    if [[ "\${TEST_DOWNLOAD_FAIL:-}" == 1 ]]; then
      printf 'partial download' > "$output"
      exit 22
    fi
    cat "$TEST_ARCHIVE" > "$output"
    ;;
  https://bun.sh/install) cat "$TEST_BOOTSTRAP" > "$output" ;;
  *) exit 22 ;;
esac`,
  );
  const env = {
    HOME: home,
    PATH: bin,
    SHELL: "/bin/bash",
    TEST_ARCHIVE: archive,
    TEST_REAL_BUN: process.execPath,
    TEST_BOOTSTRAP: bootstrap,
    TEST_BUN_FIXTURE: bunFixture,
    TEST_LAUNCH_LOG: join(root, "launch.log"),
    TEST_DOWNLOAD_LOG: join(root, "downloads.log"),
  };
  return {
    root,
    home,
    bin,
    env,
    command: join(home, ".local/bin/agentos"),
    installation: join(home, ".local/lib/agentos"),
    run(extra: Record<string, string> = {}, args: string[] = []) {
      const result = Bun.spawnSync(["/bin/bash", installer, ...args], {
        env: { ...env, ...extra },
        cwd: root,
      });
      return {
        code: result.exitCode,
        output: result.stdout.toString() + result.stderr.toString(),
      };
    },
    expectClean() {
      const lib = join(home, ".local/lib");
      if (existsSync(lib)) expect(readdirSync(lib)).toEqual([]);
      expect(existsSync(join(home, ".local/bin/agentos"))).toBe(false);
    },
  };
}

test("installs a release and preserves launcher cwd and arguments", () => {
  const f = fixture();
  const result = f.run();
  expect(result.code).toBe(0);
  expect(result.output).toContain('export PATH="$HOME/.local/bin:$PATH"');
  expect(result.output).toContain("Install Codex, OpenCode, or Agy");
  expect(existsSync(join(f.installation, "node_modules"))).toBe(true);
  expect(readdirSync(join(f.home, ".local/lib")).sort()).toEqual([
    "agentos",
    "agentos.installation",
  ]);
  const launched = Bun.spawnSync(
    [f.command, "--help", "argument with spaces", "$(literal)"],
    { cwd: f.root, env: f.env },
  );
  expect(launched.exitCode).toBe(0);
  expect(readFileSync(f.env.TEST_LAUNCH_LOG, "utf8").split("\n")).toEqual([
    f.root,
    join(f.installation, "src/index.ts"),
    "--help",
    "argument with spaces",
    "$(literal)",
    "",
  ]);
});

test("repository selection prefers CLI over environment over the canonical default", () => {
  const scenarios: {
    env: Record<string, string>;
    args: string[];
    repository: string;
  }[] = [
    { env: {}, args: [], repository: "Jarvissilva/agentos" },
    {
      env: { AGENTOS_REPOSITORY: "example/fork" },
      args: [],
      repository: "example/fork",
    },
    {
      env: { AGENTOS_REPOSITORY: "example/fork" },
      args: ["--repo", "other/fork"],
      repository: "other/fork",
    },
  ];
  for (const scenario of scenarios) {
    const f = fixture();
    expect(f.run(scenario.env, scenario.args).code).toBe(0);
    expect(readFileSync(f.env.TEST_DOWNLOAD_LOG, "utf8").split("\n")).toEqual([
      `https://github.com/${scenario.repository}/releases/latest`,
      `https://github.com/${scenario.repository}/archive/refs/tags/v0.1.0.tar.gz`,
      "",
    ]);
  }
});

test("supports an explicit tag without querying the latest release", () => {
  const f = fixture();
  expect(f.run({}, ["--version", "v0.1.0"]).code).toBe(0);
  const downloads = readFileSync(f.env.TEST_DOWNLOAD_LOG, "utf8");
  expect(downloads).toContain("/archive/refs/tags/v0.1.0.tar.gz");
  expect(downloads).not.toContain("/releases/latest");
});

test("bootstraps pinned Bun when absent and uses it outside PATH", () => {
  const f = fixture({ bun: false });
  expect(f.run().code).toBe(0);
  expect(existsSync(join(f.home, ".bun/bin/bun"))).toBe(true);
  expect(Bun.spawnSync([f.command, "--help"], { env: f.env }).exitCode).toBe(0);
});

test("reuses Bun installed outside PATH", () => {
  const f = fixture({ bun: false });
  mkdirSync(join(f.home, ".bun/bin"), { recursive: true });
  symlinkSync(f.env.TEST_BUN_FIXTURE, join(f.home, ".bun/bin/bun"));
  expect(f.run().code).toBe(0);
  expect(readFileSync(f.env.TEST_DOWNLOAD_LOG, "utf8")).not.toContain("bun.sh");
});

test("detects missing Linux tools before making any changes", () => {
  const f = fixture({ missing: "setsid" });
  const result = f.run();
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("Missing tools: setsid");
  expect(existsSync(f.env.TEST_DOWNLOAD_LOG)).toBe(false);
  f.expectClean();
});

test.each(["1.3.14", "1.4.2"])(
  "refuses Bun %s without overwriting it",
  (version) => {
    const f = fixture();
    const result = f.run({ TEST_BUN_VERSION: version });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("too old");
    expect(existsSync(join(f.bin, "bun"))).toBe(true);
    f.expectClean();
  },
);

test.each(["1.4.3", "1.5.0"])("reuses compatible Bun %s", (version) => {
  const f = fixture();
  expect(f.run({ TEST_BUN_VERSION: version }).code).toBe(0);
  expect(readFileSync(f.env.TEST_DOWNLOAD_LOG, "utf8")).not.toContain("bun.sh");
});

test("cleans up when publishing the launcher fails", () => {
  const f = fixture();
  rmSync(join(f.bin, "ln"));
  symlinkSync("/usr/bin/false", join(f.bin, "ln"));
  expect(f.run().code).not.toBe(0);
  f.expectClean();
});

test("reports missing unzip when Bun needs bootstrapping", () => {
  const f = fixture({ bun: false, missing: "unzip" });
  const result = f.run();
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("Installing Bun requires unzip");
  expect(existsSync(join(f.home, ".bun"))).toBe(false);
  f.expectClean();
});

test.each(["TEST_DOWNLOAD_FAIL", "TEST_INSTALL_FAIL"])(
  "cleans a failed installation: %s",
  (failure) => {
    const f = fixture();
    expect(f.run({ [failure]: "1" }).code).not.toBe(0);
    f.expectClean();
  },
);

test("refuses existing commands, including dangling symlinks", () => {
  const f = fixture();
  mkdirSync(resolve(f.command, ".."), { recursive: true });
  symlinkSync(join(f.root, "missing-checkout"), f.command);
  const result = f.run();
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("existing command");
  expect(existsSync(f.env.TEST_DOWNLOAD_LOG)).toBe(false);
  expect(
    Bun.spawnSync(["/usr/bin/readlink", f.command]).stdout.toString(),
  ).toBe(`${join(f.root, "missing-checkout")}\n`);
});

test("reinstall refusal preserves the installation and user data", () => {
  const f = fixture();
  expect(f.run().code).toBe(0);
  const data = join(f.home, ".local/share/agentos");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "notes.md"), "keep my data");
  const original = readFileSync(f.command, "utf8");
  expect(f.run().code).not.toBe(0);
  expect(readFileSync(f.command, "utf8")).toBe(original);
  expect(readFileSync(join(data, "notes.md"), "utf8")).toBe("keep my data");
});

test("reports missing tmux only when Agy is present", () => {
  const f = fixture();
  symlinkSync("/usr/bin/true", join(f.bin, "agy"));
  const result = f.run({ SHELL: "/usr/bin/fish" });
  expect(result.code).toBe(0);
  expect(result.output).toContain("fish_add_path");
  expect(result.output).toContain("also require tmux");
  expect(result.output).not.toContain("Install Codex, OpenCode, or Agy");
});

test("rejects invalid sources before downloading", () => {
  const f = fixture();
  expect(f.run({}, ["--repo", "../invalid"]).code).not.toBe(0);
  expect(f.run({}, ["--version", "main"]).code).not.toBe(0);
  expect(existsSync(f.env.TEST_DOWNLOAD_LOG)).toBe(false);
});
