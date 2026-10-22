import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import {
  installationState,
  recordInstallation,
  registerInstallationProcess,
  updateInstallation,
} from "../src/lib/platform/installation";

const roots: string[] = [];
const originalPath = process.env.PATH;
afterEach(() => {
  process.env.PATH = originalPath;
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync("/tmp/agentos-update-");
  roots.push(root);
  const app = join(root, "agentos");
  const state = installationState(app);
  const bin = join(root, "bin");
  const releaseRoot = join(root, "release");
  const release = join(releaseRoot, "agentos-0.2.0");
  const control = join(root, "control.json");
  const archive = join(root, "release.tar.gz");
  const runtime = fs.readFileSync(
    resolve("src/lib/platform/installation.ts"),
    "utf8",
  );
  const write = (file: string, text: string, mode = 0o644) => {
    fs.mkdirSync(resolve(file, ".."), { recursive: true });
    fs.writeFileSync(file, text, { mode });
  };
  function source(dir: string, version: string) {
    write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "agentos",
        version,
        engines: { bun: ">=1.4.3" },
      }),
    );
    write(join(dir, "bun.lock"), "lockfile");
    write(
      join(dir, "src/index.ts"),
      `console.log(process.argv.includes("--help") ? "Usage: agentos" : ${JSON.stringify(version)});`,
    );
    write(join(dir, "src/tui/app.tsx"), "// terminal app");
    write(join(dir, "src/lib/storage/migrations/meta/_journal.json"), "{}");
    write(join(dir, "src/lib/platform/installation.ts"), runtime);
  }
  source(app, "0.1.0");
  source(release, "0.2.0");
  fs.mkdirSync(bin);
  const setControl = (value: Record<string, unknown> = {}) =>
    fs.writeFileSync(control, JSON.stringify({ tag: "v0.2.0", ...value }));
  setControl();
  write(
    join(bin, "curl"),
    `#!${process.execPath}
import {readFileSync,copyFileSync} from "node:fs";
const config=JSON.parse(readFileSync(${JSON.stringify(control)},"utf8"));
const args=process.argv.slice(2),url=args.at(-1);
if(config.downloadFail)process.exit(22);
if(url.includes("api.github.com"))console.log(JSON.stringify({tag_name:config.tag,draft:!!config.draft,prerelease:!!config.prerelease}));
else copyFileSync(${JSON.stringify(archive)},args[args.indexOf("--output")+1]);
`,
    0o700,
  );
  const bun = join(bin, "bun");
  write(
    bun,
    `#!${process.execPath}
import {readFileSync,mkdirSync} from "node:fs";
const config=JSON.parse(readFileSync(${JSON.stringify(control)},"utf8"));
const args=process.argv.slice(2);
if(args[0]==="--version")console.log(config.bunVersion||"1.4.3");
else if(args[0]==="install") {if(config.installFail)process.exit(1);mkdirSync("node_modules");}
else {if(config.smokeFail)process.exit(1);const p=Bun.spawn([process.execPath,...args],{stdin:"inherit",stdout:"inherit",stderr:"inherit"});process.exitCode=await p.exited;}
`,
    0o700,
  );
  const launcher = join(bin, "agentos");
  write(launcher, "#!/bin/bash\n# owned launcher\n", 0o755);
  recordInstallation(
    app,
    app,
    launcher,
    launcher,
    "example/fork",
    "v0.1.0",
    bun,
    state,
  );
  const data = join(root, "user-data");
  write(join(data, "memory.md"), "keep my memory");
  write(join(data, "agentos.db"), "keep my database");
  function pack() {
    const tar = Bun.spawnSync([
      "/usr/bin/tar",
      "-czf",
      archive,
      "--exclude=node_modules",
      "-C",
      releaseRoot,
      "agentos-0.2.0",
    ]);
    expect(tar.exitCode).toBe(0);
  }
  pack();
  process.env.PATH = `${bin}:${originalPath}`;
  return {
    root,
    app,
    state,
    bin,
    release,
    control,
    archive,
    launcher,
    data,
    setControl,
    pack,
    write,
    metadata: () =>
      JSON.parse(fs.readFileSync(join(state, "metadata.json"), "utf8")),
    expectOriginal() {
      expect(
        JSON.parse(fs.readFileSync(join(app, "package.json"), "utf8")).version,
      ).toBe("0.1.0");
      expect(fs.readFileSync(join(data, "memory.md"), "utf8")).toBe(
        "keep my memory",
      );
      expect(fs.readFileSync(join(data, "agentos.db"), "utf8")).toBe(
        "keep my database",
      );
      expect(fs.existsSync(join(state, "transaction.json"))).toBe(false);
    },
  };
}

