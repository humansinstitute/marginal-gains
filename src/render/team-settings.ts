/**
 * Team Settings Page
 *
 * Team-specific settings like Groups and Wingman AI configuration.
 * Available to team members, with some features admin-only.
 */

import { getAppName, getFaviconUrl } from "../routes/app-settings";

import { renderAppMenu } from "./components";

import type { Session } from "../types";

export function renderTeamConfigPage(session: Session, teamSlug: string) {
  const teamName = session.teamMemberships?.find(
    (m) => m.teamSlug === teamSlug
  )?.displayName || teamSlug;

  return `<!doctype html>
<html lang="en">
${renderHead(teamName)}
<body class="settings-page">
  <main class="settings-shell">
    ${renderHeader(session, teamName)}
    ${renderSettingsContent(teamName, teamSlug)}
  </main>
  ${renderSessionSeed(session, teamSlug)}
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderHead(teamName: string) {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>${teamName} Settings - ${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${appName}" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderHeader(session: Session, _teamName: string) {
  const appName = getAppName();
  return `<header class="settings-header">
    <div class="header-left">
      <button class="hamburger-btn" type="button" data-hamburger-toggle aria-label="Menu">
        <span class="hamburger-icon"></span>
      </button>
      <h1 class="app-title">${appName}</h1>
    </div>
    <div class="header-right">
      ${renderAvatarMenu(session)}
    </div>
    ${renderAppMenu(session, "team-settings")}
  </header>`;
}

function renderAvatarMenu(session: Session) {
  return `<div class="session-controls" data-session-controls>
    <button class="avatar-chip" type="button" data-avatar title="Account menu">
      <span class="avatar-fallback" data-avatar-fallback>${formatAvatarFallback(session.npub)}</span>
      <img data-avatar-img alt="Profile photo" loading="lazy" hidden />
    </button>
    <div class="avatar-menu" data-avatar-menu hidden>
      <button type="button" data-view-profile>View Profile</button>
      <button type="button" data-copy-id>Copy ID</button>
      <a href="/wallet" class="avatar-menu-link">Wallet</a>
      <button type="button" data-logout>Log out</button>
    </div>
  </div>`;
}

function renderSettingsContent(teamName: string, teamSlug: string) {
  return `<div class="settings-content">
    <h2 class="settings-page-title">${escapeHtml(teamName)} Settings</h2>
    <p class="settings-subtitle">Settings that apply to this team.</p>

    ${renderTeamManagementSection(teamSlug)}
    ${renderWingmanSection()}
    ${renderGroupsSection()}
  </div>`;
}

function renderTeamManagementSection(teamSlug: string) {
  return `<section class="settings-section">
      <div class="settings-section-header">
        <h2>Team Management</h2>
        <a href="/t/${teamSlug}/settings" class="primary button-link">Manage Members & Invites</a>
      </div>
      <p class="settings-description">Add or remove team members, change roles, and create invite links.</p>
    </section>`;
}

function renderWingmanSection() {
  return `<section class="settings-section" data-wingman-section>
      <div class="settings-section-header">
        <h2>Wingman AI</h2>
      </div>
      <div class="settings-wingman-content" data-wingman-content>
        <p class="settings-empty">Loading...</p>
      </div>
    </section>`;
}

function renderGroupsSection() {
  return `<section class="settings-section">
      <div class="settings-section-header">
        <h2>Groups</h2>
        <button type="button" class="primary" data-create-group>Create Group</button>
      </div>
      <div class="settings-groups-list" data-groups-list>
        <p class="settings-empty">Loading groups...</p>
      </div>
    </section>

    <section class="settings-section" data-members-section hidden>
      <div class="settings-section-header">
        <h2 data-members-group-name>Group Members</h2>
        <button type="button" class="ghost" data-close-members>&times;</button>
      </div>
      <div class="settings-add-member">
        <input type="text" placeholder="Search users or paste npub..." data-member-input list="user-suggestions" />
        <datalist id="user-suggestions" data-user-suggestions></datalist>
        <button type="button" class="primary" data-add-member>Add</button>
      </div>
      <div class="settings-members-list" data-members-list>
        <p class="settings-empty">No members yet</p>
      </div>
    </section>

    ${renderCreateGroupModal()}`;
}

function renderCreateGroupModal() {
  return `<div class="settings-modal" data-group-modal hidden>
    <div class="settings-modal-body">
      <header class="settings-modal-header">
        <h3>Create Group</h3>
        <button type="button" class="ghost" data-close-group-modal>&times;</button>
      </header>
      <form class="settings-form" data-group-form>
        <label>
          <span>Name</span>
          <input name="name" required placeholder="e.g. operations" />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="2" placeholder="What is this group for?"></textarea>
        </label>
        <div class="settings-form-actions">
          <button type="button" class="ghost" data-close-group-modal>Cancel</button>
          <button type="submit" class="primary">Create</button>
        </div>
      </form>
    </div>
  </div>

  <div class="settings-modal" data-group-edit-modal hidden>
    <div class="settings-modal-body">
      <header class="settings-modal-header">
        <h3 data-group-edit-title>Edit Group</h3>
        <button type="button" class="ghost" data-close-group-edit>&times;</button>
      </header>
      <form class="settings-form" data-group-edit-form>
        <input type="hidden" name="groupId" data-group-edit-id />
        <label>
          <span>Name</span>
          <input name="name" required data-group-edit-name />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="2" data-group-edit-description></textarea>
        </label>
        <label>
          <span>Optikon Workspace</span>
          <select name="optikonWorkspaceId" data-group-edit-workspace>
            <option value="">No default workspace</option>
          </select>
          <small class="settings-field-hint">Tasks in this group will create boards in this Optikon workspace by default.</small>
        </label>
        <div class="settings-form-actions">
          <button type="button" class="ghost" data-close-group-edit>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderSessionSeed(session: Session, teamSlug: string) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session)};
    window.__TEAM_SETTINGS_PAGE__ = true;
    window.__TEAM_SLUG__ = ${JSON.stringify(teamSlug)};
  </script>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
