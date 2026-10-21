import { parse } from "yaml";
import { z } from "zod";
import { nameSchema } from "../../lib/platform/paths";

export const definitionSchema = z.object({
  name: nameSchema,
  description: z.string().default(""),
});
export function parseAgent(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match)
    throw new Error(
      "Agent requires YAML frontmatter between --- lines and Markdown instructions",
    );
  const metadata = definitionSchema.parse(parse(match[1] ?? ""));
  const instructions = z
    .string()
    .trim()
    .min(1, "Agent instructions cannot be empty")
    .parse(match[2]);
  return { ...metadata, instructions };
}
