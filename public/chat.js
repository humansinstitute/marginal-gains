import { closeAvatarMenu, getCachedProfile, fetchProfile } from "./avatar.js";
import { elements as el, escapeHtml, hide, show } from "./dom.js";
import { loadNostrLibs } from "./nostr.js";
import { connect as connectLiveUpdates, disconnect as disconnectLiveUpdates, onEvent } from "./liveUpdates.js";
import { addDmChannel, addMessage, getActiveChannelMessages, removeMessageFromChannel, selectChannel, setChatEnabled, setIsAdmin, setReplyTarget, state, updateAllChannels, upsertChannel, setChannelMessages, refreshUI } from "./state.js";

// Local user cache - populated from server database
const localUserCache = new Map();

// Cache for npub to pubkey conversions
const npubToPubkeyCache = new Map();

// Track currently open thread
let openThreadId = null;

// Track if we should scroll to bottom (only on initial load or explicit action)
let shouldScrollToBottom = false;

// Scroll a container to the bottom
function scrollToBottom(container) {
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

// Check if container is scrolled near bottom (within 100px)
function isNearBottom(container) {
  if (!container) return true;
  const threshold = 100;
  return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
}

// Show/hide the "new message" indicator
function showNewMessageIndicator() {
  let indicator = document.querySelector("[data-new-message-indicator]");
  if (!indicator && el.chatThreadList) {
    // Create indicator if it doesn't exist
    indicator = document.createElement("button");
    indicator.className = "new-message-indicator";
    indicator.setAttribute("data-new-message-indicator", "");
    indicator.textContent = "New message ↓";
    indicator.addEventListener("click", () => {
      scrollToBottom(el.chatThreadList);
      hideNewMessageIndicator();
    });
    // Insert before the thread list
    el.chatThreadList.parentElement?.insertBefore(indicator, el.chatThreadList);
  }
  if (indicator) {
    indicator.style.display = "block";
  }
}

function hideNewMessageIndicator() {
  const indicator = document.querySelector("[data-new-message-indicator]");
  if (indicator) {
    indicator.style.display = "none";
  }
}

// Mention autocomplete state
let mentionQuery = null; // Current @query being typed (null if not active)
let mentionStartPos = -1; // Position of @ in input
let mentionSelectedIndex = 0; // Currently highlighted item
let mentionMatches = []; // Filtered user matches

// Fetch all known users from server
async function fetchLocalUsers() {
  if (!state.session) return;
  try {
    const res = await fetch("/chat/users");
    if (!res.ok) return;
    const users = await res.json();
    console.log("[Chat] Loaded users from server:", users);
    users.forEach((user) => {
      localUserCache.set(user.npub, user);
      if (user.pubkey) {
        npubToPubkeyCache.set(user.npub, user.pubkey);
      }
    });
  } catch (_err) {
    // Ignore fetch errors
  }
}

// Save user to server database
async function saveUserToServer(npub, pubkey, profile) {
  if (!state.session) return;
  try {
    await fetch("/chat/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        npub,
        pubkey,
        displayName: profile?.displayName || profile?.name || null,
        name: profile?.name || null,
        about: profile?.about || null,
        picture: profile?.picture || null,
        nip05: profile?.nip05 || null,
      }),
    });
  } catch (_err) {
    // Ignore save errors
  }
}

// Convert npub to pubkey (cached)
async function npubToPubkey(npub) {
  if (!npub) return null;
  if (npubToPubkeyCache.has(npub)) {
    return npubToPubkeyCache.get(npub);
  }
  try {
    const libs = await loadNostrLibs();
    const decoded = libs.nip19.decode(npub);
    if (decoded.type === "npub") {
      npubToPubkeyCache.set(npub, decoded.data);
      return decoded.data;
    }
  } catch (_err) {
    // Ignore decode errors
  }
  return null;
}

