// Kept self-contained: the installer copies this file outside the application so
// it remains runnable while an interrupted replacement is being recovered.
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const runtimeFile = "src/lib/platform/installation.ts";
const repositoryPattern =
  /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseTag =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[A-Za-z0-9.-]+)?$/;

interface FileRecord {
  hash: string;
  mode: number;
}
export interface Installation {
  format: 1;
  root: string;
  repository: string;
  tag: string;
  bun: string;
  launcher: string;
  launcherHash: string;
  launcherMode: number;
  runtimeHash: string;
  files: Record<string, FileRecord>;
}
interface Owner {
  pid: number;
  identity: string;
}
interface Transaction {
  format: 1;
  backup: string;
  previous: Installation;
}

const installationRoot = (root: string) =>
  join(realpathSync(dirname(resolve(root))), basename(resolve(root)));
export const installationState = (root: string) =>
  `${installationRoot(root)}.installation`;
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const hashFile = (file: string) => digest(readFileSync(file));
function json(file: string): unknown {
  regular(file);
  return JSON.parse(readFileSync(file, "utf8"));
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid installation record");
  return value as Record<string, unknown>;
}
function regular(file: string) {
  if (!lstatSync(file).isFile())
    throw new Error(`Expected a regular file: ${file}`);
}
function privateDirectory(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  )
    throw new Error(
      `Installation state must be private and owned by you: ${dir}`,
    );
}
function atomic(file: string, content: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
function safeRelative(path: string) {
  return (
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !isAbsolute(path) &&
    path
      .split("/")
      .every((part) => part !== ".." && part !== "." && part !== "")
  );
}
function manifest(root: string): Record<string, FileRecord> {
  if (!lstatSync(root).isDirectory())
    throw new Error("Application root must be a regular directory");
  const files: Record<string, FileRecord> = Object.create(null);
  function visit(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      if (dir === root && name === "node_modules") continue;
      if (name === ".git")
        throw new Error("Source checkouts must be updated through Git");
      const file = join(dir, name);
      const stat = lstatSync(file);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile())
        files[relative(root, file)] = {
          hash: hashFile(file),
          mode: stat.mode & 0o777,
        };
      else
        throw new Error(
          `Application contains a symlink or special file: ${file}`,
        );
    }
  }
  visit(root);
  return files;
}
function parseInstallation(value: unknown, root: string): Installation {
  const data = record(value);
  if (
    data.format !== 1 ||
    data.root !== installationRoot(root) ||
    typeof data.repository !== "string" ||
    !repositoryPattern.test(data.repository) ||
    typeof data.tag !== "string" ||
    !releaseTag.test(data.tag) ||
    typeof data.bun !== "string" ||
    !isAbsolute(data.bun) ||
    typeof data.launcher !== "string" ||
    !isAbsolute(data.launcher) ||
    typeof data.launcherHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.launcherHash) ||
    !Number.isInteger(data.launcherMode) ||
    Number(data.launcherMode) < 0 ||
    Number(data.launcherMode) > 0o777 ||
    typeof data.runtimeHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.runtimeHash)
  )
    throw new Error(
      "Invalid installation metadata; preserve your files and reinstall",
    );
  const files = record(data.files);
  for (const [path, value] of Object.entries(files)) {
    const item = record(value);
    if (
      !safeRelative(path) ||
      path.split("/")[0] === "node_modules" ||
      typeof item.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.hash) ||
      !Number.isInteger(item.mode) ||
      Number(item.mode) < 0 ||
      Number(item.mode) > 0o777
    )
      throw new Error("Invalid installation file manifest");
  }
  if (!files[runtimeFile] || !files["package.json"] || !files["src/index.ts"])
    throw new Error("Incomplete installation file manifest");
  return data as unknown as Installation;
}
function metadata(root: string) {
  return parseInstallation(
    json(join(installationState(root), "metadata.json")),
    root,
  );
}
function identity(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}`;
  } catch {
    return null;
  }
}
function currentOwner(): Owner {
  const start = identity(process.pid);
  if (!start)
    throw new Error("Cannot identify the current process through /proc");
  return { pid: process.pid, identity: start };
}
function live(value: unknown) {
  const owner = record(value);
  if (
    !Number.isSafeInteger(owner.pid) ||
    Number(owner.pid) <= 0 ||
    typeof owner.identity !== "string"
  )
    throw new Error(
      "Invalid process ownership record; inspect installation state",
    );
  const start = identity(Number(owner.pid));
  if (start === null && existsSync(`/proc/${owner.pid}`))
    throw new Error(
      "Cannot verify a running AgentOS process; close it before updating",
    );
  return start === owner.identity;
}
function directoryLock(lock: string): () => void {
  const owner = JSON.stringify({ ...currentOwner(), token: randomUUID() });
  // Publishing a populated directory avoids locks without a process identity.
  const pending = mkdtempSync(join(dirname(lock), "gate-pending-"));
  try {
    writeFileSync(join(pending, "owner.json"), owner, {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(pending, lock);
  } catch (error) {
    if (
      !["EEXIST", "ENOTEMPTY"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
    privateDirectory(lock);
    const ownerPath = join(lock, "owner.json");
    regular(ownerPath);
    const observed = readFileSync(ownerPath, "utf8");
    if (live(JSON.parse(observed)))
      throw new Error(
        "Another AgentOS launch or update is in progress; retry shortly",
      );
    // Serialize stale-owner recovery. This lock uses the same protocol so it
    // can itself be recovered if a process dies during stale-lock cleanup.
    const releaseRecovery = directoryLock(join(lock, "reaping"));
    const stale = `${lock}.stale-${randomUUID()}`;
    try {
      if (readFileSync(ownerPath, "utf8") !== observed)
        throw new Error("Installation lock changed; retry shortly");
      renameSync(lock, stale);
    } finally {
      releaseRecovery();
    }
    rmSync(stale, { recursive: true });
    return directoryLock(lock);
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
  return () => {
    if (
      existsSync(lock) &&
      readFileSync(join(lock, "owner.json"), "utf8") === owner
    )
      rmSync(lock, { recursive: true });
  };
}
function gate(root: string): () => void {
  const state = installationState(root);
  privateDirectory(state);
  return directoryLock(join(state, "gate"));
}
function requireManaged(root: string) {
  if (!existsSync(join(installationState(root), "metadata.json")))
    throw new Error(
      "This installation has no updater ownership metadata. For a source checkout, update through Git. For an older installer installation, preserve local changes and perform one manual reinstall; user data stays separate.",
    );
}
function verifyOwned(root: string, installed: Installation) {
  regular(installed.launcher);
  regular(join(installationState(root), "runtime.ts"));
  if (
    hashFile(installed.launcher) !== installed.launcherHash ||
    (lstatSync(installed.launcher).mode & 0o777) !== installed.launcherMode ||
    hashFile(join(installationState(root), "runtime.ts")) !==
      installed.runtimeHash ||
    JSON.stringify(manifest(root)) !== JSON.stringify(installed.files)
  )
    throw new Error(
      "Installation files or launcher were modified; preserve local changes before reinstalling",
    );
}
function recover(root: string) {
  const state = installationState(root);
  const journal = join(state, "transaction.json");
  if (!existsSync(journal)) return;
  const transaction = record(json(journal));
  if (
    transaction.format !== 1 ||
    typeof transaction.backup !== "string" ||
    !/^previous-[A-Za-z0-9.-]+$/.test(transaction.backup)
  )
    throw new Error(
      "Invalid update recovery journal; preserve installation state for recovery",
    );
  const previous = parseInstallation(transaction.previous, root);
  const backup = join(state, transaction.backup);
  if (existsSync(backup)) {
    if (!lstatSync(backup).isDirectory())
      throw new Error("Invalid recovery backup");
    if (existsSync(root))
      renameSync(root, join(state, `failed-${randomUUID()}`));
    renameSync(backup, root);
  }
  if (!existsSync(root))
    throw new Error(
      "Previous application is missing; restore your installation backup",
    );
  const runtime = readFileSync(join(root, runtimeFile), "utf8");
  if (digest(runtime) !== previous.runtimeHash)
    throw new Error(
      "Recovery runtime does not match the previous installation",
    );
  atomic(join(state, "runtime.ts"), runtime);
  atomic(join(state, "metadata.json"), JSON.stringify(previous));
  rmSync(journal);
}

export function recordInstallation(
  source: string,
  root: string,
  launcher: string,
  stagedLauncher: string,
  repository: string,
  tag: string,
  bun: string,
  state: string,
) {
  if (!repositoryPattern.test(repository) || !releaseTag.test(tag))
    throw new Error(
      "Installation requires a release tag and a valid repository",
    );
  const pkg = record(json(join(source, "package.json")));
  if (pkg.name !== "agentos" || pkg.version !== tag.slice(1))
    throw new Error("Release tag and package version do not match");
  const files = manifest(source);
  const runtimeHash = files[runtimeFile]?.hash;
  if (!runtimeHash)
    throw new Error("Release is missing the installation runtime");
  const installation = parseInstallation(
    {
      format: 1,
      root: installationRoot(root),
      repository,
      tag,
      bun,
      launcher,
      launcherHash: hashFile(stagedLauncher),
      launcherMode: lstatSync(stagedLauncher).mode & 0o777,
      runtimeHash,
      files,
    },
    root,
  );
  privateDirectory(state);
  atomic(
    join(state, "runtime.ts"),
    readFileSync(join(source, runtimeFile), "utf8"),
  );
  atomic(join(state, "metadata.json"), JSON.stringify(installation));
}

// Register before application imports or database access. The stable launcher
// also registers itself, closing the spawn-to-registration window for its child.
export function registerInstallationProcess(root: string): () => void {
  root = installationRoot(root);
  if (!existsSync(installationState(root))) return () => {};
  requireManaged(root);
  const unlock = gate(root);
  try {
    recover(root);
    const processes = join(installationState(root), "processes");
    privateDirectory(processes);
    const file = join(processes, `${process.pid}-${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify(currentOwner()), {
      mode: 0o600,
      flag: "wx",
    });
    return () => rmSync(file, { force: true });
  } finally {
    unlock();
  }
}
function requireIdle(root: string) {
  const processes = join(installationState(root), "processes");
  if (!existsSync(processes)) return;
  privateDirectory(processes);
  for (const file of readdirSync(processes)) {
    const path = join(processes, file);
    if (live(json(path)))
      throw new Error(
        "AgentOS is running. Close all AgentOS instances and stop the scheduler with 'agentos automations stop-service', then retry. No processes were stopped.",
      );
    rmSync(path);
  }
}
async function capture(
  command: string,
  args: string[],
  cwd?: string,
  env = process.env,
) {
  const child = Bun.spawn([command, ...args], {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  const [out, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `${basename(command)} failed (exit ${code}); installation was not committed`,
    );
  return out;
}
async function download(url: string, destination?: string) {
  return capture("curl", [
    "--fail",
    "--silent",
    "--show-error",
    "--location",
    "--max-time",
    "120",
    "--proto",
    "=https",
    "--proto-redir",
    "=https",
    ...(destination ? ["--output", destination] : []),
    url,
  ]);
}
async function extractArchive(archive: string, destination: string) {
  const paths = (await capture("tar", ["-tzf", archive])).trim().split("\n");
  const top = paths[0]?.split("/")[0];
  if (
    !top ||
    paths.some((path) => {
      const clean = path.endsWith("/") ? path.slice(0, -1) : path;
      return !safeRelative(clean) || clean.split("/")[0] !== top;
    })
  )
    throw new Error("Release archive contains unsafe paths");
  const types = (await capture("tar", ["-tvzf", archive])).trim().split("\n");
  if (types.some((line) => !["-", "d"].includes(line[0] ?? "")))
    throw new Error("Release archive contains links or special files");
  await capture("tar", [
    "--extract",
    "--gzip",
    "--file",
    archive,
    "--directory",
    destination,
    "--strip-components=1",
    "--no-same-owner",
    "--no-same-permissions",
  ]);
}
export async function updateInstallation(
  root: string,
  check = false,
): Promise<string> {
  root = installationRoot(root);
  requireManaged(root);
  const unlock = gate(root);
  let stage: string | undefined;
  try {
    recover(root);
    const installed = metadata(root);
    verifyOwned(root, installed);
    if (!check) requireIdle(root);
    const release = record(
      JSON.parse(
        await download(
          `https://api.github.com/repos/${installed.repository}/releases/latest`,
        ),
      ),
    );
    const tag = release.tag_name;
    if (
      typeof tag !== "string" ||
      !stableTag.test(tag) ||
      release.draft !== false ||
      release.prerelease !== false
    )
      throw new Error("GitHub did not return a published stable release");
    const status = `Installed: ${installed.tag}. Latest: ${tag}.`;
    if (tag === installed.tag) return `${status} Already up to date.`;
    if (Bun.semver.order(tag.slice(1), installed.tag.slice(1)) <= 0)
      throw new Error(`${status} Refusing a downgrade.`);
    if (check) return `${status} Run 'agentos update' to install.`;
    const state = installationState(root);
    stage = mkdtempSync(join(state, "stage-"));
    const archive = join(stage, "release.tar.gz");
    const app = join(stage, "app");
    mkdirSync(app, { mode: 0o700 });
    await download(
      `https://github.com/${installed.repository}/archive/refs/tags/${tag}.tar.gz`,
      archive,
    );
    await extractArchive(archive, app);
    for (const file of [
      "package.json",
      "bun.lock",
      "src/index.ts",
      "src/tui/app.tsx",
      runtimeFile,
      "src/lib/storage/migrations/meta/_journal.json",
    ])
      regular(join(app, file));
    const pkg = record(json(join(app, "package.json")));
    if (pkg.name !== "agentos" || pkg.version !== tag.slice(1))
      throw new Error("Release tag and package version do not match");
    const engines = record(pkg.engines);
    const bunVersion = (await capture(installed.bun, ["--version"])).trim();
    if (
      typeof engines.bun !== "string" ||
      !Bun.semver.satisfies(bunVersion, engines.bun)
    )
      throw new Error(
        `Release requires Bun ${engines.bun}; upgrade Bun separately, then retry`,
      );
    // Validate source files before allowing package installation to run.
    manifest(app);
    await capture(installed.bun, ["install", "--frozen-lockfile"], app);
    const smoke = join(stage, "smoke");
    mkdirSync(smoke);
    await capture(installed.bun, [join(app, "src/index.ts"), "--help"], smoke, {
      ...process.env,
      XDG_CONFIG_HOME: join(smoke, "config"),
      XDG_DATA_HOME: join(smoke, "data"),
      XDG_CACHE_HOME: join(smoke, "cache"),
    });
    // Revalidate ownership immediately before replacement.
    verifyOwned(root, installed);
    requireIdle(root);
    const next = {
      ...installed,
      tag,
      files: manifest(app),
      runtimeHash: hashFile(join(app, runtimeFile)),
    };
    const backup = `previous-${installed.tag}-${randomUUID()}`;
    atomic(
      join(state, "transaction.json"),
      JSON.stringify({
        format: 1,
        backup,
        previous: installed,
      } satisfies Transaction),
    );
    try {
      renameSync(root, join(state, backup));
      renameSync(app, root);
      atomic(
        join(state, "runtime.ts"),
        readFileSync(join(root, runtimeFile), "utf8"),
      );
      atomic(join(state, "metadata.json"), JSON.stringify(next));
      rmSync(join(state, "transaction.json"));
    } catch (error) {
      recover(root);
      throw error;
    }
    return `Updated ${installed.tag} → ${tag}. Previous application: ${join(state, backup)}. Restart AgentOS and restart the scheduler if you use it. User data was preserved; future database migrations are not reversed by restoring application files.`;
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
    unlock();
  }
}
export async function updateCommand(root: string, args: string[]) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0] ?? "")) {
    console.log(
      "Usage: agentos update [--check]\nInstall the latest stable GitHub release. Close AgentOS and stop the scheduler first.",
    );
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
    throw new Error("Usage: agentos update [--check]");
  console.log(await updateInstallation(root, args[0] === "--check"));
}
async function launch(root: string, args: string[]) {
  if (args[0] === "update") return updateCommand(root, args.slice(1));
  const unregister = registerInstallationProcess(root);
  try {
    const installed = metadata(root);
    const child = Bun.spawn(
      [installed.bun, join(root, "src/index.ts"), ...args],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const term = () => forward("SIGTERM");
    process.on("SIGTERM", term);
    try {
      process.exitCode = await child.exited;
    } finally {
      process.off("SIGTERM", term);
    }
  } finally {
    unregister();
  }
}
if (import.meta.main) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "record" && args.length === 8) {
      const [source, root, launcher, staged, repo, tag, bun, state] = args;
      if (
        !source ||
        !root ||
        !launcher ||
        !staged ||
        !repo ||
        !tag ||
        !bun ||
        !state
      )
        throw new Error("Missing installation recording arguments");
      recordInstallation(source, root, launcher, staged, repo, tag, bun, state);
    } else if (mode === "launch" && args[0]) {
      await launch(resolve(args[0]), args.slice(1));
    } else
      throw new Error(
        `Invalid installation runtime invocation: ${fileURLToPath(import.meta.url)}`,
      );
  } catch (error) {
    console.error(
      `agentos: ${error instanceof Error ? error.message : "Update failed"}`,
    );
    process.exitCode = 1;
  }
}
