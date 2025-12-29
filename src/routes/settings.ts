import { isAdmin } from "../config";
import { renderSettingsPage } from "../render/settings";
import type { Session } from "../types";

export function handleSettings(session: Session | null) {
  // Redirect non-admins to chat
  if (!session || !isAdmin(session.npub)) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/chat" },
    });
  }

  const page = renderSettingsPage(session);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
