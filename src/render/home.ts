import { getThreadLinkCount } from "../db";
import { ALLOWED_STATE_TRANSITIONS, formatPriorityLabel, formatStateLabel } from "../domain/todos";
import { getAppName, getFaviconUrl } from "../routes/app-settings";
import { escapeHtml } from "../utils/html";

import { renderAppMenu, renderKeyTeleportSetupModal, renderPinModal, renderUnlockCodeModal } from "./components";

import type { Group, Todo } from "../db";
import type { TeamBranding } from "../routes/app-settings";
import type { ViewMode } from "../routes/home";
import type { Session, TodoPriority, TodoState } from "../types";

// ==================== Shared Helpers ====================

function filterTodos(allTodos: Todo[], filterTags: string[]) {
  if (filterTags.length === 0) return allTodos;
  return allTodos.filter((todo) => {
    const todoTags = todo.tags ? todo.tags.split(",").map((t) => t.trim().toLowerCase()) : [];
    return filterTags.some((ft) => todoTags.includes(ft.toLowerCase()));
  });
}

function collectTags(todos: Todo[]) {
  const allTags = new Set<string>();
  for (const todo of todos) {
    if (!todo.tags) continue;
    todo.tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .forEach((t) => allTags.add(t));
  }
  return Array.from(allTags);
}

function toggleTag(activeTags: string[], tag: string, isActive: boolean) {
  if (isActive) return activeTags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
  return [...activeTags, tag];
}