// Get display name for an author (npub)
function getAuthorDisplayName(npub) {
  if (!npub) return "anon";

  // Check local server cache first
  const localUser = localUserCache.get(npub);
  if (localUser?.display_name || localUser?.name) {
    return localUser.display_name || localUser.name;
  }

  // Check relay profile cache
  let pubkey = npubToPubkeyCache.get(npub);
  if (!pubkey && state.session?.npub === npub) {
    pubkey = state.session.pubkey;
    npubToPubkeyCache.set(npub, pubkey);
  }

  if (pubkey) {
    const profile = getCachedProfile(pubkey);
    if (profile?.name || profile?.displayName) {
      return profile.displayName || profile.name;
    }
  }

  // Fallback to short npub
  const trimmed = npub.replace(/^npub1/, "");
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

// Get avatar URL for an author (npub)
function getAuthorAvatarUrl(npub) {
  if (!npub) return "https://robohash.org/nostr.png?set=set3";

  // First check server database cache (shared across all users)
  const localUser = localUserCache.get(npub);
  if (localUser?.picture) return localUser.picture;

  // Fall back to relay profile cache
  const pubkey = npubToPubkeyCache.get(npub) || localUser?.pubkey || (state.session?.npub === npub ? state.session.pubkey : null);
  if (pubkey) {
    const profile = getCachedProfile(pubkey);
    if (profile?.picture) return profile.picture;
    return `https://robohash.org/${pubkey}.png?set=set3`;
  }

  // Fallback using npub hash
  return `https://robohash.org/${npub}.png?set=set3`;
}

// Prefetch profiles for message authors
async function prefetchAuthorProfiles(messages) {
  const uniqueNpubs = [...new Set(messages.map((m) => m.author).filter(Boolean))];
  await Promise.all(
    uniqueNpubs.map(async (npub) => {
      // Skip if we already have this user with name AND picture
      const existing = localUserCache.get(npub);
      if ((existing?.display_name || existing?.name) && existing?.picture) return;

      const pubkey = await npubToPubkey(npub);
      if (pubkey) {
        const profile = await fetchProfile(pubkey);
        // Save to server for future use if we got useful data
        if (profile?.displayName || profile?.name || profile?.picture) {
          await saveUserToServer(npub, pubkey, profile);
          // Update local cache
          localUserCache.set(npub, {
            npub,
            pubkey,
            display_name: profile.displayName || profile.name || existing?.display_name,
            name: profile.name || existing?.name,
            about: profile.about || existing?.about,
            picture: profile.picture || existing?.picture,
            nip05: profile.nip05 || existing?.nip05,
          });
        }
      }
    })
  );
}

// Fetch current user's admin status
async function fetchUserInfo() {
  if (!state.session) return;
  try {
    const res = await fetch("/chat/me");
    if (!res.ok) return;
    const info = await res.json();
    setIsAdmin(info.isAdmin === true);
  } catch (_err) {
    // Ignore fetch errors
  }
}

// Set up handlers for live update events
function setupLiveUpdateHandlers() {
  // When initial sync completes, render channels
  onEvent("sync:init", () => {
    renderChannels();
  });

  // When a new message arrives
  onEvent("message:new", (data) => {
    // If viewing this channel, handle the new message
    if (state.chat.selectedChannelId === String(data.channelId)) {
      // Check if user is near bottom before re-rendering
      const wasNearBottom = isNearBottom(el.chatThreadList);

      renderThreads();

      // If user was near bottom, scroll to show new message
      // Otherwise show the "new message" indicator
      if (wasNearBottom) {
        scrollToBottom(el.chatThreadList);
        hideNewMessageIndicator();
      } else {
        showNewMessageIndicator();
      }

      // If thread panel is open for a parent message that just got a reply, update it
      // Compare as strings since openThreadId is a string and data.parent_id is a number
      const parentId = data.parent_id ? String(data.parent_id) : null;
      if (openThreadId && parentId === openThreadId) {
        renderThreadPanel(openThreadId);
      }
    }
  });

  // When a new channel is created
  onEvent("channel:new", () => {
    renderChannels();
  });

  // When a channel is updated
  onEvent("channel:update", (data) => {
    renderChannels();
    // Update active channel chip if this is the selected channel
    if (state.chat.selectedChannelId === String(data.id) && el.activeChannel) {
      el.activeChannel.textContent = data.displayName || data.name;
    }
  });

  // When a channel is deleted
  onEvent("channel:delete", (data) => {
    renderChannels();
    // If viewing this channel, clear the view
    if (state.chat.selectedChannelId === String(data.id)) {
      if (el.threadList) {
        el.threadList.innerHTML = `<p class="chat-placeholder">This channel was deleted.</p>`;
      }
      if (el.activeChannel) {
        el.activeChannel.textContent = "Pick a channel";
      }
    }
  });

  // When a new DM is created
  onEvent("dm:new", () => {
    renderChannels();
  });

  // When a message is deleted
  onEvent("message:delete", (data) => {
    const channelId = String(data.channelId);
    const messageId = String(data.messageId);

    // Remove message from state
    removeMessageFromChannel(channelId, messageId);

    // Re-render if viewing this channel
    if (state.chat.selectedChannelId === channelId) {
      renderThreads();

      // Close thread panel if the deleted message was the open thread root
      if (openThreadId === messageId) {
        closeThreadPanel();
      }
    }
  });
}

export const initChat = async () => {
  // Check if we're on the chat page
  const isChatPage = window.__CHAT_PAGE__ === true;

  // Pre-populate the npub→pubkey cache for the logged-in user
  if (state.session?.npub && state.session?.pubkey) {
    npubToPubkeyCache.set(state.session.npub, state.session.pubkey);
  }

  // Fetch local users and user info from server database
  await Promise.all([fetchLocalUsers(), fetchUserInfo()]);

  if (isChatPage && el.chatShell) {
    // On chat page - show chat immediately and connect to live updates
    show(el.chatShell);
    setChatEnabled(true);

    // Set up live update event handlers
    setupLiveUpdateHandlers();

    // Hide new message indicator when user scrolls to bottom
    el.chatThreadList?.addEventListener("scroll", () => {
      if (isNearBottom(el.chatThreadList)) {
        hideNewMessageIndicator();
      }
    });

    // Connect to SSE - this will provide initial sync and live updates
    await connectLiveUpdates();

    // Fetch messages for initially selected channel (if any)
    if (state.chat.selectedChannelId) {
      await fetchMessages(state.chat.selectedChannelId);
    }
  } else if (el.chatShell) {
    // On home page - keep chat hidden (navigate to /chat instead)
    hide(el.chatShell);
  }

  if (el.channelModal) {
    hide(el.channelModal);
  }

  wireChannelModal();
  wireComposer();
  wireThreadSidebar();
  wireChannelSettingsModal();
  wireDmModal();
  updateChannelSettingsCog();
};

async function fetchChannels() {
  if (!state.session) return;
  try {
    const res = await fetch("/chat/channels");
    if (!res.ok) return;
    const data = await res.json();

    // Map regular channels
    const channels = (data.channels || []).map((ch) => ({
      id: String(ch.id),
      name: ch.name,
      displayName: ch.display_name,
      description: ch.description,
      isPublic: ch.is_public === 1,
    }));

    // Map DM channels - include other participant's npub for display
    const dmChannels = (data.dmChannels || []).map((ch) => ({
      id: String(ch.id),
      name: ch.name,
      displayName: ch.display_name,
      description: ch.description,
      otherNpub: ch.other_npub || null,
    }));

    // Map personal channel
    const personalChannel = data.personalChannel ? {
      id: String(data.personalChannel.id),
      name: data.personalChannel.name,
      displayName: data.personalChannel.display_name,
      description: data.personalChannel.description,
    } : null;

    // Update all channels at once
    updateAllChannels(channels, dmChannels, personalChannel);
  } catch (_err) {
    // Ignore fetch errors
  }
}

async function fetchMessages(channelId) {
  if (!state.session) return;
  try {
    const res = await fetch(`/chat/channels/${channelId}/messages`);
    if (!res.ok) return;
    const messages = await res.json();
    const mapped = messages.map((m) => ({
      id: String(m.id),
      channelId: String(m.channel_id),
      author: m.author,
      body: m.body,
      createdAt: m.created_at,
      parentId: m.parent_id ? String(m.parent_id) : null,
    }));
    setChannelMessages(channelId, mapped);

    // Scroll to bottom on initial load of channel messages
    shouldScrollToBottom = true;
    // Hide any existing new message indicator
    hideNewMessageIndicator();

    // Prefetch author profiles in background, then re-render to show names
    prefetchAuthorProfiles(mapped).then(() => {
      renderThreads();
    });
  } catch (_err) {
    // Ignore fetch errors
  }
}


function wireChannelModal() {
  const closeModal = () => hide(el.channelModal);
  el.channelModal?.addEventListener("click", (event) => {
    if (event.target === el.channelModal) closeModal();
  });
  el.newChannelTriggers?.forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!state.session) return;
      // Show/hide private channel option based on admin status
      const privateField = el.channelModal?.querySelector('[data-admin-only]');
      if (privateField) {
        if (state.isAdmin) {
          privateField.style.display = '';
        } else {
          privateField.style.display = 'none';
        }
      }
      show(el.channelModal);
    })
  );
  el.closeChannelModalBtns?.forEach((btn) => btn.addEventListener("click", closeModal));
  el.channelForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.session) return;
    const data = new FormData(event.currentTarget);

    // Only admins can create private channels (isPublic defaults to true if not admin)
    const isPublicChecked = data.get("isPublic") === "on";
    const isPublic = state.isAdmin ? isPublicChecked : true;

    const payload = {
      name: String(data.get("name") || "").trim().toLowerCase() || "untitled",
      displayName: String(data.get("displayName") || "").trim() || "Untitled channel",
      description: String(data.get("description") || "").trim(),
      isPublic,
    };

    try {
      const res = await fetch("/chat/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const created = await res.json();
        upsertChannel({
          id: String(created.id),
          name: created.name,
          displayName: created.display_name,
          description: created.description,
          isPublic: created.is_public === 1,
        });
        selectChannel(String(created.id));
      } else {
        const err = await res.json().catch(() => ({}));
        console.error('[Chat] Failed to create channel:', err.error || res.status);
      }
    } catch (_err) {
      // Ignore errors
    }

    hide(el.channelModal);
    event.currentTarget.reset();
  });
}

