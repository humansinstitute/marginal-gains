import { NOSTR_RELAYS } from "../config";
import { getAppName, getFaviconUrl } from "../routes/app-settings";

import { renderPinModal, renderUnlockCodeModal } from "./components";

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
    ${renderNostrConnectModal()}
    ${renderPinModal()}
    ${renderUnlockCodeModal()}
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
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${appName}" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
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
      <button class="auth-option auth-nostr-connect" type="button" data-nostr-connect>Nostr Connect</button>
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

function renderNostrConnectModal() {
  return `<div class="nostr-connect-overlay" data-nostr-connect-modal hidden>
    <div class="nostr-connect-modal">
      <button class="nostr-connect-close" type="button" data-nostr-connect-close aria-label="Close">&times;</button>
      <h2>Nostr Connect</h2>
      <p class="nostr-connect-description">Scan with your mobile signer (Amber, Nostrsigner) or copy the URI</p>
      <div class="nostr-connect-qr" data-nostr-connect-qr></div>
      <div class="nostr-connect-uri-wrapper">
        <input type="text" class="nostr-connect-uri" data-nostr-connect-uri readonly />
        <button type="button" class="nostr-connect-copy" data-nostr-connect-copy>Copy</button>
      </div>
      <p class="nostr-connect-status" data-nostr-connect-status>Waiting for connection...</p>
      <p class="nostr-connect-timer" data-nostr-connect-timer></p>
      <button type="button" class="nostr-connect-cancel" data-nostr-connect-cancel>Cancel</button>
    </div>
  </div>`;
}

function renderSessionSeed() {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";
  return `<script>
    window.__NOSTR_SESSION__ = null;
    window.__NOSTR_RELAYS__ = ${JSON.stringify(NOSTR_RELAYS)};
    window.__APP_NAME__ = ${JSON.stringify(appName)};
    window.__APP_FAVICON__ = ${JSON.stringify(faviconUrl)};
    window.__RETURN_PATH__ = new URLSearchParams(window.location.search).get("return") || null;
  </script>`;
}
