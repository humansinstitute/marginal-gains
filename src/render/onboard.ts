/**
 * Onboarding Page Renderer
 *
 * Renders the team invite onboarding page where users:
 * 1. See team info and groups they'll join
 * 2. Log in (or create a new identity)
 * 3. Complete zero-knowledge key exchange
 * 4. Join the team
 *
 * Uses the same layout structure as the home page for consistent styling.
 */

import { getAppName, getFaviconUrl } from "../routes/app-settings";
import { escapeHtml } from "../utils/html";

import { renderPinModal, renderUnlockCodeModal } from "./components";

export type InvitePreview = {
  valid: boolean;
  error?: string;
  team?: {
    id: number;
    slug: string;
    displayName: string;
    description: string;
  };
  groups?: Array<{
    id: number;
    name: string;
  }>;
  role?: "owner" | "manager" | "member";
  alreadyMember?: boolean;
};

type OnboardingArgs = {
  inviteCode: string;
  preview: InvitePreview;
  isLoggedIn: boolean;
  userNpub?: string;
};

export function renderOnboardingPage({
  inviteCode,
  preview,
  isLoggedIn,
  userNpub,
}: OnboardingArgs): string {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>Join Team - ${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>
<body class="tasks-page">
  <main class="tasks-app-shell">
    ${renderHeader(appName)}
    <div class="tasks-content" data-tasks-content>
      <div class="tasks-content-inner">
        ${renderInviteContent(preview, inviteCode, isLoggedIn, userNpub)}
      </div>
    </div>
    ${renderPinModal()}
    ${renderUnlockCodeModal()}
  </main>
  ${renderOnboardingScript(inviteCode, preview, isLoggedIn)}
  <script type="module" src="/onboarding.js"></script>
</body>
</html>`;
}

function renderHeader(appName: string): string {
  const faviconUrl = getFaviconUrl() || "/favicon.png";
  return `<header class="tasks-page-header">
    <div class="header-left">
      <a href="/" class="app-logo-link">
        <img src="${faviconUrl}" alt="" class="app-logo" />
      </a>
      <h1 class="app-title">${appName}</h1>
    </div>
  </header>`;
}

function renderInviteContent(
  preview: InvitePreview,
  inviteCode: string,
  isLoggedIn: boolean,
  userNpub?: string
): string {
  if (!preview.valid) {
    return renderInvalidInvite(preview.error || "Invalid invite code");
  }

  if (preview.alreadyMember && preview.team) {
    return renderAlreadyMember(preview.team);
  }

  return `
    ${renderTeamInviteHero(preview)}
    ${isLoggedIn ? renderJoinSection(inviteCode, userNpub) : renderAuthSection()}
  `;
}

function renderTeamInviteHero(preview: InvitePreview): string {
  if (!preview.team) return "";

  const groupsHtml = preview.groups && preview.groups.length > 0
    ? `<p class="invite-groups">You'll be added to: ${preview.groups.map(g => `<span class="invite-group-badge">${escapeHtml(g.name)}</span>`).join(" ")}</p>`
    : "";

  const roleHtml = preview.role && preview.role !== "member"
    ? `<p class="invite-role">Role: <span class="role-badge role-${preview.role}">${preview.role === "owner" ? "Owner" : "Manager"}</span></p>`
    : "";

  return `
    <section class="invite-hero">
      <div class="invite-team-icon">${preview.team.displayName.slice(0, 2).toUpperCase()}</div>
      <h2>You've been invited to join</h2>
      <h1 class="invite-team-name">${escapeHtml(preview.team.displayName)}</h1>
      ${preview.team.description ? `<p class="invite-team-desc">${escapeHtml(preview.team.description)}</p>` : ""}
      ${groupsHtml}
      ${roleHtml}
    </section>`;
}

function renderAuthSection(): string {
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

function renderJoinSection(_inviteCode: string, userNpub?: string): string {
  const shortNpub = userNpub ? `${userNpub.slice(0, 12)}...${userNpub.slice(-4)}` : "";

  return `
    <section class="auth-panel" data-login-panel>
      <h2>Ready to join</h2>
      <p class="auth-description">
        Signed in as <span class="npub-badge" title="${userNpub || ""}">${shortNpub}</span>
      </p>
      <div class="auth-actions">
        <button class="auth-option" type="button" data-join-team>Join Team</button>
      </div>
      <p class="auth-switch">
        <button class="link-btn" type="button" data-switch-account>Use a different account</button>
      </p>
      <p class="auth-error" data-login-error hidden></p>
      <div class="auth-loading" data-onboarding-loading hidden>
        <span class="spinner"></span>
        <span>Setting up your access...</span>
      </div>
    </section>`;
}

function renderInvalidInvite(error: string): string {
  const appName = getAppName();
  return `
    <section class="auth-panel">
      <h2>Invite Not Valid</h2>
      <p class="auth-description">${escapeHtml(error)}</p>
      <div class="auth-actions">
        <a href="/" class="auth-option">Return to ${escapeHtml(appName)}</a>
      </div>
    </section>`;
}

function renderAlreadyMember(team: { slug: string; displayName: string }): string {
  return `
    <section class="auth-panel">
      <h2>You're already a member!</h2>
      <p class="auth-description">You're already a member of <strong>${escapeHtml(team.displayName)}</strong>.</p>
      <div class="auth-actions">
        <a href="/t/${team.slug}/chat" class="auth-option">Go to Team Chat</a>
      </div>
    </section>`;
}

function renderOnboardingScript(
  inviteCode: string,
  preview: InvitePreview,
  isLoggedIn: boolean
): string {
  return `<script>
    window.__INVITE_CODE__ = ${JSON.stringify(inviteCode)};
    window.__INVITE_PREVIEW__ = ${JSON.stringify(preview)};
    window.__IS_LOGGED_IN__ = ${isLoggedIn};
  </script>`;
}

/**
 * Render error page for invalid invites
 */
export function renderInviteErrorPage(error: string): string {
  const appName = getAppName();
  const faviconUrl = getFaviconUrl() || "/favicon.png";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>Invalid Invite - ${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>
<body class="tasks-page">
  <main class="tasks-app-shell">
    ${renderHeader(appName)}
    <div class="tasks-content" data-tasks-content>
      <div class="tasks-content-inner">
        ${renderInvalidInvite(error)}
      </div>
    </div>
  </main>
</body>
</html>`;
}