// ========== Mention Autocomplete ==========

// Detect if cursor is in a @mention context and extract query
function detectMentionQuery(input) {
  const cursorPos = input.selectionStart;
  const text = input.value.slice(0, cursorPos);

  // Find the last @ that could be a mention start
  const lastAtPos = text.lastIndexOf('@');
  if (lastAtPos === -1) return null;

  // Check if @ is at start or preceded by whitespace
  if (lastAtPos > 0 && !/\s/.test(text[lastAtPos - 1])) return null;

  // Extract the query after @
  const query = text.slice(lastAtPos + 1);

  // If query contains whitespace, we're not in a mention anymore
  if (/\s/.test(query)) return null;

  return { query: query.toLowerCase(), startPos: lastAtPos };
}

// Filter users by query
function filterUsers(query) {
  const users = Array.from(localUserCache.values());
  if (!query) return users.slice(0, 8); // Show first 8 if empty query

  return users
    .filter(user => {
      const name = (user.display_name || user.name || '').toLowerCase();
      const npubShort = user.npub?.slice(5, 15)?.toLowerCase() || '';
      return name.includes(query) || npubShort.includes(query);
    })
    .sort((a, b) => {
      // Prioritize prefix matches
      const aName = (a.display_name || a.name || '').toLowerCase();
      const bName = (b.display_name || b.name || '').toLowerCase();
      const aPrefix = aName.startsWith(query);
      const bPrefix = bName.startsWith(query);
      if (aPrefix && !bPrefix) return -1;
      if (bPrefix && !aPrefix) return 1;
      return aName.localeCompare(bName);
    })
    .slice(0, 8);
}

// Render the mention popup
function renderMentionPopup() {
  if (!el.mentionPopup) return;

  if (mentionQuery === null || mentionMatches.length === 0) {
    hide(el.mentionPopup);
    return;
  }

  el.mentionPopup.innerHTML = mentionMatches
    .map((user, index) => {
      const name = user.display_name || user.name || 'Unknown';
      const avatarUrl = user.picture || `https://robohash.org/${user.pubkey || user.npub}.png?set=set3`;
      const npubShort = user.npub ? `${user.npub.slice(0, 8)}…${user.npub.slice(-4)}` : '';
      const activeClass = index === mentionSelectedIndex ? 'active' : '';
      return `<div class="mention-item ${activeClass}" data-mention-index="${index}" data-npub="${escapeHtml(user.npub)}">
        <img class="mention-item-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
        <span class="mention-item-name">${escapeHtml(name)}</span>
        <span class="mention-item-npub">${escapeHtml(npubShort)}</span>
      </div>`;
    })
    .join('');

  show(el.mentionPopup);

  // Wire up click handlers
  el.mentionPopup.querySelectorAll('.mention-item').forEach(item => {
    item.addEventListener('click', () => {
      const npub = item.dataset.npub;
      if (npub) insertMention(npub);
    });
  });
}

// Insert a mention at the current position
function insertMention(npub) {
  if (!el.chatInput || mentionStartPos === -1) return;

  const text = el.chatInput.value;
  const before = text.slice(0, mentionStartPos);
  const cursorPos = el.chatInput.selectionStart;
  const after = text.slice(cursorPos);

  // Insert the nostr: mention format
  const mention = `nostr:${npub} `;
  el.chatInput.value = before + mention + after;

  // Move cursor after the mention
  const newCursorPos = mentionStartPos + mention.length;
  el.chatInput.setSelectionRange(newCursorPos, newCursorPos);
  el.chatInput.focus();

  // Clear mention state
  closeMentionPopup();

  // Trigger input event to update send button state
  el.chatInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// Close mention popup and reset state
function closeMentionPopup() {
  mentionQuery = null;
  mentionStartPos = -1;
  mentionSelectedIndex = 0;
  mentionMatches = [];
  hide(el.mentionPopup);
}

// Handle input changes for mention detection
function handleMentionInput() {
  if (!el.chatInput) return;

  const detected = detectMentionQuery(el.chatInput);

  if (detected) {
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
function handleMentionKeydown(event) {
  if (mentionQuery === null || mentionMatches.length === 0) return false;

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionMatches.length;
      renderMentionPopup();
      return true;

    case 'ArrowUp':
      event.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex - 1 + mentionMatches.length) % mentionMatches.length;
      renderMentionPopup();
      return true;

    case 'Enter':
    case 'Tab':
      if (mentionMatches[mentionSelectedIndex]) {
        event.preventDefault();
        insertMention(mentionMatches[mentionSelectedIndex].npub);
        return true;
      }
      break;

    case 'Escape':
      event.preventDefault();
      closeMentionPopup();
      return true;
  }

  return false;
}

function wireComposer() {
  el.chatInput?.addEventListener("input", () => {
    const hasText = Boolean(el.chatInput.value.trim());
    if (hasText && state.chat.selectedChannelId) el.chatSendBtn?.removeAttribute("disabled");
    else el.chatSendBtn?.setAttribute("disabled", "disabled");

    // Handle mention autocomplete
    handleMentionInput();
  });

  el.chatInput?.addEventListener("keydown", (event) => {
    // Let mention handler take over if active
    if (handleMentionKeydown(event)) return;
  });

  // Paste handler for images/files
  el.chatInput?.addEventListener("paste", async (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files = extractUploadableFiles(items);
    if (files.length > 0) {
      event.preventDefault();
      await uploadFiles(files);
    }
  });

  // Drag and drop handler
  const composer = el.chatInput?.closest(".chat-composer");
  composer?.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    composer.classList.add("drag-over");
  });
  composer?.addEventListener("dragleave", () => {
    composer.classList.remove("drag-over");
  });
  composer?.addEventListener("drop", async (event) => {
    event.preventDefault();
    composer.classList.remove("drag-over");
    const items = event.dataTransfer?.items || event.dataTransfer?.files;
    if (!items) return;
    const files = extractUploadableFiles(items);
    if (files.length > 0) {
      await uploadFiles(files);
    }
  });

  // Close mention popup when clicking outside
  document.addEventListener("click", (event) => {
    if (!el.mentionPopup?.contains(event.target) && event.target !== el.chatInput) {
      closeMentionPopup();
    }
  });

  // Message menu: toggle dropdown, close others, and handle delete
  document.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-message-menu]");
    const deleteBtn = event.target.closest("[data-delete-message]");

    // Handle menu trigger click
    if (trigger) {
      event.stopPropagation();
      const id = trigger.dataset.messageMenu;
      // Close all other open menus
      document.querySelectorAll("[data-message-dropdown]").forEach((d) => {
        if (d.dataset.messageDropdown !== id) d.hidden = true;
      });
      // Toggle this menu
      const dropdown = document.querySelector(`[data-message-dropdown="${id}"]`);
      if (dropdown) dropdown.hidden = !dropdown.hidden;
      return;
    }

    // Handle delete button click
    if (deleteBtn) {
      event.stopPropagation();
      const messageId = deleteBtn.dataset.deleteMessage;
      if (!confirm("Delete this message? Thread replies will also be removed.")) return;

      try {
        const res = await fetch(`/chat/messages/${messageId}`, { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || "Failed to delete message");
        }
        // Success: SSE broadcast handles UI update, no need to do anything here
      } catch (_err) {
        alert("Failed to delete message");
      }
      return;
    }

    // Close all menus when clicking elsewhere
    document.querySelectorAll("[data-message-dropdown]").forEach((d) => {
      d.hidden = true;
    });
  });

  el.chatSendBtn?.addEventListener("click", sendMessage);
}

