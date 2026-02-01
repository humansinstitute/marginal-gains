import { isAdmin } from "../config";
import { getTeamBySlug } from "../master-db";

import type { Session } from "../types";

export type ActivePage = "teams" | "settings" | "team-settings" | "app-settings" | "chat" | "tasks" | "crm";

export function renderPinModal() {
  const numpadButtons = [1, 2, 3, 4, 5, 6, 7, 8, 9, "clear", 0, "back"]
    .map((key) => {
      if (key === "clear") {
        return `<button type="button" class="pin-key pin-key-action" data-pin-clear>C</button>`;
      }
      if (key === "back") {
        return `<button type="button" class="pin-key pin-key-action" data-pin-back>&larr;</button>`;
      }
      return `<button type="button" class="pin-key" data-pin-digit="${key}">${key}</button>`;
    })
    .join("");

  return `<div class="pin-modal-overlay" data-pin-modal hidden>
    <div class="pin-modal">
      <h2 data-pin-title>Enter PIN</h2>
      <p data-pin-subtitle>Enter your 6-digit PIN to unlock</p>
      <div class="pin-display">
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
      </div>
      <p class="pin-error" data-pin-error hidden>Wrong PIN. Try again.</p>
      <div class="pin-numpad">
        ${numpadButtons}
      </div>
      <button type="button" class="pin-cancel" data-pin-cancel>Cancel</button>
    </div>
  </div>`;
}

/**
 * Render unlock code modal for Key Teleport v2
 * User pastes throwaway nsec to decrypt their key
 */
export function renderUnlockCodeModal() {
  return `<div class="unlock-modal-overlay" data-unlock-modal hidden>
    <div class="unlock-modal">
      <h2 data-unlock-title>Paste Unlock Code</h2>
      <p data-unlock-subtitle>Paste the unlock code from your clipboard to complete login</p>
      <input
        type="password"
        class="unlock-input"
        data-unlock-input
        placeholder="paste code"
        autocomplete="off"
        spellcheck="false"
      />
      <p class="unlock-error" data-unlock-error hidden>Invalid unlock code. Please try again.</p>
      <div class="unlock-actions">
        <button type="button" class="unlock-cancel" data-unlock-cancel>Cancel</button>
        <button type="button" class="unlock-submit" data-unlock-submit>Unlock</button>
      </div>
    </div>
  </div>`;
}

/**
 * Render Key Teleport setup modal
 * Shows registration blob for user to copy and paste into Welcome
 */
export function renderKeyTeleportSetupModal() {
  return `<div class="keyteleport-setup-overlay" data-keyteleport-setup-modal hidden>
    <div class="keyteleport-setup-modal">
      <h2>Setup Key Teleport</h2>
      <p>Copy this registration code and paste it into your Welcome key manager to register this app.</p>
      <textarea
        class="keyteleport-setup-blob"
        data-keyteleport-setup-blob
        readonly
        rows="4"
        placeholder="Loading..."
      ></textarea>
      <p class="keyteleport-setup-status" data-keyteleport-setup-status hidden></p>
      <div class="keyteleport-setup-actions">
        <button type="button" class="keyteleport-setup-cancel" data-keyteleport-setup-cancel>Close</button>
        <button type="button" class="keyteleport-setup-copy" data-keyteleport-setup-copy>Copy Code</button>
      </div>
    </div>
  </div>`;
}

export type FeatureVisibility = {
  hideTasks?: boolean;
  hideCrm?: boolean;
};

