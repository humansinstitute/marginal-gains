// Mention autocomplete module
import { elements as el, escapeHtml, hide, show } from "./dom.js";

// Module state
let mentionQuery = null;
let mentionStartPos = -1;
let mentionSelectedIndex = 0;
let mentionMatches = [];
let activeInput = null; // Track which input is active
let activePopup = null; // Track which popup is active

// Reference to user cache (set via init)
let userCache = null;

// Initialize with user cache reference
export function init(cache) {
  userCache = cache;
}

// Detect if cursor is in a @mention context and extract query
export function detectMentionQuery(input) {
  const cursorPos = input.selectionStart;
  const text = input.value.slice(0, cursorPos);

  const lastAtPos = text.lastIndexOf("@");
  if (lastAtPos === -1) return null;

  if (lastAtPos > 0 && !/\s/.test(text[lastAtPos - 1])) return null;

  const query = text.slice(lastAtPos + 1);
  if (/\s/.test(query)) return null;

  return { query: query.toLowerCase(), startPos: lastAtPos };
}

// Filter users by query
export function filterUsers(query) {
  if (!userCache) return [];
  const users = Array.from(userCache.values());
  if (!query) return users.slice(0, 8);

  return users
    .filter((user) => {
      const name = (user.display_name || user.name || "").toLowerCase();
      const npubShort = user.npub?.slice(5, 15)?.toLowerCase() || "";
      return name.includes(query) || npubShort.includes(query);
    })
    .sort((a, b) => {
      const aName = (a.display_name || a.name || "").toLowerCase();
      const bName = (b.display_name || b.name || "").toLowerCase();
      const aPrefix = aName.startsWith(query);
      const bPrefix = bName.startsWith(query);
      if (aPrefix && !bPrefix) return -1;
      if (bPrefix && !aPrefix) return 1;
      return aName.localeCompare(bName);
    })
    .slice(0, 8);
}

// Get or create popup for an input element
function getPopupForInput(input) {
  // For main chat input, use the existing popup
  if (input === el.chatInput && el.mentionPopup) {
    return el.mentionPopup;
  }

  // For thread input, create/get a popup in the thread composer
  if (input === el.threadInput) {
    let popup = document.querySelector("[data-thread-mention-popup]");
    if (!popup) {
      popup = document.createElement("div");
      popup.className = "mention-popup";
      popup.setAttribute("data-thread-mention-popup", "");
      popup.hidden = true;
      // Insert before the thread input
      input.parentElement?.insertBefore(popup, input);
    }
    return popup;
  }

  return null;
}

// Render the mention popup
export function renderMentionPopup() {
  if (!activePopup) return;

  if (mentionQuery === null || mentionMatches.length === 0) {
    hide(activePopup);
    return;
  }

  activePopup.innerHTML = mentionMatches
    .map((user, index) => {
      const name = user.display_name || user.name || "Unknown";
      const avatarUrl = user.picture || `https://robohash.org/${user.pubkey || user.npub}.png?set=set3`;
      const npubShort = user.npub ? `${user.npub.slice(0, 8)}…${user.npub.slice(-4)}` : "";
      const activeClass = index === mentionSelectedIndex ? "active" : "";
      return `<div class="mention-item ${activeClass}" data-mention-index="${index}" data-npub="${escapeHtml(user.npub)}">
        <img class="mention-item-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
        <span class="mention-item-name">${escapeHtml(name)}</span>
        <span class="mention-item-npub">${escapeHtml(npubShort)}</span>
      </div>`;
    })
    .join("");

  show(activePopup);

  activePopup.querySelectorAll(".mention-item").forEach((item) => {
    item.addEventListener("click", () => {
      const npub = item.dataset.npub;
      if (npub) insertMention(npub);
    });
  });
}

// Insert a mention at the current position
export function insertMention(npub) {
  if (!activeInput || mentionStartPos === -1) return;

  const text = activeInput.value;
  const before = text.slice(0, mentionStartPos);
  const cursorPos = activeInput.selectionStart;
  const after = text.slice(cursorPos);

  const mention = `nostr:${npub} `;
  activeInput.value = before + mention + after;

  const newCursorPos = mentionStartPos + mention.length;
  activeInput.setSelectionRange(newCursorPos, newCursorPos);
  activeInput.focus();

  closeMentionPopup();
  activeInput.dispatchEvent(new Event("input", { bubbles: true }));
}

// Close mention popup and reset state
export function closeMentionPopup() {
  mentionQuery = null;
  mentionStartPos = -1;
  mentionSelectedIndex = 0;
  mentionMatches = [];
  if (activePopup) hide(activePopup);
  activeInput = null;
  activePopup = null;
}

// Handle input changes for mention detection
// Now accepts an optional input parameter
export function handleMentionInput(input = el.chatInput) {
  if (!input) return;

  const detected = detectMentionQuery(input);

  if (detected) {
    activeInput = input;
    activePopup = getPopupForInput(input);
    mentionQuery = detected.query;
    mentionStartPos = detected.startPos;
    mentionMatches = filterUsers(mentionQuery);
    mentionSelectedIndex = 0;
    renderMentionPopup();
  } else {
    closeMentionPopup();
  }
}

// Handle keyboard navigation in mention popup
export function handleMentionKeydown(event) {
  if (mentionQuery === null || mentionMatches.length === 0) return false;

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionMatches.length;
      renderMentionPopup();
      return true;

    case "ArrowUp":
      event.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex - 1 + mentionMatches.length) % mentionMatches.length;
      renderMentionPopup();
      return true;

    case "Enter":
    case "Tab":
      if (mentionMatches[mentionSelectedIndex]) {
        event.preventDefault();
        insertMention(mentionMatches[mentionSelectedIndex].npub);
        return true;
      }
      break;

    case "Escape":
      event.preventDefault();
      closeMentionPopup();
      return true;
  }

  return false;
}
