import { BRAND } from "../lib/constants";
import type { Command, ResourceContext, ResourceView, Row } from "../lib/types";
import { colors } from "../theme";
import { relativeTime } from "../utils/format";
export function notificationsView(context: ResourceContext): ResourceView {
  const { app, refresh } = context;

  const notifications = app.listNotifications();

  const notificationRows: Row[] = notifications.map((notification) => ({
    id: notification.id,
    name: notification.message,
    meta: notification.read ? "read" : "unread",
    glyph: notification.read ? "○" : "●",
    glyphColor: notification.read ? colors.dim : colors.warning,
    description: relativeTime(notification.createdAt),
    body: () => JSON.stringify(notification, null, 2),
  }));

  const sectionCommands: Command[] = [];

  return {
    navigation: {
      name: "notifications",
      description: "Local activity and failure records",
      group: "navigate",
      run: () => {
        context.openSection("notifications");
      },
    },
    copy: {
      title: "Notifications",
      noun: "notification",
      glyph: "●",
      empty: "Nothing to review",
      hint: `${BRAND} records local activity here`,
    },
    rows: notificationRows,
    commands: () => [],
    sectionCommands,
    creation: sectionCommands.find((command) =>
      command.name.startsWith("new "),
    ),
    open: (row) => {
      try {
        app.readNotification(row.id);
      } catch {
        /* Read markers are best effort. */
      }
      refresh();
      return false;
    },
  };
}
