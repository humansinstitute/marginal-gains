import { getAppName, getFaviconUrl } from "../routes/app-settings";

import { renderAppMenu, renderPinModal } from "./components";

import type { DeepLink, Session } from "../types";

export function renderChatPage(session: Session | null, deepLink?: DeepLink, needsOnboarding = false) {
  const bodyClass = needsOnboarding ? "chat-page onboarding-mode" : "chat-page";
  return `<!doctype html>
<html lang="en">
${renderHead()}
<body class="${bodyClass}">
  <main class="chat-app-shell">
    ${renderChatHeader(session, needsOnboarding)}
    ${!session ? renderAuthRequired() : needsOnboarding ? renderOnboardingLobby() : renderChatContent()}
  </main>
  ${renderSessionSeed(session, deepLink, needsOnboarding)}
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
  <title>Chat - ${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${appName}" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderChatHeader(session: Session | null, needsOnboarding = false) {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";
  // Hide menu during onboarding - user can only enter invite code or log out
  if (needsOnboarding) {
    return `<header class="chat-page-header">
      <div class="header-left">
        <img src="${faviconUrl}" alt="" class="app-logo" />
        <h1 class="app-title">${appName}</h1>
      </div>
      <div class="header-right">
        ${session ? renderOnboardingAvatarMenu(session) : ""}
      </div>
    </header>`;
  }

  return `<header class="chat-page-header">
    <div class="header-left">
      <button class="hamburger-btn" type="button" data-hamburger-toggle aria-label="Menu">
        <span class="hamburger-icon"></span>
      </button>
      <img src="${faviconUrl}" alt="" class="app-logo" />
      <h1 class="app-title">${appName}</h1>
    </div>
    <div class="header-right">
      ${session ? renderAvatarMenu(session) : ""}
    </div>
    ${renderAppMenu(session, "chat")}
  </header>`;
}

function renderOnboardingAvatarMenu(session: Session) {
  return `<div class="session-controls" data-session-controls>
    <button class="avatar-chip" type="button" data-avatar title="Account menu">
      <span class="avatar-fallback" data-avatar-fallback>${formatAvatarFallback(session.npub)}</span>
      <img data-avatar-img alt="Profile photo" loading="lazy" hidden />
    </button>
    <div class="avatar-menu" data-avatar-menu hidden>
      <button type="button" data-logout>Log out</button>
    </div>
  </div>`;
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

function renderChatContent() {
  return `<section class="chat-shell chat-shell-page" data-chat-shell>
    <div class="chat-layout" data-chat-layout data-mobile-view="channels">
      <aside class="chat-channels-sidebar">
        <div class="chat-section-header">
          <h3>Channels</h3>
          <button type="button" class="text-btn" data-new-channel-trigger>+ New</button>
        </div>
        <div class="chat-list" data-channel-list></div>
        <div class="chat-section-header dm-section-header">
          <h3>Direct Messages</h3>
          <button type="button" class="text-btn" data-new-dm-trigger>+ New</button>
        </div>
        <div class="chat-list" data-dm-list></div>
        <div class="chat-personal-section" data-personal-section></div>
      </aside>
      <section class="chat-messages-area">
        <header class="chat-messages-header">
          <button type="button" class="chat-back-btn" data-back-to-channels>Channels</button>
          <div class="chat-channel-chip" data-active-channel>Pick a channel</div>
          <button type="button" class="channel-settings-btn" data-channel-settings hidden title="Channel settings">&#9881;</button>
        </header>
        <div class="chat-threads" data-thread-list>
          <p class="chat-placeholder">Pick or create a channel to start chatting.</p>
        </div>
        <div class="chat-composer">
          <div class="mention-popup" data-mention-popup hidden></div>
          <div class="chat-composer-row">
            <textarea class="chat-input" placeholder="Share an update, @name to mention" data-chat-input rows="2"></textarea>
            <div class="chat-composer-buttons">
              <button type="button" class="chat-attach-btn" data-attach-file title="Attach file">&#128206;</button>
              <input type="file" data-file-input hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" />
              <button type="button" class="chat-send-btn primary" data-send-chat disabled>Send</button>
            </div>
          </div>
        </div>
      </section>
      <aside class="chat-thread-panel" data-thread-panel hidden>
        <header class="chat-thread-panel-header">
          <button type="button" class="chat-back-btn" data-back-to-messages>Back</button>
          <h3>Thread</h3>
          <div class="chat-thread-header-actions">
            <button type="button" class="chat-thread-tasks-btn" data-view-thread-tasks hidden title="View linked tasks">&#9745;</button>
            <button type="button" class="chat-thread-expand" data-expand-thread title="Expand thread">|&larr;</button>
            <button type="button" class="chat-thread-expand" data-collapse-thread hidden title="Collapse thread">&rarr;|</button>
            <button type="button" class="chat-thread-close" data-close-thread>&times;</button>
          </div>
        </header>
        <div class="chat-thread-panel-messages" data-thread-messages></div>
        <div class="chat-thread-panel-composer">
          <div class="chat-composer-row">
            <textarea placeholder="Reply to thread..." data-thread-input rows="2"></textarea>
            <div class="chat-composer-buttons">
              <button type="button" class="chat-attach-btn" data-thread-attach-file title="Attach file">&#128206;</button>
              <input type="file" data-thread-file-input hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" />
              <button type="button" class="chat-send-btn primary" data-thread-send disabled>Reply</button>
            </div>
          </div>
        </div>
      </aside>
    </div>
    ${renderChannelModal()}
    ${renderChannelSettingsModal()}
    ${renderDmModal()}
    ${renderProfileModal()}
    ${renderTaskLinkModal()}
  </section>`;
}

function renderChannelModal() {
  return `<div class="chat-modal" data-channel-modal hidden>
    <div class="chat-modal-body channel-wizard">
      <header class="chat-modal-header">
        <h3>Create channel</h3>
        <button type="button" class="ghost" data-close-channel-modal>&times;</button>
      </header>
      <div class="wizard-step wizard-step-1" data-wizard-step-1>
        <p class="channel-type-prompt">What type of channel?</p>
        <div class="channel-type-buttons">
          <button type="button" class="channel-type-btn" data-select-channel-type="public">
            <span class="channel-type-icon">&#127758;</span>
            <span class="channel-type-label">Public</span>
            <span class="channel-type-desc">Anyone can view and join</span>
          </button>
          <button type="button" class="channel-type-btn" data-select-channel-type="private">
            <span class="channel-type-icon">&#128274;</span>
            <span class="channel-type-label">Private</span>
            <span class="channel-type-desc">Encrypted, group members only</span>
          </button>
        </div>
      </div>
      <div class="wizard-step wizard-step-2" data-wizard-step-2 style="display: none;">
        <div class="wizard-step-2-header">
          <span class="wizard-type-badge" data-wizard-type-badge></span>
        </div>
        <form class="chat-form" data-channel-form>
          <input type="hidden" name="isPublic" value="1" data-channel-is-public />
          <label>
            <span>Slug</span>
            <input name="name" required placeholder="my-channel" pattern="[a-z0-9-]+" title="Lowercase letters, numbers, and hyphens only" />
            <span class="field-hint">Lowercase, no spaces (e.g. team-updates)</span>
          </label>
          <label>
            <span>Description</span>
            <textarea name="description" rows="2" placeholder="What is this channel about?"></textarea>
          </label>
          <div class="channel-group-section" data-channel-group-section style="display: none;">
            <label>
              <span>Group</span>
              <select name="groupId" data-channel-group-select>
                <option value="">Select a group...</option>
              </select>
            </label>
            <span class="field-hint">Members of this group will have access</span>
          </div>
          <div class="chat-form-actions">
            <button type="button" class="ghost" data-channel-back>Back</button>
            <button type="submit" class="primary">Create</button>
          </div>
        </form>
      </div>
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
        <div class="channel-encryption-section" data-channel-encryption-section hidden>
          <label>
            <span>🔐 Encryption Keys</span>
          </label>
          <div class="encryption-status" data-encryption-status>
            <p>Loading key status...</p>
          </div>
          <button type="button" class="secondary" data-distribute-keys>Distribute Keys to Pending Members</button>
        </div>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-close-channel-settings>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
      <div class="channel-danger-zone" data-channel-danger-zone>
        <button type="button" class="danger" data-delete-channel>Delete Channel</button>
      </div>
    </div>
  </div>`;
}

function renderDmModal() {
  return `<div class="chat-modal" data-dm-modal hidden>
    <div class="chat-modal-body dm-modal-body">
      <header class="chat-modal-header">
        <h3>New Direct Message</h3>
        <button type="button" class="ghost" data-close-dm-modal>&times;</button>
      </header>
      <div class="dm-user-search">
        <input type="text" placeholder="Search users..." data-dm-search autocomplete="off" />
        <div class="dm-user-list" data-dm-user-list></div>
      </div>
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

function renderTaskLinkModal() {
  return `<div class="chat-modal task-link-modal" data-task-link-modal hidden>
    <div class="chat-modal-body task-link-modal-body">
      <header class="chat-modal-header">
        <h3>Link to Task</h3>
        <button type="button" class="ghost" data-close-task-link>&times;</button>
      </header>
      <div class="task-link-tabs">
        <button type="button" class="task-link-tab active" data-task-tab="create">Create New</button>
        <button type="button" class="task-link-tab" data-task-tab="existing">Link Existing</button>
      </div>
      <form class="task-link-create-form" data-task-link-create>
        <label>
          <span>Board</span>
          <select name="board" data-task-board>
            <option value="">Personal</option>
          </select>
        </label>
        <label>
          <span>Title</span>
          <input name="title" required placeholder="Task title" />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="2" placeholder="Description (optional)"></textarea>
        </label>
        <label>
          <span>Priority</span>
          <select name="priority">
            <option value="sand">Sand (Low)</option>
            <option value="pebble" selected>Pebble (Normal)</option>
            <option value="rock">Rock (High)</option>
            <option value="boulder">Boulder (Critical)</option>
          </select>
        </label>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-close-task-link>Cancel</button>
          <button type="submit" class="primary">Create &amp; Link</button>
        </div>
      </form>
      <div class="task-link-existing" data-task-link-existing hidden>
        <div class="task-search-container">
          <select data-task-search-board class="task-search-board">
            <option value="all">All Boards</option>
            <option value="">Personal</option>
          </select>
          <input type="search" placeholder="Search tasks..." data-task-search autocomplete="off" />
        </div>
        <div class="task-search-results" data-task-results>
          <p class="task-search-empty">Search for tasks to link...</p>
        </div>
      </div>
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
  const appName = getAppName();
  const logoUrl = getFaviconUrl() || "/logo.png";
  return `<section class="chat-auth-section">
    <div class="chat-auth-container">
      <img src="${logoUrl}" alt="${appName}" class="auth-logo" />
      <h2>Welcome to ${appName}</h2>
      <p class="auth-description">A nostr native community chat app, think slack, but client side encrypted and with a service that respects its users.</p>
      <section class="auth-panel" data-login-panel>
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
      </section>
    </div>
    ${renderQrModal()}
    ${renderPinModal()}
  </section>`;
}

function renderSessionSeed(session: Session | null, deepLink?: DeepLink, needsOnboarding = false) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
    window.__CHAT_PAGE__ = true;
    window.__DEEP_LINK__ = ${JSON.stringify(deepLink ?? null)};
    window.__NEEDS_ONBOARDING__ = ${needsOnboarding};
  </script>`;
}

function renderOnboardingLobby() {
  const appName = getAppName();
  return `<section class="onboarding-lobby" data-onboarding-lobby>
    <div class="onboarding-card">
      <div class="onboarding-icon">🔐</div>
      <h2>Welcome to ${appName}</h2>
      <p class="onboarding-desc">
        This community uses end-to-end encryption.
        Enter your invite code to get access.
      </p>
      <form class="onboarding-form" data-invite-form>
        <input
          type="text"
          name="inviteCode"
          placeholder="XXXX-XXXX-XXXX"
          class="invite-input"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          data-invite-input
          required
        />
        <button type="submit" class="primary onboarding-btn" data-invite-submit>
          Join Community
        </button>
      </form>
      <p class="onboarding-error" data-invite-error hidden></p>
      <p class="onboarding-hint">
        Don't have an invite code? Ask the community owner.
      </p>
    </div>
  </section>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}
