import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { redact } from "../../lib/platform/files";
import type { AppDatabase } from "../../lib/storage/database";
import { notifications } from "../../lib/storage/schema";

export class NotificationService {
  constructor(private db: AppDatabase) {}
  listNotifications() {
    return this.db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(100)
      .all();
  }
  readNotification(id: string) {
    this.db
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.id, id))
      .run();
  }
  notify(message: string, runId?: string) {
    this.db
      .insert(notifications)
      .values({
        id: randomUUID(),
        message: redact(message),
        runId,
        createdAt: Date.now(),
      })
      .run();
  }
}
