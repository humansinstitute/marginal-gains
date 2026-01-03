import { APP_NAME } from "../config";

import { renderAppMenu, renderPinModal } from "./components";

import type { Session } from "../types";

export function renderWalletPage(session: Session) {
  return `<!doctype html>
<html lang="en">
${renderHead()}
<body class="wallet-page">
  <main class="wallet-shell">
    ${renderHeader(session)}
    ${renderWalletContent()}
  </main>
  ${renderPinModal()}
  ${renderSessionSeed(session)}
  <script type="module" src="/wallet.js"></script>
</body>
</html>`;
}

function renderHead() {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>Wallet - ${APP_NAME}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${APP_NAME}" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderHeader(session: Session) {
  return `<header class="wallet-header">
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
      <a href="/wallet" class="avatar-menu-link active">Wallet</a>
      <button type="button" data-logout>Log out</button>
    </div>
  </div>`;
}

function renderWalletContent() {
  return `<div class="wallet-content">
    <!-- Connection section - shown when wallet not connected -->
    <section class="wallet-section wallet-connect-section" data-wallet-connect-section>
      <div class="wallet-section-header">
        <h2>Connect Wallet</h2>
      </div>
      <p class="wallet-description">
        Connect your Lightning wallet using Nostr Wallet Connect (NWC) to send and receive payments.
      </p>
      <form class="wallet-connect-form" data-wallet-connect-form>
        <label>
          <span>NWC Connection String</span>
          <input type="text" name="nwcUri" required
            placeholder="nostr+walletconnect://..."
            data-nwc-input />
        </label>
        <p class="wallet-hint">
          Get this from your NWC-compatible wallet (Alby, Mutiny, etc.)
        </p>
        <div class="wallet-form-actions">
          <button type="submit" class="primary">Connect Wallet</button>
        </div>
      </form>
    </section>

    <!-- Wallet dashboard - shown when wallet is connected -->
    <section class="wallet-section wallet-dashboard" data-wallet-dashboard hidden>
      <div class="wallet-balance-card" data-wallet-balance-card>
        <div class="wallet-balance-header">
          <h2>Balance</h2>
          <button type="button" class="ghost wallet-refresh-btn" data-refresh-balance title="Refresh">&#8635;</button>
        </div>
        <div class="wallet-balance-amount" data-wallet-balance>
          <span class="wallet-balance-loading">Loading...</span>
        </div>
      </div>

      <div class="wallet-actions">
        <button type="button" class="primary" data-wallet-receive>Receive</button>
        <button type="button" class="primary" data-wallet-send>Send</button>
      </div>

      <div class="wallet-section-header">
        <h3>Recent Transactions</h3>
      </div>
      <div class="wallet-transactions" data-wallet-transactions>
        <p class="wallet-empty">Loading transactions...</p>
      </div>

      <div class="wallet-disconnect">
        <button type="button" class="ghost danger" data-wallet-disconnect>Disconnect Wallet</button>
      </div>
    </section>

    <!-- Receive modal -->
    <div class="wallet-modal" data-receive-modal hidden>
      <div class="wallet-modal-body">
        <header class="wallet-modal-header">
          <h3>Receive Payment</h3>
          <button type="button" class="ghost" data-close-receive>&times;</button>
        </header>
        <form class="wallet-form" data-receive-form>
          <label>
            <span>Amount (sats)</span>
            <input type="number" name="amount" required min="1" placeholder="1000" />
          </label>
          <label>
            <span>Description (optional)</span>
            <input type="text" name="description" placeholder="What's this for?" />
          </label>
          <div class="wallet-form-actions">
            <button type="button" class="ghost" data-close-receive>Cancel</button>
            <button type="submit" class="primary">Create Invoice</button>
          </div>
        </form>
        <div class="wallet-invoice-result" data-invoice-result hidden>
          <p class="wallet-invoice-label">Invoice created:</p>
          <div class="wallet-invoice-box">
            <code data-invoice-text></code>
            <button type="button" class="ghost" data-copy-invoice title="Copy">Copy</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Send modal -->
    <div class="wallet-modal" data-send-modal hidden>
      <div class="wallet-modal-body">
        <header class="wallet-modal-header">
          <h3>Send Payment</h3>
          <button type="button" class="ghost" data-close-send>&times;</button>
        </header>
        <form class="wallet-form" data-send-form>
          <label>
            <span>Invoice or Lightning Address</span>
            <input type="text" name="target" required placeholder="lnbc... or user@domain.com" data-send-target />
          </label>
          <label data-amount-label hidden>
            <span>Amount (sats)</span>
            <input type="number" name="amount" min="1" placeholder="1000" data-send-amount />
          </label>
          <div class="wallet-form-actions">
            <button type="button" class="ghost" data-close-send>Cancel</button>
            <button type="submit" class="primary">Pay</button>
          </div>
        </form>
        <div class="wallet-send-result" data-send-result hidden>
          <p class="wallet-success" data-send-success></p>
        </div>
      </div>
    </div>
  </div>`;
}

function renderSessionSeed(session: Session) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session)};
    window.__WALLET_PAGE__ = true;
  </script>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}
