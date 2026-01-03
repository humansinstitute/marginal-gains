import { isAdmin } from "../config";

import type { Session } from "../types";

export type ActivePage = "settings" | "chat" | "tasks" | "crm";

export function renderPinModal() {
  const numpadButtons = [1, 2, 3, 4, 5, 6, 7, 8, 9, "clear", 0, "back"]
    .map((key) => {
      if (key === "clear") {
        return `<button type="button" class="pin-key pin-key-action" data-pin-clear>C</button>`;
      }
      if (key === "back") {
        return `<button type="button" class="pin-key pin-key-action" data-pin-back>&larr;</button>`;
      }
      return `<button type="button" class="pin-key" data-pin-digit="${key}">${key}</button>`;
    })
    .join("");

  return `<div class="pin-modal-overlay" data-pin-modal hidden>
    <div class="pin-modal">
      <h2 data-pin-title>Enter PIN</h2>
      <p data-pin-subtitle>Enter your 4-digit PIN to unlock</p>
      <div class="pin-display">
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
      </div>
      <p class="pin-error" data-pin-error hidden>Wrong PIN. Try again.</p>
      <div class="pin-numpad">
        ${numpadButtons}
      </div>
      <button type="button" class="pin-cancel" data-pin-cancel>Cancel</button>
    </div>
  </div>`;
}

export function renderAppMenu(session: Session | null, activePage: ActivePage) {
  const settingsLink = session
    ? `<li><a href="/settings" class="app-menu-item${activePage === "settings" ? " active" : ""}">Settings</a></li>`
    : "";

  const crmLink = session && isAdmin(session.npub)
    ? `<li><a href="/crm" class="app-menu-item${activePage === "crm" ? " active" : ""}">CRM</a></li>`
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
        ${crmLink}
      </ul>
    </div>
  </nav>`;
}