// ========== File Upload Handling ==========

// Track upload state
let isUploading = false;

// Extract files from clipboard or drop event
function extractUploadableFiles(items) {
  const files = [];
  for (const item of Array.from(items)) {
    if (!item) continue;
    if (item.kind === "file") {
      const file = item.getAsFile?.();
      if (file) files.push(file);
    } else if (item instanceof File) {
      files.push(item);
    }
  }
  return files;
}

// Upload files and insert markdown into a specific input element
async function uploadFilesToInput(files, inputEl, sendBtn, defaultPlaceholder) {
  if (!state.session || !inputEl || isUploading) return;

  for (const file of files) {
    isUploading = true;
    sendBtn?.setAttribute("disabled", "disabled");
    inputEl.setAttribute("placeholder", "Uploading...");

    try {
      const form = new FormData();
      form.append("file", file, file.name);

      const res = await fetch("/api/assets/upload", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Upload failed");
        continue;
      }

      const payload = await res.json();
      const markdown = payload.isImage
        ? `![${file.name}](${payload.url})`
        : `[${file.name}](${payload.url})`;

      insertTextAtCursorIn(inputEl, markdown);
    } catch (error) {
      console.error("[Chat] Upload failed:", error);
      alert("Upload failed");
    } finally {
      isUploading = false;
      inputEl.setAttribute("placeholder", defaultPlaceholder);
      // Trigger input event to update send button state
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
}

// Wrapper for main chat input
async function uploadFiles(files) {
  await uploadFilesToInput(files, el.chatInput, el.chatSendBtn, "Share an update, @name to mention");
}

// Insert text at cursor position in a specific input element
function insertTextAtCursorIn(inputEl, text) {
  if (!inputEl) return;
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  const before = inputEl.value.slice(0, start);
  const after = inputEl.value.slice(end);

  // Add newlines around markdown if needed
  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";

  inputEl.value = before + prefix + text + suffix + after;
  const newPos = start + prefix.length + text.length + suffix.length;
  inputEl.selectionStart = inputEl.selectionEnd = newPos;
  inputEl.focus();
}

// Legacy wrapper for main chat input
function insertTextAtCursor(text) {
  insertTextAtCursorIn(el.chatInput, text);
  el.chatInput?.dispatchEvent(new Event("input", { bubbles: true }));
}

async function sendMessage() {
  if (!state.session || !el.chatInput) return;
  const body = el.chatInput.value.trim();
  if (!body || !state.chat.selectedChannelId) return;

  const channelId = state.chat.selectedChannelId;
  const parentId = state.chat.replyingTo?.id || null;

  el.chatInput.value = "";
  el.chatSendBtn?.setAttribute("disabled", "disabled");
  setReplyTarget(null);

  try {
    const res = await fetch(`/chat/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, parentId: parentId ? Number(parentId) : null }),
    });
    if (res.ok) {
      await fetchMessages(channelId);
    }
  } catch (_err) {
    // Ignore errors
  }
}

export const refreshChatUI = () => {
  if (!el.chatShell) return;

  const isChatPage = window.__CHAT_PAGE__ === true;

  if (!state.session || (!state.chat.enabled && !isChatPage)) {
    hide(el.chatShell);
    hide(el.channelModal);
    return;
  }

  if (isChatPage || state.chat.enabled) {
    show(el.chatShell);
    renderChannels();
    renderThreads();
  }
};

function renderChannels() {
  // Render regular channels
  if (el.chatChannelList) {
    const channels = state.chat.channels;
    el.chatChannelList.innerHTML = channels
      .map((channel) => {
        const isActive = channel.id === state.chat.selectedChannelId;
        const lockIcon = channel.isPublic ? '' : '<span class="channel-lock" title="Private">&#128274;</span>';
        return `<button class="chat-channel${isActive ? " active" : ""}" data-channel-id="${channel.id}">
          <div class="chat-channel-name">#${escapeHtml(channel.name)} ${lockIcon}</div>
          <p class="chat-channel-desc">${escapeHtml(channel.displayName)}</p>
        </button>`;
      })
      .join("");
  }

  // Render DM channels
  if (el.dmList) {
    const dmChannels = state.chat.dmChannels;
    if (dmChannels.length === 0) {
      el.dmList.innerHTML = `<p class="dm-empty">No conversations yet</p>`;
    } else {
      el.dmList.innerHTML = dmChannels
        .map((dm) => {
          const isActive = dm.id === state.chat.selectedChannelId;
          const displayName = getDmDisplayName(dm);
          const avatarUrl = getAuthorAvatarUrl(dm.otherNpub);
          return `<button class="chat-channel dm-channel${isActive ? " active" : ""}" data-channel-id="${dm.id}">
            <img class="dm-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
            <div class="dm-info">
              <div class="chat-channel-name">${escapeHtml(displayName)}</div>
            </div>
          </button>`;
        })
        .join("");
    }
  }

  // Render personal channel section
  if (el.personalSection) {
    const personalChannel = state.chat.personalChannel;
    if (personalChannel) {
      const isActive = personalChannel.id === state.chat.selectedChannelId;
      el.personalSection.innerHTML = `
        <div class="channel-divider"></div>
        <button class="chat-channel channel-personal${isActive ? " active" : ""}" data-channel-id="${personalChannel.id}">
          <div class="chat-channel-name"><span class="channel-note-icon" title="Personal notes">&#128221;</span> ${escapeHtml(personalChannel.displayName)}</div>
          <p class="chat-channel-desc">Your private notes</p>
        </button>`;
    } else {
      el.personalSection.innerHTML = '';
    }
  }

  // Wire up all channel click handlers
  const allChannelBtns = document.querySelectorAll("[data-channel-id]");
  allChannelBtns.forEach((btn) => {
    const handler = async () => {
      const channelId = btn.dataset.channelId;
      selectChannel(channelId);
      updateChannelSettingsCog();
      await fetchMessages(channelId);
      setMobileView("messages");
    };
    btn.addEventListener("click", handler);
    btn.addEventListener("touchend", (e) => {
      e.preventDefault();
      handler();
    });
  });
}

// Get display name for a DM channel
function getDmDisplayName(dm) {
  if (!dm.otherNpub) return "DM";
  const user = localUserCache.get(dm.otherNpub);
  if (user?.display_name || user?.name) {
    return user.display_name || user.name;
  }
  // Fallback to short npub
  const trimmed = dm.otherNpub.replace(/^npub1/, "");
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

// Find channel by ID across all channel types
function findChannel(channelId) {
  return (
    state.chat.channels.find((c) => c.id === channelId) ||
    state.chat.dmChannels.find((c) => c.id === channelId) ||
    (state.chat.personalChannel?.id === channelId ? state.chat.personalChannel : null)
  );
}

function renderThreads() {
  if (!el.chatThreadList) return;
  const channel = findChannel(state.chat.selectedChannelId);
  if (!channel) {
    el.chatThreadList.innerHTML = `<p class="chat-placeholder">Pick or create a channel to start chatting.</p>`;
    setChatHeader("Pick a channel");
    return;
  }

  // Determine header based on channel type
  const isDm = state.chat.dmChannels.some((c) => c.id === channel.id);
  const isPersonal = state.chat.personalChannel?.id === channel.id;
  let headerText;
  let placeholderText;

  if (isDm) {
    const dmName = getDmDisplayName(channel);
    headerText = `DM - ${dmName}`;
    placeholderText = `Start a conversation with ${dmName}`;
  } else if (isPersonal) {
    headerText = "Note to self";
    placeholderText = "Write your first note";
  } else {
    headerText = `#${channel.name}`;
    placeholderText = `Say hello in #${channel.name}`;
  }

  setChatHeader(headerText);
  const messages = getActiveChannelMessages();
  if (messages.length === 0) {
    el.chatThreadList.innerHTML = `<p class="chat-placeholder">No messages yet. ${placeholderText}.</p>`;
    return;
  }
  const byParent = groupByParent(messages);
  const roots = byParent.get(null) || [];
  el.chatThreadList.innerHTML = roots
    .map((message) => renderCollapsedThread(message, byParent))
    .join("");

  // Only scroll to bottom on initial load, not on every re-render
  if (shouldScrollToBottom) {
    scrollToBottom(el.chatThreadList);
    shouldScrollToBottom = false;
  }

  // Wire up thread click handlers
  el.chatThreadList.querySelectorAll("[data-thread-id]").forEach((thread) => {
    const handler = (e) => {
      // Don't open sidebar if clicking on a button
      if (e.target.closest("button")) return;
      const threadId = thread.dataset.threadId;
      openThread(threadId, messages, byParent);
    };
    thread.addEventListener("click", handler);
    thread.addEventListener("touchend", handler);
  });
}

// Format timestamp as dd/mm/yy @ hh:mm
function formatReplyTimestamp(dateStr) {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} @ ${hours}:${minutes}`;
}

function renderCollapsedThread(message, byParent) {
  const replies = byParent.get(message.id) || [];
  const replyCount = replies.length;
  const lastReply = replies.length > 0 ? replies[replies.length - 1] : null;

  return `<article class="chat-thread" data-thread-id="${message.id}">
    <div class="chat-thread-collapsed">
      <div class="chat-thread-first">
        ${renderMessageCompact(message, { showAvatar: true })}
      </div>
      ${replyCount > 0 ? `
        ${renderReplyPreview(lastReply, replyCount)}
      ` : ''}
    </div>
  </article>`;
}

// Render a reply with mini avatar, smaller text, timestamp, and view thread link
function renderReplyPreview(reply, replyCount) {
  const avatarUrl = getAuthorAvatarUrl(reply.author);
  const authorName = getAuthorDisplayName(reply.author);
  const timestamp = formatReplyTimestamp(reply.createdAt);
  const moreReplies = replyCount > 1 ? `+${replyCount - 1} more` : '';

  return `<div class="chat-reply">
    <img class="chat-reply-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
    <div class="chat-reply-content">
      <div class="chat-reply-meta">
        <span class="chat-reply-author">${escapeHtml(authorName)}</span>
        <span class="chat-reply-time">${timestamp}</span>
      </div>
      <p class="chat-message-body">${renderMessageBody(reply.body)}</p>
      <span class="chat-reply-thread-link">${moreReplies ? moreReplies + ' · ' : ''}... view thread</span>
    </div>
  </div>`;
}

// Parse message body and render mentions, images, and file links
function renderMessageBody(body) {
  // First escape the whole body
  let html = escapeHtml(body);

  // Match nostr:npub1... patterns (npub is 63 chars after "npub1")
  const mentionRegex = /nostr:(npub1[a-z0-9]{58})/g;

  html = html.replace(mentionRegex, (_match, npub) => {
    const user = localUserCache.get(npub);
    const displayName = user?.display_name || user?.name || `${npub.slice(0, 8)}…${npub.slice(-4)}`;
    return `<span class="mention">@${escapeHtml(displayName)}</span>`;
  });

  // Match markdown images: ![alt](url) - render as actual images
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  html = html.replace(imageRegex, (_match, alt, url) => {
    const safeUrl = url.replace(/"/g, "&quot;");
    const safeAlt = alt || "image";
    return `<div class="chat-image-container"><img class="chat-image" src="${safeUrl}" alt="${safeAlt}" loading="lazy" onclick="window.open('${safeUrl}', '_blank')" /></div>`;
  });

  // Match markdown links: [name](url) - render as file thumbnails for assets, regular links otherwise
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  html = html.replace(linkRegex, (_match, name, url) => {
    const safeUrl = url.replace(/"/g, "&quot;");
    const safeName = escapeHtml(name);

    // Check if it's an internal asset link
    if (url.startsWith("/assets/")) {
      const ext = url.split(".").pop()?.toLowerCase() || "";
      const icon = getFileIcon(ext);
      return `<a class="chat-file-attachment" href="${safeUrl}" target="_blank" download>
        <span class="chat-file-icon">${icon}</span>
        <span class="chat-file-name">${safeName}</span>
      </a>`;
    }

    // Regular external link
    return `<a href="${safeUrl}" target="_blank" rel="noopener">${safeName}</a>`;
  });

  return html;
}

// Get icon for file type
function getFileIcon(ext) {
  const icons = {
    pdf: "&#128196;", // page
    txt: "&#128196;",
    csv: "&#128200;", // chart
    json: "&#128196;",
    zip: "&#128230;", // package
    default: "&#128190;", // floppy disk
  };
  return icons[ext] || icons.default;
}

// Render message action menu (delete option for author or admin)
function renderMessageMenu(message) {
  const canDelete = state.session?.npub === message.author || state.isAdmin;
  if (!canDelete) return '';

  return `<div class="message-menu">
    <button class="message-menu-trigger" data-message-menu="${message.id}" aria-label="Message options">&#8942;</button>
    <div class="message-menu-dropdown" data-message-dropdown="${message.id}" hidden>
      <button class="message-menu-item danger" data-delete-message="${message.id}">Delete</button>
    </div>
  </div>`;
}

function renderMessageCompact(message, { showAvatar = false } = {}) {
  const avatarHtml = showAvatar
    ? `<img class="chat-message-avatar" src="${escapeHtml(getAuthorAvatarUrl(message.author))}" alt="" loading="lazy" />`
    : '';
  const menuHtml = renderMessageMenu(message);
  return `<div class="chat-message${showAvatar ? ' chat-message-with-avatar' : ''}" data-message-id="${message.id}">
    ${avatarHtml}
    <div class="chat-message-content">
      <div class="chat-message-meta">
        <span class="chat-message-author">${escapeHtml(getAuthorDisplayName(message.author))}</span>
        <time>${new Date(message.createdAt).toLocaleTimeString()}</time>
      </div>
      <p class="chat-message-body">${renderMessageBody(message.body)}</p>
      ${menuHtml}
    </div>
  </div>`;
}

function renderMessageFull(message) {
  const avatarUrl = getAuthorAvatarUrl(message.author);
  const menuHtml = renderMessageMenu(message);
  return `<div class="chat-message chat-message-with-avatar" data-message-id="${message.id}">
    <img class="chat-thread-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
    <div class="chat-message-content">
      <div class="chat-message-meta">
        <span class="chat-message-author">${escapeHtml(getAuthorDisplayName(message.author))}</span>
        <time>${new Date(message.createdAt).toLocaleTimeString()}</time>
      </div>
      <p class="chat-message-body">${renderMessageBody(message.body)}</p>
      ${menuHtml}
    </div>
  </div>`;
}

function groupByParent(messages) {
  const map = new Map();
  messages.forEach((m) => {
    const key = m.parentId || null;
    const bucket = map.get(key) || [];
    bucket.push(m);
    map.set(key, bucket);
  });
  return map;
}

function setChatHeader(label) {
  if (!el.activeChannel) return;
  el.activeChannel.textContent = label;
}

// Mobile view navigation helpers
function setMobileView(view) {
  if (el.chatLayout) {
    el.chatLayout.dataset.mobileView = view;
  }
}

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

// Thread panel functions (inline panel, not overlay)
function wireThreadSidebar() {
  // Close thread button
  const closeHandler = () => closeThreadPanel();
  el.closeThreadBtn?.addEventListener("click", closeHandler);
  el.closeThreadBtn?.addEventListener("touchend", (e) => { e.preventDefault(); closeHandler(); });

  el.threadInput?.addEventListener("input", () => {
    const hasText = Boolean(el.threadInput.value.trim());
    if (hasText && openThreadId) el.threadSendBtn?.removeAttribute("disabled");
    else el.threadSendBtn?.setAttribute("disabled", "disabled");
  });

  // Paste handler for thread input
  el.threadInput?.addEventListener("paste", async (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files = extractUploadableFiles(items);
    if (files.length > 0) {
      event.preventDefault();
      await uploadFilesToInput(files, el.threadInput, el.threadSendBtn, "Reply to thread...");
    }
  });

  // Drag and drop for thread composer
  const threadComposer = el.threadInput?.closest(".chat-thread-panel-composer");
  threadComposer?.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    threadComposer.classList.add("drag-over");
  });
  threadComposer?.addEventListener("dragleave", () => {
    threadComposer.classList.remove("drag-over");
  });
  threadComposer?.addEventListener("drop", async (event) => {
    event.preventDefault();
    threadComposer.classList.remove("drag-over");
    const items = event.dataTransfer?.items || event.dataTransfer?.files;
    if (!items) return;
    const files = extractUploadableFiles(items);
    if (files.length > 0) {
      await uploadFilesToInput(files, el.threadInput, el.threadSendBtn, "Reply to thread...");
    }
  });

  // Thread send button
  const sendHandler = () => sendThreadReply();
  el.threadSendBtn?.addEventListener("click", sendHandler);
  el.threadSendBtn?.addEventListener("touchend", (e) => { e.preventDefault(); sendHandler(); });

  // Mobile back buttons
  const backToChannelsHandler = () => setMobileView("channels");
  el.backToChannelsBtn?.addEventListener("click", backToChannelsHandler);
  el.backToChannelsBtn?.addEventListener("touchend", (e) => { e.preventDefault(); backToChannelsHandler(); });

  const backToMessagesHandler = () => { closeThreadPanel(); setMobileView("messages"); };
  el.backToMessagesBtn?.addEventListener("click", backToMessagesHandler);
  el.backToMessagesBtn?.addEventListener("touchend", (e) => { e.preventDefault(); backToMessagesHandler(); });
}

function openThread(threadId, messages, byParent) {
  openThreadId = threadId;
  const rootMessage = messages.find((m) => m.id === threadId);
  if (!rootMessage) return;

  const replies = byParent.get(threadId) || [];
  const allMessages = [rootMessage, ...replies];

  // Render messages in panel
  if (el.threadMessages) {
    el.threadMessages.innerHTML = allMessages
      .map((msg) => renderMessageFull(msg))
      .join("");
    // Scroll to bottom to show latest replies
    scrollToBottom(el.threadMessages);
  }

  // Show inline panel
  show(el.threadPanel);

  // Switch to thread view on mobile
  if (isMobile()) {
    setMobileView("thread");
  }

  el.threadInput?.focus();
}

// Re-render the currently open thread panel (used by SSE updates)
function renderThreadPanel(threadId) {
  if (!threadId) return;
  const messages = getActiveChannelMessages();
  const byParent = groupByParent(messages);
  openThread(threadId, messages, byParent);
}

function closeThreadPanel() {
  openThreadId = null;
  hide(el.threadPanel);
  if (el.threadInput) el.threadInput.value = "";
  el.threadSendBtn?.setAttribute("disabled", "disabled");

  // Switch to messages view on mobile when thread is closed
  if (isMobile()) {
    setMobileView("messages");
  }
}

async function sendThreadReply() {
  if (!state.session || !el.threadInput || !openThreadId) return;
  const body = el.threadInput.value.trim();
  if (!body || !state.chat.selectedChannelId) return;

  const channelId = state.chat.selectedChannelId;
  const parentId = openThreadId;

  el.threadInput.value = "";
  el.threadSendBtn?.setAttribute("disabled", "disabled");

  try {
    const res = await fetch(`/chat/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: body, parentId: Number(parentId) }),
    });
    if (res.ok) {
      await fetchMessages(channelId);
      // Re-open the thread to show the new message
      const messages = getActiveChannelMessages();
      const byParent = groupByParent(messages);
      openThread(parentId, messages, byParent);
    }
  } catch (_err) {
    // Ignore errors
  }
}

