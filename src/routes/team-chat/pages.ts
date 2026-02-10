/**
 * Team chat page handlers
 */

import { renderChatPage } from "../../render/chat";
import { TeamDatabase } from "../../team-db";
import { getTeamBranding } from "../app-settings";

import { requireTeamContext } from "./helpers";

import type { DeepLink, Session } from "../../types";

export function handleTeamChatPage(
  session: Session | null,
  teamSlug: string,
  deepLink?: DeepLink
): Response {
  // Build return path based on deep link
  let returnPath = `/t/${teamSlug}/chat`;
  if (deepLink?.type === "channel") {
    returnPath = `/t/${teamSlug}/chat/channel/${deepLink.slug}`;
  } else if (deepLink?.type === "dm") {
    returnPath = `/t/${teamSlug}/chat/dm/${deepLink.id}`;
  }
  const result = requireTeamContext(session, teamSlug, returnPath);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);

  // Check if community encryption is active and user needs onboarding
  let needsOnboarding = false;
  const bootstrapped = db.isCommunityBootstrapped();
  if (bootstrapped) {
    const hasCommunityKey = !!db.getCommunityKey(ctx.session.pubkey);
    needsOnboarding = !hasCommunityKey;
  }

  const branding = getTeamBranding(teamSlug);
  const page = renderChatPage(ctx.session, deepLink, needsOnboarding, teamSlug, branding);
  return new Response(page, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
