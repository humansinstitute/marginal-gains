/**
 * Emoji reactions module for chat messages
 */

import { state } from "./state.js";

const QUICK_EMOJIS = ["\ud83d\udc4d", "\u2764\ufe0f", "\ud83d\ude02", "\ud83c\udf89", "\ud83d\udc40", "\ud83d\ude4f"];

// Extended emoji list for picker
const PICKER_EMOJIS = [
  // Smileys
  "\ud83d\ude00", "\ud83d\ude03", "\ud83d\ude04", "\ud83d\ude01", "\ud83d\ude02", "\ud83e\udd23", "\ud83d\ude05", "\ud83d\ude06",
  "\ud83d\ude09", "\ud83d\ude0a", "\ud83d\ude0b", "\ud83d\ude0e", "\ud83d\ude0d", "\ud83e\udd70", "\ud83d\ude18", "\ud83d\ude17",
  "\ud83e\udd14", "\ud83e\udd28", "\ud83d\ude10", "\ud83d\ude11", "\ud83d\ude36", "\ud83d\ude44", "\ud83d\ude0f", "\ud83d\ude23",
  "\ud83d\ude25", "\ud83d\ude22", "\ud83d\ude2d", "\ud83d\ude29", "\ud83d\ude21", "\ud83d\ude31", "\ud83d\ude33", "\ud83e\udd2f",
  // Gestures
  "\ud83d\udc4d", "\ud83d\udc4e", "\ud83d\udc4f", "\ud83d\ude4c", "\ud83d\udc4b", "\u270b", "\ud83e\udd1a", "\ud83d\udc4c",
  "\u270c\ufe0f", "\ud83e\udd1e", "\ud83e\udd1f", "\ud83e\udd18", "\ud83d\udc49", "\ud83d\udc48", "\ud83d\udc46", "\ud83d\udc47",
  // Hearts
  "\u2764\ufe0f", "\ud83e\udde1", "\ud83d\udc9b", "\ud83d\udc9a", "\ud83d\udc99", "\ud83d\udc9c", "\ud83d\udda4", "\ud83d\udc94",
  // Objects
  "\ud83c\udf89", "\ud83c\udf8a", "\ud83c\udf81", "\ud83c\udf88", "\u2728", "\ud83d\udca5", "\ud83d\udd25", "\ud83d\udc40",
  "\ud83d\ude4f", "\ud83d\udcaa", "\ud83d\udca1", "\ud83d\udcaf", "\u2705", "\u274c", "\u2757", "\u2753",
];

let currentOpenPicker = null;

/**
 * Initialize reaction handlers
 */
export function initReactions() {
  console.log("[Reactions] Initializing reaction handlers");

  // Handle clicks on reaction pills (to toggle own reaction)
  document.addEventListener("click", handleReactionClick);

  // Handle clicks on quick-react buttons
  document.addEventListener("click", handleQuickReactClick);

  // Handle add reaction button click (show picker)
  document.addEventListener("click", handleAddReactionClick);

  // Close picker when clicking outside
  document.addEventListener("click", handleOutsideClick);

  // Handle picker emoji selection
  document.addEventListener("click", handlePickerEmojiClick);
}

/**
 * Handle click on existing reaction pill (toggle)
 */
function handleReactionClick(e) {
  const pill = e.target.closest(".reaction-pill");
  if (!pill) return;

  e.preventDefault();
  e.stopPropagation();

  const messageId = pill.dataset.messageId;
  const emoji = pill.dataset.emoji;
  console.log("[Reactions] Pill clicked:", { messageId, emoji });
  if (messageId && emoji) {
    toggleReaction(messageId, emoji);
  }
}

/**
 * Handle click on quick-react button
 */
function handleQuickReactClick(e) {
  const btn = e.target.closest(".quick-react-btn");
  if (!btn || btn.classList.contains("add-reaction-btn")) return;

  e.preventDefault();
  e.stopPropagation();

  const bar = btn.closest(".quick-react-bar");
  const messageId = bar?.dataset.messageId;
  const emoji = btn.dataset.emoji;
  console.log("[Reactions] Quick-react clicked:", { messageId, emoji });
  if (messageId && emoji) {
    toggleReaction(messageId, emoji);
  }
}

