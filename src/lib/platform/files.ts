import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

export const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function atomicWrite(file: string, content: string, expected?: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  if (existsSync(file) && !lstatSync(file).isFile())
    throw new Error("Refusing to replace a non-regular file");
  if (
    expected !== undefined &&
    (existsSync(file) ? readFileSync(file, "utf8") : "") !== expected
  )
    throw new Error("File changed externally; reload before saving");
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, {
      mode: existsSync(file) ? lstatSync(file).mode & 0o777 : 0o600,
      flag: "wx",
    });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}
export function inside(root: string, relative: string) {
  const path = resolve(root, relative);
  if (!path.startsWith(resolve(root) + sep))
    throw new Error("Path escapes managed directory");
  return path;
}
export function processIdentity(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]}`;
  } catch {
    return null;
  }
}
export function redact(value: string): string {
  let text = value;
  for (const [key, secret] of Object.entries(process.env))
    if (
      /(TOKEN|PASSWORD|SECRET|API_KEY|CREDENTIAL)/i.test(key) &&
      secret &&
      secret.length >= 8
    )
      text = text.replaceAll(secret, "[REDACTED]");
  return text.replace(/(Bearer\s+)[\w.-]+/gi, "$1[REDACTED]");
}
