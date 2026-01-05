import { getThreadLinkCount } from "../db";
import { ALLOWED_STATE_TRANSITIONS, formatPriorityLabel, formatStateLabel } from "../domain/todos";
import { getAppName, getFaviconUrl } from "../routes/app-settings";
import { escapeHtml } from "../utils/html";

import { renderAppMenu, renderPinModal } from "./components";

import type { Group, Todo } from "../db";
import type { Session, TodoPriority, TodoState } from "../types";

type RenderArgs = {
  showArchive: boolean;
  session: Session | null;
  filterTags?: string[];
  todos?: Todo[];
  userGroups?: Group[];
  selectedGroup?: Group | null;
  canManage?: boolean;
};

type PageState = {
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
};

export function renderHomePage({
  showArchive,
  session,
  filterTags = [],
  todos = [],
  userGroups = [],
  selectedGroup = null,
  canManage = true,
}: RenderArgs) {
  const filteredTodos = filterTodos(todos, filterTags);
  const pageState = buildPageState(filteredTodos, filterTags, showArchive, session, userGroups, selectedGroup, canManage);

  return `<!doctype html>
<html lang="en">
${renderHead()}
<body class="tasks-page">
  <main class="tasks-app-shell">
    ${renderHeader(session)}
    <div class="tasks-content" data-tasks-content>
      <div class="tasks-content-inner">
        ${renderAuth(session)}
        ${renderHero(session, pageState.groupId, pageState.canManage)}
        ${renderWork(pageState)}
        ${renderSummaries()}
      </div>
    </div>
    ${renderQrModal()}
    ${renderProfileModal()}
    ${renderPinModal()}
    ${renderTaskEditModal(pageState.groupId)}
  </main>
  ${renderSessionSeed(session, pageState.groupId)}
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
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
</head>`;
}

