export const colors = {
  bg: "#04070d",
  bgRaised: "#070d16",
  panel: "#0a121d",
  panelAlt: "#0d1825",
  line: "#162335",
  lineBright: "#243b56",
  text: "#e8eef8",
  textSoft: "#c2cfe0",
  muted: "#7f91a9",
  dim: "#4b5f78",
  faint: "#2b3c50",
  accent: "#b4cff1",
  accentBright: "#e4efff",
  accentDim: "#6d8fb6",
  selection: "#0f1c2c",
  chip: "#0d1724",
  error: "#ffa1a6",
  success: "#93dcb5",
  warning: "#e9c78f",
  star: "#24364c",
  starBright: "#5a7597",
  grid: "#0a131f",
  atmosphere: "#152638",
  rim: "#bdd8f6",
  rimSoft: "#4d7399",
  planet: "#0b1a29",
  globeDeep: "#0f283a",
  globeBack: "#1b4560",
  globeMid: "#347a9e",
  globeLine: "#79c4e8",
  globeHot: "#e8faff",
} as const;

export function clip(text: string, max: number) {
  if (max <= 0) return "";
  const chars = [...text.replaceAll(/\s+/g, " ")];
  if (chars.length <= max) return chars.join("");
  if (max === 1) return "…";
  return `${chars.slice(0, max - 1).join("")}…`;
}

export function relativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  if (diff < 45_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function prettyPath(path: string) {
  const home = process.env.HOME;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export function statusMark(status: string) {
  switch (status) {
    case "attached":
      return { glyph: "●", color: colors.success };
    case "ready":
      return { glyph: "●", color: colors.accent };
    case "starting":
    case "queued":
      return { glyph: "◔", color: colors.warning };
    case "idle":
      return { glyph: "○", color: colors.muted };
    case "failed":
      return { glyph: "✕", color: colors.error };
    case "interrupted":
      return { glyph: "◌", color: colors.warning };
    case "running":
      return { glyph: "●", color: colors.accent };
    case "completed":
      return { glyph: "✓", color: colors.success };
    case "attention":
      return { glyph: "!", color: colors.warning };
    default:
      return { glyph: "·", color: colors.dim };
  }
}

export function sessionMark(status: string) {
  return statusMark(status);
}
