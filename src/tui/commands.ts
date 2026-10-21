import type { Command } from "./types";

export function matches(text: string, query: string) {
  const terms = query
    .replace(/^\//, "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = text.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function matchCommands(commands: Command[], input: string) {
  const query = input.replace(/^\//, "").trim().toLowerCase();
  const rank = (command: Command) =>
    command.name === query ? 0 : command.name.startsWith(query) ? 1 : 2;
  return commands
    .filter((command) =>
      matches(`${command.name} ${command.description}`, input),
    )
    .sort((a, b) => rank(a) - rank(b));
}