// ========== Channel Settings Modal ==========

// State for channel settings
let channelSettingsGroups = [];
let allGroups = [];

// Update cog button visibility based on admin status and selected channel
export function updateChannelSettingsCog() {
  if (!el.channelSettingsBtn) return;

  // Show cog only for admins when a channel is selected
  if (state.isAdmin && state.chat.selectedChannelId) {
    show(el.channelSettingsBtn);
  } else {
    hide(el.channelSettingsBtn);
  }
}

// Fetch all groups for the dropdown
async function fetchAllGroups() {
  try {
    const res = await fetch("/chat/groups");
    if (!res.ok) return;
    allGroups = await res.json();
  } catch (_err) {
    console.error("[Chat] Failed to fetch groups");
  }
}

// Fetch groups assigned to a channel
async function fetchChannelGroups(channelId) {
  try {
    const res = await fetch(`/chat/channels/${channelId}/groups`);
    if (!res.ok) return [];
    return await res.json();
  } catch (_err) {
    console.error("[Chat] Failed to fetch channel groups");
    return [];
  }
}

// Open channel settings modal
async function openChannelSettingsModal() {
  if (!state.chat.selectedChannelId) return;

  const channel = state.chat.channels.find((c) => c.id === state.chat.selectedChannelId);
  if (!channel) return;

  // Populate form
  if (el.channelSettingsId) el.channelSettingsId.value = channel.id;
  if (el.channelSettingsDisplayName) el.channelSettingsDisplayName.value = channel.displayName || "";
  if (el.channelSettingsDescription) el.channelSettingsDescription.value = channel.description || "";
  if (el.channelSettingsPublic) el.channelSettingsPublic.checked = channel.isPublic;

  // Show/hide public toggle and groups section based on admin status
  if (el.channelPublicToggle) {
    el.channelPublicToggle.style.display = state.isAdmin ? "" : "none";
  }

  // Fetch groups data
  await fetchAllGroups();
  channelSettingsGroups = await fetchChannelGroups(channel.id);

  // Show groups section for private channels
  updateGroupsSection(!channel.isPublic);

  // Show danger zone only for admins and non-personal channels
  if (el.channelDangerZone) {
    const isPersonalChannel = !!channel.ownerNpub;
    el.channelDangerZone.style.display = state.isAdmin && !isPersonalChannel ? "" : "none";
  }

  show(el.channelSettingsModal);
}

