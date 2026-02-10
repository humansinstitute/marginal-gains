import { baseChatUrl, channelUrl, chatUrl, dmUrl, eventsUrl, teamUrl } from "./api.js";
import { closeAvatarMenu, getCachedProfile, fetchProfile } from "./avatar.js";
import { formatLocalDateTime } from "./dateUtils.js";
import { elements as el, escapeHtml, hide, show } from "./dom.js";
import { loadNostrLibs } from "./nostr.js";
import { connect as connectLiveUpdates, disconnect as disconnectLiveUpdates, onEvent, getConnectionState } from "./liveUpdates.js";
import { addDmChannel, addMessage, clearUnread, getActiveChannelMessages, getSessionMentionCount, getUnreadCount, incrementSessionMention, incrementUnread, removeMessageFromChannel, selectChannel, setChatEnabled, setIsAdmin, setReplyTarget, setUnreadState, state, updateAllChannels, upsertChannel, setChannelMessages, refreshUI } from "./state.js";
import { init as initMentions, handleMentionInput, handleMentionKeydown, closeMentionPopup } from "./mentions.js";
import { init as initSlashCommands, handleSlashInput, handleSlashKeydown, closePopup as closeSlashPopup } from "./slashCommands.js";
import { wireAttachButton, wirePasteAndDrop } from "./uploads.js";
import {
  init as initMessageRenderer,
  formatReplyTimestamp,
  renderCollapsedThread,
  renderReplyPreview,
  renderMessageBody,
  renderMessageCompact,
  renderMessageFull,
  renderMessageMenu,
  groupByParent,
} from "./messageRenderer.js";
import { initReactions, updateMessageReactions } from "./reactions.js";
import {
  setupChannelEncryption,
  distributeKeyToMember,
  distributeKeysToAllPendingMembers,
  encryptMessageForChannel,
  processMessagesForDisplay,
  isChannelEncrypted,
  channelNeedsEncryption,
  usesCommunityEncryption,
  setupAllDmEncryption,
  fetchChannelKey,
  clearCachedChannelKey,
  runBackgroundKeyDistribution,
  refetchChannelKey,
} from "./chatCrypto.js";
import { checkEncryptionSupport } from "./crypto.js";
import { fetchCommunityKey, getCommunityStatus } from "./communityCrypto.js";
import { autoFulfillPendingKeyRequests } from "./teams.js";
import { initProfileCards } from "./profileCard.js";
import { initChannelDnd, teardownChannelDnd } from "./channelDnd.js";

// Local user cache - populated from server database
const localUserCache = new Map();

// Cache for npub to pubkey conversions
const npubToPubkeyCache = new Map();

// Cache for rendered channel lists to avoid unnecessary DOM recreation
// This prevents image flickering on Safari PWA
let lastRenderedDmSignature = null;
let lastRenderedChannelSignature = null;

// Track currently open thread
let openThreadId = null;

// Track if thread is expanded to main view (desktop only)
let threadExpanded = false;

// Track if we should scroll to bottom (only on initial load or explicit action)
let shouldScrollToBottom = false;

// Touch movement threshold for distinguishing taps from scrolls (in pixels)
const TOUCH_MOVE_THRESHOLD = 10;

// Helper to wire touch-aware click handlers that ignore scroll gestures
function wireTouchAwareHandler(element, handler) {
  let touchStartX = 0;
  let touchStartY = 0;

  element.addEventListener("click", handler);

  element.addEventListener("touchstart", (e) => {
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });

  element.addEventListener("touchend", (e) => {
    const touch = e.changedTouches[0];
    const deltaX = Math.abs(touch.clientX - touchStartX);
    const deltaY = Math.abs(touch.clientY - touchStartY);

    // Only trigger if finger didn't move much (tap, not scroll)
    if (deltaX < TOUCH_MOVE_THRESHOLD && deltaY < TOUCH_MOVE_THRESHOLD) {
      e.preventDefault();
      handler(e);
    }
  });
}

// Pinned messages state for current channel
let pinnedMessages = [];
let canPinMessages = false;

/**
 * Parse slash commands from message text (client-side, before encryption)
 * Returns array of command names found in the message
 * @param {string} text - Message text
 * @returns {string[]} Array of command names (e.g., ["wingman", "image-wingman"])
 */
function parseSlashCommands(text) {
  const commands = [];
  const commandPattern = /\/([\w-]+)/g;
  let match;
  while ((match = commandPattern.exec(text)) !== null) {
    commands.push(match[1].toLowerCase());
  }
  return commands;
}

/**
 * Generate a 63-character random alphanumeric string for hang.live rooms
 * @returns {string} 63-character random ID
 */
function generateHangId() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(63);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * Transform /hang commands into hang.live room links (client-side)
 * This runs before encryption so the server never sees hang room IDs in encrypted channels
 * @param {string} text - Message text
 * @returns {string} Transformed text with /hang replaced by room link
 */
function transformHangCommand(text) {
  // Match /hang at word boundary (not /hangout or similar)
  const hangPattern = /\/hang\b/gi;

  if (!hangPattern.test(text)) {
    return text;
  }

  // Reset regex state after test
  hangPattern.lastIndex = 0;

  // Replace each /hang with a unique room link
  return text.replace(hangPattern, () => {
    const hangId = generateHangId();
    return `https://hang.live/@${hangId}`;
  });
}

/**
 * Parse @mentions from message text (client-side, before encryption)
 * Extracts npubs from nostr:npub... format used by the mention system
 * @param {string} text - Message text
 * @returns {string[]} Array of mentioned npubs
 */
function parseMentions(text) {
  const mentions = [];
  // Match nostr:npub1... format (npub is 63 chars: npub1 + 58 bech32 chars)
  const mentionPattern = /nostr:(npub1[a-z0-9]{58})/gi;
  let match;
  while ((match = mentionPattern.exec(text)) !== null) {
    const npub = match[1].toLowerCase();
    if (!mentions.includes(npub)) {
      mentions.push(npub);
    }
  }
  return mentions;
}

/**
 * Auto-resize textarea to fit content (up to max-height set in CSS)
 */
function autoResizeTextarea(textarea) {
  if (!textarea) return;
  // Reset height to auto to get proper scrollHeight
  textarea.style.height = "auto";
  // Set height to scrollHeight (CSS max-height will cap it)
  textarea.style.height = textarea.scrollHeight + "px";
}

/**
 * Copy text to clipboard with fallback for Safari mobile
 * Safari requires synchronous clipboard access from user gesture
 */
async function copyToClipboard(text) {
  // Try modern clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_err) {
      // Fall through to legacy method
    }
  }

  // Fallback: create temporary textarea and use execCommand
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch (_err) {
    document.body.removeChild(textarea);
    return false;
  }
}

// Update browser URL to reflect current channel (for deep linking)
function updateChatUrl(channelId) {
  if (!channelId) {
    history.replaceState(null, "", baseChatUrl());
    return;
  }

  // Find the channel to determine type and slug
  const channel = state.chat.channels.find((c) => c.id === channelId);
  const dm = state.chat.dmChannels.find((c) => c.id === channelId);
  const personal = state.chat.personalChannel?.id === channelId ? state.chat.personalChannel : null;

  let url = baseChatUrl();
  if (channel) {
    url = channelUrl(channel.name);
  } else if (dm) {
    url = dmUrl(channelId);
  } else if (personal) {
    url = channelUrl(personal.name);
  }

  // Use replaceState to avoid cluttering history
  history.replaceState(null, "", url);
}

// Handle deep link from server (e.g., /chat/channel/general or /chat/dm/123)
// Returns { channelId, threadId } where threadId is from URL ?thread= param
function handleDeepLink() {
  const deepLink = window.__DEEP_LINK__;

  // Check for thread parameter in URL
  const urlParams = new URLSearchParams(window.location.search);
  const threadId = urlParams.get("thread");

  if (!deepLink) {
    return { channelId: null, threadId };
  }

  let channelId = null;
  if (deepLink.type === "channel") {
    // Find channel by slug/name
    const channel = state.chat.channels.find((c) => c.name === deepLink.slug);
    const personal = state.chat.personalChannel?.name === deepLink.slug ? state.chat.personalChannel : null;
    channelId = channel?.id || personal?.id || null;
  } else if (deepLink.type === "dm") {
    // Find DM by ID
    const dm = state.chat.dmChannels.find((c) => c.id === String(deepLink.id));
    channelId = dm?.id || null;
  }

  return { channelId, threadId };
}

// Set up mobile keyboard handling using visualViewport API
function setupMobileKeyboardHandler() {
  if (!window.visualViewport) return;

  const appShell = document.querySelector(".chat-app-shell");
  if (!appShell) return;

  let isKeyboardOpen = false;

  const updateLayout = () => {
    const vv = window.visualViewport;
    const fullHeight = window.innerHeight;
    const visibleHeight = vv.height;

    // Detect if keyboard is open (visible height significantly less than full height)
    const keyboardOpen = fullHeight - visibleHeight > 150;

    if (keyboardOpen && !isKeyboardOpen) {
      // Keyboard just opened - switch to fixed positioning
      isKeyboardOpen = true;
      appShell.style.position = "fixed";
      appShell.style.top = `${vv.offsetTop}px`;
      appShell.style.left = "0";
      appShell.style.right = "0";
      appShell.style.height = `${visibleHeight}px`;
      appShell.style.bottom = "auto";
    } else if (keyboardOpen) {
      // Keyboard still open - update position
      appShell.style.top = `${vv.offsetTop}px`;
      appShell.style.height = `${visibleHeight}px`;
    } else if (!keyboardOpen && isKeyboardOpen) {
      // Keyboard closed - restore normal positioning
      isKeyboardOpen = false;
      appShell.style.position = "";
      appShell.style.top = "";
      appShell.style.left = "";
      appShell.style.right = "";
      appShell.style.height = "";
      appShell.style.bottom = "";
    }
  };

  // Update on viewport resize (keyboard show/hide)
  window.visualViewport.addEventListener("resize", updateLayout);
  window.visualViewport.addEventListener("scroll", updateLayout);

  // Set initial layout
  updateLayout();
}

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

// Show "Wingman is thinking..." indicator for a thread
function showWingmanThinking(threadId) {
  // Remove any existing indicator
  hideWingmanThinking(threadId);

  // Find the thread root message in the DOM
  const threadEl = document.querySelector(`[data-thread-id="${threadId}"]`);
  if (!threadEl) {
    // Try to find by message ID if it's a root message
    const messageEl = document.querySelector(`[data-message-id="${threadId}"]`);
    if (messageEl) {
      // Insert indicator after the message
      const indicator = createWingmanIndicator(threadId);
      messageEl.after(indicator);
    }
    return;
  }

  // Insert indicator at the end of the thread
  const indicator = createWingmanIndicator(threadId);
  threadEl.appendChild(indicator);
}

function createWingmanIndicator(threadId) {
  const indicator = document.createElement("div");
  indicator.className = "wingman-thinking";
  indicator.setAttribute("data-wingman-thinking", threadId);
  indicator.innerHTML = `
    <span class="wingman-thinking-dots"></span>
    <span class="wingman-thinking-text">Wingman is thinking...</span>
  `;
  return indicator;
}