function renderSummaries() {
  return `<section class="summary-panel" data-summary-panel hidden>
    <div class="section-heading">
      <h2>Summaries</h2>
      <span class="summary-meta" data-summary-updated></span>
    </div>
    <div class="summary-grid">
      <article class="summary-card" data-summary-day hidden>
        <h3>Today</h3>
        <p class="summary-text" data-summary-day-text></p>
      </article>
      <article class="summary-card" data-summary-week hidden>
        <h3>This Week</h3>
        <p class="summary-text" data-summary-week-text></p>
      </article>
      <article class="summary-card summary-suggestions" data-summary-suggestions hidden>
        <h3>Suggestions</h3>
        <p class="summary-text" data-summary-suggestions-text></p>
      </article>
    </div>
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

function renderKanbanBoardAlpine(groupId: number | null, canManage: boolean, isAllTasksView = false, teamSlug: string | null = null) {
  // Summary column for parent tasks (reorderable within column)
  const summaryColumn = `
    <div class="kanban-column kanban-column-summary" data-kanban-column="summary" x-show="getColumnCount('summary') > 0">
      <div class="kanban-column-header">
        <h3>Summary Tasks</h3>
        <span class="kanban-count" x-text="getColumnCount('summary')"></span>
      </div>
      <div
        class="kanban-cards"
        data-kanban-cards="summary"
        @dragover.prevent="onDragOver($event, 'summary')"
        @dragleave="onDragLeave($event)"
        @drop.prevent="onDrop($event, 'summary')"
      >
        <template x-for="card in getFilteredCards('summary')" :key="card.id">
          <div
            class="kanban-card is-parent"
            :class="'state-' + card.state"
            draggable="true"
            :data-todo-id="card.id"
            :data-todo-state="card.state"
            :data-group-id="card.group_id || ${groupId ?? "null"}"
            @dragstart="onDragStart($event, card, 'summary')"
            @dragend="onDragEnd($event)"
            @click="window.openTaskModal && window.openTaskModal(card.id)"
          >
            <div class="kanban-card-header">
              <span class="kanban-card-title" x-text="card.title"></span>
              <template x-if="card.subtaskProgress">
                <span class="subtask-progress" x-html="formatProgressSquares(card.subtaskProgress)"></span>
              </template>
            </div>
            <template x-if="card.description">
              <p class="kanban-card-desc" x-text="card.description.slice(0, 100) + (card.description.length > 100 ? '...' : '')"></p>
            </template>
            <div class="kanban-card-meta">
              <span class="badge" :class="'priority-' + card.priority" x-text="formatPriority(card.priority)"></span>
              <template x-for="(tag, idx) in getCardTags(card)" :key="card.id + '-tag-' + idx">
                <span class="tag-chip" x-text="tag"></span>
              </template>
              <template x-if="card.optikon_board_url">
                <a :href="card.optikon_board_url" target="_blank" rel="noopener noreferrer" class="optikon-badge" title="Open Optikon board" @click.stop>&#127919;</a>
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>`;

  // Regular workflow columns
  const columns = [
    { state: "new", label: "New" },
    { state: "ready", label: "Ready" },
    { state: "in_progress", label: "In Progress" },
    { state: "review", label: "Review" },
    { state: "done", label: "Done" },
  ];

  const columnHtml = columns.map(col => `
    <div class="kanban-column" data-kanban-column="${col.state}">
      <div class="kanban-column-header">
        <h3>${col.label}</h3>
        <span class="kanban-count" x-text="getColumnCount('${col.state}')"></span>
      </div>
      <div
        class="kanban-cards"
        data-kanban-cards="${col.state}"
        ${canManage ? "" : 'data-readonly="true"'}
        @dragover.prevent="onDragOver($event, '${col.state}')"
        @dragleave="onDragLeave($event)"
        @drop.prevent="onDrop($event, '${col.state}')"
      >
        <template x-for="card in getFilteredCards('${col.state}')" :key="card.id">
          <div
            class="kanban-card"
            :class="{ 'is-subtask': card.parent_id }"
            ${canManage ? ':draggable="canDragCard(card)"' : 'draggable="false"'}
            :data-todo-id="card.id"
            :data-todo-state="card.state"
            :data-todo-position="card.position"
            :data-parent-id="card.parent_id"
            :data-group-id="card.group_id || ${groupId ?? "null"}"
            :data-assigned-to="card.assigned_to || ${isAllTasksView ? "null" : "(card.group_id === null ? card.owner : null)"}"
            @dragstart="onDragStart($event, card, '${col.state}')"
            @dragend="onDragEnd($event)"
          >
            <div class="kanban-card-header">
              <template x-if="card.parent_id">
                <span class="subtask-prefix">&#8627;</span>
              </template>
              <span class="kanban-card-title" x-text="card.title"></span>
              <template x-if="card.assigned_to || ${isAllTasksView ? "false" : "(card.group_id === null)"}">
                <span class="assignee-avatar" :data-assignee-npub="card.assigned_to || card.owner" title="Assigned">
                  <img class="avatar-img" data-avatar-img hidden alt="" loading="lazy" />
                  <span class="avatar-initials" x-text="formatAvatarInitials(card.assigned_to || card.owner)"></span>
                </span>
              </template>
            </div>
            <template x-if="card.description">
              <p class="kanban-card-desc" x-text="card.description.slice(0, 100) + (card.description.length > 100 ? '...' : '')"></p>
            </template>
            <template x-if="card.parent_id && Number(card.parent_id) > 0">
              <div class="kanban-card-parent" @click.stop="window.openTaskModal && window.openTaskModal(card.parent_id)">
                <span class="parent-indicator-icon">&#8593;</span>
                <span class="parent-indicator-title" x-text="getParentTitle(card.parent_id)"></span>
              </div>
            </template>
            <div class="kanban-card-meta">
              ${isAllTasksView ? `<template x-if="card.group_name || card.group_id === null">
                <span class="badge board-badge" x-text="card.group_name || 'Personal'"></span>
              </template>` : ""}
              <span class="badge" :class="'priority-' + card.priority" x-text="formatPriority(card.priority)"></span>
              <template x-for="(tag, idx) in getCardTags(card)" :key="card.id + '-tag-' + idx">
                <span class="tag-chip" x-text="tag"></span>
              </template>
              <template x-if="card.threadCount > 0">
                <button type="button" class="thread-link-badge" :data-view-threads="card.id" title="View linked threads">
                  &#128172; <span x-text="card.threadCount"></span>
                </button>
              </template>
              <template x-if="card.optikon_board_url">
                <a :href="card.optikon_board_url" target="_blank" rel="noopener noreferrer" class="optikon-badge" title="Open Optikon board" @click.stop>&#127919;</a>
              </template>
            </div>
          </div>
        </template>
        <p x-show="isColumnEmpty('${col.state}')" class="kanban-empty">No tasks</p>
      </div>
    </div>`).join("");

  return `
    <div
      class="kanban-scroll-container"
      x-data="createKanbanStore(window.__INITIAL_TODOS__, ${groupId ?? "null"}, ${teamSlug ? `'${teamSlug}'` : "null"})"
      x-init="init()"
    >
      <!-- Text filter -->
      <div class="text-filter-bar">
        <label class="label" for="task-text-filter">Filter by title:</label>
        <input
          type="text"
          id="task-text-filter"
          class="text-filter-input"
          placeholder="Type to filter tasks..."
          x-model="textFilter"
        />
        <button
          type="button"
          class="clear-text-filter"
          x-show="textFilter.length > 0"
          @click="textFilter = ''"
          title="Clear filter"
        >&times;</button>
      </div>

      <!-- Tag filter (reactive) -->
      <div class="tag-filter-bar" x-show="getAllTags().length > 0">
        <span class="label">Filter by tag:</span>
        <template x-for="tag in getAllTags()" :key="tag">
          <button
            type="button"
            class="tag-chip"
            :class="{ 'active': isTagActive(tag) }"
            @click="toggleTag(tag)"
            x-text="tag"
          ></button>
        </template>
        <button
          type="button"
          class="clear-filters"
          x-show="activeTags.length > 0"
          @click="clearTagFilters()"
        >Clear filters</button>
      </div>

      <div class="kanban-scroll-top" data-kanban-scroll-top><div class="kanban-scroll-top-inner"></div></div>
      <div
        class="kanban-board"
        data-kanban-board
        ${groupId ? `data-group-id="${groupId}"` : ""}
        ${teamSlug ? `data-team-slug="${teamSlug}"` : ""}
      >
        <!-- Sync indicator -->
        <div x-show="syncing" class="sync-indicator">Syncing...</div>

        <!-- Error state -->
        <template x-if="error">
          <div class="kanban-error" x-text="error"></div>
        </template>

        <!-- Columns -->
        <div class="kanban-columns-wrapper">
          ${summaryColumn}
          ${columnHtml}
        </div>
      </div>
    </div>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "•••";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}

