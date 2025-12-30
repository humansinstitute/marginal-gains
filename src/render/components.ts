import type { Session } from "../types";

export type ActivePage = "settings" | "chat" | "tasks";

export function renderAppMenu(session: Session | null, activePage: ActivePage) {
  const settingsLink = session
    ? `<li><a href="/settings" class="app-menu-item${activePage === "settings" ? " active" : ""}">Settings</a></li>`
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
        <li><a href="/chat" class="app-menu-item${activePage === "chat" ? " active" : ""}">Chat</a></li>
        <li><a href="/todo" class="app-menu-item${activePage === "tasks" ? " active" : ""}">Tasks</a></li>
      </ul>
    </div>
  </nav>`;
}
