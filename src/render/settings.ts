import { APP_NAME, isAdmin } from "../config";

import { renderAppMenu } from "./components";

import type { Session } from "../types";

export function renderSettingsPage(session: Session) {
  const userIsAdmin = isAdmin(session.npub);

  return `<!doctype html>
<html lang="en">
${renderHead()}
<body class="settings-page">
  <main class="settings-shell">
    ${renderHeader(session)}
    ${renderSettingsContent(userIsAdmin)}
  </main>
  ${renderSessionSeed(session, userIsAdmin)}
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderHead() {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>Settings - ${APP_NAME}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${APP_NAME}" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderHeader(session: Session) {
  return `<header class="settings-header">
    <div class="header-left">
      <button class="hamburger-btn" type="button" data-hamburger-toggle aria-label="Menu">
        <span class="hamburger-icon"></span>
      </button>
      <h1 class="app-title">${APP_NAME}</h1>
    </div>
    <div class="header-right">
      ${renderAvatarMenu(session)}
    </div>
    ${renderAppMenu(session, "settings")}
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
      <button type="button" data-export-secret ${session.method === "ephemeral" ? "" : "hidden"}>Export Secret</button>
      <button type="button" data-show-login-qr ${session.method === "ephemeral" ? "" : "hidden"}>Show Login QR</button>
      <button type="button" data-copy-id>Copy ID</button>
      <button type="button" data-logout>Log out</button>
    </div>
  </div>`;
}

function renderSettingsContent(userIsAdmin: boolean) {
  return `<div class="settings-content">
    <section class="settings-section" data-notifications-section>
      <div class="settings-section-header">
        <h2>Notifications</h2>
      </div>
      <p class="settings-empty">Loading...</p>
    </section>

    ${userIsAdmin ? renderWingmanSection() : ""}
    ${userIsAdmin ? renderGroupsSection() : ""}
  </div>`;
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
  </div>`;
}

function renderSessionSeed(session: Session, userIsAdmin: boolean) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session)};
    window.__SETTINGS_PAGE__ = true;
    window.__IS_ADMIN__ = ${userIsAdmin};
  </script>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}
