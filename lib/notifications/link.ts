import { destinationFor, type NotificationType } from "./events";
import { routes } from "@/lib/routes";

/**
 * The path a notification opens.
 *
 * Split from the catalogue so `events.ts` can stay import-free — it is read by
 * the API routes as well as the browser, and a module with no dependencies is
 * one that runs anywhere and can be unit tested without a bundler. All the
 * decisions live there; this is the ten lines that turn a decision into a URL.
 */
export function notificationLink(item: {
  type: NotificationType;
  customerId?: string | null;
  documentId?: string | null;
  conversationId?: string | null;
}): string {
  const target = destinationFor(item);
  switch (target.screen) {
    case "document":
      return routes.document(target.id ?? "");
    case "customer":
      return routes.customer(target.id ?? "");
    case "invoices":
      return routes.invoices;
    case "knockRoutes":
      return routes.knockRoutes;
    case "schedule":
      return routes.schedule;
    case "pipeline":
      return routes.pipeline;
    case "chatThread":
      return routes.chatThread(target.id ?? "");
    case "chat":
      return routes.chat;
    case "customers":
    default:
      return routes.customers;
  }
}
