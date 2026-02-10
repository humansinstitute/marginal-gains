import { renderLandingPage } from "../render/landing";

import type { Session } from "../types";

export function handleHome(session: Session | null) {
  if (session) {
    // If user has a team context, go to that team's home page
    if (session.currentTeamSlug) {
      return new Response(null, {
        status: 302,
        headers: { Location: `/t/${session.currentTeamSlug}/home` },
      });
    }
    // Otherwise go to teams page to select one (will auto-redirect if user has one team)
    return new Response(null, {
      status: 302,
      headers: { Location: "/teams" },
    });
  }
  const page = renderLandingPage();
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export type ViewMode = "kanban" | "list";
