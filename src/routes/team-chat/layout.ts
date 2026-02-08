/**
 * Channel layout (ordering + sections) handlers
 *
 * Stores layout as JSON in the team's app_settings table (key: "channel.layout").
 * Shape: { sections: [{ id, name, channelIds: number[] }] }
 */

import { isAdmin } from "../../config";
import { jsonResponse } from "../../http";
import { broadcast } from "../../services/events";
import { TeamDatabase } from "../../team-db";

import { forbidden, requireTeamContext } from "./helpers";

import type { Session } from "../../types";

const LAYOUT_KEY = "channel.layout";

interface LayoutSection {
  id: string;
  name: string;
  channelIds: number[];
}

interface ChannelLayout {
  sections: LayoutSection[];
  channelOrder?: number[];
}

function parseLayout(raw: string | null): ChannelLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.sections)) {
      return parsed as ChannelLayout;
    }
    return null;
  } catch {
    return null;
  }
}

export function handleTeamGetChannelLayout(
  session: Session | null,
  teamSlug: string
): Response {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;
  const db = new TeamDatabase(ctx.teamDb);
  const raw = db.getSetting(LAYOUT_KEY);
  const layout = parseLayout(raw);

  return jsonResponse({ layout });
}

export async function handleTeamPutChannelLayout(
  req: Request,
  session: Session | null,
  teamSlug: string
): Promise<Response> {
  const result = requireTeamContext(session, teamSlug);
  if (!result.ok) return result.response;

  const { ctx } = result;

  if (!isAdmin(ctx.session.npub)) {
    return forbidden("Only admins can update channel layout");
  }

  const body = await req.json();
  const { sections, channelOrder } = body;

  if (!Array.isArray(sections)) {
    return jsonResponse({ error: "sections must be an array" }, 400);
  }

  // Validate each section
  for (const section of sections) {
    if (
      typeof section.id !== "string" ||
      typeof section.name !== "string" ||
      !Array.isArray(section.channelIds)
    ) {
      return jsonResponse(
        { error: "Each section must have id (string), name (string), channelIds (number[])" },
        400
      );
    }
  }

  const layout: ChannelLayout = { sections };
  if (Array.isArray(channelOrder)) {
    layout.channelOrder = channelOrder.filter((id: unknown) => typeof id === "number");
  }
  const db = new TeamDatabase(ctx.teamDb);
  db.setSetting(LAYOUT_KEY, JSON.stringify(layout));

  // Broadcast to all connected clients so they see the update
  broadcast(teamSlug, ctx.teamDb, {
    type: "channel:layout",
    data: { layout },
  });

  return jsonResponse({ layout });
}