/**
 * Handle click on add reaction button (show picker)
 */
function handleAddReactionClick(e) {
  const btn = e.target.closest(".add-reaction-btn");
  if (!btn) return;

  e.stopPropagation();
  const bar = btn.closest(".quick-react-bar");
  const messageId = bar?.dataset.messageId;
  if (!messageId) return;

  // Close any existing picker
  closePicker();

  // Create and show picker
  const picker = createEmojiPicker(messageId);
  btn.parentElement.appendChild(picker);
  currentOpenPicker = picker;
}

/**
 * Handle click outside picker to close it
 */
function handleOutsideClick(e) {
  if (!currentOpenPicker) return;
  if (!e.target.closest(".emoji-picker") && !e.target.closest(".add-reaction-btn")) {
    closePicker();
  }
}

/**
 * Handle emoji selection from picker
 */
function handlePickerEmojiClick(e) {
  const btn = e.target.closest(".emoji-picker button");
  if (!btn) return;

  const picker = btn.closest(".emoji-picker");
  const messageId = picker?.dataset.messageId;
  const emoji = btn.dataset.emoji;
  if (messageId && emoji) {
    toggleReaction(messageId, emoji);
    closePicker();
  }
}

/**
 * Close the emoji picker
 */
function closePicker() {
  if (currentOpenPicker) {
    currentOpenPicker.remove();
    currentOpenPicker = null;
  }
}

/**
 * Create emoji picker element
 */
function createEmojiPicker(messageId) {
  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.dataset.messageId = messageId;

  picker.innerHTML = PICKER_EMOJIS.map(
    (emoji) => `<button type="button" data-emoji="${emoji}">${emoji}</button>`
  ).join("");

  return picker;
}

/**
 * Toggle reaction via API
 */
export async function toggleReaction(messageId, emoji) {
  console.log("[Reactions] Toggling reaction:", { messageId, emoji });
  try {
    const res = await fetch(`/api/messages/${messageId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });

    if (!res.ok) {
      console.error("[Reactions] Failed to toggle reaction:", await res.text());
    } else {
      console.log("[Reactions] Toggle successful");
    }
    // SSE event will update the UI
  } catch (err) {
    console.error("[Reactions] Failed to toggle reaction:", err);
  }
}

/**
 * Render quick-react bar for a message
 */
export function renderQuickReactBar(messageId) {
  const buttons = QUICK_EMOJIS.map(
    (emoji) => `<button type="button" class="quick-react-btn" data-emoji="${emoji}">${emoji}</button>`
  ).join("");

  return `
    <div class="quick-react-bar" data-message-id="${messageId}">
      ${buttons}
      <button type="button" class="quick-react-btn add-reaction-btn" title="More reactions">+</button>
    </div>
  `;
}

/**
 * Render reaction pills for a message
 */
export function renderReactionPills(reactions, messageId, currentUserNpub) {
  if (!reactions || reactions.length === 0) return "";

  const pills = reactions.map((r) => {
    const userReacted = r.reactors.includes(currentUserNpub);
    const reactedClass = userReacted ? "reacted" : "";
    const title = r.reactors.map((npub) => npub.slice(0, 12) + "...").join(", ");
    return `<button type="button" class="reaction-pill ${reactedClass}" data-message-id="${messageId}" data-emoji="${r.emoji}" title="${title}">${r.emoji} ${r.count}</button>`;
  }).join("");

  return `<div class="message-reactions">${pills}</div>`;
}

/**
 * Update reactions display for a message
 */
export function updateMessageReactions(messageId, reactions) {
  // Find the message element
  const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!messageEl) return;

  // Find or create reactions container
  let reactionsEl = messageEl.querySelector(".message-reactions");

  if (!reactions || reactions.length === 0) {
    // Remove reactions container if no reactions
    if (reactionsEl) reactionsEl.remove();
    return;
  }

  const currentUserNpub = state.user?.npub || "";
  const newHtml = renderReactionPills(reactions, messageId, currentUserNpub);

  if (reactionsEl) {
    // Update existing container
    reactionsEl.outerHTML = newHtml;
  } else {
    // Add new container after message content
    const content = messageEl.querySelector(".chat-message-content");
    if (content) {
      content.insertAdjacentHTML("beforeend", newHtml);
    }
  }
}