// Update groups section visibility and content
function updateGroupsSection(isPrivate) {
  if (!el.channelGroupsSection) return;

  if (isPrivate && state.isAdmin) {
    show(el.channelGroupsSection);
    renderChannelGroups();
    updateGroupDropdown();
  } else {
    hide(el.channelGroupsSection);
  }
}

// Render assigned groups list
function renderChannelGroups() {
  if (!el.channelGroupsList) return;

  if (channelSettingsGroups.length === 0) {
    el.channelGroupsList.innerHTML = `<p class="channel-groups-empty">No groups assigned</p>`;
    return;
  }

  el.channelGroupsList.innerHTML = channelSettingsGroups
    .map((group) => `<div class="channel-group-chip" data-group-id="${group.id}">
      <span>${escapeHtml(group.name)}</span>
      <button type="button" data-remove-channel-group="${group.id}" title="Remove group">&times;</button>
    </div>`)
    .join("");

  // Wire remove handlers
  el.channelGroupsList.querySelectorAll("[data-remove-channel-group]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const groupId = Number(btn.dataset.removeChannelGroup);
      await removeChannelGroup(groupId);
    });
  });
}

// Update group dropdown (exclude already assigned groups)
function updateGroupDropdown() {
  if (!el.channelAddGroup) return;

  const assignedIds = new Set(channelSettingsGroups.map((g) => g.id));
  const available = allGroups.filter((g) => !assignedIds.has(g.id));

  el.channelAddGroup.innerHTML = `<option value="">Add a group...</option>` +
    available.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
}

