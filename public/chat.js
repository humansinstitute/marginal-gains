import { closeAvatarMenu, getCachedProfile, fetchProfile } from "./avatar.js";
import { elements as el, escapeHtml, hide, show } from "./dom.js";
import { loadNostrLibs } from "./nostr.js";
import { addMessage, getActiveChannelMessages, selectChannel, setChatEnabled, setIsAdmin, setReplyTarget, state, updateChannelsList, upsertChannel, setChannelMessages } from "./state.js";

// Local user cache - populated from server database
const localUserCache = new Map();

// Cache for npub to pubkey conversions
const npubToPubkeyCache = new Map();

// Track currently open thread
let openThreadId = null;

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
    // On chat page - show chat immediately and fetch data
    show(el.chatShell);
    setChatEnabled(true);
    await fetchChannels();
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
};

async function fetchChannels() {
  if (!state.session) return;
  try {
    const res = await fetch("/chat/channels");
    if (!res.ok) return;
    const channels = await res.json();
    const mapped = channels.map((ch) => ({
      id: String(ch.id),
      name: ch.name,
      displayName: ch.display_name,
      description: ch.description,
      isPublic: ch.is_public === 1,
    }));
    // Use updateChannelsList to handle cleanup of removed channels
    updateChannelsList(mapped);
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

  // Close mention popup when clicking outside
  document.addEventListener("click", (event) => {
    if (!el.mentionPopup?.contains(event.target) && event.target !== el.chatInput) {
      closeMentionPopup();
    }
  });

  el.chatSendBtn?.addEventListener("click", sendMessage);
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
  if (!el.chatChannelList) return;
  const channels = state.chat.channels;
  el.chatChannelList.innerHTML = channels
    .map((channel) => {
      const isActive = channel.id === state.chat.selectedChannelId;
      const lockIcon = channel.isPublic ? '' : '<span class="channel-lock" title="Private channel">&#128274;</span>';
      return `<button class="chat-channel${isActive ? " active" : ""}${channel.isPublic ? "" : " private"}" data-channel-id="${channel.id}">
        <div class="chat-channel-name">${lockIcon}#${escapeHtml(channel.name)}</div>
        <p class="chat-channel-desc">${escapeHtml(channel.displayName)}</p>
      </button>`;
    })
    .join("");
  el.chatChannelList.querySelectorAll("[data-channel-id]").forEach((btn) => {
    const handler = async () => {
      const channelId = btn.dataset.channelId;
      selectChannel(channelId);
      await fetchMessages(channelId);
      // Always set mobile view - CSS only applies at mobile widths
      setMobileView("messages");
    };
    btn.addEventListener("click", handler);
    // Safari mobile sometimes needs touchend
    btn.addEventListener("touchend", (e) => {
      e.preventDefault();
      handler();
    });
  });
}

function renderThreads() {
  if (!el.chatThreadList) return;
  const channel = state.chat.channels.find((c) => c.id === state.chat.selectedChannelId);
  if (!channel) {
    el.chatThreadList.innerHTML = `<p class="chat-placeholder">Pick or create a channel to start chatting.</p>`;
    setChatHeader("Pick a channel");
    return;
  }
  setChatHeader(`#${channel.name}`);
  const messages = getActiveChannelMessages();
  if (messages.length === 0) {
    el.chatThreadList.innerHTML = `<p class="chat-placeholder">No messages yet. Say hello in #${channel.name}.</p>`;
    return;
  }
  const byParent = groupByParent(messages);
  const roots = byParent.get(null) || [];
  el.chatThreadList.innerHTML = roots
    .map((message) => renderCollapsedThread(message, byParent))
    .join("");

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

// Parse message body and render mentions as styled display names
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

  return html;
}

function renderMessageCompact(message, { showAvatar = false } = {}) {
  const avatarHtml = showAvatar
    ? `<img class="chat-message-avatar" src="${escapeHtml(getAuthorAvatarUrl(message.author))}" alt="" loading="lazy" />`
    : '';
  return `<div class="chat-message${showAvatar ? ' chat-message-with-avatar' : ''}">
    ${avatarHtml}
    <div class="chat-message-content">
      <div class="chat-message-meta">
        <span class="chat-message-author">${escapeHtml(getAuthorDisplayName(message.author))}</span>
        <time>${new Date(message.createdAt).toLocaleTimeString()}</time>
      </div>
      <p class="chat-message-body">${renderMessageBody(message.body)}</p>
    </div>
  </div>`;
}

function renderMessageFull(message) {
  const avatarUrl = getAuthorAvatarUrl(message.author);
  return `<div class="chat-message chat-message-with-avatar">
    <img class="chat-thread-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
    <div class="chat-message-content">
      <div class="chat-message-meta">
        <span class="chat-message-author">${escapeHtml(getAuthorDisplayName(message.author))}</span>
        <time>${new Date(message.createdAt).toLocaleTimeString()}</time>
      </div>
      <p class="chat-message-body">${renderMessageBody(message.body)}</p>
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
  }

  // Show inline panel
  show(el.threadPanel);

  // Switch to thread view on mobile
  if (isMobile()) {
    setMobileView("thread");
  }

  el.threadInput?.focus();
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