test("updates the owned installation, retains its previous copy, and preserves user data", async () => {
  const f = fixture();
  const launcher = fs.readFileSync(f.launcher, "utf8");
  const result = await updateInstallation(f.app);
  expect(result).toContain("Updated v0.1.0 → v0.2.0");
  expect(f.metadata().repository).toBe("example/fork");
  expect(f.metadata().tag).toBe("v0.2.0");
  expect(
    JSON.parse(fs.readFileSync(join(f.app, "package.json"), "utf8")).version,
  ).toBe("0.2.0");
  expect(
    fs.readdirSync(f.state).some((file) => file.startsWith("previous-v0.1.0-")),
  ).toBe(true);
  expect(fs.readFileSync(f.launcher, "utf8")).toBe(launcher);
  expect(fs.readFileSync(join(f.data, "memory.md"), "utf8")).toBe(
    "keep my memory",
  );
  expect(fs.readFileSync(join(f.data, "agentos.db"), "utf8")).toBe(
    "keep my database",
  );
  expect(await updateInstallation(f.app)).toContain("Already up to date");
});

test("checking reports versions without installing, including while the application is running", async () => {
  const f = fixture();
  const stop = registerInstallationProcess(f.app);
  try {
    expect(await updateInstallation(f.app, true)).toContain(
      "Run 'agentos update'",
    );
    f.expectOriginal();
    await expect(updateInstallation(f.app)).rejects.toThrow(
      "Close all AgentOS",
    );
  } finally {
    stop();
  }
});

test("installation identity is stable through a symlinked parent directory", async () => {
  const f = fixture();
  const alias = join(f.root, "alias");
  fs.symlinkSync(f.root, alias);
  expect(await updateInstallation(join(alias, "agentos"))).toContain("Updated");
  expect(f.metadata().root).toBe(f.app);
});

test.each([
  { tag: "v0.1.0", message: "Already up to date", success: true },
  { tag: "v0.0.9", message: "downgrade", success: false },
  { tag: "v0.2.0-rc.1", message: "stable release", success: false },
  { draft: true, message: "stable release", success: false },
  { prerelease: true, message: "stable release", success: false },
])(
  "handles release selection: %j",
  async ({ message, success, ...control }) => {
    const f = fixture();
    f.setControl(control);
    if (success) expect(await updateInstallation(f.app)).toContain(message);
    else await expect(updateInstallation(f.app)).rejects.toThrow(message);
    f.expectOriginal();
  },
);

test.each([
  { downloadFail: true },
  { installFail: true },
  { smokeFail: true },
  { bunVersion: "1.4.2" },
])(
  "failed preparation preserves the original installation: %j",
  async (control) => {
    const f = fixture();
    f.setControl(control);
    await expect(updateInstallation(f.app)).rejects.toThrow();
    f.expectOriginal();
    expect(
      fs.readdirSync(f.state).some((file) => file.startsWith("stage-")),
    ).toBe(false);
  },
);

test("rejects release tag/package mismatches and archives containing links", async () => {
  const f = fixture();
  f.write(
    join(f.release, "package.json"),
    JSON.stringify({ name: "agentos", version: "9.0.0" }),
  );
  f.pack();
  await expect(updateInstallation(f.app)).rejects.toThrow("do not match");
  f.expectOriginal();
  fs.symlinkSync("/tmp", join(f.release, "unsafe"));
  f.pack();
  await expect(updateInstallation(f.app)).rejects.toThrow(
    "links or special files",
  );
  f.expectOriginal();
});