// Add a group to the channel
async function addChannelGroup(groupId) {
  if (!state.chat.selectedChannelId || !groupId) return;

  try {
    const res = await fetch(`/chat/channels/${state.chat.selectedChannelId}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds: [groupId] }),
    });
    if (res.ok) {
      channelSettingsGroups = await fetchChannelGroups(state.chat.selectedChannelId);
      renderChannelGroups();
      updateGroupDropdown();
    }
  } catch (_err) {
    console.error("[Chat] Failed to add group to channel");
  }
}

// Remove a group from the channel
async function removeChannelGroup(groupId) {
  if (!state.chat.selectedChannelId) return;

  try {
    const res = await fetch(`/chat/channels/${state.chat.selectedChannelId}/groups/${groupId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      channelSettingsGroups = channelSettingsGroups.filter((g) => g.id !== groupId);
      renderChannelGroups();
      updateGroupDropdown();
    }
  } catch (_err) {
    console.error("[Chat] Failed to remove group from channel");
  }
}

// Save channel settings
async function saveChannelSettings(e) {
  e.preventDefault();
  if (!state.chat.selectedChannelId) return;

  const formData = new FormData(e.currentTarget);
  const displayName = String(formData.get("displayName") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const isPublic = formData.get("isPublic") === "on";

  try {
    const res = await fetch(`/chat/channels/${state.chat.selectedChannelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, description, isPublic }),
    });
    if (res.ok) {
      const updated = await res.json();
      // Update local state
      const channel = state.chat.channels.find((c) => c.id === state.chat.selectedChannelId);
      if (channel) {
        channel.displayName = updated.display_name;
        channel.description = updated.description;
        channel.isPublic = updated.is_public === 1;
      }
      renderChannels();
      renderThreads();
      hide(el.channelSettingsModal);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to save channel settings");
    }
  } catch (_err) {
    console.error("[Chat] Failed to save channel settings");
  }
}

// Delete channel with confirmation
async function deleteChannel() {
  if (!state.chat.selectedChannelId) return;

  const channel = state.chat.channels.find((c) => c.id === state.chat.selectedChannelId);
  if (!channel) return;

  const confirmed = confirm(`Are you sure you want to delete "${channel.displayName || channel.name}"?\n\nThis will permanently delete the channel and all its messages.`);
  if (!confirmed) return;

  try {
    const res = await fetch(`/chat/channels/${channel.id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Failed to delete channel");
      return;
    }

    // Close modal
    hide(el.channelSettingsModal);

    // Remove channel from state and re-render
    state.chat.channels = state.chat.channels.filter((c) => c.id !== channel.id);
    state.chat.selectedChannelId = null;
    renderChannels();

    // Clear messages area
    if (el.threadList) {
      el.threadList.innerHTML = `<p class="chat-placeholder">Pick or create a channel to start chatting.</p>`;
    }
    if (el.activeChannel) {
      el.activeChannel.textContent = "Pick a channel";
    }
  } catch (_err) {
    console.error("[Chat] Failed to delete channel");
    alert("Failed to delete channel");
  }
}

// Wire channel settings modal
function wireChannelSettingsModal() {
  // Open modal on cog click
  el.channelSettingsBtn?.addEventListener("click", openChannelSettingsModal);

  // Close modal
  const closeModal = () => hide(el.channelSettingsModal);
  el.closeChannelSettingsBtns?.forEach((btn) => btn.addEventListener("click", closeModal));
  el.channelSettingsModal?.addEventListener("click", (e) => {
    if (e.target === el.channelSettingsModal) closeModal();
  });

  // Handle public toggle to show/hide groups section
  el.channelSettingsPublic?.addEventListener("change", () => {
    updateGroupsSection(!el.channelSettingsPublic.checked);
  });

  // Handle group dropdown selection
  el.channelAddGroup?.addEventListener("change", async () => {
    const groupId = Number(el.channelAddGroup.value);
    if (groupId) {
      await addChannelGroup(groupId);
      el.channelAddGroup.value = "";
    }
  });

  // Handle form submit
  el.channelSettingsForm?.addEventListener("submit", saveChannelSettings);

  // Handle delete channel
  el.deleteChannelBtn?.addEventListener("click", deleteChannel);
}

// ========== DM Modal ==========

let dmSearchQuery = "";

// Render user list for DM selection
function renderDmUserList() {
  if (!el.dmUserList) return;

  const users = Array.from(localUserCache.values());
  const query = dmSearchQuery.toLowerCase();

  const filtered = query
    ? users.filter((user) => {
        const name = (user.display_name || user.name || "").toLowerCase();
        const npubShort = user.npub?.slice(5, 15)?.toLowerCase() || "";
        return name.includes(query) || npubShort.includes(query);
      })
    : users;

  // Don't show self
  const selfNpub = state.session?.npub;
  const otherUsers = filtered.filter((u) => u.npub !== selfNpub).slice(0, 10);

  if (otherUsers.length === 0) {
    el.dmUserList.innerHTML = `<p class="dm-user-empty">No users found</p>`;
    return;
  }

  el.dmUserList.innerHTML = otherUsers
    .map((user) => {
      const name = user.display_name || user.name || "Unknown";
      const avatarUrl = user.picture || `https://robohash.org/${user.pubkey || user.npub}.png?set=set3`;
      const npubShort = user.npub ? `${user.npub.slice(0, 8)}…${user.npub.slice(-4)}` : "";
      return `<button type="button" class="dm-user-item" data-dm-target="${escapeHtml(user.npub)}">
        <img class="dm-user-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
        <div class="dm-user-info">
          <span class="dm-user-name">${escapeHtml(name)}</span>
          <span class="dm-user-npub">${escapeHtml(npubShort)}</span>
        </div>
      </button>`;
    })
    .join("");

  // Wire up click handlers
  el.dmUserList.querySelectorAll("[data-dm-target]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetNpub = btn.dataset.dmTarget;
      await createDmWithUser(targetNpub);
    });
  });
}

