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
