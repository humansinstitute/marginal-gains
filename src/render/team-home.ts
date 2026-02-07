/**
 * Team Home page template
 *
 * Server-rendered home page with two activity panels:
 *  - Mentions: things directed at you (mentions, DMs, task assignments)
 *  - Updates:  general activity (task state changes, etc.)
 */

import { getAppName, getFaviconUrl } from "../routes/app-settings";
import { escapeHtml } from "../utils/html";

import { renderAppMenu, renderPinModal, renderUnlockCodeModal, renderKeyTeleportSetupModal } from "./components";

import type { TeamBranding } from "../routes/app-settings";
import type { Activity } from "../team-db";
import type { Session } from "../types";

/** Activity types that represent something directed at the user */
const MENTION_TYPES: Activity["type"][] = ["mention", "dm", "task_assigned"];

interface TeamHomeArgs {
  session: Session;
  teamSlug: string;
  activities: Activity[];
  unreadCount: number;
  branding?: TeamBranding;
  /** channel_id → channel name (slug) */
  channelNames: Map<number, string>;
  /** todo_id → group_id | null */
  todoGroups: Map<number, number | null>;
}

export function renderTeamHomePage({
  session,
  teamSlug,
  activities,
  unreadCount,
  branding,
  channelNames,
  todoGroups,
}: TeamHomeArgs) {
  const mentions = activities.filter(a => MENTION_TYPES.includes(a.type));
  const updates = activities.filter(a => !MENTION_TYPES.includes(a.type));
  const mentionUnread = mentions.filter(a => a.is_read === 0).length;
  const updateUnread = updates.filter(a => a.is_read === 0).length;

  return `<!doctype html>
<html lang="en">
${renderHead(branding)}
<body class="home-page">
  <main class="home-app-shell">
    ${renderHeader(session, teamSlug, branding)}
    <div class="home-content">
      <div class="home-content-inner">
        <div class="activity-panels">
          ${renderMentionsPanel(mentions, mentionUnread, teamSlug, channelNames, todoGroups)}
          ${renderUpdatesPanel(updates, updateUnread, teamSlug, channelNames, todoGroups)}
        </div>
      </div>
    </div>
    ${renderPinModal()}
    ${renderUnlockCodeModal()}
    ${renderKeyTeleportSetupModal()}
  </main>
  ${renderSessionSeed(session, teamSlug, unreadCount)}
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderHead(branding?: TeamBranding) {
  const appName = branding?.name || getAppName();
  const faviconUrl = branding?.iconUrl || getFaviconUrl() || "/favicon.png";
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>Home - ${escapeHtml(appName)}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${escapeHtml(appName)}" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderHeader(session: Session, teamSlug: string, branding?: TeamBranding) {
  const appName = branding?.name || getAppName();
  const faviconUrl = branding?.iconUrl || getFaviconUrl() || "/favicon.png";
  const avatarFallback = session.npub ? session.npub.replace(/^npub1/, "").slice(0, 2).toUpperCase() : "MG";

  return `<header class="home-page-header">
    <div class="header-left">
      <button class="hamburger-btn" type="button" data-hamburger-toggle aria-label="Menu">
        <span class="hamburger-icon"></span>
      </button>
      <a href="/t/${teamSlug}/home" class="app-logo-link">
        <img src="${faviconUrl}" alt="" class="app-logo" />
      </a>
      <h1 class="app-title">${escapeHtml(appName)}</h1>
    </div>
    <div class="header-right">
      <div class="session-controls" data-session-controls>
        <button class="avatar-chip" type="button" data-avatar title="Account menu">
          <span class="avatar-fallback" data-avatar-fallback>${avatarFallback}</span>
          <img data-avatar-img alt="Profile photo" loading="lazy" hidden />
        </button>
        <div class="avatar-menu" data-avatar-menu hidden>
          <button type="button" data-view-profile>View Profile</button>
          <button type="button" data-export-secret ${session.method === "ephemeral" ? "" : "hidden"}>Export Secret</button>
          <button type="button" data-copy-id>Copy ID</button>
          <button type="button" data-logout>Log out</button>
        </div>
      </div>
    </div>
    ${renderAppMenu(session, "home")}
  </header>`;
}

function renderMentionsPanel(
  mentions: Activity[],
  unreadCount: number,
  teamSlug: string,
  channelNames: Map<number, string>,
  todoGroups: Map<number, number | null>,
) {
  const unreadBadge = unreadCount > 0
    ? `<span class="activity-unread-badge" data-unread-badge="mentions">${unreadCount}</span>`
    : `<span class="activity-unread-badge" data-unread-badge="mentions" hidden>0</span>`;

  const markAllBtn = unreadCount > 0
    ? `<button type="button" class="activity-mark-all-read" data-mark-all-read>Mark all as read</button>`
    : `<button type="button" class="activity-mark-all-read" data-mark-all-read hidden>Mark all as read</button>`;

  const listHtml = mentions.length > 0
    ? mentions.map(a => renderActivityItem(a, teamSlug, channelNames, todoGroups)).join("")
    : `<p class="activity-empty">No mentions yet. You're all caught up.</p>`;

  return `<section class="activity-panel" data-activity-panel="mentions">
    <div class="activity-header">
      <h2>Mentions ${unreadBadge}</h2>
      ${markAllBtn}
    </div>
    <div class="activity-list" data-activity-list="mentions">
      ${listHtml}
    </div>
  </section>`;
}