test("rejects archives containing parent traversal before extraction", async () => {
  const f = fixture();
  const tar = Bun.spawnSync([
    "/usr/bin/tar",
    "-czf",
    f.archive,
    "--transform",
    "s|agentos-0.2.0|../escape|",
    "-C",
    resolve(f.release, ".."),
    "agentos-0.2.0",
  ]);
  expect(tar.exitCode).toBe(0);
  await expect(updateInstallation(f.app)).rejects.toThrow("unsafe paths");
  f.expectOriginal();
  expect(fs.existsSync(join(f.state, "escape"))).toBe(false);
});

test("refuses modified application files, additional files, and externally changed launchers", async () => {
  for (const target of ["src/index.ts", "extra.md", "launcher"]) {
    const f = fixture();
    f.write(
      target === "launcher" ? f.launcher : join(f.app, target),
      "local changes",
    );
    await expect(updateInstallation(f.app)).rejects.toThrow("modified");
  }
});

test("refuses unowned source checkouts and older installer installations", async () => {
  const f = fixture();
  fs.rmSync(f.state, { recursive: true });
  await expect(updateInstallation(f.app)).rejects.toThrow("manual reinstall");
});

test("stale process records are ignored, while a concurrent update excludes startup and other updates", async () => {
  const f = fixture();
  fs.mkdirSync(join(f.state, "processes"), { mode: 0o700 });
  f.write(
    join(f.state, "processes/stale.json"),
    JSON.stringify({ pid: process.pid, identity: "old-process" }),
  );
  const updating = updateInstallation(f.app);
  expect(() => registerInstallationProcess(f.app)).toThrow("in progress");
  await expect(updateInstallation(f.app)).rejects.toThrow("in progress");
  expect(await updating).toContain("Updated");
});

test("recovers a stale update gate using process-start identity", async () => {
  const f = fixture();
  fs.mkdirSync(join(f.state, "gate"), { mode: 0o700 });
  f.write(
    join(f.state, "gate/owner.json"),
    JSON.stringify({ pid: process.pid, identity: "previous-process" }),
  );
  fs.mkdirSync(join(f.state, "gate/reaping"), { mode: 0o700 });
  f.write(
    join(f.state, "gate/reaping/owner.json"),
    JSON.stringify({ pid: process.pid, identity: "previous-recovery-process" }),
  );
  expect(await updateInstallation(f.app, true)).toContain("v0.2.0");
  expect(fs.existsSync(join(f.state, "gate"))).toBe(false);
});

test("rolls back replacement when publishing the candidate fails", async () => {
  const f = fixture();
  const original = fs.renameSync;
  let failed = false;
  const rename = spyOn(fs, "renameSync").mockImplementation(
    (oldPath, newPath) => {
      if (!failed && String(oldPath).endsWith("/app") && newPath === f.app) {
        failed = true;
        throw new Error("replacement failed");
      }
      original(oldPath, newPath);
    },
  );
  try {
    await expect(updateInstallation(f.app)).rejects.toThrow(
      "replacement failed",
    );
    expect(failed).toBe(true);
    f.expectOriginal();
    expect(f.metadata().tag).toBe("v0.1.0");
  } finally {
    rename.mockRestore();
  }
});

