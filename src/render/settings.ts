import { APP_NAME, isAdmin } from "../config";
import type { Session } from "../types";

export function renderSettingsPage(session: Session | null) {
  // Non-admins shouldn't reach this page (handled in route), but just in case
  if (!session || !isAdmin(session.npub)) {
    return renderAccessDenied();
  }

  return `<!doctype html>
<html lang="en">
${renderHead()}
<body class="settings-page">
  <main class="settings-shell">
    ${renderHeader(session)}
    ${renderSettingsContent()}
  </main>
  ${renderSessionSeed(session)}
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderHead() {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Settings - ${APP_NAME}</title>
  <meta name="theme-color" content="#0f172a" />
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
    ${renderAppMenu()}
  </header>`;
}

function renderAppMenu() {
  return `<nav class="app-menu" data-app-menu hidden>
    <div class="app-menu-overlay" data-app-menu-overlay></div>
    <div class="app-menu-panel">
      <div class="app-menu-header">
        <span class="app-menu-title">Menu</span>
        <button type="button" class="app-menu-close" data-app-menu-close>&times;</button>
      </div>
      <ul class="app-menu-list">
        <li><a href="/settings" class="app-menu-item active">Settings</a></li>
        <li><a href="/chat" class="app-menu-item">Chat</a></li>
        <li><a href="/todo" class="app-menu-item">Tasks</a></li>
      </ul>
    </div>
  </nav>`;
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

function renderSettingsContent() {
  return `<div class="settings-content">
    <section class="settings-section">
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

    ${renderCreateGroupModal()}
  </div>`;
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

function renderAccessDenied() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Access Denied - ${APP_NAME}</title>
  <link rel="stylesheet" href="/app.css?v=3" />
</head>
<body class="settings-page">
  <main class="settings-shell">
    <div class="settings-access-denied">
      <h1>Access Denied</h1>
      <p>You don't have permission to access settings.</p>
      <a href="/chat" class="primary">Go to Chat</a>
    </div>
  </main>
</body>
</html>`;
}

function renderSessionSeed(session: Session) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session)};
    window.__SETTINGS_PAGE__ = true;
  </script>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}