function renderUpdatesPanel(
  updates: Activity[],
  unreadCount: number,
  teamSlug: string,
  channelNames: Map<number, string>,
  todoGroups: Map<number, number | null>,
) {
  const unreadBadge = unreadCount > 0
    ? `<span class="activity-unread-badge" data-unread-badge="updates">${unreadCount}</span>`
    : `<span class="activity-unread-badge" data-unread-badge="updates" hidden>0</span>`;

  const listHtml = updates.length > 0
    ? updates.map(a => renderActivityItem(a, teamSlug, channelNames, todoGroups)).join("")
    : `<p class="activity-empty">No updates yet.</p>`;

  return `<section class="activity-panel" data-activity-panel="updates">
    <div class="activity-header">
      <h2>Updates ${unreadBadge}</h2>
    </div>
    <div class="activity-list" data-activity-list="updates">
      ${listHtml}
    </div>
  </section>`;
}

function renderActivityItem(
  activity: Activity,
  teamSlug: string,
  channelNames: Map<number, string>,
  todoGroups: Map<number, number | null>,
) {
  const isUnread = activity.is_read === 0;
  const unreadClass = isUnread ? " activity-unread" : "";
  const iconClass = getActivityIconClass(activity.type);
  const typeIcon = getActivityIcon(activity.type);
  const link = getActivityLink(activity, teamSlug, channelNames, todoGroups);
  const timeAgo = activity.created_at;

  return `<div class="activity-item${unreadClass}" data-activity-id="${activity.id}" data-activity-read="${activity.is_read}">
    <span class="activity-icon ${iconClass}">${typeIcon}</span>
    <div class="activity-body">
      <span class="activity-source" data-npub="${escapeHtml(activity.source_npub)}">${escapeHtml(activity.source_npub.slice(0, 16))}...</span>
      <span class="activity-summary">${escapeHtml(activity.summary)}</span>
      <time class="activity-time" datetime="${escapeHtml(activity.created_at)}">${escapeHtml(timeAgo)}</time>
    </div>
    ${link ? `<a href="${link}" class="activity-link" data-activity-link>View</a>` : ""}
  </div>`;
}

function getActivityIcon(type: Activity["type"]): string {
  switch (type) {
    case "mention": return "@";
    case "dm": return "DM";
    case "task_assigned": return "=&gt;";
    case "task_update": return "!!";
    default: return "*";
  }
}

function getActivityIconClass(type: Activity["type"]): string {
  switch (type) {
    case "mention": return "icon-mention";
    case "dm": return "icon-dm";
    case "task_assigned": return "icon-task-assigned";
    case "task_update": return "icon-task-update";
    default: return "";
  }
}

function getActivityLink(
  activity: Activity,
  teamSlug: string,
  channelNames: Map<number, string>,
  todoGroups: Map<number, number | null>,
): string | null {
  // Mentions: deep-link to channel + thread
  if (activity.type === "mention" && activity.channel_id) {
    const channelName = channelNames.get(activity.channel_id);
    if (channelName) {
      const threadParam = activity.message_id ? `?thread=${activity.message_id}` : "";
      return `/t/${teamSlug}/chat/channel/${encodeURIComponent(channelName)}${threadParam}`;
    }
  }

  // DMs: deep-link to DM conversation
  if (activity.type === "dm" && activity.channel_id) {
    return `/t/${teamSlug}/chat/dm/${activity.channel_id}`;
  }

  // Tasks: deep-link to kanban board with task modal open
  if (activity.todo_id) {
    const groupId = todoGroups.get(activity.todo_id);
    const params: string[] = [];
    if (groupId) params.push(`group=${groupId}`);
    params.push(`task=${activity.todo_id}`);
    return `/t/${teamSlug}/todo/kanban?${params.join("&")}`;
  }

  // Fallback: channel link without thread
  if (activity.channel_id) {
    const channelName = channelNames.get(activity.channel_id);
    if (channelName) {
      return `/t/${teamSlug}/chat/channel/${encodeURIComponent(channelName)}`;
    }
  }

  return null;
}

function renderSessionSeed(session: Session, teamSlug: string, unreadCount: number) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session)};
    window.__TEAM_SLUG__ = ${JSON.stringify(teamSlug)};
    window.__HOME_PAGE__ = true;
    window.__UNREAD_ACTIVITY_COUNT__ = ${unreadCount};
  </script>`;
}
