import { APP_NAME, isAdmin } from "../config";
import type { Session } from "../types";

export function renderChatPage(session: Session | null) {
  return `<!doctype html>
<html lang="en">
${renderHead()}
<body class="chat-page">
  <main class="chat-app-shell">
    ${renderChatHeader(session)}
    ${session ? renderChatContent() : renderAuthRequired()}
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
  <title>Chat - ${APP_NAME}</title>
  <meta name="theme-color" content="#0f172a" />
  <meta name="application-name" content="${APP_NAME}" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderChatHeader(session: Session | null) {
  return `<header class="chat-page-header">
    <div class="header-left">
      <button class="hamburger-btn" type="button" data-hamburger-toggle aria-label="Menu">
        <span class="hamburger-icon"></span>
      </button>
      <h1 class="app-title">${APP_NAME}</h1>
    </div>
    <div class="header-right">
      ${session ? renderAvatarMenu(session) : ""}
    </div>
    ${renderAppMenu(session)}
  </header>`;
}

function renderAppMenu(session: Session | null) {
  const settingsLink = session && isAdmin(session.npub)
    ? `<li><a href="/settings" class="app-menu-item">Settings</a></li>`
    : "";
  return `<nav class="app-menu" data-app-menu hidden>
    <div class="app-menu-overlay" data-app-menu-overlay></div>
    <div class="app-menu-panel">
      <div class="app-menu-header">
        <span class="app-menu-title">Menu</span>
        <button type="button" class="app-menu-close" data-app-menu-close>&times;</button>
      </div>
      <ul class="app-menu-list">
        ${settingsLink}
        <li><a href="/chat" class="app-menu-item active">Chat</a></li>
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

function renderChatContent() {
  return `<section class="chat-shell chat-shell-page" data-chat-shell>
    <div class="chat-layout" data-chat-layout data-mobile-view="channels">
      <aside class="chat-channels-sidebar">
        <div class="chat-section-header">
          <h3>Channels</h3>
          <button type="button" class="text-btn" data-new-channel-trigger>+ New</button>
        </div>
        <div class="chat-list" data-channel-list></div>
      </aside>
      <section class="chat-messages-area">
        <header class="chat-messages-header">
          <button type="button" class="chat-back-btn" data-back-to-channels>Channels</button>
          <div class="chat-channel-chip" data-active-channel>Pick a channel</div>
          <button type="button" class="channel-settings-btn" data-channel-settings hidden title="Channel settings">&#9881;</button>
          <button type="button" class="primary" data-new-channel-trigger>Create channel</button>
        </header>
        <div class="chat-threads" data-thread-list>
          <p class="chat-placeholder">Pick or create a channel to start chatting.</p>
        </div>
        <div class="chat-composer">
          <div class="mention-popup" data-mention-popup hidden></div>
          <textarea class="chat-input" placeholder="Share an update, @name to mention" data-chat-input rows="2"></textarea>
          <button type="button" class="primary" data-send-chat disabled>Send</button>
        </div>
      </section>
      <aside class="chat-thread-panel" data-thread-panel hidden>
        <header class="chat-thread-panel-header">
          <button type="button" class="chat-back-btn" data-back-to-messages>Back</button>
          <h3>Thread</h3>
          <button type="button" class="chat-thread-close" data-close-thread>&times;</button>
        </header>
        <div class="chat-thread-panel-messages" data-thread-messages></div>
        <div class="chat-thread-panel-composer">
          <textarea placeholder="Reply to thread..." data-thread-input rows="2"></textarea>
          <button type="button" class="primary" data-thread-send disabled>Reply</button>
        </div>
      </aside>
    </div>
    ${renderChannelModal()}
    ${renderChannelSettingsModal()}
    ${renderProfileModal()}
  </section>`;
}

function renderChannelModal() {
  return `<div class="chat-modal" data-channel-modal hidden>
    <div class="chat-modal-body">
      <header class="chat-modal-header">
        <h3>Create channel</h3>
        <button type="button" class="ghost" data-close-channel-modal>&times;</button>
      </header>
      <form class="chat-form" data-channel-form>
        <label>
          <span>Name (slug)</span>
          <input name="name" required placeholder="general" />
        </label>
        <label>
          <span>Display name</span>
          <input name="displayName" required placeholder="General" />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="2" placeholder="What is this channel about?"></textarea>
        </label>
        <label class="chat-checkbox" data-admin-only>
          <input type="checkbox" name="isPublic" checked />
          <span>Public channel (uncheck for private)</span>
        </label>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-close-channel-modal>Cancel</button>
          <button type="submit" class="primary">Create</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderChannelSettingsModal() {
  return `<div class="chat-modal" data-channel-settings-modal hidden>
    <div class="chat-modal-body channel-settings-body">
      <header class="chat-modal-header">
        <h3>Channel Settings</h3>
        <button type="button" class="ghost" data-close-channel-settings>&times;</button>
      </header>
      <form class="chat-form" data-channel-settings-form>
        <input type="hidden" name="channelId" data-channel-settings-id />
        <label>
          <span>Display name</span>
          <input name="displayName" required placeholder="General" data-channel-settings-display-name />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="2" placeholder="What is this channel about?" data-channel-settings-description></textarea>
        </label>
        <label class="chat-checkbox" data-channel-public-toggle>
          <input type="checkbox" name="isPublic" data-channel-settings-public />
          <span>Public channel</span>
        </label>
        <div class="channel-groups-section" data-channel-groups-section hidden>
          <label>
            <span>Assigned Groups</span>
          </label>
          <div class="channel-groups-list" data-channel-groups-list>
            <p class="channel-groups-empty">No groups assigned</p>
          </div>
          <div class="channel-groups-add">
            <select data-channel-add-group>
              <option value="">Add a group...</option>
            </select>
          </div>
        </div>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-close-channel-settings>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderProfileModal() {
  return `<div class="profile-modal-overlay" data-profile-modal hidden>
    <div class="profile-modal">
      <button class="profile-modal-close" type="button" data-profile-close aria-label="Close">&times;</button>
      <div class="profile-view" data-profile-view>
        <div class="profile-header">
          <div class="profile-avatar" data-profile-avatar></div>
          <div class="profile-identity">
            <h2 class="profile-name" data-profile-name>Loading...</h2>
            <p class="profile-nip05" data-profile-nip05></p>
          </div>
        </div>
        <p class="profile-about" data-profile-about></p>
        <div class="profile-meta">
          <p class="profile-npub" data-profile-npub></p>
        </div>
        <button type="button" class="profile-edit-btn" data-profile-edit>Edit Profile</button>
      </div>
      <form class="profile-edit-form" data-profile-edit-form hidden>
        <label>
          <span>Display Name</span>
          <input type="text" name="displayName" data-profile-edit-name placeholder="Your name" />
        </label>
        <label>
          <span>About</span>
          <textarea name="about" data-profile-edit-about rows="3" placeholder="Tell us about yourself"></textarea>
        </label>
        <label>
          <span>Picture URL</span>
          <input type="url" name="picture" data-profile-edit-picture placeholder="https://..." />
        </label>
        <div class="profile-edit-actions">
          <button type="button" class="ghost" data-profile-edit-cancel>Cancel</button>
          <button type="submit" class="primary">Save & Publish</button>
        </div>
        <p class="profile-edit-status" data-profile-edit-status hidden></p>
      </form>
    </div>
  </div>`;
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

function renderAuthRequired() {
  return `<section class="chat-auth-section">
    <div class="chat-auth-container">
      <h2>Welcome to ${APP_NAME}</h2>
      <p class="auth-description">Sign in with Nostr to start chatting.</p>
      <section class="auth-panel" data-login-panel>
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
      </section>
    </div>
    ${renderQrModal()}
  </section>`;
}

function renderSessionSeed(session: Session | null) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
    window.__CHAT_PAGE__ = true;
  </script>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}