// Create or open DM with a user
async function createDmWithUser(targetNpub) {
  const user = localUserCache.get(targetNpub);
  const displayName = user?.display_name || user?.name || "DM";

  try {
    const res = await fetch("/chat/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetNpub, displayName: `DM - ${displayName}` }),
    });

    if (res.ok) {
      const channel = await res.json();
      // Add to DM channels and select it
      addDmChannel({
        id: String(channel.id),
        name: channel.name,
        displayName: channel.display_name,
        description: channel.description,
        otherNpub: targetNpub,
      });
      selectChannel(String(channel.id));
      await fetchMessages(String(channel.id));
      hide(el.dmModal);
      setMobileView("messages");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to create DM");
    }
  } catch (_err) {
    console.error("[Chat] Failed to create DM");
  }
}

// Wire DM modal
function wireDmModal() {
  // Open modal on + New click
  el.newDmTrigger?.addEventListener("click", () => {
    if (!state.session) return;
    dmSearchQuery = "";
    if (el.dmSearch) el.dmSearch.value = "";
    renderDmUserList();
    show(el.dmModal);
    el.dmSearch?.focus();
  });

  // Close modal
  const closeModal = () => hide(el.dmModal);
  el.closeDmModalBtns?.forEach((btn) => btn.addEventListener("click", closeModal));
  el.dmModal?.addEventListener("click", (e) => {
    if (e.target === el.dmModal) closeModal();
  });

  // Handle search input
  el.dmSearch?.addEventListener("input", () => {
    dmSearchQuery = el.dmSearch.value.trim();
    renderDmUserList();
  });
}
