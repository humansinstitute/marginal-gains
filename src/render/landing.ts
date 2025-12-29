import { APP_NAME } from "../config";

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
  </main>
  ${renderSessionSeed()}
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderHead() {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_NAME}</title>
  <meta name="theme-color" content="#111111" />
  <meta name="application-name" content="${APP_NAME}" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderHeader() {
  return `<header class="page-header">
    <div class="header-left">
      <h1 class="app-title">${APP_NAME}</h1>
    </div>
  </header>`;
}

function renderWelcome() {
  return `<section class="welcome-section">
    <h2>Welcome to ${APP_NAME}</h2>
    <p class="welcome-description">A simple tool to help you track your daily marginal gains.</p>
  </section>`;
}

function renderAuth() {
  return `<section class="auth-panel" data-login-panel>
    <h2>Sign in with Nostr to get started</h2>
    <p class="auth-description">Start with a quick Ephemeral ID or bring your own signer.</p>
    <div class="auth-actions">
      <button class="auth-option" type="button" data-login-method="ephemeral">Sign Up</button>
    </div>
    <details class="auth-advanced">
      <summary>Advanced options</summary>
      <p>Use a browser extension or connect to a remote bunker.</p>
      <button class="auth-option" type="button" data-login-method="extension">Browser extension</button>
      <form data-bunker-form>
        <input name="bunker" placeholder="nostrconnect://… or name@example.com" autocomplete="off" />
        <button class="bunker-submit" type="submit">Connect bunker</button>
      </form>
      <form data-secret-form>
        <input name="secret" placeholder="nsec1…" autocomplete="off" />
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
