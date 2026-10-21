import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite } from "../platform/files";
import type { AppPaths } from "../platform/paths";

const marker = "# Managed by Agent OS";
function quote(s: string) {
  if (/[\r\n\0]/.test(s)) throw new Error("Invalid service path");
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$")}"`;
}
export function unitContents(paths: AppPaths) {
  const file = fileURLToPath(new URL("../index.ts", import.meta.url));
  const environment =
    ["DATA", "CONFIG", "CACHE"]
      .map((key) => {
        const root =
          key === "DATA"
            ? paths.data
            : key === "CONFIG"
              ? paths.config
              : paths.cache;
        return `Environment=${quote(`XDG_${key}_HOME=${join(root, "..")}`)}`;
      })
      .join("\n") +
    `\nEnvironment=${quote(`PATH=${join(homedir(), ".local/bin")}:${join(homedir(), ".bun/bin")}:${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}`)}`;
  return `${marker}\n[Unit]\nDescription=Agent OS persistent local scheduler\n\n[Service]\nType=simple\nExecStart=${quote(process.execPath)} ${quote(file)} automations worker\n${environment}\nEnvironmentFile=-${join(paths.config, "worker.env").replaceAll("%", "%%").replaceAll(" ", "\\x20")}\nUMask=0077\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=15\nKillMode=mixed\n\n[Install]\nWantedBy=default.target\n`;
}
async function systemctl(args: string[]) {
  const p = Bun.spawn(["systemctl", "--user", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  const [text, , code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `systemctl ${args[0]} failed; inspect systemctl --user status agentos.service`,
    );
  return text.trim();
}
export async function installWorker(paths: AppPaths, start = false) {
  const file = join(paths.config, "../systemd/user/agentos.service");
  const original = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (original && !original.startsWith(marker))
    throw new Error("An unmanaged agentos.service already exists");
  atomicWrite(file, unitContents(paths), original);
  await systemctl(["daemon-reload"]);
  if (start) await systemctl(["enable", "--now", "agentos.service"]);
  return file;
}
export const stopWorker = () =>
  systemctl(["disable", "--now", "agentos.service"]);
export async function workerStatus() {
  try {
    return await systemctl(["is-active", "agentos.service"]);
  } catch {
    return "inactive or user systemd unavailable";
  }
}
