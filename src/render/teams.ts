/**
 * Teams Page Rendering
 *
 * Renders the teams selection page and team settings page.
 */

import { isAdmin } from "../config";
import { getAppName, getFaviconUrl } from "../routes/app-settings";

import type { Team, TeamMembership, TeamInvitation } from "../db-router";
import type { Session, SessionTeamMembership } from "../types";

// Group info for invite modal
export type InviteGroupOption = {
  id: number;
  name: string;
};

// ============================================================================
// Teams List Page
// ============================================================================

export function renderTeamsPage(session: Session, teams: SessionTeamMembership[]): string {
  return `<!doctype html>
<html lang="en">
${renderHead("Teams")}
<body class="teams-page">
  <main class="teams-shell">
    ${renderTeamsHeader(session)}
    ${renderTeamsContent(session, teams)}
  </main>
  ${renderTeamsSessionSeed(session, teams)}
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderHead(title: string) {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>${title} - ${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${appName}" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderTeamsHeader(session: Session) {
  const appName = getAppName();
  return `<header class="teams-header">
    <div class="header-left">
      <h1 class="app-title">${appName}</h1>
    </div>
    <div class="header-right">
      ${renderAvatarMenu(session)}
    </div>
  </header>`;
}

function renderAvatarMenu(session: Session) {
  return `<div class="session-controls" data-session-controls>
    <button class="avatar-chip" type="button" data-avatar title="Account menu">
      <span class="avatar-fallback" data-avatar-fallback>${formatAvatarFallback(session.npub)}</span>
      <img data-avatar-img alt="Profile photo" loading="lazy" hidden />
    </button>
    <div class="avatar-menu" data-avatar-menu hidden>
      <button type="button" data-logout>Log out</button>
    </div>
  </div>`;
}

function renderTeamsContent(session: Session, teams: SessionTeamMembership[]) {
  const canCreate = isAdmin(session.npub);

  return `<div class="teams-content">
    <section class="teams-section">
      <div class="teams-section-header">
        <h2>Your Teams</h2>
        ${canCreate ? `<button type="button" class="primary" data-create-team>Create Team</button>` : ""}
      </div>

      ${teams.length === 0 ? renderNoTeams() : renderTeamsList(teams)}
    </section>

    ${renderJoinTeamSection()}
    ${renderCreateTeamModal()}
  </div>`;
}

function renderNoTeams() {
  return `<div class="teams-empty">
    <p>You're not a member of any teams yet.</p>
    <p>Join a team using an invite code or create your own.</p>
  </div>`;
}

function renderTeamsList(teams: SessionTeamMembership[]) {
  const teamCards = teams
    .map(
      (team) => {
        const iconContent = team.iconUrl
          ? `<img src="${escapeHtml(team.iconUrl)}" alt="" class="team-icon-img" />`
          : `<span class="team-icon-fallback">${team.displayName.slice(0, 2).toUpperCase()}</span>`;

        return `<div class="team-card-wrapper">
      <button type="button" class="team-card" data-select-team="${team.teamSlug}">
        <div class="team-card-icon">
          ${iconContent}
        </div>
        <div class="team-card-info">
          <span class="team-card-name">${escapeHtml(team.displayName)}</span>
          <span class="team-card-role">${team.role}</span>
        </div>
        <span class="team-card-arrow">&rarr;</span>
      </button>
      ${team.role === "owner" ? `<button type="button" class="team-delete-btn ghost danger" data-delete-team-id="${team.teamId}" data-delete-team-name="${escapeHtml(team.displayName)}" title="Delete team">&times;</button>` : ""}
    </div>`;
      }
    )
    .join("");

  return `<div class="teams-list">${teamCards}</div>`;
}

function renderJoinTeamSection() {
  return `<section class="teams-section teams-join">
    <div class="teams-section-header">
      <h2>Join a Team</h2>
    </div>
    <form class="teams-join-form" data-join-team-form>
      <input type="text" name="code" placeholder="Enter invite code" required />
      <button type="submit" class="primary">Join</button>
    </form>
    <p class="teams-join-error" data-join-error hidden></p>
  </section>`;
}

function renderCreateTeamModal() {
  return `<div class="teams-modal" data-create-team-modal hidden>
    <div class="teams-modal-body">
      <header class="teams-modal-header">
        <h3>Create Team</h3>
        <button type="button" class="ghost" data-close-modal>&times;</button>
      </header>
      <form class="teams-form" data-create-team-form>
        <label>
          <span>Team Name</span>
          <input type="text" name="displayName" required placeholder="My Team" maxlength="50" />
        </label>
        <label>
          <span>Team URL</span>
          <div class="teams-slug-input">
            <span class="teams-slug-prefix">/t/</span>
            <input type="text" name="slug" required placeholder="my-team" maxlength="32" pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" />
          </div>
          <small class="form-hint">Lowercase letters, numbers, and hyphens only. 3-32 characters.</small>
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="2" placeholder="What is this team for?"></textarea>
        </label>
        <div class="teams-form-actions">
          <button type="button" class="ghost" data-close-modal>Cancel</button>
          <button type="submit" class="primary">Create Team</button>
        </div>
        <p class="teams-form-error" data-form-error hidden></p>
      </form>
    </div>
  </div>`;
}

function renderTeamsSessionSeed(session: Session, teams: SessionTeamMembership[]) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session)};
    window.__TEAMS_PAGE__ = true;
    window.__USER_TEAMS__ = ${JSON.stringify(teams)};
    window.__CAN_CREATE_TEAMS__ = ${isAdmin(session.npub)};
  </script>`;
}

