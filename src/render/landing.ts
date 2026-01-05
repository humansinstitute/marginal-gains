import { getAppName, getFaviconUrl } from "../routes/app-settings";

import { renderPinModal } from "./components";

export function renderLandingPage() {
  return `<!doctype html>
<html lang="en">
${renderHead()}
<body>
  <main class="app-shell">
    ${renderHeader()}
    ${renderWelcome()}
    ${renderAuth()}
    ${renderQrModal()}
    ${renderPinModal()}
  </main>
  ${renderSessionSeed()}
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderHead() {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${appName}" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderHeader() {
  const appName = getAppName();
  return `<header class="page-header">
    <div class="header-left">
      <h1 class="app-title">${appName}</h1>
    </div>
  </header>`;
}

function renderWelcome() {
  const appName = getAppName();
  const logoUrl = getFaviconUrl() || "/logo.png";
  return `<section class="welcome-section">
    <img src="${logoUrl}" alt="${appName}" class="auth-logo" />
    <h2>Welcome to ${appName}</h2>
    <p class="welcome-description">A nostr native community chat app, think slack, but client side encrypted and with a service that respects its users.</p>
  </section>`;
}

function renderAuth() {
  return `<section class="auth-panel" data-login-panel>
    <h2>Sign in with Nostr to get started</h2>
    <p class="auth-description">Start with a quick Ephemeral ID or bring your own signer.</p>
    <div class="auth-actions">
      <button class="auth-option" type="button" data-login-method="ephemeral">Sign Up</button>
      <button class="auth-option auth-extension" type="button" data-login-method="extension">Log in with Nostr Extension</button>
    </div>
    <details class="auth-advanced">
      <summary>Advanced Options (nsec, bunker://...)</summary>
      <p>Connect to a remote bunker or sign in with your secret key.</p>
      <form data-bunker-form>
        <input name="bunker" placeholder="nostrconnect://… or name@example.com" autocomplete="off" />
        <button class="bunker-submit" type="submit">Connect bunker</button>
      </form>
      <form data-secret-form>
        <div class="secret-input-wrapper">
          <input type="password" name="secret" placeholder="nsec1…" autocomplete="off" />
          <button type="button" class="secret-toggle" data-toggle-secret aria-label="Show secret">&#128065;</button>
        </div>
        <button class="bunker-submit" type="submit">Sign in with secret</button>
      </form>
    </details>
    <p class="auth-error" data-login-error hidden></p>
  </section>`;
}

function renderQrModal() {
  return `<div class="qr-modal-overlay" data-qr-modal hidden>
    <div class="qr-modal">
      <button class="qr-modal-close" type="button" data-qr-close aria-label="Close">&times;</button>
      <h2>Login QR Code</h2>
      <p>Scan this code with your mobile device to log in</p>
      <div class="qr-canvas-container" data-qr-container></div>
    </div>
  </div>`;
}

function renderSessionSeed() {
  return `<script>
    window.__NOSTR_SESSION__ = null;
  </script>`;
}
