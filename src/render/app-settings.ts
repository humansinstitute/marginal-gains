/**
 * App Settings Page (Admin Only)
 *
 * Global application settings like app name and favicon.
 * Only accessible to admins.
 */

import { getAppName, getFaviconUrl } from "../routes/app-settings";

import { renderAppMenu } from "./components";

import type { Session } from "../types";

export function renderAppSettingsPage(session: Session) {
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
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>App Settings - ${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${appName}" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderHeader(session: Session) {
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
    ${renderAppMenu(session, "app-settings")}
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

function renderSettingsContent() {
  return `<div class="settings-content">
    <h2 class="settings-page-title">App Settings</h2>
    <p class="settings-subtitle">Global settings that apply to the entire application.</p>

    ${renderAppSettingsSection()}
  </div>`;
}

function renderAppSettingsSection() {
  return `<section class="settings-section" data-app-settings-section>
      <div class="settings-section-header">
        <h2>Branding</h2>
      </div>
      <div class="app-settings-content" data-app-settings-content>
        <p class="settings-empty">Loading...</p>
      </div>
      <form class="settings-form app-settings-form" data-app-settings-form hidden>
        <label>
          <span>App Name</span>
          <input type="text" name="appName" placeholder="Marginal Gains" maxlength="50" />
          <small class="form-hint">Leave empty to use default</small>
        </label>
        <label>
          <span>Favicon URL</span>
          <input type="url" name="faviconUrl" placeholder="https://example.com/favicon.png" />
          <small class="form-hint">URL to a PNG or ICO file (leave empty for default)</small>
        </label>
        <div class="settings-form-actions">
          <button type="submit" class="primary" data-save-app-settings>Save</button>
        </div>
        <p class="app-settings-status" data-app-settings-status hidden></p>
      </form>
    </section>`;
}

function renderSessionSeed(session: Session) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session)};
    window.__APP_SETTINGS_PAGE__ = true;
    window.__IS_ADMIN__ = true;
  </script>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}