// ============================================================================
// Team Settings Page
// ============================================================================

export function renderTeamSettingsPage(
  session: Session,
  team: Team,
  members: TeamMembership[],
  invitations: TeamInvitation[],
  isOwner: boolean,
  groups: InviteGroupOption[] = []
): string {
  return `<!doctype html>
<html lang="en">
${renderHead(`${team.display_name} Settings`)}
<body class="team-settings-page">
  <main class="team-settings-shell">
    ${renderTeamSettingsHeader(session, team)}
    ${renderTeamSettingsContent(session, team, members, invitations, isOwner, groups)}
  </main>
  ${renderTeamSettingsSessionSeed(session, team, isOwner)}
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderTeamSettingsHeader(session: Session, team: Team) {
  return `<header class="team-settings-header">
    <div class="header-left">
      <a href="/t/${team.slug}/chat" class="back-link">&larr; Back to ${escapeHtml(team.display_name)}</a>
    </div>
    <div class="header-right">
      ${renderAvatarMenu(session)}
    </div>
  </header>`;
}

function renderTeamSettingsContent(
  session: Session,
  team: Team,
  members: TeamMembership[],
  invitations: TeamInvitation[],
  isOwner: boolean,
  groups: InviteGroupOption[] = []
) {
  return `<div class="team-settings-content">
    ${renderTeamInfoSection(team, isOwner)}
    ${renderFeatureVisibilitySection(team)}
    ${renderTeamMembersSection(members, isOwner)}
    ${renderTeamInvitationsSection(invitations)}
    ${isOwner ? renderTeamDangerZone(team) : ""}
    ${renderInviteModal(groups)}
  </div>`;
}

function renderFeatureVisibilitySection(team: Team) {
  return `<section class="settings-section">
    <div class="settings-section-header">
      <h2>Feature Visibility</h2>
    </div>
    <p class="settings-section-desc">Control which features are visible in the sidebar for team members.</p>
    <form class="settings-form" data-feature-visibility-form data-team-id="${team.id}">
      <label class="settings-toggle">
        <input type="checkbox" name="hideTasks" ${team.hide_tasks ? "checked" : ""} />
        <span>Hide Tasks</span>
        <small class="form-hint">Hide the Tasks section from the sidebar.</small>
      </label>
      <label class="settings-toggle">
        <input type="checkbox" name="hideCrm" ${team.hide_crm ? "checked" : ""} />
        <span>Hide CRM</span>
        <small class="form-hint">Hide the CRM section from the sidebar.</small>
      </label>
      <div class="settings-form-actions">
        <button type="submit" class="primary">Save Changes</button>
      </div>
    </form>
  </section>`;
}

function renderTeamInfoSection(team: Team, isOwner: boolean) {
  const iconPreview = team.icon_url
    ? `<img src="${escapeHtml(team.icon_url)}" alt="Team icon" class="team-icon-img" />`
    : `<span class="team-icon-fallback">${team.display_name.slice(0, 2).toUpperCase()}</span>`;

  return `<section class="settings-section">
    <div class="settings-section-header">
      <h2>Team Information</h2>
    </div>
    <form class="settings-form" data-team-info-form>
      <label>
        <span>Name</span>
        <input type="text" name="displayName" value="${escapeHtml(team.display_name)}" ${isOwner ? "" : "disabled"} />
      </label>
      <label>
        <span>Description</span>
        <textarea name="description" rows="2" ${isOwner ? "" : "disabled"}>${escapeHtml(team.description)}</textarea>
      </label>
      <div class="form-field">
        <span class="form-label">Team Icon</span>
        <div class="team-icon-upload" data-team-id="${team.id}">
          <div class="team-icon-current" data-icon-preview>
            ${iconPreview}
          </div>
          ${isOwner ? `<div class="team-icon-actions">
            <label class="btn secondary team-icon-upload-btn">
              <input type="file" name="icon" accept="image/png,image/jpeg,image/gif,image/webp" hidden data-icon-input />
              Upload Icon
            </label>
            <small class="form-hint">PNG, JPEG, GIF, or WebP. Max 5MB.</small>
          </div>` : ""}
        </div>
      </div>
      <label>
        <span>Team URL</span>
        <input type="text" value="/t/${team.slug}" disabled />
        <small class="form-hint">Team URLs cannot be changed after creation.</small>
      </label>
      ${isOwner ? `<div class="settings-form-actions">
        <button type="submit" class="primary">Save Changes</button>
      </div>` : ""}
    </form>
  </section>`;
}

function renderTeamMembersSection(members: TeamMembership[], isOwner: boolean) {
  const memberRows = members
    .map(
      (m) => `<tr>
      <td class="member-npub" title="${m.user_npub}">${formatNpub(m.user_npub)}</td>
      <td class="member-role">
        ${isOwner ? `<select data-member-role="${m.user_npub}" ${m.role === "owner" ? "disabled" : ""}>
          <option value="member" ${m.role === "member" ? "selected" : ""}>Member</option>
          <option value="manager" ${m.role === "manager" ? "selected" : ""}>Manager</option>
          <option value="owner" ${m.role === "owner" ? "selected" : ""}>Owner</option>
        </select>` : m.role}
      </td>
      <td class="member-actions">
        ${isOwner && m.role !== "owner" ? `<button type="button" class="ghost danger" data-remove-member="${m.user_npub}">Remove</button>` : ""}
      </td>
    </tr>`
    )
    .join("");

  return `<section class="settings-section">
    <div class="settings-section-header">
      <h2>Members (${members.length})</h2>
      ${isOwner ? `<button type="button" class="primary" data-add-member>Add Member</button>` : ""}
    </div>
    <table class="team-members-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Role</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${memberRows}
      </tbody>
    </table>
    ${renderAddMemberModal()}
  </section>`;
}

function renderAddMemberModal() {
  return `<div class="teams-modal" data-add-member-modal hidden>
    <div class="teams-modal-body">
      <header class="teams-modal-header">
        <h3>Add Member</h3>
        <button type="button" class="ghost" data-close-modal>&times;</button>
      </header>
      <form class="teams-form" data-add-member-form>
        <label>
          <span>Search User</span>
          <input type="text" name="npub" required placeholder="Search by name or paste npub..." list="team-user-suggestions" data-team-member-input />
          <datalist id="team-user-suggestions" data-team-user-suggestions></datalist>
          <small class="form-hint">Start typing to search known users, or paste a full npub.</small>
        </label>
        <label>
          <span>Role</span>
          <select name="role">
            <option value="member" selected>Member</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <div class="teams-form-actions">
          <button type="button" class="ghost" data-close-modal>Cancel</button>
          <button type="submit" class="primary">Add Member</button>
        </div>
        <p class="teams-form-error" data-form-error hidden></p>
      </form>
    </div>
  </div>`;
}

function renderTeamInvitationsSection(invitations: TeamInvitation[]) {
  const inviteRows = invitations
    .map((inv) => {
      const expiresDate = new Date(inv.expires_at * 1000);
      const isExpired = expiresDate < new Date();
      const labelDisplay = inv.label ? escapeHtml(inv.label) : `<span class="text-muted">No label</span>`;
      return `<tr class="${isExpired ? "expired" : ""}">
        <td class="invite-label">${labelDisplay}</td>
        <td class="invite-role">${inv.role}</td>
        <td class="invite-usage">${inv.single_use ? "Single" : "Multi"} (${inv.redeemed_count})</td>
        <td class="invite-expires">${isExpired ? "Expired" : expiresDate.toLocaleDateString()}</td>
        <td class="invite-actions">
          <button type="button" class="ghost danger" data-delete-invite="${inv.id}">Delete</button>
        </td>
      </tr>`;
    })
    .join("");

  return `<section class="settings-section">
    <div class="settings-section-header">
      <h2>Invitations</h2>
      <button type="button" class="primary" data-create-invite>Create Invite</button>
    </div>
    ${invitations.length === 0 ? `<p class="settings-empty">No active invitations</p>` : `<table class="team-invites-table">
      <thead>
        <tr>
          <th>Label</th>
          <th>Role</th>
          <th>Usage</th>
          <th>Expires</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${inviteRows}
      </tbody>
    </table>`}
  </section>`;
}

function renderInviteModal(groups: InviteGroupOption[] = []) {
  const groupCheckboxes = groups.length > 0 ? `
        <fieldset class="invite-groups-fieldset">
          <legend>Auto-join groups (optional)</legend>
          <div class="invite-groups-list">
            ${groups.map((g) => `
              <label class="checkbox-label group-option">
                <input type="checkbox" name="groupIds" value="${g.id}" />
                <span class="group-name">${escapeHtml(g.name)}</span>
              </label>
            `).join("")}
          </div>
        </fieldset>` : "";

  return `<div class="teams-modal" data-invite-modal hidden>
    <div class="teams-modal-body">
      <header class="teams-modal-header">
        <h3>Create Invitation</h3>
        <button type="button" class="ghost" data-close-modal>&times;</button>
      </header>
      <form class="teams-form" data-create-invite-form>
        <label>
          <span>Label (optional)</span>
          <input type="text" name="label" placeholder="e.g. Workshop on 5th" />
          <small class="form-hint">A name to help you identify this invite code.</small>
        </label>
        <label>
          <span>Role for new members</span>
          <select name="role">
            <option value="member" selected>Member</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <label>
          <span>Expires in</span>
          <select name="expiresInHours">
            <option value="24">1 day</option>
            <option value="72">3 days</option>
            <option value="168" selected>7 days</option>
            <option value="336">14 days</option>
          </select>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" name="singleUse" checked />
          <span>Single-use (can only be used once)</span>
        </label>
        ${groupCheckboxes}
        <div class="teams-form-actions">
          <button type="button" class="ghost" data-close-modal>Cancel</button>
          <button type="submit" class="primary">Create</button>
        </div>
      </form>
      <div class="invite-result" data-invite-result hidden>
        <p>Share this link with new members:</p>
        <div class="invite-code-display">
          <input type="text" data-invite-link readonly />
          <button type="button" class="ghost" data-copy-invite>Copy</button>
        </div>
        <p class="invite-hint">This link will not be shown again.</p>
      </div>
    </div>
  </div>`;
}

function renderTeamDangerZone(team: Team) {
  return `<section class="settings-section danger-zone">
    <div class="settings-section-header">
      <h2>Danger Zone</h2>
    </div>
    <div class="danger-zone-content">
      <p>Deleting this team will remove all members and deactivate the team. This action cannot be undone.</p>
      <button type="button" class="danger" data-delete-team="${team.id}">Delete Team</button>
    </div>
  </section>`;
}

function renderTeamSettingsSessionSeed(session: Session, team: Team, isOwner: boolean) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session)};
    window.__TEAM_SETTINGS_PAGE__ = true;
    window.__CURRENT_TEAM__ = ${JSON.stringify({
      id: team.id,
      slug: team.slug,
      displayName: team.display_name,
    })};
    window.__IS_TEAM_OWNER__ = ${isOwner};
  </script>`;
}

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNpub(npub: string): string {
  if (npub.length <= 16) return npub;
  return `${npub.slice(0, 10)}...${npub.slice(-6)}`;
}

function formatAvatarFallback(npub: string): string {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}