function hideWingmanThinking(threadId) {
  const indicator = document.querySelector(`[data-wingman-thinking="${threadId}"]`);
  if (indicator) {
    indicator.remove();
  }
}

// Fetch all known users from server
async function fetchLocalUsers() {
  if (!state.session) return;
  try {
    const res = await fetch(chatUrl("/users"));
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
    await fetch(chatUrl("/users"), {
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
    const res = await fetch(chatUrl("/me"));
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
      // Use pre-captured scroll state from liveUpdates.js
      // (captured BEFORE the message was added to state and DOM was updated)
      const { wasNearBottom } = data;

      // Clear any "Wingman is thinking" indicator for this thread
      const threadRootId = data.thread_root_id ? String(data.thread_root_id) : String(data.id);
      hideWingmanThinking(threadRootId);

      // Note: renderThreads() was already called by refreshUI() when message was added to state
      // No need to call it again here

      // If user was near bottom, scroll to show new message
      // Otherwise show the "new message" indicator
      if (wasNearBottom) {
        scrollToBottom(el.chatThreadList);
        hideNewMessageIndicator();
      } else {
        showNewMessageIndicator();
      }

      // If thread panel is open and this message belongs to that thread, update it
      // Check both parent_id and thread_root_id since replies might be nested
      const parentId = data.parent_id ? String(data.parent_id) : null;
      const msgThreadRootId = data.thread_root_id ? String(data.thread_root_id) : null;
      if (openThreadId && (parentId === openThreadId || msgThreadRootId === openThreadId)) {
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

  // When channel layout is updated (sections/ordering)
  onEvent("channel:layout", (data) => {
    if (window.__FEATURE_FLAGS__?.alpineChat) {
      const chatShell = document.querySelector("[data-chat-shell]");
      if (chatShell && chatShell._x_dataStack) {
        const alpineStore = chatShell._x_dataStack[0];
        // Only update if not currently in arrange mode (don't override local edits)
        if (!alpineStore.arrangeMode) {
          alpineStore.setChannelLayout(data.layout || null);
        }
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

  // When a reaction is added/removed
  onEvent("message:reaction", (data) => {
    const { messageId, reactions } = data;
    updateMessageReactions(messageId, reactions);
  });

  // When connection state changes, update avatar outline
  onEvent("connection:change", (data) => {
    updateAvatarConnectionStatus(data.state);
  });

  // When Wingman starts thinking, show indicator
  onEvent("wingman:thinking", (data) => {
    const { threadId, channelId } = data;
    if (state.chat.selectedChannelId === String(channelId)) {
      showWingmanThinking(String(threadId));
    }
  });

  // When new key requests arrive (someone joined via our invite)
  // Auto-fulfill them in the background
  onEvent("key_request:new", () => {
    console.log("[Chat] Key request received, auto-fulfilling...");
    autoFulfillPendingKeyRequests();
  });

  // When our key request is fulfilled (we received keys)
  // Clear cached key and refetch, then refresh UI
  onEvent("key_request:fulfilled", async (data) => {
    const channelIdStr = String(data.channelId);
    console.log("[Chat] Key request fulfilled for channel", channelIdStr);

    // Clear any cached key to force refetch
    clearCachedChannelKey(channelIdStr);

    // Refetch the key - this populates the cache
    const key = await fetchChannelKey(channelIdStr);
    console.log("[Chat] Key fetched:", key ? "success" : "not available");

    // If we're viewing this channel, fully refresh it
    if (state.chat.selectedChannelId === channelIdStr) {
      console.log("[Chat] Refreshing current channel after key received");
      // Re-fetch messages (will now decrypt properly)
      await fetchMessages(channelIdStr);
      // Explicitly re-render to update UI state
      renderThreads();
    }
  });

  // When a message is pinned, refresh pinned messages if viewing that channel
  onEvent("message:pinned", async (data) => {
    const channelIdStr = String(data.channelId);
    if (state.chat.selectedChannelId === channelIdStr) {
      await fetchPinnedMessages(channelIdStr);
      updateChannelSettingsCog();
      renderThreads();
    }
  });

  // When a message is unpinned, refresh pinned messages if viewing that channel
  onEvent("message:unpinned", async (data) => {
    const channelIdStr = String(data.channelId);
    if (state.chat.selectedChannelId === channelIdStr) {
      await fetchPinnedMessages(channelIdStr);
      updateChannelSettingsCog();
      renderThreads();
    }
  });
}

/**
 * Update avatar outline to reflect SSE connection status
 * Green outline = connected, Red outline = disconnected
 */
function updateAvatarConnectionStatus(connState) {
  if (!el.avatarButton) return;

  // Remove any existing connection status classes
  el.avatarButton.classList.remove("sse-connected", "sse-disconnected", "sse-connecting");

  // Add appropriate class based on connection state
  if (connState === "connected") {
    el.avatarButton.classList.add("sse-connected");
  } else if (connState === "connecting") {
    el.avatarButton.classList.add("sse-connecting");
  } else {
    el.avatarButton.classList.add("sse-disconnected");
  }
}

export const initChat = async () => {
  // Skip chat initialization if user needs onboarding (no community key)
  if (window.__NEEDS_ONBOARDING__) {
    return;
  }

  // Check if we're on the chat page
  const isChatPage = window.__CHAT_PAGE__ === true;

  // Pre-populate the npub→pubkey cache for the logged-in user
  if (state.session?.npub && state.session?.pubkey) {
    npubToPubkeyCache.set(state.session.npub, state.session.pubkey);
  }

  // Fetch local users and user info from server database
  await Promise.all([fetchLocalUsers(), fetchUserInfo()]);

  // Initialize mentions module with user cache
  initMentions(localUserCache);

  // Initialize slash commands module
  await initSlashCommands();

  // Initialize reactions module
  initReactions();

  // Initialize message renderer with dependencies
  initMessageRenderer({
    getAuthorDisplayName,
    getAuthorAvatarUrl,
    getContext: () => ({ session: state.session, isAdmin: state.isAdmin, canPin: canPinMessages }),
    userCache: localUserCache,
  });

  // Initialize profile card popovers
  initProfileCards({
    getUserInfo: (npub) => {
      const user = localUserCache.get(npub);
      if (user) return user;
      // Try relay cache
      const pubkey = npubToPubkeyCache.get(npub);
      if (pubkey) {
        const profile = getCachedProfile(pubkey);
        if (profile) {
          return {
            displayName: profile.displayName || profile.name,
            picture: profile.picture,
            about: profile.about,
            nip05: profile.nip05,
            npub,
          };
        }
      }
      return null;
    },
  });

  // Initialize Alpine chat store if feature is enabled
  if (window.__FEATURE_FLAGS__?.alpineChat && isChatPage) {
    try {
      const chatSync = await import("./stores/chatSync.js");
      // Wait for Alpine to be ready
      const waitForAlpine = () => {
        return new Promise((resolve) => {
          if (window.Alpine) {
            resolve();
          } else {
            document.addEventListener("alpine:init", resolve, { once: true });
            // Fallback timeout
            setTimeout(resolve, 2000);
          }
        });
      };
      await waitForAlpine();

      // Get the Alpine store from the chat shell element
      const chatShell = document.querySelector("[data-chat-shell]");
      if (chatShell && chatShell._x_dataStack) {
        const alpineStore = chatShell._x_dataStack[0];

        // Initialize chatSync with store and dependencies
        await chatSync.init(alpineStore, {
          processMessage: async (msg, channelId) => {
            // Use existing decryption logic
            const result = await processMessagesForDisplay([msg], channelId);
            return result[0];
          },
          userCache: localUserCache,
          currentUserNpub: state.session?.npub,
        });

        // Inject dependencies into Alpine store
        alpineStore.setDependencies({
          getAuthorDisplayName,
          getAuthorAvatarUrl,
          escapeHtml,
          formatTimestamp: (ts) => formatReplyTimestamp(ts),
          renderMessageBody,
          currentUserNpub: state.session?.npub || null,
          isAdmin: state.isAdmin,
          canPin: state.isAdmin, // For now, only admins can pin
          getDmDisplayName,
          onChannelSelect: async (channelId) => {
            // Called by Alpine store when user clicks a channel
            selectChannel(channelId);
            updateChatUrl(channelId);
            await fetchPinnedMessages(channelId);
            updateChannelSettingsCog();
            await fetchMessages(channelId);
            setMobileView("messages");
          },
        });

        // Wrap arrange mode methods to init/teardown DnD
        const origEnter = alpineStore.enterArrangeMode.bind(alpineStore);
        const origCancel = alpineStore.cancelArrangeMode.bind(alpineStore);
        const origSave = alpineStore.saveArrangement.bind(alpineStore);
        alpineStore.enterArrangeMode = function () {
          origEnter();
          // Init DnD after Alpine re-renders the draggable elements
          requestAnimationFrame(() => initChannelDnd());
        };
        alpineStore.cancelArrangeMode = function () {
          teardownChannelDnd();
          origCancel();
        };
        alpineStore.saveArrangement = function () {
          teardownChannelDnd();
          return origSave();
        };

        console.log("[Chat] Alpine chat store initialized");
      }
    } catch (err) {
      console.error("[Chat] Failed to initialize Alpine chat:", err);
    }
  }

  if (isChatPage && el.chatShell) {
    // On chat page - show chat immediately and connect to live updates
    show(el.chatShell);
    setChatEnabled(true);

    // Set up mobile keyboard handling (adjusts layout when keyboard appears)
    setupMobileKeyboardHandler();

    // Fetch channels via HTTP first (more reliable than SSE for initial load)
    await fetchChannels();

    // Pre-fetch community key if available (enables community encryption for public channels)
    try {
      await fetchCommunityKey();
    } catch (_err) {
      // Community key may not be available - that's OK
    }

    // Helper to update Alpine store when selecting a channel
    const updateAlpineChannel = (channelId) => {
      if (window.__FEATURE_FLAGS__?.alpineChat) {
        const chatShell = document.querySelector("[data-chat-shell]");
        if (chatShell && chatShell._x_dataStack) {
          const alpineStore = chatShell._x_dataStack[0];
          alpineStore.selectedChannelId = channelId;
          alpineStore.loading = true;
          alpineStore.messages = [];
          alpineStore.rootMessages = [];
        }
      }
    };

    // Handle deep link if present (e.g., /chat/channel/general?thread=123)
    const deepLink = handleDeepLink();
    if (deepLink.channelId) {
      selectChannel(deepLink.channelId);
      updateAlpineChannel(deepLink.channelId);
      await fetchMessages(deepLink.channelId);

      // If a thread ID was specified, open that thread after messages load
      if (deepLink.threadId) {
        const messages = getActiveChannelMessages();
        const byParent = groupByParent(messages);
        // Small delay to ensure DOM is ready
        setTimeout(() => {
          openThread(deepLink.threadId, messages, byParent);
        }, 100);
      }
    } else if (state.chat.selectedChannelId) {
      // Update URL to reflect default selected channel
      updateAlpineChannel(state.chat.selectedChannelId);
      updateChatUrl(state.chat.selectedChannelId);
      await fetchPinnedMessages(state.chat.selectedChannelId);
      updateChannelSettingsCog();
      await fetchMessages(state.chat.selectedChannelId);
    } else if (state.chat.channels.length > 0) {
      // Default to first channel if none selected
      const firstChannel = state.chat.channels[0];
      selectChannel(firstChannel.id);
      updateAlpineChannel(firstChannel.id);
      updateChatUrl(firstChannel.id);
      await fetchPinnedMessages(firstChannel.id);
      updateChannelSettingsCog();
      await fetchMessages(firstChannel.id);
    }

    renderChannels();

    // Set up live update event handlers
    setupLiveUpdateHandlers();

    // Hide new message indicator and mark channel as read when user scrolls to bottom
    el.chatThreadList?.addEventListener("scroll", () => {
      if (isNearBottom(el.chatThreadList)) {
        hideNewMessageIndicator();
        // Mark channel as read when scrolled to bottom
        const channelId = state.chat.selectedChannelId;
        if (channelId && getUnreadCount(channelId) > 0) {
          markChannelAsRead(channelId);
        }
      }
    });

    // Connect to SSE for live updates only
    await connectLiveUpdates();

    // Set initial connection status on avatar
    updateAvatarConnectionStatus(getConnectionState());

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
  wireDmSettingsModal();
  wireHangButtons();
  wirePinnedButton();
  wireDmModal();
  wireTaskLinkModal();
  updateChannelSettingsCog();
};

async function fetchChannels() {
  if (!state.session) return;
  try {
    const res = await fetch(chatUrl("/channels"));
    if (!res.ok) return;
    const data = await res.json();

    // Map regular channels
    const channels = (data.channels || []).map((ch) => ({
      id: String(ch.id),
      name: ch.name,
      displayName: ch.display_name,
      description: ch.description,
      isPublic: ch.is_public === 1,
      encrypted: ch.encrypted === 1,
    }));
    console.log("[Chat] Loaded channels with encryption status:", channels.map(c => ({ id: c.id, name: c.name, encrypted: c.encrypted })));

    // Map DM channels - include other participant's npub for display
    const dmChannels = (data.dmChannels || []).map((ch) => ({
      id: String(ch.id),
      name: ch.name,
      displayName: ch.display_name,
      description: ch.description,
      otherNpub: ch.other_npub || null,
      encrypted: ch.encrypted === 1,
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

    // Update Alpine store if feature enabled
    if (window.__FEATURE_FLAGS__?.alpineChat) {
      const chatShell = document.querySelector("[data-chat-shell]");
      if (chatShell && chatShell._x_dataStack) {
        const alpineStore = chatShell._x_dataStack[0];
        alpineStore.channels = channels;
        alpineStore.dmChannels = dmChannels;
        alpineStore.personalChannel = personalChannel;
        alpineStore.setChannelLayout(data.channelLayout || null);
        if (data.unreadState) {
          Object.keys(data.unreadState).forEach(id => {
            alpineStore.unreadCounts[id] = data.unreadState[id].unread || 0;
            alpineStore.mentionCounts[id] = data.unreadState[id].mentions || 0;
          });
        }
      }
    }

    // Set unread state from server
    if (data.unreadState) {
      setUnreadState(data.unreadState);
    }

    // Auto-setup encryption for DMs that don't have it yet
    // Only do this if community encryption is active (user is onboarded)
    if (state.session?.onboarded) {
      setupAllDmEncryption().catch(err => {
        console.warn("[Chat] Failed to setup DM encryption:", err);
      });
    }

    // Background key distribution: silently distribute keys to members who
    // joined via invite codes but don't have their own NIP-44 wrapped key.
    // Server-side checks admin/owner permission, so we can call unconditionally.
    runBackgroundKeyDistribution().catch(err => {
      console.warn("[Chat] Background key distribution error:", err);
    });
  } catch (_err) {
    // Ignore fetch errors
  }
}

/**
 * Mark a channel as read - called when user scrolls to bottom
 */
async function markChannelAsRead(channelId) {
  if (!state.session || !channelId) return;

  try {
    const res = await fetch(chatUrl(`/channels/${channelId}/read`), {
      method: "POST",
    });
    if (res.ok) {
      // Clear unread state locally
      clearUnread(channelId);
      // Re-render channel list to update badges
      renderChannels();
    }
  } catch (_err) {
    // Ignore errors - non-critical operation
  }
}

async function fetchMessages(channelId) {
  if (!state.session) return;

  // For encrypted channels, admins should auto-distribute keys to pending members
  const channel = state.chat.channels.find(c => c.id === channelId) ||
                  state.chat.dmChannels.find(c => c.id === channelId);
  if (channel?.encrypted && state.isAdmin) {
    // Don't await - let it run in background
    distributeKeysToAllPendingMembers(channelId).then(result => {
      if (result.success > 0) {
        console.log(`[Chat] Auto-distributed keys to ${result.success} pending member(s) for channel ${channelId}`);
      }
    }).catch(err => {
      console.warn("[Chat] Failed to auto-distribute keys:", err);
    });
  }

  // If Alpine + Dexie enabled, try to load from cache first for instant display
  if (window.__FEATURE_FLAGS__?.alpineChat) {
    try {
      const chatDB = await import("./db/chatDB.js");
      const cached = await chatDB.getMessagesForChannel(channelId);
      if (cached && cached.length > 0) {
        console.log(`[Chat] Loaded ${cached.length} messages from cache for channel ${channelId}`);
        const chatShell = document.querySelector("[data-chat-shell]");
        const alpineStore = chatShell?._x_dataStack?.[0];
        if (alpineStore) {
          alpineStore.setMessages(cached);
          // Keep loading true - we're still fetching from server
        }
        setChannelMessages(channelId, cached);
        renderThreads();
      }
    } catch (err) {
      console.warn("[Chat] Failed to load from cache:", err);
    }
  }

  try {
    const res = await fetch(chatUrl(`/channels/${channelId}/messages`));
    if (!res.ok) return;
    const messages = await res.json();
    let mapped = messages.map((m) => ({
      id: String(m.id),
      channelId: String(m.channel_id),
      author: m.author,
      body: m.body,
      createdAt: m.created_at,
      parentId: m.parent_id ? String(m.parent_id) : null,
      encrypted: m.encrypted === 1,
      keyVersion: m.key_version,
      reactions: m.reactions || [],
    }));

    // Decrypt encrypted messages if needed
    mapped = await processMessagesForDisplay(mapped, channelId);

    setChannelMessages(channelId, mapped);

    // Update Alpine store if feature enabled
    if (window.__FEATURE_FLAGS__?.alpineChat) {
      const chatShell = document.querySelector("[data-chat-shell]");
      if (chatShell && chatShell._x_dataStack) {
        const alpineStore = chatShell._x_dataStack[0];
        alpineStore.setMessages(mapped);
        alpineStore.loading = false;
      }

      // Save to Dexie cache for future
      try {
        const chatDB = await import("./db/chatDB.js");
        await chatDB.hydrateMessages(channelId, mapped);
        console.log(`[Chat] Cached ${mapped.length} messages for channel ${channelId}`);
      } catch (err) {
        console.warn("[Chat] Failed to cache messages:", err);
      }
    }

    // Scroll to bottom on initial load of channel messages
    shouldScrollToBottom = true;
    // Hide any existing new message indicator
    hideNewMessageIndicator();

    // Mark channel as read after a short delay (allows scroll to complete)
    // This handles the case where all messages fit on screen without scrolling
    setTimeout(() => {
      if (isNearBottom(el.chatThreadList) && getUnreadCount(channelId) > 0) {
        markChannelAsRead(channelId);
      }
    }, 100);

    // Prefetch author profiles in background, then re-render to show names
    prefetchAuthorProfiles(mapped).then(() => {
      renderThreads();
    });
  } catch (_err) {
    // Ignore fetch errors
  }
}


function wireChannelModal() {
  let selectedChannelType = null; // 'public' or 'private'

  const closeModal = () => {
    hide(el.channelModal);
    goToStep1();
  };

  const goToStep1 = () => {
    selectedChannelType = null;
    // Show step 1, hide step 2
    if (el.wizardStep1) el.wizardStep1.style.display = "";
    if (el.wizardStep2) el.wizardStep2.style.display = "none";
    el.channelForm?.reset();
  };

  const goToStep2 = async (type) => {
    selectedChannelType = type;
    // Hide step 1, show step 2
    if (el.wizardStep1) el.wizardStep1.style.display = "none";
    if (el.wizardStep2) el.wizardStep2.style.display = "";

    // Set the hidden isPublic value
    if (el.channelIsPublic) {
      el.channelIsPublic.value = type === "public" ? "1" : "0";
    }

    // Update the badge to show selected type
    if (el.wizardTypeBadge) {
      if (type === "public") {
        el.wizardTypeBadge.innerHTML = "🌐 Public Channel";
        el.wizardTypeBadge.className = "wizard-type-badge badge-public";
      } else {
        el.wizardTypeBadge.innerHTML = "🔒 Private Encrypted Channel";
        el.wizardTypeBadge.className = "wizard-type-badge badge-private";
      }
    }

    // For private channels, show group selection (encryption is automatic)
    if (type === "private") {
      await loadGroupsForDropdown();
      if (el.channelGroupSection) el.channelGroupSection.style.display = "";
    } else {
      if (el.channelGroupSection) el.channelGroupSection.style.display = "none";
    }
  };

  const loadGroupsForDropdown = async () => {
    if (!el.channelGroupSelect) return;
    try {
      const res = await fetch(chatUrl("/groups"));
      if (!res.ok) return;
      const groups = await res.json();
      el.channelGroupSelect.innerHTML = `<option value="">Select a group...</option>` +
        groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
    } catch (_err) {
      console.error("[Chat] Failed to load groups for channel creation");
    }
  };

  el.channelModal?.addEventListener("click", (event) => {
    if (event.target === el.channelModal) closeModal();
  });

  // Wire up channel type buttons using event delegation
  el.channelModal?.addEventListener("click", async (event) => {
    const typeBtn = event.target.closest("[data-select-channel-type]");
    if (typeBtn) {
      const type = typeBtn.dataset.selectChannelType;
      await goToStep2(type);
    }
  });

  // Back button handler
  el.channelBackBtn?.addEventListener("click", () => {
    goToStep1();
  });

  el.newChannelTriggers?.forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!state.session) return;

      // Reset modal to step 1
      goToStep1();

      // For non-admins, skip type selection and go directly to public channel form
      if (!state.isAdmin) {
        await goToStep2("public");
      }

      show(el.channelModal);
    })
  );

  el.closeChannelModalBtns?.forEach((btn) => btn.addEventListener("click", closeModal));

  el.channelForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.session) return;
    const form = event.currentTarget;
    const data = new FormData(form);

    const isPublic = data.get("isPublic") === "1";
    // Private channels are always encrypted
    const encrypted = !isPublic;
    const groupId = !isPublic ? data.get("groupId") : null;

    // Validate group selection for private channels
    if (!isPublic && !groupId) {
      alert("Please select a group for the private channel");
      return;
    }

    // For private channels, verify encryption is available BEFORE creating
    if (!isPublic) {
      const encryptCheck = await checkEncryptionSupport();
      if (!encryptCheck.available) {
        alert(`Cannot create encrypted channel: ${encryptCheck.reason}\n\nPrivate channels require a secure connection (HTTPS) and a Nostr signer.`);
        return;
      }
    }

    // Ensure slug format (lowercase, hyphens only)
    const rawName = String(data.get("name") || "").trim();
    const name = rawName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "untitled";
    const displayName = name
      .split(/-+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");

    const payload = {
      name,
      displayName,
      description: String(data.get("description") || "").trim(),
      isPublic,
      encrypted,
      groupId: groupId ? Number(groupId) : null,
    };

    try {
      const res = await fetch(chatUrl("/channels"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const created = await res.json();
        const channelId = String(created.id);
        let channelEncrypted = created.encrypted === 1;

        // If encrypted, setup channel encryption keys
        if (channelEncrypted && state.session?.pubkey) {
          const keySetup = await setupChannelEncryption(channelId, state.session.pubkey);
          if (!keySetup) {
            // Encryption setup failed - delete the channel to avoid orphaned unencrypted channels
            console.error('[Chat] Failed to setup encryption keys, deleting channel');
            try {
              await fetch(chatUrl(`/channels/${channelId}`), { method: "DELETE" });
            } catch (_e) {
              console.error('[Chat] Failed to delete channel after encryption failure');
            }
            alert('Failed to setup encryption. Channel was not created.\n\nPlease ensure you have a secure connection (HTTPS) and try again.');
            return;
          }

          // Distribute keys to all group members immediately
          const keyDistResult = await distributeKeysToAllPendingMembers(channelId);
          if (keyDistResult.success > 0) {
            console.log(`[Chat] Distributed encryption keys to ${keyDistResult.success} group member(s)`);
          }
          if (keyDistResult.failed > 0) {
            console.warn(`[Chat] Failed to distribute keys to ${keyDistResult.failed} group member(s)`);
          }
        }

        upsertChannel({
          id: channelId,
          name: created.name,
          displayName: created.display_name,
          description: created.description,
          isPublic: created.is_public === 1,
          encrypted: channelEncrypted,
        });
        selectChannel(channelId);
        updateChatUrl(channelId);
        renderChannels();
        await fetchMessages(channelId);
      } else {
        const err = await res.json().catch(() => ({}));
        console.error('[Chat] Failed to create channel:', err.error || res.status);
        alert(err.error || 'Failed to create channel');
      }
    } catch (_err) {
      // Ignore errors
    }

    hide(el.channelModal);
    form?.reset();
    goToStep1();
  });
}

function wireComposer() {
  el.chatInput?.addEventListener("input", () => {
    const hasText = Boolean(el.chatInput.value.trim());
    if (hasText && state.chat.selectedChannelId) el.chatSendBtn?.removeAttribute("disabled");
    else el.chatSendBtn?.setAttribute("disabled", "disabled");

    // Handle mention autocomplete
    handleMentionInput();

    // Handle slash command autocomplete
    handleSlashInput();

    // Auto-expand textarea
    autoResizeTextarea(el.chatInput);
  });

  el.chatInput?.addEventListener("keydown", (event) => {
    // Let mention handler take over if active
    if (handleMentionKeydown(event)) return;

    // Let slash command handler take over if active
    if (handleSlashKeydown(event)) return;

    // Enter sends message, Shift+Enter adds new line
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  // Wire paste and drop handlers for file uploads
  wirePasteAndDrop(el.chatInput, el.chatSendBtn, "Share an update, @name to mention", () => !!state.session);

  // Wire attach button for file uploads
  wireAttachButton(el.chatAttachBtn, el.chatFileInput, el.chatInput, el.chatSendBtn, "Share an update, @name to mention", () => !!state.session);

  // Close mention popup when clicking outside
  document.addEventListener("click", (event) => {
    if (!el.mentionPopup?.contains(event.target) && event.target !== el.chatInput) {
      closeMentionPopup();
    }
    // Close slash popup when clicking outside
    const slashPopup = document.querySelector("[data-slash-popup]");
    if (slashPopup && !slashPopup.contains(event.target) && event.target !== el.chatInput) {
      closeSlashPopup();
    }
  });

  // Message menu: toggle dropdown, close others, and handle copy/delete/pin
  document.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-message-menu]");
    const copyBtn = event.target.closest("[data-copy-message]");
    const copyThreadBtn = event.target.closest("[data-copy-thread]");
    const pinBtn = event.target.closest("[data-pin-message]");
    const unpinBtn = event.target.closest("[data-unpin-message]");
    const deleteBtn = event.target.closest("[data-delete-message]");

    // Handle menu trigger click
    if (trigger) {
      event.stopPropagation();
      // Find the dropdown sibling within the same menu container
      const menuContainer = trigger.closest(".message-menu");
      const dropdown = menuContainer?.querySelector("[data-message-dropdown]");
      // Close all other open menus
      document.querySelectorAll("[data-message-dropdown]").forEach((d) => {
        if (d !== dropdown) d.hidden = true;
      });
      // Toggle this menu's dropdown
      if (dropdown) dropdown.hidden = !dropdown.hidden;
      return;
    }

    // Handle copy button click
    if (copyBtn) {
      event.stopPropagation();
      const messageId = copyBtn.dataset.copyMessage;
      // Find the message in state
      const messages = getActiveChannelMessages();
      const message = messages.find((m) => m.id === messageId);
      if (message?.body) {
        const success = await copyToClipboard(message.body);
        if (success) {
          // Brief visual feedback - change button text temporarily
          const originalText = copyBtn.textContent;
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 1000);
        } else {
          alert("Failed to copy to clipboard");
        }
      }
      // Close the menu
      document.querySelectorAll("[data-message-dropdown]").forEach((d) => {
        d.hidden = true;
      });
      return;
    }

    // Handle copy entire thread button click
    if (copyThreadBtn) {
      event.stopPropagation();
      const threadId = copyThreadBtn.dataset.copyThread;
      const messages = getActiveChannelMessages();
      const byParent = groupByParent(messages);
      const rootMessage = messages.find((m) => m.id === threadId);
      if (rootMessage) {
        const replies = byParent.get(threadId) || [];
        const allMessages = [rootMessage, ...replies];
        // Format thread as text with author names and timestamps
        const threadText = allMessages
          .map((msg) => {
            const author = getAuthorDisplayName(msg.author);
            const time = formatLocalDateTime(msg.createdAt);
            return `[${author} - ${time}]\n${msg.body}`;
          })
          .join("\n\n");
        const success = await copyToClipboard(threadText);
        if (success) {
          const originalText = copyThreadBtn.textContent;
          copyThreadBtn.textContent = "Copied!";
          setTimeout(() => {
            copyThreadBtn.textContent = originalText;
          }, 1000);
        } else {
          alert("Failed to copy to clipboard");
        }
      }
      // Close the menu
      document.querySelectorAll("[data-message-dropdown]").forEach((d) => {
        d.hidden = true;
      });
      return;
    }

    // Handle pin button click
    if (pinBtn) {
      event.stopPropagation();
      const messageId = pinBtn.dataset.pinMessage;
      await pinMessage(messageId);
      document.querySelectorAll("[data-message-dropdown]").forEach((d) => {
        d.hidden = true;
      });
      return;
    }

    // Handle unpin button click
    if (unpinBtn) {
      event.stopPropagation();
      const messageId = unpinBtn.dataset.unpinMessage;
      await unpinMessage(messageId);
      document.querySelectorAll("[data-message-dropdown]").forEach((d) => {
        d.hidden = true;
      });
      return;
    }

    // Handle delete button click
    if (deleteBtn) {
      event.stopPropagation();
      const messageId = deleteBtn.dataset.deleteMessage;
      if (!confirm("Delete this message? Thread replies will also be removed.")) return;

      try {
        const res = await fetch(chatUrl(`/messages/${messageId}`), { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || "Failed to delete message");
          return;
        }
        // Update UI immediately (don't rely solely on SSE)
        const channelId = state.chat.selectedChannelId;
        if (channelId) {
          removeMessageFromChannel(channelId, messageId);
          renderThreads();
          // Close thread panel if the deleted message was the open thread root
          if (openThreadId === messageId) {
            closeThreadPanel();
          } else if (openThreadId) {
            // Re-render thread panel if open (message might be a reply)
            renderThreadPanel(openThreadId);
          }
        }
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

async function sendMessage() {
  if (!state.session || !el.chatInput) return;
  const body = el.chatInput.value.trim();
  if (!body || !state.chat.selectedChannelId) return;

  const channelId = state.chat.selectedChannelId;
  const parentId = state.chat.replyingTo?.id || null;

  // Save message text before clearing (in case of error)
  const savedBody = body;

  el.chatInput.value = "";
  el.chatInput.style.height = "auto"; // Reset height after sending
  el.chatSendBtn?.setAttribute("disabled", "disabled");
  setReplyTarget(null);

  try {
    // Transform client-side commands (like /hang) before anything else
    // This ensures the server never sees hang room IDs in encrypted channels
    let content = transformHangCommand(body);
    let encrypted = false;

    // Parse slash commands and mentions from plaintext BEFORE encryption
    // This allows the server to handle these without decrypting
    // Note: /hang is already transformed, so it won't be in the commands list
    const commands = parseSlashCommands(content);
    const mentions = parseMentions(content);

    // Encrypt message if channel needs encryption (private or community)
    if (channelNeedsEncryption(channelId)) {
      const encResult = await encryptMessageForChannel(content, channelId);
      if (encResult) {
        content = encResult.encrypted;
        encrypted = true;
      } else {
        console.error('[Chat] Failed to encrypt message - no encryption key available');
        // Restore message text and show error
        el.chatInput.value = savedBody;
        el.chatSendBtn?.removeAttribute("disabled");
        alert('Unable to send message: encryption key not available. Try refreshing the page or check if you have access to this encrypted channel.');
        return;
      }
    }

    const res = await fetch(chatUrl(`/channels/${channelId}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        parentId: parentId ? Number(parentId) : null,
        encrypted,
        commands: commands.length > 0 ? commands : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
      }),
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
  // If Alpine is handling the sidebar, skip innerHTML rendering
  // Alpine templates reactively update from the store's channels/dmChannels/personalChannel
  if (window.__FEATURE_FLAGS__?.alpineChat) {
    // Still wire up handlers for elements that aren't in the Alpine template
    // (modals, etc. are still handled via old pattern)
    return;
  }

  // Render regular channels (with signature-based caching to avoid unnecessary DOM updates)
  if (el.chatChannelList) {
    const channels = state.chat.channels;
    // Build signature: channel ids, active state, unread counts, mention counts
    const channelSignature = channels.map(c => {
      const isActive = c.id === state.chat.selectedChannelId;
      return `${c.id}:${isActive}:${getUnreadCount(c.id)}:${getSessionMentionCount(c.id)}:${c.encrypted}:${c.isPublic}:${c.hasWingmanAccess}`;
    }).join('|');

    if (channelSignature !== lastRenderedChannelSignature) {
      lastRenderedChannelSignature = channelSignature;
      el.chatChannelList.innerHTML = channels
        .map((channel) => {
          const isActive = channel.id === state.chat.selectedChannelId;
          const unreadCount = getUnreadCount(channel.id);
          const mentionCount = getSessionMentionCount(channel.id);
          const hasUnread = unreadCount > 0 && !isActive;
          // Show shield for encrypted, lock for private non-encrypted
          let statusIcon = '';
          if (channel.encrypted) {
            statusIcon = '<span class="channel-encrypted" title="E2E Encrypted">&#128737;</span>';
          } else if (!channel.isPublic) {
            statusIcon = '<span class="channel-lock" title="Private">&#128274;</span>';
          }
          // Show wingman icon if Wingman has access
          const wingmanIcon = channel.hasWingmanAccess
            ? '<img src="/wingman-icon.png" class="channel-wingman-icon" title="Wingman has access" alt="Wingman" />'
            : '';
          // Show unread badge
          let unreadBadge = '';
          if (mentionCount > 0 && !isActive) {
            unreadBadge = `<span class="unread-badge mention">(${mentionCount > 99 ? '99+' : mentionCount})</span>`;
          }
          return `<button class="chat-channel${isActive ? " active" : ""}${hasUnread ? " unread" : ""}" data-channel-id="${channel.id}" title="${escapeHtml(channel.displayName)}">
            <div class="chat-channel-name">#${escapeHtml(channel.name)} ${statusIcon}${wingmanIcon}${unreadBadge}</div>
          </button>`;
        })
        .join("");
    }
  }

  // Render DM channels (with signature-based caching to prevent avatar flickering on Safari)
  if (el.dmList) {
    const dmChannels = state.chat.dmChannels;
    // Build signature: dm ids, active state, unread counts, avatar urls
    const dmSignature = dmChannels.length === 0
      ? 'empty'
      : dmChannels.map(dm => {
          const isActive = dm.id === state.chat.selectedChannelId;
          return `${dm.id}:${isActive}:${getUnreadCount(dm.id)}:${dm.otherNpub}`;
        }).join('|');

    if (dmSignature !== lastRenderedDmSignature) {
      lastRenderedDmSignature = dmSignature;
      if (dmChannels.length === 0) {
        el.dmList.innerHTML = `<p class="dm-empty">No conversations yet</p>`;
      } else {
        el.dmList.innerHTML = dmChannels
          .map((dm) => {
            const isActive = dm.id === state.chat.selectedChannelId;
            const unreadCount = getUnreadCount(dm.id);
            const hasUnread = unreadCount > 0 && !isActive;
            const displayName = getDmDisplayName(dm);
            const avatarUrl = getAuthorAvatarUrl(dm.otherNpub);
            const unreadBadge = hasUnread
              ? `<span class="unread-badge">(${unreadCount > 99 ? '99+' : unreadCount})</span>`
              : '';
            return `<button class="chat-channel dm-channel${isActive ? " active" : ""}${hasUnread ? " unread" : ""}" data-channel-id="${dm.id}">
              <img class="dm-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
              <div class="dm-info">
                <div class="chat-channel-name">${escapeHtml(displayName)}${unreadBadge}</div>
              </div>
            </button>`;
          })
          .join("");
      }
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

      // Update Alpine store if feature enabled
      if (window.__FEATURE_FLAGS__?.alpineChat) {
        const chatShell = document.querySelector("[data-chat-shell]");
        if (chatShell && chatShell._x_dataStack) {
          const alpineStore = chatShell._x_dataStack[0];
          alpineStore.selectedChannelId = channelId;
          alpineStore.loading = true;
          alpineStore.messages = [];
          alpineStore.rootMessages = [];
        }
      }

      updateChatUrl(channelId);
      await fetchPinnedMessages(channelId);
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

// Wire up thread click handlers for Alpine-rendered content
function wireAlpineThreadHandlers() {
  if (!el.chatThreadList) return;

  const messages = getActiveChannelMessages();
  const byParent = groupByParent(messages);

  el.chatThreadList.querySelectorAll("[data-thread-id]").forEach((thread) => {
    // Skip if already wired
    if (thread.dataset.wired) return;
    thread.dataset.wired = "true";

    const replySection = thread.querySelector("[data-open-thread]");
    if (!replySection) return;

    const handler = (e) => {
      // Don't open if clicking on a button
      if (e.target.closest("button")) return;
      e.preventDefault();
      const threadId = thread.dataset.threadId;
      openThread(threadId, messages, byParent);
    };
    wireTouchAwareHandler(replySection, handler);
  });
}

function renderThreads() {
  // Skip rendering if Alpine chat is enabled - Alpine handles reactivity
  if (window.__FEATURE_FLAGS__?.alpineChat) {
    // Still need to update header
    const channel = findChannel(state.chat.selectedChannelId);
    if (channel) {
      const isDm = state.chat.dmChannels.some((c) => c.id === channel.id);
      const isPersonal = state.chat.personalChannel?.id === channel.id;
      if (isDm) {
        setChatHeader(`DM - ${getDmDisplayName(channel)}`);
      } else if (isPersonal) {
        setChatHeader("Note to self");
      } else {
        setChatHeader(`#${channel.name}`);
      }
    }

    // Wire up thread click handlers after Alpine renders
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      wireAlpineThreadHandlers();
    });
    return;
  }

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

  // Mark messages as pinned based on pinnedMessages array
  const pinnedIds = new Set(pinnedMessages.map((p) => String(p.message_id)));
  const messagesWithPinned = messages.map((m) => ({
    ...m,
    isPinned: pinnedIds.has(String(m.id)),
  }));

  const byParent = groupByParent(messagesWithPinned);
  const roots = byParent.get(null) || [];
  el.chatThreadList.innerHTML = roots
    .map((message) => renderCollapsedThread(message, byParent))
    .join("");

  // Only scroll to bottom on initial load, not on every re-render
  if (shouldScrollToBottom) {
    scrollToBottom(el.chatThreadList);
    shouldScrollToBottom = false;
  }

  // Wire up thread click handlers - only on reply section, not entire message
  el.chatThreadList.querySelectorAll("[data-thread-id]").forEach((thread) => {
    const replySection = thread.querySelector("[data-open-thread]");
    if (!replySection) return;

    const handler = (e) => {
      // Don't open if clicking on a button
      if (e.target.closest("button")) return;
      e.preventDefault();
      const threadId = thread.dataset.threadId;
      openThread(threadId, messages, byParent);
    };
    wireTouchAwareHandler(replySection, handler);
  });

  // Wire up refetch key buttons for decryption errors
  el.chatThreadList.querySelectorAll("[data-refetch-channel]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const channelId = btn.dataset.refetchChannel;
      btn.disabled = true;
      btn.textContent = "Refetching...";

      try {
        console.log("[Chat] Manually refetching key for channel", channelId);
        const key = await refetchChannelKey(channelId);
        if (key) {
          console.log("[Chat] Key refetch successful, re-rendering messages");
          // Re-fetch and re-render messages
          await fetchMessages(channelId);
        } else {
          console.error("[Chat] Key refetch returned null");
          btn.textContent = "Key not found";
          setTimeout(() => { btn.textContent = "Refetch key"; btn.disabled = false; }, 3000);
        }
      } catch (err) {
        console.error("[Chat] Key refetch failed:", err);
        btn.textContent = "Failed";
        setTimeout(() => { btn.textContent = "Refetch key"; btn.disabled = false; }, 3000);
      }
    });
  });
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

  // Expand thread button (desktop only)
  const expandHandler = () => expandThread();
  el.expandThreadBtn?.addEventListener("click", expandHandler);
  el.expandThreadBtn?.addEventListener("touchend", (e) => { e.preventDefault(); expandHandler(); });

  // Collapse thread button (desktop only)
  const collapseHandler = () => collapseThread();
  el.collapseThreadBtn?.addEventListener("click", collapseHandler);
  el.collapseThreadBtn?.addEventListener("touchend", (e) => { e.preventDefault(); collapseHandler(); });

  // Click on messages area when thread is expanded collapses back to normal
  const messagesArea = document.querySelector(".chat-messages-area");
  messagesArea?.addEventListener("click", (e) => {
    if (threadExpanded && !isMobile()) {
      e.preventDefault();
      collapseThread();
    }
  });

  el.threadInput?.addEventListener("input", () => {
    const hasText = Boolean(el.threadInput.value.trim());
    if (hasText && openThreadId) el.threadSendBtn?.removeAttribute("disabled");
    else el.threadSendBtn?.setAttribute("disabled", "disabled");

    // Handle mention autocomplete
    handleMentionInput(el.threadInput);

    // Handle slash command autocomplete
    handleSlashInput(el.threadInput);

    // Auto-expand textarea
    autoResizeTextarea(el.threadInput);
  });

  // Enter sends reply, Shift+Enter adds new line
  el.threadInput?.addEventListener("keydown", (event) => {
    // Let mention handler take over if active
    if (handleMentionKeydown(event)) return;

    // Let slash command handler take over if active
    if (handleSlashKeydown(event)) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendThreadReply();
    }
  });

  // Wire paste and drop handlers for file uploads
  wirePasteAndDrop(el.threadInput, el.threadSendBtn, "Reply to thread...", () => !!state.session);

  // Wire attach button for file uploads
  wireAttachButton(el.threadAttachBtn, el.threadFileInput, el.threadInput, el.threadSendBtn, "Reply to thread...", () => !!state.session);

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

async function openThread(threadId, messages, byParent) {
  openThreadId = threadId;
  const rootMessage = messages.find((m) => m.id === threadId);
  if (!rootMessage) return;

  const replies = byParent.get(threadId) || [];

  // Use Alpine store if feature enabled
  if (window.__FEATURE_FLAGS__?.alpineChat) {
    const chatShell = document.querySelector("[data-chat-shell]");
    const alpineStore = chatShell?._x_dataStack?.[0];
    if (alpineStore) {
      alpineStore.openThread(threadId);
      // Scroll to bottom after Alpine renders
      requestAnimationFrame(() => {
        scrollToBottom(el.threadMessages);
      });
    }
  } else {
    // Vanilla JS rendering
    const allMessages = [rootMessage, ...replies];
    if (el.threadMessages) {
      el.threadMessages.innerHTML = allMessages
        .map((msg, index) => renderMessageFull(msg, { isThreadRoot: index === 0, threadRootId: threadId }))
        .join("");
      scrollToBottom(el.threadMessages);
    }
    show(el.threadPanel);
  }

  // Check for linked tasks and show/hide the view tasks button
  await updateThreadTasksButton(threadId);

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
  // Mark messages as pinned
  const pinnedIds = new Set(pinnedMessages.map((p) => String(p.message_id)));
  const messagesWithPinned = messages.map((m) => ({
    ...m,
    isPinned: pinnedIds.has(String(m.id)),
  }));
  const byParent = groupByParent(messagesWithPinned);
  openThread(threadId, messagesWithPinned, byParent);
}

function closeThreadPanel() {
  openThreadId = null;

  // Close Alpine store thread if feature enabled
  if (window.__FEATURE_FLAGS__?.alpineChat) {
    const chatShell = document.querySelector("[data-chat-shell]");
    const alpineStore = chatShell?._x_dataStack?.[0];
    if (alpineStore) {
      alpineStore.closeThread();
    }
  } else {
    hide(el.threadPanel);
  }

  if (el.threadInput) el.threadInput.value = "";
  el.threadSendBtn?.setAttribute("disabled", "disabled");

  // Also collapse if expanded
  if (threadExpanded) {
    collapseThread();
  }

  // Switch to messages view on mobile when thread is closed
  if (isMobile()) {
    setMobileView("messages");
  }
}

// Expand thread to become main view (desktop only)
function expandThread() {
  if (isMobile() || !openThreadId) return;
  threadExpanded = true;
  el.chatLayout?.setAttribute("data-thread-expanded", "");
  // Toggle button visibility
  if (el.expandThreadBtn) el.expandThreadBtn.hidden = true;
  if (el.collapseThreadBtn) el.collapseThreadBtn.hidden = false;
}

// Collapse thread back to normal sidebar (desktop only)
function collapseThread() {
  threadExpanded = false;
  el.chatLayout?.removeAttribute("data-thread-expanded");
  // Toggle button visibility
  if (el.expandThreadBtn) el.expandThreadBtn.hidden = false;
  if (el.collapseThreadBtn) el.collapseThreadBtn.hidden = true;
}

async function sendThreadReply() {
  if (!state.session || !el.threadInput || !openThreadId) return;
  const body = el.threadInput.value.trim();
  if (!body || !state.chat.selectedChannelId) return;

  const channelId = state.chat.selectedChannelId;
  const parentId = openThreadId;

  el.threadInput.value = "";
  el.threadInput.style.height = "auto"; // Reset height after sending
  el.threadSendBtn?.setAttribute("disabled", "disabled");

  try {
    // Transform client-side commands (like /hang) before anything else
    let content = transformHangCommand(body);
    let encrypted = false;

    // Parse slash commands and mentions from plaintext BEFORE encryption
    const commands = parseSlashCommands(content);
    const mentions = parseMentions(content);

    // Encrypt message if channel needs encryption (private or community)
    if (channelNeedsEncryption(channelId)) {
      const encResult = await encryptMessageForChannel(content, channelId);
      if (encResult) {
        content = encResult.encrypted;
        encrypted = true;
      } else {
        console.error('[Chat] Failed to encrypt message');
        return;
      }
    }

    const res = await fetch(chatUrl(`/channels/${channelId}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        parentId: Number(parentId),
        encrypted,
        commands: commands.length > 0 ? commands : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
      }),
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

// Check if the selected channel is a DM
function isSelectedChannelDm() {
  if (!state.chat.selectedChannelId) return false;
  return state.chat.dmChannels.some((dm) => dm.id === state.chat.selectedChannelId);
}

// Update cog button and hang button visibility based on admin status and selected channel
export function updateChannelSettingsCog() {
  // Show cog for admins (all channels) or for any user viewing a DM
  if (el.channelSettingsBtn) {
    const isDm = isSelectedChannelDm();
    if (state.chat.selectedChannelId && (state.isAdmin || isDm)) {
      show(el.channelSettingsBtn);
    } else {
      hide(el.channelSettingsBtn);
    }
  }

  // Show hang button for all users when a channel is selected
  if (el.channelHangBtn) {
    if (state.chat.selectedChannelId) {
      show(el.channelHangBtn);
    } else {
      hide(el.channelHangBtn);
    }
  }

  // Show pinned button when a channel is selected
  if (el.channelPinnedBtn) {
    if (state.chat.selectedChannelId) {
      show(el.channelPinnedBtn);
      // Update has-pins class based on current pinned messages
      if (pinnedMessages.length > 0) {
        el.channelPinnedBtn.classList.add("has-pins");
      } else {
        el.channelPinnedBtn.classList.remove("has-pins");
      }
    } else {
      hide(el.channelPinnedBtn);
    }
  }
}

// Fetch pinned messages for a channel
async function fetchPinnedMessages(channelId) {
  if (!channelId) {
    pinnedMessages = [];
    canPinMessages = false;
    return;
  }
  try {
    const res = await fetch(chatUrl(`/channels/${channelId}/pinned`).replace("/chat/", "/api/"));
    if (!res.ok) {
      pinnedMessages = [];
      canPinMessages = false;
      return;
    }
    const data = await res.json();
    canPinMessages = data.canPin || false;

    // Update Alpine store if feature enabled
    if (window.__FEATURE_FLAGS__?.alpineChat) {
      const chatShell = document.querySelector("[data-chat-shell]");
      const alpineStore = chatShell?._x_dataStack?.[0];
      if (alpineStore) {
        alpineStore._deps.canPin = canPinMessages;
      }
    }

    // Map pinned messages to the format expected by processMessagesForDisplay
    let pinned = (data.pinned || []).map((p) => ({
      id: String(p.message_id),
      author: p.author,
      body: p.body,
      createdAt: p.created_at,
      parentId: p.thread_root_id ? String(p.thread_root_id) : null,
      encrypted: p.encrypted === 1,
      keyVersion: p.key_version,
      // Preserve original fields for the popout
      message_id: p.message_id,
      thread_root_id: p.thread_root_id,
      created_at: p.created_at,
    }));

    // Decrypt encrypted pinned messages
    pinned = await processMessagesForDisplay(pinned, channelId);
    pinnedMessages = pinned;
  } catch (err) {
    console.error("[Chat] Failed to fetch pinned messages:", err);
    pinnedMessages = [];
    canPinMessages = false;
  }
}

// Show pinned messages popout
function showPinnedPopout() {
  // Close any existing popout
  closePinnedPopout();

  if (!pinnedMessages.length) {
    // No pinned messages - still show popout with empty state
  }

  const popout = document.createElement("div");
  popout.className = "pinned-popout";
  popout.setAttribute("data-pinned-popout", "");

  let html = `<div class="pinned-popout-header">Pinned Messages</div>`;

  if (pinnedMessages.length === 0) {
    html += `<div class="pinned-popout-empty">No pinned messages</div>`;
  } else {
    for (const pin of pinnedMessages) {
      const authorName = getAuthorDisplayName(pin.author);
      // Use decrypted body from processMessagesForDisplay
      const body = pin.body || "";
      const preview = body.slice(0, 80) + (body.length > 80 ? "..." : "");
      const time = formatReplyTimestamp(pin.createdAt || pin.created_at);
      const threadId = pin.parentId || pin.id || pin.thread_root_id || pin.message_id;
      html += `
        <div class="pinned-message-item" data-open-pinned-thread="${threadId}">
          <div class="pinned-message-author">${escapeHtml(authorName)}</div>
          <div class="pinned-message-preview">${escapeHtml(preview)}</div>
          <div class="pinned-message-time">${time}</div>
        </div>
      `;
    }
  }

  popout.innerHTML = html;

  // Position relative to the button
  const btnRect = el.channelPinnedBtn.getBoundingClientRect();
  const header = el.channelPinnedBtn.closest("header");
  if (header) {
    header.style.position = "relative";
    popout.style.top = `${el.channelPinnedBtn.offsetTop + el.channelPinnedBtn.offsetHeight}px`;
    popout.style.right = "0";
    header.appendChild(popout);
  } else {
    document.body.appendChild(popout);
    popout.style.position = "fixed";
    popout.style.top = `${btnRect.bottom + 4}px`;
    popout.style.right = `${window.innerWidth - btnRect.right}px`;
  }

  // Close on outside click
  setTimeout(() => {
    document.addEventListener("click", closePinnedPopoutOnOutsideClick);
  }, 0);

  // Wire up click handlers for pinned items
  popout.querySelectorAll("[data-open-pinned-thread]").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const threadId = item.getAttribute("data-open-pinned-thread");
      closePinnedPopout();
      // Use renderThreadPanel which handles getting messages internally
      renderThreadPanel(threadId);
    });
  });
}

function closePinnedPopout() {
  const popout = document.querySelector("[data-pinned-popout]");
  if (popout) popout.remove();
  document.removeEventListener("click", closePinnedPopoutOnOutsideClick);
}

function closePinnedPopoutOnOutsideClick(e) {
  const popout = document.querySelector("[data-pinned-popout]");
  if (popout && !popout.contains(e.target) && e.target !== el.channelPinnedBtn) {
    closePinnedPopout();
  }
}

// Pin a message
async function pinMessage(messageId) {
  const channelId = state.chat.selectedChannelId;
  if (!channelId || !messageId) return;

  try {
    const res = await fetch(chatUrl(`/channels/${channelId}/messages/${messageId}/pin`).replace("/chat/", "/api/"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      // Show feedback to user
      showToast("Message pinned");
      // SSE event will handle refreshing pinned messages and re-rendering
    } else {
      showToast("Failed to pin message", "error");
    }
  } catch (err) {
    console.error("[Chat] Failed to pin message:", err);
    showToast("Failed to pin message", "error");
  }
}

// Unpin a message
async function unpinMessage(messageId) {
  const channelId = state.chat.selectedChannelId;
  if (!channelId || !messageId) return;

  try {
    const res = await fetch(chatUrl(`/channels/${channelId}/messages/${messageId}/pin`).replace("/chat/", "/api/"), {
      method: "DELETE",
    });
    if (res.ok) {
      // Show feedback to user
      showToast("Message unpinned");
      // SSE event will handle refreshing pinned messages and re-rendering
    } else {
      showToast("Failed to unpin message", "error");
    }
  } catch (err) {
    console.error("[Chat] Failed to unpin message:", err);
    showToast("Failed to unpin message", "error");
  }
}

// Fetch all groups for the dropdown
async function fetchAllGroups() {
  try {
    const res = await fetch(chatUrl("/groups"));
    if (!res.ok) return;
    allGroups = await res.json();
  } catch (_err) {
    console.error("[Chat] Failed to fetch groups");
  }
}

// Fetch groups assigned to a channel
async function fetchChannelGroups(channelId) {
  try {
    const res = await fetch(chatUrl(`/channels/${channelId}/groups`));
    if (!res.ok) return [];
    return await res.json();
  } catch (_err) {
    console.error("[Chat] Failed to fetch channel groups");
    return [];
  }
}

// Open channel settings modal
async function openChannelSettingsModal() {
  if (!state.chat.selectedChannelId) {
    console.warn("[Chat] openChannelSettingsModal: No selected channel ID");
    return;
  }

  const channel = state.chat.channels.find((c) => c.id === state.chat.selectedChannelId);
  if (!channel) {
    console.warn("[Chat] openChannelSettingsModal: Channel not found in state.chat.channels", {
      selectedChannelId: state.chat.selectedChannelId,
      availableChannels: state.chat.channels.map((c) => ({ id: c.id, name: c.name })),
    });
    return;
  }

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

  // Show encryption section for encrypted channels (admin only)
  if (el.channelEncryptionSection) {
    console.log("[Chat] Channel settings - channel:", channel, "isAdmin:", state.isAdmin, "encrypted:", channel.encrypted);
    if (channel.encrypted && state.isAdmin) {
      show(el.channelEncryptionSection);
      // Load encryption key status
      await loadEncryptionKeyStatus(channel.id);
    } else {
      hide(el.channelEncryptionSection);
    }
  } else {
    console.log("[Chat] channelEncryptionSection element not found");
  }

  show(el.channelSettingsModal);
}

// Load and display encryption key status
async function loadEncryptionKeyStatus(channelId) {
  if (!el.encryptionStatus) return;

  el.encryptionStatus.innerHTML = "<p>Loading key status...</p>";

  try {
    // Fetch all keys for the channel
    const keysRes = await fetch(chatUrl(`/channels/${channelId}/keys/all`), {
      credentials: "same-origin",
    });
    const keysData = keysRes.ok ? await keysRes.json() : { keys: [] };

    // Fetch pending members
    const pendingRes = await fetch(chatUrl(`/channels/${channelId}/keys/pending`), {
      credentials: "same-origin",
    });
    const pendingData = pendingRes.ok ? await pendingRes.json() : { pendingMembers: [] };

    const keys = keysData.keys || [];
    const pending = pendingData.pendingMembers || [];

    let html = "";

    if (keys.length > 0) {
      html += `<div class="encryption-keys-list"><strong>Users with keys (${keys.length}):</strong><ul>`;
      for (const key of keys) {
        const displayName = await getDisplayNameForPubkey(key.user_pubkey);
        html += `<li>✅ ${escapeHtml(displayName || key.user_pubkey.slice(0, 12) + "...")}</li>`;
      }
      html += `</ul></div>`;
    }

    if (pending.length > 0) {
      html += `<div class="encryption-pending-list"><strong>Pending keys (${pending.length}):</strong><ul>`;
      for (const member of pending) {
        const displayName = member.displayName || member.npub.slice(0, 16) + "...";
        html += `<li>⏳ ${escapeHtml(displayName)}</li>`;
      }
      html += `</ul></div>`;
    }

    if (keys.length === 0 && pending.length === 0) {
      html = "<p>No members assigned to this channel's groups.</p>";
    }

    el.encryptionStatus.innerHTML = html;
  } catch (err) {
    console.error("[Chat] Failed to load encryption key status:", err);
    el.encryptionStatus.innerHTML = "<p>Failed to load key status</p>";
  }
}

// Get display name for a pubkey
async function getDisplayNameForPubkey(pubkey) {
  // Check local cache first
  if (localUserCache.has(pubkey)) {
    return localUserCache.get(pubkey)?.display_name || null;
  }
  // Check users loaded from server
  for (const [, user] of localUserCache) {
    if (user.pubkey === pubkey) {
      return user.display_name || null;
    }
  }
  return null;
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
    const res = await fetch(chatUrl(`/channels/${state.chat.selectedChannelId}/groups`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupIds: [groupId] }),
    });
    if (res.ok) {
      const data = await res.json();
      channelSettingsGroups = await fetchChannelGroups(state.chat.selectedChannelId);
      renderChannelGroups();
      updateGroupDropdown();

      // If this is an encrypted channel, distribute keys to new group members
      if (data.needsKeyDistribution) {
        console.log(`[Chat] Distributing keys for encrypted channel ${data.channelName}`);
        try {
          const result = await distributeKeysToAllPendingMembers(state.chat.selectedChannelId);
          console.log(`[Chat] Key distribution result:`, result);
        } catch (err) {
          console.error(`[Chat] Failed to distribute keys:`, err);
        }
      }
    }
  } catch (_err) {
    console.error("[Chat] Failed to add group to channel");
  }
}

// Remove a group from the channel
async function removeChannelGroup(groupId) {
  if (!state.chat.selectedChannelId) return;

  try {
    const res = await fetch(chatUrl(`/channels/${state.chat.selectedChannelId}/groups/${groupId}`), {
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
    const res = await fetch(chatUrl(`/channels/${state.chat.selectedChannelId}`), {
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
    const res = await fetch(chatUrl(`/channels/${channel.id}`), {
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
  // Open modal on cog click - show DM settings for DMs, channel settings for channels
  el.channelSettingsBtn?.addEventListener("click", () => {
    if (isSelectedChannelDm()) {
      openDmSettingsModal();
    } else {
      openChannelSettingsModal();
    }
  });

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

  // Handle manual key distribution
  el.distributeKeysBtn?.addEventListener("click", async () => {
    if (!state.chat.selectedChannelId) return;

    el.distributeKeysBtn.disabled = true;
    el.distributeKeysBtn.textContent = "Distributing...";

    try {
      const result = await distributeKeysToAllPendingMembers(state.chat.selectedChannelId);
      if (result.success > 0 || result.failed > 0) {
        alert(`Keys distributed: ${result.success} success, ${result.failed} failed`);
      } else {
        alert("No pending members to distribute keys to.");
      }
      // Reload the status
      await loadEncryptionKeyStatus(state.chat.selectedChannelId);
    } catch (err) {
      console.error("[Chat] Failed to distribute keys:", err);
      alert("Failed to distribute keys. Check console for details.");
    } finally {
      el.distributeKeysBtn.disabled = false;
      el.distributeKeysBtn.textContent = "Distribute Keys to Pending Members";
    }
  });
}

// ========== DM Settings Modal ==========

// Open DM settings modal
function openDmSettingsModal() {
  if (!state.chat.selectedChannelId) return;

  const dm = state.chat.dmChannels.find((d) => d.id === state.chat.selectedChannelId);
  if (!dm) return;

  // Set the channel ID in the hidden input
  if (el.dmSettingsId) el.dmSettingsId.value = dm.id;

  show(el.dmSettingsModal);
}

// Archive a DM channel
async function archiveDm() {
  const channelId = el.dmSettingsId?.value;
  if (!channelId) return;

  if (!confirm("Archive this conversation? It will be removed from your sidebar but messages will not be deleted.")) {
    return;
  }

  try {
    const res = await fetch(teamUrl(`/api/dm/${channelId}/archive`), {
      method: "POST",
      credentials: "same-origin",
    });

    if (res.ok) {
      // Remove from local state
      state.chat.dmChannels = state.chat.dmChannels.filter((d) => d.id !== channelId);

      // Update Alpine store if using Alpine chat
      if (window.__FEATURE_FLAGS__?.alpineChat) {
        const chatShell = document.querySelector("[data-chat-shell]");
        if (chatShell && chatShell._x_dataStack) {
          const alpineStore = chatShell._x_dataStack[0];
          alpineStore.dmChannels = state.chat.dmChannels;
        }
      }

      // Close modal first
      hide(el.dmSettingsModal);

      // If viewing this DM, switch to another channel
      if (state.chat.selectedChannelId === channelId) {
        // Helper to update Alpine store's selected channel
        const updateAlpineSelectedChannel = (newChannelId) => {
          if (window.__FEATURE_FLAGS__?.alpineChat) {
            const chatShell = document.querySelector("[data-chat-shell]");
            if (chatShell && chatShell._x_dataStack) {
              const alpineStore = chatShell._x_dataStack[0];
              alpineStore.selectedChannelId = newChannelId;
              alpineStore.loading = true;
            }
          }
        };

        if (state.chat.channels.length > 0) {
          const firstChannel = state.chat.channels[0];
          selectChannel(firstChannel.id);
          updateAlpineSelectedChannel(firstChannel.id);
          updateChatUrl(firstChannel.id);
          await fetchPinnedMessages(firstChannel.id);
          updateChannelSettingsCog();
          await fetchMessages(firstChannel.id);
        } else if (state.chat.dmChannels.length > 0) {
          // Switch to another DM if no regular channels
          const firstDm = state.chat.dmChannels[0];
          selectChannel(firstDm.id);
          updateAlpineSelectedChannel(firstDm.id);
          updateChatUrl(firstDm.id);
          updateChannelSettingsCog();
          await fetchMessages(firstDm.id);
        } else {
          state.chat.selectedChannelId = null;
          updateAlpineSelectedChannel(null);
          if (el.threadList) {
            el.threadList.innerHTML = `<p class="chat-placeholder">Pick or create a channel to start chatting.</p>`;
          }
          if (el.activeChannel) {
            el.activeChannel.textContent = "Pick a channel";
          }
          updateChannelSettingsCog();
        }
      }

      renderChannels();
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to archive conversation");
    }
  } catch (_err) {
    console.error("[Chat] Failed to archive DM");
    alert("Failed to archive conversation");
  }
}

// Wire DM settings modal
function wireDmSettingsModal() {
  // Close modal
  const closeModal = () => hide(el.dmSettingsModal);
  el.closeDmSettingsBtns?.forEach((btn) => btn.addEventListener("click", closeModal));
  el.dmSettingsModal?.addEventListener("click", (e) => {
    if (e.target === el.dmSettingsModal) closeModal();
  });

  // Archive button
  el.archiveDmBtn?.addEventListener("click", archiveDm);
}

// ========== Hang Buttons ==========

/**
 * Send a hang message to a channel or thread
 * @param {string|number} channelId - The channel ID
 * @param {number|null} parentId - Thread parent ID (null for channel message)
 */
async function sendHangMessage(channelId, parentId = null) {
  if (!state.session) return;

  const hangId = generateHangId();
  const hangUrl = `https://hang.live/@${hangId}`;
  const body = `Join the hang: ${hangUrl}`;

  try {
    let content = body;
    let encrypted = false;

    // Encrypt if channel needs it
    if (channelNeedsEncryption(channelId)) {
      const encResult = await encryptMessageForChannel(body, channelId);
      if (encResult) {
        content = encResult.encrypted;
        encrypted = true;
      } else {
        console.error("[Hang] Failed to encrypt hang message");
        return;
      }
    }

    const res = await fetch(`/chat/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        parentId: parentId ? Number(parentId) : null,
        encrypted,
      }),
    });

    if (res.ok) {
      await fetchMessages(channelId);
      // If this was a thread reply, refresh the thread view
      if (parentId && openThreadId) {
        const messages = getActiveChannelMessages();
        const byParent = groupByParent(messages);
        openThread(parentId, messages, byParent);
      }
    }
  } catch (err) {
    console.error("[Hang] Failed to send hang message:", err);
  }
}

// Wire hang buttons
function wireHangButtons() {
  // Channel hang button - sends to current channel
  el.channelHangBtn?.addEventListener("click", () => {
    if (!state.chat.selectedChannelId) return;
    sendHangMessage(state.chat.selectedChannelId, null);
  });

  // Thread hang button - sends to current thread
  el.threadHangBtn?.addEventListener("click", () => {
    if (!state.chat.selectedChannelId || !openThreadId) return;
    sendHangMessage(state.chat.selectedChannelId, openThreadId);
  });
}

// Wire pinned messages button
function wirePinnedButton() {
  el.channelPinnedBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const popout = document.querySelector("[data-pinned-popout]");
    if (popout) {
      closePinnedPopout();
    } else {
      showPinnedPopout();
    }
  });
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
    const res = await fetch(chatUrl("/dm"), {
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
      updateChatUrl(String(channel.id));
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

// ========== Task Link Modal ==========

let taskSearchDebounce = null;
let threadLinkedTasks = []; // Cache of linked tasks for current thread

// Update the "view linked tasks" button visibility based on task count
async function updateThreadTasksButton(threadId) {
  if (!el.viewThreadTasksBtn) return;

  try {
    const res = await fetch(`/api/threads/${threadId}/tasks`);
    if (!res.ok) {
      hide(el.viewThreadTasksBtn);
      return;
    }
    const data = await res.json();
    threadLinkedTasks = data.tasks || [];

    if (threadLinkedTasks.length > 0) {
      show(el.viewThreadTasksBtn);
    } else {
      hide(el.viewThreadTasksBtn);
    }
  } catch (_err) {
    hide(el.viewThreadTasksBtn);
  }
}

// Fetch user's groups for the board dropdown
async function fetchUserGroups() {
  try {
    const res = await fetch(chatUrl("/groups"));
    if (!res.ok) return [];
    return await res.json();
  } catch (_err) {
    return [];
  }
}

// Populate the board dropdown with user's groups
async function populateBoardDropdown() {
  if (!el.taskBoardSelect) return;
  const groups = await fetchUserGroups();
  el.taskBoardSelect.innerHTML = `<option value="">Personal</option>` +
    groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
}

// Search tasks by query
async function searchTasks(query, groupId = null) {
  const resultsContainer = document.querySelector("[data-task-results]");
  if (!resultsContainer) return;

  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (groupId) params.set("group_id", groupId);

  try {
    const res = await fetch(`/api/tasks/search?${params.toString()}`);
    if (!res.ok) {
      resultsContainer.innerHTML = `<p class="task-search-error">Failed to search tasks</p>`;
      return;
    }
    const data = await res.json();
    renderTaskSearchResults(data.tasks || [], resultsContainer);
  } catch (_err) {
    resultsContainer.innerHTML = `<p class="task-search-error">Failed to search tasks</p>`;
  }
}

// Render task search results
function renderTaskSearchResults(tasks, container = null) {
  const resultsContainer = container || document.querySelector("[data-task-results]");
  if (!resultsContainer) return;

  if (tasks.length === 0) {
    resultsContainer.innerHTML = `<p class="task-search-empty">No tasks found</p>`;
    return;
  }

  resultsContainer.innerHTML = tasks
    .map((task) => `<button type="button" class="task-result-item" data-link-task-id="${task.id}">
      <span class="task-result-title">${escapeHtml(task.title)}</span>
      <span class="task-result-meta">
        ${task.group_name ? `<span class="task-result-board">${escapeHtml(task.group_name)}</span>` : '<span class="task-result-board">Personal</span>'}
        <span class="badge badge-state-${task.state}">${task.state.replace("_", " ")}</span>
      </span>
    </button>`)
    .join("");

  // Wire click handlers
  resultsContainer.querySelectorAll("[data-link-task-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const taskId = btn.dataset.linkTaskId;
      await linkThreadToTask(Number(taskId));
    });
  });
}

// Link current thread to a task
async function linkThreadToTask(taskId) {
  if (!openThreadId) {
    alert("No thread selected");
    return;
  }

  try {
    const res = await fetch(`/api/tasks/${taskId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: Number(openThreadId) }),
    });

    if (res.ok) {
      hide(el.taskLinkModal);
      showToast("Thread linked to task");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to link thread");
    }
  } catch (_err) {
    alert("Failed to link thread");
  }
}

// Create a new task and link thread
async function createAndLinkTask(formData) {
  if (!openThreadId) {
    alert("No thread selected");
    return;
  }

  const groupId = formData.get("board") || null;
  const payload = {
    title: String(formData.get("title") || "").trim(),
    description: String(formData.get("description") || "").trim(),
    priority: String(formData.get("priority") || "pebble"),
    group_id: groupId ? Number(groupId) : null,
    thread_id: Number(openThreadId),
  };

  if (!payload.title) {
    alert("Title is required");
    return;
  }

  try {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      hide(el.taskLinkModal);
      el.taskLinkCreateForm?.reset();
      showToast("Task created and linked");
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to create task");
    }
  } catch (_err) {
    alert("Failed to create task");
  }
}

// Show a toast notification
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " toast-error" : ""}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-fade");
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Open task link modal
async function openTaskLinkModal() {
  if (!openThreadId) return;

  // Reset to create tab
  switchTaskLinkTab("create");
  el.taskLinkCreateForm?.reset();
  if (el.taskSearchInput) el.taskSearchInput.value = "";
  if (el.taskResults) el.taskResults.innerHTML = `<p class="task-search-empty">Select a board and search for tasks...</p>`;

  // Populate both board dropdowns (create and search)
  await populateBoardDropdown();
  await populateSearchBoardDropdown();

  show(el.taskLinkModal);
}

// Populate the search board dropdown with user's groups
async function populateSearchBoardDropdown() {
  const select = document.querySelector("[data-task-search-board]");
  if (!select) return;
  const groups = await fetchUserGroups();
  select.innerHTML = `<option value="all">All Boards</option><option value="">Personal</option>` +
    groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
}

// Switch between create/existing tabs
function switchTaskLinkTab(tab) {
  // Query elements directly to ensure they're found (modal may not exist at page load)
  const tabsContainer = document.querySelector(".task-link-tabs");
  const tabs = tabsContainer?.querySelectorAll("[data-task-tab]");
  const createForm = document.querySelector("[data-task-link-create]");
  const existingSection = document.querySelector("[data-task-link-existing]");

  tabs?.forEach((t) => {
    if (t.dataset.taskTab === tab) {
      t.classList.add("active");
    } else {
      t.classList.remove("active");
    }
  });

  if (tab === "create") {
    show(createForm);
    hide(existingSection);
  } else {
    hide(createForm);
    show(existingSection);
    // Load initial tasks for selected board (default to "all")
    const boardSelect = document.querySelector("[data-task-search-board]");
    const groupId = boardSelect?.value || "all";
    searchTasks("", groupId);
  }
}

// Unlink a thread from a task
async function unlinkThreadFromTask(taskId, messageId) {
  if (!confirm("Unlink this task from the thread?")) return;

  try {
    const res = await fetch(`/api/tasks/${taskId}/threads/${messageId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to unlink");

    // Remove from cache and refresh dropdown
    threadLinkedTasks = threadLinkedTasks.filter((t) => t.id !== taskId);
    const dropdown = document.querySelector(".thread-tasks-dropdown");
    if (dropdown) dropdown.remove();

    // Update button visibility
    if (threadLinkedTasks.length === 0) {
      hide(el.viewThreadTasksBtn);
    } else {
      showLinkedTasksDropdown();
    }
  } catch (err) {
    console.error("Failed to unlink thread from task:", err);
    alert("Failed to unlink task");
  }
}

// Show linked tasks dropdown from thread header button
function showLinkedTasksDropdown() {
  if (threadLinkedTasks.length === 0) return;

  // Remove any existing dropdown
  const existing = document.querySelector(".thread-tasks-dropdown");
  if (existing) {
    existing.remove();
    return;
  }

  const dropdown = document.createElement("div");
  dropdown.className = "thread-tasks-dropdown";
  dropdown.innerHTML = threadLinkedTasks
    .map((task) => `<div class="thread-task-item">
      <a href="/todo" class="thread-task-link" data-task-id="${task.id}">
        <span class="thread-task-title">${escapeHtml(task.title)}</span>
        <span class="thread-task-meta">
          <span class="badge priority-${task.priority}">${task.priority}</span>
          <span class="badge state-${task.state}">${task.state.replace("_", " ")}</span>
        </span>
      </a>
      <button type="button" class="thread-task-unlink" data-unlink-task="${task.id}" title="Unlink">&times;</button>
    </div>`)
    .join("");

  // Position below the button
  if (el.viewThreadTasksBtn) {
    const rect = el.viewThreadTasksBtn.getBoundingClientRect();
    dropdown.style.position = "fixed";
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.right = `${window.innerWidth - rect.right}px`;
    dropdown.style.zIndex = "1000";
  }

  document.body.appendChild(dropdown);

  // Handle unlink button clicks
  dropdown.addEventListener("click", (e) => {
    const unlinkBtn = e.target.closest("[data-unlink-task]");
    if (unlinkBtn) {
      e.preventDefault();
      e.stopPropagation();
      const taskId = Number(unlinkBtn.dataset.unlinkTask);
      if (openThreadId) {
        unlinkThreadFromTask(taskId, openThreadId);
      }
    }
  });

  // Close on click outside
  const closeHandler = (e) => {
    if (!dropdown.contains(e.target) && e.target !== el.viewThreadTasksBtn) {
      dropdown.remove();
      document.removeEventListener("click", closeHandler);
    }
  };
  setTimeout(() => document.addEventListener("click", closeHandler), 0);
}

// Wire task link modal
function wireTaskLinkModal() {
  // View linked tasks button in thread header
  el.viewThreadTasksBtn?.addEventListener("click", showLinkedTasksDropdown);

  // Handle "Link thread to task" from message menu (via event delegation)
  document.addEventListener("click", async (e) => {
    const linkBtn = e.target.closest("[data-link-thread-to-task]");
    if (linkBtn) {
      e.stopPropagation();
      const threadId = linkBtn.dataset.linkThreadToTask;
      // Close the message menu dropdown
      document.querySelectorAll("[data-message-dropdown]").forEach((d) => {
        d.hidden = true;
      });
      // Set the thread ID and open modal
      openThreadId = threadId;
      await openTaskLinkModal();
      return;
    }
  });

  // Close modal
  const closeModal = () => hide(el.taskLinkModal);
  el.closeTaskLinkBtns?.forEach((btn) => btn.addEventListener("click", closeModal));
  el.taskLinkModal?.addEventListener("click", (e) => {
    if (e.target === el.taskLinkModal) closeModal();
  });

  // Tab switching
  el.taskLinkTabs?.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-task-tab]");
    if (!tab) return;
    switchTaskLinkTab(tab.dataset.taskTab);
  });

  // Create form submission
  el.taskLinkCreateForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    await createAndLinkTask(formData);
  });

  // Search input with debounce
  el.taskSearchInput?.addEventListener("input", () => {
    clearTimeout(taskSearchDebounce);
    taskSearchDebounce = setTimeout(() => {
      const query = el.taskSearchInput.value.trim();
      const boardSelect = document.querySelector("[data-task-search-board]");
      const groupId = boardSelect?.value || null;
      searchTasks(query, groupId);
    }, 300);
  });

  // Board selector change - re-run search with new board
  const searchBoardSelect = document.querySelector("[data-task-search-board]");
  searchBoardSelect?.addEventListener("change", () => {
    const query = el.taskSearchInput?.value.trim() || "";
    const groupId = searchBoardSelect.value || null;
    searchTasks(query, groupId);
  });
}