function formatTransitionLabel(current: TodoState, next: TodoState) {
  if (current === "done" && next === "ready") return "Reopen";
  if (current === "ready" && next === "in_progress") return "Start Work";
  if (next === "done") return "Complete";
  if (next === "ready") return "Mark Ready";
  return formatStateLabel(next);
}

function renderPriorityOption(value: TodoPriority, current: string) {
  const isSelected = value === current ? "selected" : "";
  return `<option value="${value}" ${isSelected}>${formatPriorityLabel(value)}</option>`;
}

function renderStateOption(value: TodoState, current: string) {
  const isSelected = value === current ? "selected" : "";
  return `<option value="${value}" ${isSelected}>${formatStateLabel(value)}</option>`;
}

function renderTagsDisplay(tags: string) {
  if (!tags) return "";
  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (tagList.length === 0) return "";
  return `<span class="tags-display">${tagList.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</span>`;
}

function renderTagsInput(tags: string) {
  const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const chips = tagList
    .map((t) => `<span class="tag-chip" data-tag="${escapeHtml(t)}">${escapeHtml(t)}<span class="remove-tag">&times;</span></span>`)
    .join("");
  return `
    <label>Tags
      <div class="tag-input-wrapper">
        ${chips}
        <input type="text" placeholder="Type and press comma..." />
        <input type="hidden" name="tags" value="${escapeHtml(tags)}" />
      </div>
    </label>`;
}

// ==================== Team-scoped Todo Page ====================

type TeamRenderArgs = {
  showArchive: boolean;
  session: Session | null;
  filterTags?: string[];
  todos?: Todo[];
  userGroups?: Group[];
  selectedGroup?: Group | null;
  canManage?: boolean;
  teamSlug: string;
  viewMode?: ViewMode;
  branding?: TeamBranding;
};

type TeamPageState = {
  archiveHref: string;
  archiveLabel: string;
  remainingText: string;
  tagFilterBar: string;
  activeTodos: Todo[];
  doneTodos: Todo[];
  emptyActiveMessage: string;
  emptyArchiveMessage: string;
  showArchive: boolean;
  groupId: number | null;
  canManage: boolean;
  contextSwitcher: string;
  teamSlug: string;
  viewMode: ViewMode;
  currentUserNpub: string | null;
  userGroups: Group[];
};

/**
 * Render the todos page in a team context
 * Uses team-scoped URLs for all actions
 */
