import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { stringify } from "yaml";
import { z } from "zod";
import type { AppPaths } from "../../lib/platform/paths";
import type { AppDatabase } from "../../lib/storage/database";
import { agents } from "../../lib/storage/schema";
import { definitionSchema, parseAgent } from "./definition";

export class AgentService {
  constructor(
    private db: AppDatabase,
    private paths: AppPaths,
  ) {}
  removeAgent(id: string) {
    const a = this.agent(id);
    const file = this.agentFile(id);
    unlinkSync(file);
    this.db.delete(agents).where(eq(agents.id, a.id)).run();
  }
  listAgents() {
    return this.db.select().from(agents).orderBy(agents.name).all();
  }
  agent(id: string) {
    const result = this.listAgents().find((a) => a.id === id || a.name === id);
    if (!result) throw new Error(`Agent not found: ${id}`);
    return result;
  }
  agentFile(id: string) {
    const record = this.agent(id);
    if (basename(record.file) !== record.file)
      throw new Error("Invalid managed agent path");
    const file = join(this.paths.agents, record.file);
    if (!lstatSync(file).isFile())
      throw new Error(
        "Managed agent must be a regular file, not a symbolic link",
      );
    return file;
  }
  agentDefinition(id: string) {
    return parseAgent(readFileSync(this.agentFile(id), "utf8"));
  }
  createAgent(name: string, instructions: string, description = "") {
    const metadata = definitionSchema.parse({ name, description });
    const body = z.string().trim().min(1).parse(instructions);
    const file = `${
      metadata.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "agent"
    }-${randomUUID().slice(0, 8)}.md`;
    const path = join(this.paths.agents, file);
    writeFileSync(path, `---\n${stringify(metadata)}---\n\n${body}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    try {
      return this.db
        .insert(agents)
        .values({ id: randomUUID(), ...metadata, file, createdAt: Date.now() })
        .returning()
        .get();
    } catch (error) {
      unlinkSync(path);
      throw error;
    }
  }
  syncAgent(id: string) {
    const record = this.agent(id);
    const definition = this.agentDefinition(record.id);
    this.db
      .update(agents)
      .set({ name: definition.name, description: definition.description })
      .where(eq(agents.id, record.id))
      .run();
  }
}
