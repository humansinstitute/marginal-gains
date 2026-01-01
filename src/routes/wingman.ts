/**
 * Wingman API routes
 * Admin-only endpoints for managing Wingman settings
 */

import { isAdmin } from "../config";
import {
  setSetting,
  listWingmanCosts,
  getWingmanCostSummary,
  getWingmanTotalCost,
  getUserByNpub,
} from "../db";
import { jsonResponse, unauthorized } from "../http";
import { getAvailableCommands } from "../services/slashCommands";
import {
  getWingmanSettings,
  isWingmanAvailable,
} from "../services/wingman";

import type { Session } from "../types";

// Settings keys (must match wingman.ts)
const SETTING_SYSTEM_PROMPT = "wingman_system_prompt";
const SETTING_MODEL = "wingman_model";
const SETTING_ENABLED = "wingman_enabled";

function forbidden(message = "Forbidden") {
  return jsonResponse({ error: message }, 403);
}

/**
 * GET /api/wingman/settings
 * Returns current Wingman settings (admin only)
 */
export function handleGetWingmanSettings(session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) {
    return forbidden("Only admins can access Wingman settings");
  }

  const settings = getWingmanSettings();
  const available = isWingmanAvailable();

  return jsonResponse({
    ...settings,
    available,
  });
}

/**
 * PATCH /api/wingman/settings
 * Update Wingman settings (admin only)
 */
export async function handleUpdateWingmanSettings(req: Request, session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) {
    return forbidden("Only admins can update Wingman settings");
  }

  const body = await req.json();
  const { enabled, systemPrompt, model } = body;

  // Update each setting if provided
  if (typeof enabled === "boolean") {
    setSetting(SETTING_ENABLED, enabled ? "true" : "false");
  }

  if (typeof systemPrompt === "string") {
    setSetting(SETTING_SYSTEM_PROMPT, systemPrompt);
  }

  if (typeof model === "string" && model.trim()) {
    setSetting(SETTING_MODEL, model.trim());
  }

  // Return updated settings
  const settings = getWingmanSettings();
  const available = isWingmanAvailable();

  return jsonResponse({
    ...settings,
    available,
  });
}

/**
 * GET /api/slashcommands
 * Returns available slash commands for the current user (for autocomplete)
 */
export function handleGetSlashCommands(session: Session | null) {
  if (!session) return unauthorized();

  const userIsAdmin = isAdmin(session.npub);
  const commands = getAvailableCommands(userIsAdmin);

  // Return simplified command list for autocomplete
  return jsonResponse(
    commands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }))
  );
}

/**
 * GET /api/wingman/costs
 * Returns Wingman cost tracking data (admin only)
 */
export function handleGetWingmanCosts(session: Session | null) {
  if (!session) return unauthorized();
  if (!isAdmin(session.npub)) {
    return forbidden("Only admins can view Wingman costs");
  }

  // Get summary by user
  const summary = getWingmanCostSummary().map((s) => {
    const user = getUserByNpub(s.npub);
    return {
      ...s,
      display_name: user?.display_name || user?.name || s.npub.slice(0, 12) + "...",
    };
  });

  // Get totals
  const totals = getWingmanTotalCost();

  // Get recent requests
  const recentRequests = listWingmanCosts(50).map((r) => {
    const user = getUserByNpub(r.npub);
    return {
      ...r,
      display_name: user?.display_name || user?.name || r.npub.slice(0, 12) + "...",
    };
  });

  return jsonResponse({
    summary,
    totals,
    recentRequests,
  });
}
