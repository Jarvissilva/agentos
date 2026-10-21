import { basename } from "node:path";
import type { Session } from "../../lib/storage/schema";

export const SESSION_TITLE_MAX = 60;
const ansi = /\p{Cc}\[[0-?]*[ -/]*[@-~]/gu;
const control = /\p{Cc}/gu;

export function cleanSessionTitle(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .normalize("NFKC")
    .replace(ansi, "")
    .replace(control, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned || undefined;
}

export function shortenSessionTitle(value: string): string {
  const characters = [...value];
  if (characters.length <= SESSION_TITLE_MAX) return value;
  const clipped = characters.slice(0, SESSION_TITLE_MAX - 1).join("");
  const boundary = clipped.lastIndexOf(" ");
  const stem =
    boundary >= Math.floor(SESSION_TITLE_MAX * 0.6)
      ? clipped.slice(0, boundary)
      : clipped;
  return `${stem.trimEnd()}…`;
}

export function sessionTitle(
  prompt: string | null | undefined,
): string | undefined {
  const cleaned = cleanSessionTitle(prompt);
  return cleaned ? shortenSessionTitle(cleaned) : undefined;
}

export function sessionLabel(
  session: Pick<Session, "title" | "cwd">,
  projectName?: string,
): string {
  return session.title ?? projectName ?? (basename(session.cwd) || session.cwd);
}
