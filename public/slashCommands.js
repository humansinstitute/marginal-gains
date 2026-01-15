/**
 * Slash Command Autocomplete Module
 * Provides autocomplete for /commands in chat input
 */

import { elements as el, escapeHtml, hide, show } from "./dom.js";

// Module state
let slashQuery = null;
let slashStartPos = -1;
let slashSelectedIndex = 0;
let slashMatches = [];
let commands = [];
let activeInput = null; // Track which input is active
let activePopup = null; // Track which popup is active

// Client-side only commands (handled in chat.js, not sent to server)
const clientSideCommands = [
  { name: "hang", description: "Start a hang.live video/voice chat room" },
];

/**
 * Initialize slash commands by fetching available commands from server
 */
export async function init() {
  try {
    const res = await fetch("/api/slashcommands");
    if (res.ok) {
      commands = await res.json();
    }
  } catch (_err) {
    console.error("[SlashCommands] Failed to fetch commands");
  }

  // Add client-side only commands (always available)
  commands = [...commands, ...clientSideCommands];
}

/**
 * Detect if cursor is in a /command context and extract query
 */
function detectSlashQuery(input) {
  const cursorPos = input.selectionStart;
  const text = input.value.slice(0, cursorPos);

  // Find last / that starts a command
  const lastSlashPos = text.lastIndexOf("/");
  if (lastSlashPos === -1) return null;

  // Must be at start or after whitespace
  if (lastSlashPos > 0 && !/\s/.test(text[lastSlashPos - 1])) return null;

  // Extract potential command (letters only)
  const query = text.slice(lastSlashPos + 1);
  // If there's a space after the command name, it's complete - don't autocomplete
  if (/\s/.test(query)) return null;

  return { query: query.toLowerCase(), startPos: lastSlashPos };
}

/**
 * Filter commands by query
 */
function filterCommands(query) {
  if (!query) return commands.slice(0, 8);

  return commands
    .filter((cmd) => cmd.name.toLowerCase().includes(query))
    .sort((a, b) => {
      const aPrefix = a.name.toLowerCase().startsWith(query);
      const bPrefix = b.name.toLowerCase().startsWith(query);
      if (aPrefix && !bPrefix) return -1;
      if (bPrefix && !aPrefix) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8);
}

/**
 * Get or create popup for an input element
 */
function getPopupForInput(input) {
  // For main chat input
  if (input === el.chatInput) {
    let popup = document.querySelector("[data-slash-popup]");
    if (!popup) {
      popup = document.createElement("div");
      popup.className = "slash-popup";
      popup.setAttribute("data-slash-popup", "");
      popup.hidden = true;
      input.parentElement?.insertBefore(popup, input);
    }
    return popup;
  }

  // For thread input
  if (input === el.threadInput) {
    let popup = document.querySelector("[data-thread-slash-popup]");
    if (!popup) {
      popup = document.createElement("div");
      popup.className = "slash-popup";
      popup.setAttribute("data-thread-slash-popup", "");
      popup.hidden = true;
      input.parentElement?.insertBefore(popup, input);
    }
    return popup;
  }

  return null;
}

/**
 * Render the slash command popup
 */
function renderPopup() {
  if (!activePopup) return;

  if (slashQuery === null || slashMatches.length === 0) {
    hide(activePopup);
    return;
  }

  activePopup.innerHTML = slashMatches
    .map((cmd, index) => {
      const activeClass = index === slashSelectedIndex ? "active" : "";
      return `<div class="slash-item ${activeClass}" data-slash-index="${index}" data-command="${escapeHtml(cmd.name)}">
        <span class="slash-item-name">/${escapeHtml(cmd.name)}</span>
        <span class="slash-item-desc">${escapeHtml(cmd.description)}</span>
      </div>`;
    })
    .join("");

  show(activePopup);

  // Wire click handlers
  activePopup.querySelectorAll(".slash-item").forEach((item) => {
    item.addEventListener("click", () => {
      const command = item.dataset.command;
      if (command) insertCommand(command);
    });
  });
}

/**
 * Insert a command at the current position
 */
function insertCommand(command) {
  if (!activeInput || slashStartPos === -1) return;

  const text = activeInput.value;
  const before = text.slice(0, slashStartPos);
  const cursorPos = activeInput.selectionStart;
  const after = text.slice(cursorPos);

  // Insert command with trailing space
  const commandText = `/${command} `;
  activeInput.value = before + commandText + after;

  const newCursorPos = slashStartPos + commandText.length;
  activeInput.setSelectionRange(newCursorPos, newCursorPos);
  activeInput.focus();

  closePopup();
  activeInput.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Close popup and reset state
 */
export function closePopup() {
  slashQuery = null;
  slashStartPos = -1;
  slashSelectedIndex = 0;
  slashMatches = [];
  if (activePopup) hide(activePopup);
  activeInput = null;
  activePopup = null;
}

/**
 * Handle input changes for slash command detection
 * Now accepts an optional input parameter
 */
export function handleSlashInput(input = el.chatInput) {
  if (!input) return;

  const detected = detectSlashQuery(input);

  if (detected) {
    activeInput = input;
    activePopup = getPopupForInput(input);
    slashQuery = detected.query;
    slashStartPos = detected.startPos;
    slashMatches = filterCommands(slashQuery);
    slashSelectedIndex = 0;
    renderPopup();
  } else {
    closePopup();
  }
}

/**
 * Handle keyboard navigation in slash popup
 * Returns true if event was handled
 */
export function handleSlashKeydown(event) {
  if (slashQuery === null || slashMatches.length === 0) return false;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      slashSelectedIndex = (slashSelectedIndex + 1) % slashMatches.length;
      renderPopup();
      return true;

    case "ArrowUp":
      event.preventDefault();
      slashSelectedIndex = (slashSelectedIndex - 1 + slashMatches.length) % slashMatches.length;
      renderPopup();
      return true;

    case "Enter":
    case "Tab":
      if (slashMatches[slashSelectedIndex]) {
        event.preventDefault();
        insertCommand(slashMatches[slashSelectedIndex].name);
        return true;
      }
      break;

    case "Escape":
      event.preventDefault();
      closePopup();
      return true;
  }

  return false;
}