test.each([false, true])(
  "stable launcher recovers interrupted replacement (candidate activated: %s)",
  async (activated) => {
    const f = fixture();
    const previous = f.metadata();
    const backup = "previous-v0.1.0-test";
    f.write(
      join(f.state, "transaction.json"),
      JSON.stringify({ format: 1, backup, previous }),
    );
    fs.renameSync(f.app, join(f.state, backup));
    if (activated) fs.cpSync(f.release, f.app, { recursive: true });
    const child = Bun.spawn(
      [
        process.execPath,
        join(f.state, "runtime.ts"),
        "launch",
        f.app,
        "--version",
      ],
      {
        cwd: f.root,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out.trim()).toBe("0.1.0");
    f.expectOriginal();
  },
);

test("CLI update refuses unsupported installations before creating data directories", async () => {
  const root = fs.mkdtempSync("/tmp/agentos-update-cli-");
  roots.push(root);
  const child = Bun.spawn(
    [process.execPath, resolve("src/index.ts"), "update", "--check"],
    {
      env: {
        ...process.env,
        XDG_DATA_HOME: join(root, "data"),
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_CACHE_HOME: join(root, "cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [err, code] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(1);
  expect(err).toContain("source checkout");
  expect(fs.existsSync(join(root, "data"))).toBe(false);
  expect(fs.existsSync(join(root, "config"))).toBe(false);
});

test("managed workers block updates across processes and stale records clear after exit", async () => {
  const f = fixture();
  const marker = join(f.root, "worker-ready");
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    import {registerInstallationProcess} from ${JSON.stringify(resolve("src/lib/platform/installation.ts"))};
    import {writeFileSync} from "node:fs";
    const unregister=registerInstallationProcess(${JSON.stringify(f.app)});
    writeFileSync(${JSON.stringify(marker)},"ready");
    setInterval(()=>{},1000);
    process.on("SIGTERM",()=>{unregister();process.exit(0)});
  `,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  try {
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(marker) && Date.now() < deadline) await Bun.sleep(10);
    expect(fs.existsSync(marker)).toBe(true);
    await expect(updateInstallation(f.app)).rejects.toThrow(
      "Close all AgentOS",
    );
    child.kill("SIGKILL");
    await child.exited;
    expect(await updateInstallation(f.app)).toContain("Updated");
    expect(fs.readdirSync(join(f.state, "processes"))).toEqual([]);
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
});

test("the full application starts through the stable launcher before and after an update", async () => {
  const f = fixture();
  for (const dir of [f.app, f.release]) {
    fs.cpSync(resolve("src"), join(dir, "src"), { recursive: true });
    fs.symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
  }
  const cli = join(f.release, "src/cli/commands.ts");
  f.write(
    cli,
    fs
      .readFileSync(cli, "utf8")
      .replace('.version("0.1.0")', '.version("0.2.0")'),
  );
  recordInstallation(
    f.app,
    f.app,
    f.launcher,
    f.launcher,
    "example/fork",
    "v0.1.0",
    join(f.bin, "bun"),
    f.state,
  );
  // Dependency installation is mocked, but startup uses the real application and
  // existing dependency tree, including migrations and the process registry.
  const fakeBun = join(f.bin, "bun");
  f.write(
    fakeBun,
    fs
      .readFileSync(fakeBun, "utf8")
      .replace(
        "{readFileSync,mkdirSync}",
        "{readFileSync,mkdirSync,symlinkSync}",
      )
      .replace(
        'mkdirSync("node_modules")',
        `symlinkSync(${JSON.stringify(resolve("node_modules"))},"node_modules")`,
      ),
    0o700,
  );
  f.pack();
  const run = async (...args: string[]) => {
    // Regular files avoid this sandbox's restrictions on inherited pipe writes.
    const output = join(f.root, "command.stdout");
    const errors = join(f.root, "command.stderr");
    fs.writeFileSync(output, "");
    fs.writeFileSync(errors, "");
    const child = Bun.spawn(
      [process.execPath, join(f.state, "runtime.ts"), "launch", f.app, ...args],
      {
        cwd: f.root,
        env: {
          ...process.env,
          XDG_DATA_HOME: join(f.root, "data"),
          XDG_CONFIG_HOME: join(f.root, "config"),
          XDG_CACHE_HOME: join(f.root, "cache"),
        },
        stdout: Bun.file(output),
        stderr: Bun.file(errors),
      },
    );
    const code = await child.exited;
    const out = fs.readFileSync(output, "utf8");
    const err = fs.readFileSync(errors, "utf8");
    expect(err).toBe("");
    expect(code).toBe(0);
    return out;
  };
  expect(JSON.parse(await run("projects", "list"))).toEqual([]);
  expect((await run("--version")).trim()).toBe("0.1.0");
  expect(await run("update")).toContain("Updated v0.1.0 → v0.2.0");
  expect((await run("--version")).trim()).toBe("0.2.0");
  expect(JSON.parse(await run("projects", "list"))).toEqual([]);
  expect(fs.existsSync(join(f.root, "data/agentos/agentos.db"))).toBe(true);
});