export function renderAppMenu(
  session: Session | null,
  activePage: ActivePage,
  featureVisibility?: FeatureVisibility
) {
  // Team selector is first in the menu
  const teamSelector = session ? renderTeamSelector(session) : "";

  // Build team-scoped links if team is selected
  const teamSlug = session?.currentTeamSlug;
  const chatHref = teamSlug ? `/t/${teamSlug}/chat` : "/chat";
  const tasksHref = teamSlug ? `/t/${teamSlug}/todo` : "/todo";
  const teamConfigHref = teamSlug ? `/t/${teamSlug}/config` : null;

  // Get feature visibility from team settings if not provided
  let visibility = featureVisibility;
  if (!visibility && teamSlug) {
    const team = getTeamBySlug(teamSlug);
    if (team) {
      visibility = {
        hideTasks: !!team.hide_tasks,
        hideCrm: !!team.hide_crm,
      };
    }
  }
  visibility = visibility || {};

  // Tasks link - can be hidden per-team
  const tasksLink = !visibility.hideTasks
    ? `<li><a href="${tasksHref}" class="app-menu-item${activePage === "tasks" ? " active" : ""}">Tasks</a></li>`
    : "";

  // CRM link - team-scoped for managers, global for admins
  const crmHref = teamSlug ? `/t/${teamSlug}/crm` : "/crm";
  // In team context, show to team managers (owner/manager role)
  // Outside team context, show to admins only
  const currentMembership = session?.teamMemberships?.find(
    (m) => m.teamSlug === teamSlug
  );
  const isTeamManager = currentMembership?.role === "owner" || currentMembership?.role === "manager";
  const canAccessCrm = session && (teamSlug ? isTeamManager : isAdmin(session.npub)) && !visibility.hideCrm;
  const crmLink = canAccessCrm
    ? `<li><a href="${crmHref}" class="app-menu-item${activePage === "crm" ? " active" : ""}">CRM</a></li>`
    : "";

  // Team settings link (only if in a team context)
  const teamSettingsLink = session && teamConfigHref
    ? `<li><a href="${teamConfigHref}" class="app-menu-item${activePage === "team-settings" ? " active" : ""}">Team Settings</a></li>`
    : "";

  // Personal settings link
  const personalSettingsLink = session
    ? `<li><a href="/settings" class="app-menu-item${activePage === "settings" ? " active" : ""}">Personal Settings</a></li>`
    : "";

  // App settings link (admin only)
  const appSettingsLink = session && isAdmin(session.npub)
    ? `<li><a href="/admin/settings" class="app-menu-item${activePage === "app-settings" ? " active" : ""}">App Settings</a></li>`
    : "";

  return `<nav class="app-menu" data-app-menu hidden>
    <div class="app-menu-overlay" data-app-menu-overlay></div>
    <div class="app-menu-panel">
      <div class="app-menu-header">
        <span class="app-menu-title">Menu</span>
        <button type="button" class="app-menu-close" data-app-menu-close>&times;</button>
      </div>
      ${teamSelector}
      <ul class="app-menu-list">
        <li><a href="${chatHref}" class="app-menu-item${activePage === "chat" ? " active" : ""}">Chat</a></li>
        ${tasksLink}
        ${crmLink}
        ${teamSettingsLink}
      </ul>
      <hr class="app-menu-divider" />
      <ul class="app-menu-list">
        ${personalSettingsLink}
        ${appSettingsLink}
      </ul>
    </div>
  </nav>`;
}

/**
 * Render the team selector dropdown (first item in menu)
 * Shows current team and allows switching between teams
 */
function renderTeamSelector(session: Session) {
  const currentTeam = session.currentTeamSlug
    ? session.teamMemberships?.find((m) => m.teamSlug === session.currentTeamSlug)
    : null;

  const teamName = currentTeam?.displayName || "Select Team";
  const hasMultipleTeams = (session.teamMemberships?.length || 0) > 1;

  // Show team icon if available, otherwise show 2-letter fallback
  const iconContent = currentTeam?.iconUrl
    ? `<img src="${escapeHtml(currentTeam.iconUrl)}" alt="" class="team-selector-icon-img" />`
    : `<span class="team-selector-icon-fallback">${currentTeam ? teamName.slice(0, 2).toUpperCase() : "?"}</span>`;

  return `<div class="team-selector" data-team-selector>
    <button type="button" class="team-selector-btn" data-team-selector-btn>
      <span class="team-selector-icon">${iconContent}</span>
      <span class="team-selector-name">${escapeHtml(teamName)}</span>
      ${hasMultipleTeams ? `<span class="team-selector-arrow">&#9662;</span>` : ""}
    </button>
    <div class="team-selector-dropdown" data-team-dropdown hidden>
      ${renderTeamDropdownItems(session)}
      <div class="team-selector-divider"></div>
      <a href="/teams?manage=1" class="team-selector-item team-selector-manage">Manage Teams</a>
    </div>
  </div>`;
}

function renderTeamDropdownItems(session: Session) {
  if (!session.teamMemberships || session.teamMemberships.length === 0) {
    return `<span class="team-selector-empty">No teams</span>`;
  }

  return session.teamMemberships
    .map((team) => {
      // Show team icon if available, otherwise show 2-letter fallback
      const iconContent = team.iconUrl
        ? `<img src="${escapeHtml(team.iconUrl)}" alt="" class="team-selector-icon-img" />`
        : `<span class="team-selector-icon-fallback">${team.displayName.slice(0, 2).toUpperCase()}</span>`;

      return `<button type="button" class="team-selector-item${
        team.teamSlug === session.currentTeamSlug ? " active" : ""
      }" data-switch-team="${team.teamSlug}">
      <span class="team-selector-icon">${iconContent}</span>
      <span>${escapeHtml(team.displayName)}</span>
      ${team.teamSlug === session.currentTeamSlug ? `<span class="team-check">&#10003;</span>` : ""}
    </button>`;
    })
    .join("");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