function renderHeader(session: Session | null) {
  const appName = getAppName();
  return `<header class="tasks-page-header">
    <div class="header-left">
      <button class="hamburger-btn" type="button" data-hamburger-toggle aria-label="Menu">
        <span class="hamburger-icon"></span>
      </button>
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

function renderAuth(session: Session | null) {
  return `<section class="auth-panel" data-login-panel ${session ? "hidden" : ""}>
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

function renderHero(session: Session | null, groupId: number | null, canManage: boolean) {
  const isDisabled = !session || !canManage;
  const placeholder = !session ? "Add a task" : !canManage ? "View only" : "Add something else…";
  const groupIdField = groupId ? `<input type="hidden" name="group_id" value="${groupId}" />` : "";

  return `<section class="hero-entry" data-hero-section ${canManage ? "" : "hidden"}>
    <form class="todo-form" method="post" action="/todos">
      ${groupIdField}
      <label for="title" class="sr-only">Add a task</label>
      <div class="hero-input-wrapper">
        <input class="hero-input" data-hero-input id="title" name="title" placeholder="${placeholder}" autocomplete="off" autofocus required ${isDisabled ? "disabled" : ""} />
      </div>
      <p class="hero-hint" data-hero-hint hidden>Sign in above to add tasks.</p>
    </form>
  </section>`;
}

function renderWork(state: PageState) {
  return `<section class="work" data-work-section>
    <div class="work-header">
      <h2>Work</h2>
      <div class="work-header-actions">
        ${state.contextSwitcher}
        <div class="view-switcher" data-view-switcher>
          <button type="button" class="view-btn active" data-view-mode="list" title="List view">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h12v1H2V4zm0 3.5h12v1H2v-1zm0 3.5h12v1H2v-1z"/></svg>
          </button>
          <button type="button" class="view-btn" data-view-mode="kanban" title="Kanban view">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h4v12H1V2zm5 0h4v8H6V2zm5 0h4v10h-4V2z"/></svg>
          </button>
        </div>
        <a class="archive-toggle" href="${state.archiveHref}">${state.archiveLabel}</a>
      </div>
    </div>
    <p class="remaining-summary">${state.remainingText}</p>
    ${state.tagFilterBar}
    <div class="todo-list-view" data-list-view>
      ${renderTodoList(state.activeTodos, state.emptyActiveMessage, state.groupId, state.canManage)}
    </div>
    <div class="kanban-view" data-kanban-view hidden>
      ${renderKanbanBoard(state.activeTodos, state.emptyActiveMessage, state.groupId, state.canManage)}
    </div>
    ${state.showArchive ? renderArchiveSection(state.doneTodos, state.emptyArchiveMessage, state.groupId, state.canManage) : ""}
  </section>`;
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

function renderSessionSeed(session: Session | null, groupId: number | null) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
    window.__GROUP_ID__ = ${groupId ?? "null"};
  </script>`;
}

function buildPageState(
  todos: Todo[],
  filterTags: string[],
  showArchive: boolean,
  session: Session | null,
  userGroups: Group[],
  selectedGroup: Group | null,
  canManage: boolean
): PageState {
  const groupId = selectedGroup?.id ?? null;
  const activeTodos = todos.filter((t) => t.state !== "done");
  const doneTodos = todos.filter((t) => t.state === "done");

  // Build URLs with group context preserved
  const baseUrl = groupId ? `/todo?group=${groupId}` : "/todo";
  const archiveHref = showArchive ? baseUrl : `${baseUrl}${groupId ? "&" : "?"}archive=1`;
  const archiveLabel = showArchive ? "Hide archive" : `Archive (${doneTodos.length})`;
  const tagFilterBar = session ? renderTagFilterBar(todos, filterTags, showArchive, groupId) : "";
  const emptyActiveMessage = session ? "No active work. Add something new!" : "Sign in to view your todos.";
  const emptyArchiveMessage = session ? "Nothing archived yet." : "Sign in to view your archive.";
  const remainingText = session ? (activeTodos.length === 0 ? "All clear." : `${activeTodos.length} left to go.`) : "";
  const contextSwitcher = session ? renderContextSwitcher(userGroups, selectedGroup) : "";

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
  };
}

function renderContextSwitcher(userGroups: Group[], selectedGroup: Group | null): string {
  if (userGroups.length === 0) return "";

  const options = [
    `<option value="">Personal</option>`,
    ...userGroups.map(
      (g) => `<option value="${g.id}" ${selectedGroup?.id === g.id ? "selected" : ""}>${escapeHtml(g.name)}</option>`
    ),
  ].join("");

  return `<select class="context-switcher" data-context-switcher title="Switch context">${options}</select>`;
}

function filterTodos(allTodos: Todo[], filterTags: string[]) {
  if (filterTags.length === 0) return allTodos;
  return allTodos.filter((todo) => {
    const todoTags = todo.tags ? todo.tags.split(",").map((t) => t.trim().toLowerCase()) : [];
    return filterTags.some((ft) => todoTags.includes(ft.toLowerCase()));
  });
}

function renderTagFilterBar(allTodos: Todo[], activeTags: string[], showArchive: boolean, groupId: number | null) {
  // Build base URL with group context
  const groupParam = groupId ? `group=${groupId}` : "";
  const archiveParam = showArchive ? "archive=1" : "";
  const params = [groupParam, archiveParam].filter(Boolean);
  const baseUrl = params.length > 0 ? `/todo?${params.join("&")}` : "/todo";
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

function toggleTag(activeTags: string[], tag: string, isActive: boolean) {
  if (isActive) return activeTags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
  return [...activeTags, tag];
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

function renderTodoList(todos: Todo[], emptyMessage: string, groupId: number | null, canManage: boolean) {
  if (todos.length === 0) {
    return `<ul class="todo-list"><li>${emptyMessage}</li></ul>`;
  }
  return `<ul class="todo-list">${todos.map((todo) => renderTodoItem(todo, groupId, canManage)).join("")}</ul>`;
}

function renderKanbanBoard(todos: Todo[], _emptyMessage: string, groupId: number | null, canManage: boolean) {
  const columns: { state: string; label: string; todos: Todo[] }[] = [
    { state: "new", label: "New", todos: [] },
    { state: "ready", label: "Ready", todos: [] },
    { state: "in_progress", label: "In Progress", todos: [] },
    { state: "done", label: "Done", todos: [] },
  ];

  for (const todo of todos) {
    const col = columns.find((c) => c.state === todo.state);
    if (col) col.todos.push(todo);
  }

  const columnHtml = columns
    .map(
      (col) => `
      <div class="kanban-column" data-kanban-column="${col.state}">
        <div class="kanban-column-header">
          <h3>${col.label}</h3>
          <span class="kanban-count">${col.todos.length}</span>
        </div>
        <div class="kanban-cards" data-kanban-cards="${col.state}" ${canManage ? "" : 'data-readonly="true"'}>
          ${col.todos.length === 0 ? `<p class="kanban-empty">No tasks</p>` : col.todos.map((todo) => renderKanbanCard(todo, groupId)).join("")}
        </div>
      </div>`
    )
    .join("");

  return `<div class="kanban-board" data-kanban-board ${groupId ? `data-group-id="${groupId}"` : ""}>${columnHtml}</div>`;
}

function renderKanbanCard(todo: Todo, groupId: number | null) {
  const priorityClass = `priority-${todo.priority}`;
  const tagsHtml = todo.tags
    ? todo.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`)
        .join("")
    : "";
  const threadCount = getThreadLinkCount(todo.id);
  const threadBadge = threadCount > 0
    ? `<button type="button" class="thread-link-badge" data-view-threads="${todo.id}" title="View linked threads">&#128172; ${threadCount}</button>`
    : "";

  return `
    <div class="kanban-card" draggable="true" data-todo-id="${todo.id}" data-todo-state="${todo.state}" ${groupId ? `data-group-id="${groupId}"` : ""}>
      <span class="kanban-card-title">${escapeHtml(todo.title)}</span>
      ${todo.description ? `<p class="kanban-card-desc">${escapeHtml(todo.description.slice(0, 100))}${todo.description.length > 100 ? "..." : ""}</p>` : ""}
      <div class="kanban-card-meta">
        <span class="badge ${priorityClass}">${formatPriorityLabel(todo.priority)}</span>
        ${tagsHtml}
        ${threadBadge}
      </div>
    </div>`;
}

