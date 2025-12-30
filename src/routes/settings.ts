import { renderSettingsPage } from "../render/settings";
import type { Session } from "../types";

export function handleSettings(session: Session | null) {
  // Redirect unauthenticated users to home
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
  }

  const page = renderSettingsPage(session);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