export function renderTeamTodosPage({
  showArchive,
  session,
  filterTags = [],
  todos = [],
  userGroups = [],
  selectedGroup = null,
  canManage = true,
  teamSlug,
  viewMode = "kanban",
  branding,
}: TeamRenderArgs) {
  const filteredTodos = filterTodos(todos, filterTags);
  const pageState = buildTeamPageState(filteredTodos, filterTags, showArchive, session, userGroups, selectedGroup, canManage, teamSlug, viewMode);

  return `<!doctype html>
<html lang="en">
${renderTeamHead(branding)}
<body class="tasks-page">
  <main class="tasks-app-shell">
    ${renderTeamHeader(session, teamSlug, branding)}
    <div class="tasks-content" data-tasks-content>
      <div class="tasks-content-inner">
        ${renderTeamHero(session, pageState.groupId, pageState.canManage, teamSlug)}
        ${renderTeamWork(pageState)}
        ${renderSummaries()}
      </div>
    </div>
    ${renderQrModal()}
    ${renderProfileModal()}
    ${renderPinModal()}
    ${renderUnlockCodeModal()}
    ${renderKeyTeleportSetupModal()}
    ${renderTeamTaskEditModal(pageState.groupId, teamSlug)}
  </main>
  ${renderTeamSessionSeed(session, pageState.groupId, teamSlug, pageState.activeTodos)}
  <script src="/kanban-store.js"></script>
  <script src="/lib/alpine.min.js" defer></script>
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderTeamHead(branding?: TeamBranding) {
  const appName = branding?.name || getAppName();
  const faviconUrl = branding?.iconUrl || getFaviconUrl() || "/favicon.png";
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>Tasks - ${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${appName}" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderTeamHeader(session: Session | null, teamSlug: string, branding?: TeamBranding) {
  const appName = branding?.name || getAppName();
  const faviconUrl = branding?.iconUrl || getFaviconUrl() || "/favicon.png";
  return `<header class="tasks-page-header">
    <div class="header-left">
      <button class="hamburger-btn" type="button" data-hamburger-toggle aria-label="Menu">
        <span class="hamburger-icon"></span>
      </button>
      <a href="/t/${teamSlug}/chat" class="app-logo-link">
        <img src="${faviconUrl}" alt="" class="app-logo" />
      </a>
      <h1 class="app-title">${appName}</h1>
    </div>
    <div class="header-right">
      <div class="session-controls" data-session-controls ${session ? "" : "hidden"}>
        <button class="avatar-chip" type="button" data-avatar ${session ? "" : "hidden"} title="Account menu">
          <span class="avatar-fallback" data-avatar-fallback>${session ? formatAvatarFallback(session.npub) : "MG"}</span>
          <img data-avatar-img alt="Profile photo" loading="lazy" ${session ? "" : "hidden"} />
        </button>
        <div class="avatar-menu" data-avatar-menu hidden>
          <button type="button" data-view-profile>View Profile</button>
          <button type="button" data-export-secret ${session?.method === "ephemeral" ? "" : "hidden"}>Export Secret</button>
          <button type="button" data-show-login-qr ${session?.method === "ephemeral" ? "" : "hidden"}>Show Login QR</button>
          <button type="button" data-copy-id ${session ? "" : "hidden"}>Copy ID</button>
          <a href="/wallet" class="avatar-menu-link" ${session ? "" : "hidden"}>Wallet</a>
          <button type="button" data-logout>Log out</button>
        </div>
      </div>
    </div>
    ${renderAppMenu(session, "tasks")}
  </header>`;
}

function renderTeamHero(session: Session | null, groupId: number | null, canManage: boolean, teamSlug: string) {
  const isDisabled = !session || !canManage;
  const placeholder = !session ? "Add a task" : !canManage ? "View only" : "Add something else...";
  const groupIdField = groupId ? `<input type="hidden" name="group_id" value="${groupId}" />` : "";

  return `<section class="hero-entry" data-hero-section ${canManage ? "" : "hidden"}>
    <form class="todo-form" method="post" action="/t/${teamSlug}/todos">
      ${groupIdField}
      <label for="title" class="sr-only">Add a task</label>
      <div class="hero-input-wrapper">
        <input class="hero-input" data-hero-input id="title" name="title" placeholder="${placeholder}" autocomplete="off" autofocus required ${isDisabled ? "disabled" : ""} />
      </div>
      <p class="hero-hint" data-hero-hint hidden>Sign in above to add tasks.</p>
    </form>
  </section>`;
}

function buildTeamPageState(
  todos: Todo[],
  filterTags: string[],
  showArchive: boolean,
  session: Session | null,
  userGroups: Group[],
  selectedGroup: Group | null,
  canManage: boolean,
  teamSlug: string,
  viewMode: ViewMode
): TeamPageState {
  const groupId = selectedGroup?.id ?? null;
  // Active todos: everything except archived (done is still active, just completed)
  const activeTodos = todos.filter((t) => t.state !== "archived");
  // Archive section shows only archived tasks
  const doneTodos = todos.filter((t) => t.state === "archived");

  // Build URLs with team, group context, and view mode preserved
  const baseKanban = groupId ? `/t/${teamSlug}/todo/kanban?group=${groupId}` : `/t/${teamSlug}/todo/kanban`;
  const archiveHref = showArchive ? baseKanban : `${baseKanban}${groupId ? "&" : "?"}archive=1`;
  const archiveLabel = showArchive ? "Hide archive" : `Archive (${doneTodos.length})`;
  const tagFilterBar = session ? renderTeamTagFilterBar(todos, filterTags, showArchive, groupId, teamSlug, viewMode) : "";
  const emptyActiveMessage = session ? "No active work. Add something new!" : "Sign in to view your todos.";
  const emptyArchiveMessage = session ? "Nothing archived yet." : "Sign in to view your archive.";
  const remainingText = session ? (activeTodos.length === 0 ? "All clear." : `${activeTodos.length} left to go.`) : "";
  const contextSwitcher = session ? renderTeamContextSwitcher(userGroups, selectedGroup, teamSlug, viewMode) : "";

  return {
    archiveHref,
    archiveLabel,
    remainingText,
    tagFilterBar,
    activeTodos,
    doneTodos,
    emptyActiveMessage,
    emptyArchiveMessage,
    showArchive,
    groupId,
    canManage,
    contextSwitcher,
    teamSlug,
    viewMode,
    currentUserNpub: session?.npub ?? null,
    userGroups,
  };
}

function renderTeamContextSwitcher(userGroups: Group[], selectedGroup: Group | null, teamSlug: string, viewMode: ViewMode): string {
  if (userGroups.length === 0) return "";

  const basePath = `/t/${teamSlug}/todo/${viewMode}`;
  const options = [
    `<option value="${basePath}" ${!selectedGroup ? "selected" : ""}>Personal</option>`,
    ...userGroups.map(
      (g) => `<option value="${basePath}?group=${g.id}" ${selectedGroup?.id === g.id ? "selected" : ""}>${escapeHtml(g.name)}</option>`
    ),
  ].join("");

  return `<select class="context-switcher" data-context-switcher title="Switch context">${options}</select>`;
}

function renderTeamTagFilterBar(allTodos: Todo[], activeTags: string[], showArchive: boolean, groupId: number | null, teamSlug: string, viewMode: ViewMode) {
  // Build base URL with team, group context, and view mode
  const groupParam = groupId ? `group=${groupId}` : "";
  const archiveParam = showArchive ? "archive=1" : "";
  const params = [groupParam, archiveParam].filter(Boolean);
  const baseUrl = params.length > 0 ? `/t/${teamSlug}/todo/${viewMode}?${params.join("&")}` : `/t/${teamSlug}/todo/${viewMode}`;
  const separator = params.length > 0 ? "&" : "?";

  const tags = collectTags(allTodos);
  if (tags.length === 0) return "";

  const chips = tags
    .sort()
    .map((tag) => {
      const isActive = activeTags.some((t) => t.toLowerCase() === tag.toLowerCase());
      const nextTags = toggleTag(activeTags, tag, isActive);
      const href = nextTags.length > 0 ? `${baseUrl}${separator}tags=${nextTags.join(",")}` : baseUrl;
      return `<a href="${href}" class="tag-chip${isActive ? " active" : ""}">${escapeHtml(tag)}</a>`;
    })
    .join("");

  const clearLink = activeTags.length > 0 ? `<a href="${baseUrl}" class="clear-filters">Clear filters</a>` : "";
  return `<div class="tag-filter-bar"><span class="label">Filter by tag:</span>${chips}${clearLink}</div>`;
}

function renderTeamWork(state: TeamPageState) {
  // Build view switcher URLs preserving query params
  const buildViewUrl = (mode: ViewMode) => {
    const params: string[] = [];
    if (state.groupId) params.push(`group=${state.groupId}`);
    if (state.showArchive) params.push("archive=1");
    const query = params.length > 0 ? `?${params.join("&")}` : "";
    return `/t/${state.teamSlug}/todo/${mode}${query}`;
  };

  const listUrl = buildViewUrl("list");
  const kanbanUrl = buildViewUrl("kanban");
  const isKanban = state.viewMode === "kanban";
  const isList = state.viewMode === "list";

  // Only render the active view
  const viewContent = isKanban
    ? `<div class="kanban-view" data-kanban-view>
        ${renderKanbanBoardAlpine(state.groupId, state.canManage, false, state.teamSlug)}
      </div>`
    : `<div class="todo-list-view" data-list-view>
        ${renderTeamTodoList(state.activeTodos, state.emptyActiveMessage, state.groupId, state.canManage, state.teamSlug)}
      </div>`;

  return `<section class="work" data-work-section>
    <div class="work-header">
      <h2>Work</h2>
      <div class="work-header-actions">
        ${state.contextSwitcher}
        <div class="view-switcher" data-view-switcher>
          <a href="${listUrl}" class="view-btn${isList ? " active" : ""}" title="List view">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h12v1H2V4zm0 3.5h12v1H2v-1zm0 3.5h12v1H2v-1z"/></svg>
          </a>
          <a href="${kanbanUrl}" class="view-btn${isKanban ? " active" : ""}" title="Kanban view">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h4v12H1V2zm5 0h4v8H6V2zm5 0h4v10h-4V2z"/></svg>
          </a>
        </div>
        <a class="archive-toggle" href="${state.archiveHref}">${state.archiveLabel}</a>
      </div>
    </div>
    <p class="remaining-summary">${state.remainingText}</p>
    ${isList ? state.tagFilterBar : ""}
    ${viewContent}
    ${state.showArchive ? renderTeamArchiveSection(state.doneTodos, state.emptyArchiveMessage, state.groupId, state.canManage, state.teamSlug) : ""}
  </section>`;
}

function renderTeamTodoList(todos: Todo[], emptyMessage: string, groupId: number | null, canManage: boolean, teamSlug: string) {
  if (todos.length === 0) {
    return `<ul class="todo-list"><li>${emptyMessage}</li></ul>`;
  }
  return `<ul class="todo-list">${todos.map((todo) => renderTeamTodoItem(todo, groupId, canManage, teamSlug)).join("")}</ul>`;
}

function renderTeamArchiveSection(todos: Todo[], emptyMessage: string, groupId: number | null, canManage: boolean, teamSlug: string) {
  return `
    <section class="archive-section">
      <div class="section-heading"><h2>Archive</h2></div>
      ${renderTeamTodoList(todos, emptyMessage, groupId, canManage, teamSlug)}
    </section>`;
}

function renderTeamTodoItem(todo: Todo, groupId: number | null, canManage: boolean, teamSlug: string) {
  const description = todo.description ? `<p class="todo-description">${escapeHtml(todo.description)}</p>` : "";
  const scheduled = todo.scheduled_for
    ? `<p class="todo-description"><strong>Scheduled for:</strong> ${escapeHtml(todo.scheduled_for)}</p>`
    : "";
  const tagsDisplay = renderTagsDisplay(todo.tags);
  const groupIdField = groupId ? `<input type="hidden" name="group_id" value="${groupId}" />` : "";

  if (!canManage) {
    // Read-only view for non-managers
    return `
    <li>
      <details>
        <summary>
          <span class="todo-title">${escapeHtml(todo.title)}</span>
          <span class="badges">
            <span class="badge priority-${todo.priority}">${formatPriorityLabel(todo.priority)}</span>
            <span class="badge state-${todo.state}">${formatStateLabel(todo.state)}</span>
            ${tagsDisplay}
          </span>
        </summary>
        <div class="todo-body">
          ${description}
          ${scheduled}
        </div>
      </details>
    </li>`;
  }

  return `
    <li>
      <details>
        <summary>
          <span class="todo-title">${escapeHtml(todo.title)}</span>
          <span class="badges">
            <span class="badge priority-${todo.priority}">${formatPriorityLabel(todo.priority)}</span>
            <span class="badge state-${todo.state}">${formatStateLabel(todo.state)}</span>
            ${tagsDisplay}
          </span>
        </summary>
        <div class="todo-body">
          ${description}
          ${scheduled}
          <form class="edit-form" method="post" action="/t/${teamSlug}/todos/${todo.id}/update">
            ${groupIdField}
            <label>Title
              <input name="title" value="${escapeHtml(todo.title)}" required />
            </label>
            <label>Description
              <textarea name="description" rows="3">${escapeHtml(todo.description ?? "")}</textarea>
            </label>
            <label>Priority
              <select name="priority">
                ${renderPriorityOption("rock", todo.priority)}
                ${renderPriorityOption("pebble", todo.priority)}
                ${renderPriorityOption("sand", todo.priority)}
              </select>
            </label>
            <label>State
              <select name="state">
                ${renderStateOption("new", todo.state)}
                ${renderStateOption("ready", todo.state)}
                ${renderStateOption("in_progress", todo.state)}
                ${renderStateOption("review", todo.state)}
                ${renderStateOption("done", todo.state)}
              </select>
            </label>
            <label>Scheduled For
              <input type="date" name="scheduled_for" value="${todo.scheduled_for ? escapeHtml(todo.scheduled_for) : ""}" />
            </label>
            ${renderTagsInput(todo.tags)}
            <button type="submit">Update</button>
          </form>
          ${renderTeamLifecycleActions(todo, groupId, teamSlug)}
        </div>
      </details>
    </li>`;
}

function renderTeamLifecycleActions(todo: Todo, groupId: number | null, teamSlug: string) {
  const transitions = ALLOWED_STATE_TRANSITIONS[todo.state] ?? [];
  const transitionForms = transitions.map((next) =>
    renderTeamStateActionForm(todo.id, next, formatTransitionLabel(todo.state, next), groupId, teamSlug)
  );

  return `
    <div class="todo-actions">
      ${transitionForms.join("")}
      ${renderTeamDeleteForm(todo.id, groupId, teamSlug)}
    </div>`;
}

function renderTeamStateActionForm(id: number, nextState: TodoState, label: string, groupId: number | null, teamSlug: string) {
  const groupIdField = groupId ? `<input type="hidden" name="group_id" value="${groupId}" />` : "";
  return `
    <form method="post" action="/t/${teamSlug}/todos/${id}/state">
      ${groupIdField}
      <input type="hidden" name="state" value="${nextState}" />
      <button type="submit">${label}</button>
    </form>`;
}

function renderTeamDeleteForm(id: number, groupId: number | null, teamSlug: string) {
  const groupIdField = groupId ? `<input type="hidden" name="group_id" value="${groupId}" />` : "";
  return `
    <form method="post" action="/t/${teamSlug}/todos/${id}/delete">
      ${groupIdField}
      <button type="submit">Delete</button>
    </form>`;
}

function renderTeamTaskEditModal(groupId: number | null, teamSlug: string) {
  return `<div class="task-modal-overlay" data-task-modal hidden>
    <div class="task-modal">
      <div class="task-modal-header">
        <h2 data-task-modal-heading>Edit Task</h2>
        <button class="task-modal-close" type="button" data-task-modal-close aria-label="Close">&times;</button>
      </div>
      <form class="task-modal-form" method="post" data-task-modal-form data-team-slug="${teamSlug}">
        <input type="hidden" name="group_id" data-task-modal-group-id value="${groupId ?? ""}" />
        <input type="hidden" name="parent_id" data-task-modal-parent-id value="" />
        <label>Title
          <input name="title" data-task-modal-title required />
        </label>
        <label>Description
          <textarea name="description" data-task-modal-description rows="8"></textarea>
        </label>
        <div class="task-modal-parent-wrapper" data-task-modal-parent-wrapper hidden>
          <span class="task-modal-parent-label">Parent:</span>
          <span class="task-modal-parent-title" data-task-modal-parent-title hidden></span>
          <button type="button" class="task-modal-detach-parent" data-task-modal-detach-parent title="Remove from parent" hidden>&times;</button>
          <button type="button" class="task-modal-assign-parent" data-task-modal-assign-parent hidden>(none) - click to assign</button>
        </div>
        <div class="task-modal-subtasks" data-task-modal-subtasks hidden>
          <div class="task-modal-subtasks-header">Subtasks</div>
          <div class="task-modal-subtasks-list" data-task-modal-subtasks-list></div>
          <button type="button" class="task-modal-add-subtask" data-task-modal-add-subtask>+ Add Subtask</button>
        </div>
        <div class="task-modal-row">
          <label>Priority
            <select name="priority" data-task-modal-priority>
              <option value="rock">${formatPriorityLabel("rock")}</option>
              <option value="pebble">${formatPriorityLabel("pebble")}</option>
              <option value="sand">${formatPriorityLabel("sand")}</option>
            </select>
          </label>
          <label>State
            <select name="state" data-task-modal-state>
              <option value="new">${formatStateLabel("new")}</option>
              <option value="ready">${formatStateLabel("ready")}</option>
              <option value="in_progress">${formatStateLabel("in_progress")}</option>
              <option value="review">${formatStateLabel("review")}</option>
              <option value="done">${formatStateLabel("done")}</option>
              <option value="archived">${formatStateLabel("archived")}</option>
            </select>
          </label>
        </div>
        <label>Scheduled For
          <input type="date" name="scheduled_for" data-task-modal-scheduled />
        </label>
        <label>Tags
          <div class="tag-input-wrapper" data-task-modal-tags-wrapper>
            <input type="text" placeholder="Type and press comma..." />
            <input type="hidden" name="tags" data-task-modal-tags-hidden value="" />
          </div>
        </label>
        <label data-task-modal-assignee-label hidden>Assigned To
          <input type="hidden" name="assigned_to" data-task-modal-assignee value="" />
          <div class="assignee-autocomplete" data-assignee-autocomplete>
            <input type="text" placeholder="Search members..." data-assignee-input autocomplete="off" />
            <div class="assignee-selected" data-assignee-selected hidden>
              <img class="assignee-selected-avatar" data-assignee-avatar src="" alt="" />
              <span data-assignee-name></span>
              <button type="button" class="assignee-clear" data-assignee-clear>&times;</button>
            </div>
            <div class="assignee-suggestions" data-assignee-suggestions hidden></div>
          </div>
        </label>
        <label data-project-picker-label hidden>Wingman Project
          <select data-project-picker>
            <option value="">No project</option>
          </select>
          <input type="hidden" name="working_directory" data-task-modal-working-directory value="" />
        </label>
        <div class="task-modal-links" data-task-modal-links hidden>
          <div class="task-modal-links-header">Links</div>
          <div class="task-modal-links-list" data-task-modal-links-list></div>
        </div>
        <div class="task-modal-optikon" data-task-modal-optikon hidden>
          <div class="task-modal-optikon-header">Optikon Board</div>
          <div class="task-modal-optikon-link" data-optikon-link hidden>
            <a href="" target="_blank" rel="noopener noreferrer" data-optikon-link-url>
              <span class="optikon-icon">&#127919;</span>
              <span data-optikon-link-text>Open in Optikon</span>
            </a>
            <button type="button" class="task-modal-optikon-unlink" data-optikon-unlink title="Remove board link">&times;</button>
          </div>
          <button type="button" class="task-modal-optikon-attach" data-optikon-attach>
            <span class="optikon-icon">&#127919;</span>
            Attach Optikon Board
          </button>
          <p class="task-modal-optikon-status" data-optikon-status hidden></p>
        </div>
        <div class="task-modal-actions">
          <button type="button" class="task-modal-delete" data-task-modal-delete>Delete</button>
          <button type="button" class="task-modal-archive" data-task-modal-archive hidden>Archive</button>
          <div class="task-modal-actions-right">
            <button type="button" data-task-modal-cancel>Cancel</button>
            <button type="submit" class="primary">Save</button>
          </div>
        </div>
      </form>
      <div class="parent-picker-modal" data-parent-picker hidden>
        <div class="parent-picker-header">
          <span>Select Parent Task</span>
          <button type="button" class="parent-picker-close" data-parent-picker-close>&times;</button>
        </div>
        <div class="parent-picker-search">
          <input type="text" placeholder="Filter tasks..." data-parent-picker-filter />
        </div>
        <div class="parent-picker-list" data-parent-picker-list>
          <div class="parent-picker-loading">Loading...</div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderTeamSessionSeed(session: Session | null, groupId: number | null, teamSlug: string, todos: Todo[] = []) {
  // Enrich todos with thread counts for client-side rendering
  const todosWithThreads = todos.map(todo => ({
    ...todo,
    threadCount: getThreadLinkCount(todo.id),
  }));

  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
    window.__GROUP_ID__ = ${groupId ?? "null"};
    window.__TEAM_SLUG__ = ${JSON.stringify(teamSlug)};
    window.__INITIAL_TODOS__ = ${JSON.stringify(todosWithThreads)};
  </script>`;
}