function renderArchiveSection(todos: Todo[], emptyMessage: string, groupId: number | null, canManage: boolean) {
  return `
    <section class="archive-section">
      <div class="section-heading"><h2>Archive</h2></div>
      ${renderTodoList(todos, emptyMessage, groupId, canManage)}
    </section>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "•••";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}

function renderTodoItem(todo: Todo, groupId: number | null, canManage: boolean) {
  const description = todo.description ? `<p class="todo-description">${escapeHtml(todo.description)}</p>` : "";
  const scheduled = todo.scheduled_for
    ? `<p class="todo-description"><strong>Scheduled for:</strong> ${escapeHtml(todo.scheduled_for)}</p>`
    : "";
  const tagsDisplay = renderTagsDisplay(todo.tags);
  const groupIdField = groupId ? `<input type="hidden" name="group_id" value="${groupId}" />` : "";
  const threadCount = getThreadLinkCount(todo.id);
  const threadBadge = threadCount > 0
    ? `<button type="button" class="thread-link-badge" data-view-threads="${todo.id}" title="View linked threads">&#128172; ${threadCount}</button>`
    : "";

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
            ${threadBadge}
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
            ${threadBadge}
          </span>
        </summary>
        <div class="todo-body">
          ${description}
          ${scheduled}
          <form class="edit-form" method="post" action="/todos/${todo.id}/update">
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
                ${renderStateOption("done", todo.state)}
              </select>
            </label>
            <label>Scheduled For
              <input type="date" name="scheduled_for" value="${todo.scheduled_for ? escapeHtml(todo.scheduled_for) : ""}" />
            </label>
            ${renderTagsInput(todo.tags)}
            <button type="submit">Update</button>
          </form>
          ${renderLifecycleActions(todo, groupId)}
        </div>
      </details>
    </li>`;
}

function renderLifecycleActions(todo: Todo, groupId: number | null) {
  const transitions = ALLOWED_STATE_TRANSITIONS[todo.state] ?? [];
  const transitionForms = transitions.map((next) =>
    renderStateActionForm(todo.id, next, formatTransitionLabel(todo.state, next), groupId)
  );

  return `
    <div class="todo-actions">
      ${transitionForms.join("")}
      ${renderDeleteForm(todo.id, groupId)}
    </div>`;
}

function formatTransitionLabel(current: TodoState, next: TodoState) {
  if (current === "done" && next === "ready") return "Reopen";
  if (current === "ready" && next === "in_progress") return "Start Work";
  if (next === "done") return "Complete";
  if (next === "ready") return "Mark Ready";
  return formatStateLabel(next);
}

function renderStateActionForm(id: number, nextState: TodoState, label: string, groupId: number | null) {
  const groupIdField = groupId ? `<input type="hidden" name="group_id" value="${groupId}" />` : "";
  return `
    <form method="post" action="/todos/${id}/state">
      ${groupIdField}
      <input type="hidden" name="state" value="${nextState}" />
      <button type="submit">${label}</button>
    </form>`;
}

function renderDeleteForm(id: number, groupId: number | null) {
  const groupIdField = groupId ? `<input type="hidden" name="group_id" value="${groupId}" />` : "";
  return `
    <form method="post" action="/todos/${id}/delete">
      ${groupIdField}
      <button type="submit">Delete</button>
    </form>`;
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

function renderTaskEditModal(groupId: number | null) {
  const groupIdField = groupId ? `<input type="hidden" name="group_id" value="${groupId}" />` : "";
  return `<div class="task-modal-overlay" data-task-modal hidden>
    <div class="task-modal">
      <div class="task-modal-header">
        <h2>Edit Task</h2>
        <button class="task-modal-close" type="button" data-task-modal-close aria-label="Close">&times;</button>
      </div>
      <form class="task-modal-form" method="post" data-task-modal-form>
        ${groupIdField}
        <label>Title
          <input name="title" data-task-modal-title required />
        </label>
        <label>Description
          <textarea name="description" data-task-modal-description rows="3"></textarea>
        </label>
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
              <option value="done">${formatStateLabel("done")}</option>
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
        <div class="task-modal-actions">
          <button type="button" class="task-modal-delete" data-task-modal-delete>Delete</button>
          <div class="task-modal-actions-right">
            <button type="button" data-task-modal-cancel>Cancel</button>
            <button type="submit" class="primary">Save</button>
          </div>
        </div>
      </form>
    </div>
  </div>`;
}

