import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { nameSchema } from "../../lib/platform/paths";
import type { AppDatabase } from "../../lib/storage/database";
import { projects } from "../../lib/storage/schema";

export class ProjectService {
  constructor(private db: AppDatabase) {}
  listProjects() {
    return this.db.select().from(projects).orderBy(projects.name).all();
  }
  project(id: string) {
    const result = this.listProjects().find(
      (p) => p.id === id || p.name === id,
    );
    if (!result) throw new Error(`Project not found: ${id}`);
    return result;
  }
  createProject(name: string, description = "") {
    return this.db
      .insert(projects)
      .values({
        id: randomUUID(),
        name: nameSchema.parse(name),
        description,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  }
  updateProject(id: string, input: { name?: string; description?: string }) {
    const existing = this.project(id);
    return this.db
      .update(projects)
      .set({
        ...input,
        name:
          input.name === undefined
            ? existing.name
            : nameSchema.parse(input.name),
      })
      .where(eq(projects.id, existing.id))
      .returning()
      .get();
  }
  removeProject(id: string) {
    this.db
      .delete(projects)
      .where(eq(projects.id, this.project(id).id))
      .run();
  }
}
