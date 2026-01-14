/**
 * Personal Settings Page
 *
 * User-specific settings like account info and notifications.
 * Available to all authenticated users.
 */

import { getAppName, getFaviconUrl } from "../routes/app-settings";

import { renderAppMenu } from "./components";

import type { Session } from "../types";

export function renderPersonalSettingsPage(session: Session) {
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
  <title>Personal Settings - ${appName}</title>
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
      <a href="/wallet" class="avatar-menu-link">Wallet</a>
      <button type="button" data-logout>Log out</button>
    </div>
  </div>`;
}

function renderSettingsContent() {
  return `<div class="settings-content">
    <h2 class="settings-page-title">Personal Settings</h2>

    ${renderAccountSection()}

    <section class="settings-section" data-notifications-section>
      <div class="settings-section-header">
        <h2>Notifications</h2>
      </div>
      <p class="settings-empty">Loading...</p>
    </section>

    <section class="settings-section">
      <div class="settings-section-header">
        <h2>Preferences</h2>
      </div>
      <p class="settings-empty">Coming soon - theme, display settings, etc.</p>
    </section>
  </div>`;
}

function renderAccountSection() {
  return `<section class="settings-section" data-account-section>
      <div class="settings-section-header">
        <h2>Account</h2>
      </div>
      <div class="account-settings-content" data-account-content>
        <p class="settings-empty">Loading...</p>
      </div>
      <div class="account-bunker-settings" data-bunker-settings hidden>
        <p class="bunker-info">You are signed in with a remote signer (Nostr Connect).</p>
        <button type="button" class="ghost danger" data-clear-bunker>Clear Bunker Connection</button>
        <p class="bunker-hint">This will log you out and remove the saved connection.</p>
      </div>
    </section>`;
}

function renderSessionSeed(session: Session) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session)};
    window.__PERSONAL_SETTINGS_PAGE__ = true;
  </script>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}
