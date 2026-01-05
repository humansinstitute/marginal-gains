const refreshers = new Set();

export const state = {
  session: window.__NOSTR_SESSION__,
  isAdmin: false,
  summaries: { day: null, week: null },
  viewMode: localStorage.getItem("taskViewMode") || "list", // "list" or "kanban"
  chat: {
    enabled: false,
    channels: [],
    dmChannels: [],
    personalChannel: null,
    selectedChannelId: null,
    replyingTo: null,
    messagesByChannel: {},
    unreadState: {},      // { channelId: { unread: number, mentions: number } } - from server
    sessionMentions: {},  // { channelId: number } - session only, resets on page load
  },
};

export const setSession = (nextSession) => {
  state.session = nextSession;
  if (!nextSession) {
    state.chat.enabled = false;
    state.chat.selectedChannelId = null;
    state.isAdmin = false;
  }
  refreshUI();
};

export const setIsAdmin = (isAdmin) => {
  state.isAdmin = isAdmin;
  refreshUI();
};

export const setSummaries = (summaries) => {
  state.summaries = summaries;
  refreshUI();
};

export const setChatEnabled = (enabled) => {
  if (state.chat.enabled === enabled) return;
  state.chat.enabled = enabled;
  refreshUI();
};

export const setViewMode = (mode) => {
  if (state.viewMode === mode) return;
  state.viewMode = mode;
  localStorage.setItem("taskViewMode", mode);
  refreshUI();
};

export const upsertChannel = (channel) => {
  const exists = state.chat.channels.find((c) => c.id === channel.id);
  state.chat.channels = exists
    ? state.chat.channels.map((c) => (c.id === channel.id ? channel : c))
    : [...state.chat.channels, channel];
  if (!state.chat.selectedChannelId) state.chat.selectedChannelId = channel.id;
  refreshUI();
};

// Update all channel lists and clean up messages for removed channels
export const updateAllChannels = (channels, dmChannels, personalChannel) => {
  // Collect all valid channel IDs
  const allNewIds = new Set([
    ...channels.map((c) => c.id),
    ...dmChannels.map((c) => c.id),
    ...(personalChannel ? [personalChannel.id] : []),
  ]);

  const oldIds = Object.keys(state.chat.messagesByChannel);

  // Clean up messages for channels user no longer has access to
  for (const oldId of oldIds) {
    if (!allNewIds.has(oldId)) {
      delete state.chat.messagesByChannel[oldId];
      try {
        localStorage.removeItem(`channel_${oldId}_messages`);
      } catch (_e) {
        // Ignore localStorage errors
      }
    }
  }

  // If selected channel was removed, clear selection
  if (state.chat.selectedChannelId && !allNewIds.has(state.chat.selectedChannelId)) {
    state.chat.selectedChannelId = channels.length > 0 ? channels[0].id : null;
  }

  state.chat.channels = channels;
  state.chat.dmChannels = dmChannels;
  state.chat.personalChannel = personalChannel;
  refreshUI();
};

// Legacy function for backwards compatibility
export const updateChannelsList = (newChannels) => {
  const newIds = new Set(newChannels.map((c) => c.id));
  const oldIds = Object.keys(state.chat.messagesByChannel);

  // Clean up messages for channels user no longer has access to
  for (const oldId of oldIds) {
    if (!newIds.has(oldId)) {
      delete state.chat.messagesByChannel[oldId];
      // Also clear localStorage cache if any
      try {
        localStorage.removeItem(`channel_${oldId}_messages`);
      } catch (_e) {
        // Ignore localStorage errors
      }
    }
  }

  // If selected channel was removed, clear selection
  if (state.chat.selectedChannelId && !newIds.has(state.chat.selectedChannelId)) {
    state.chat.selectedChannelId = newChannels.length > 0 ? newChannels[0].id : null;
  }

  state.chat.channels = newChannels;
  refreshUI();
};

export const addDmChannel = (channel) => {
  const exists = state.chat.dmChannels.find((c) => c.id === channel.id);
  if (!exists) {
    state.chat.dmChannels = [channel, ...state.chat.dmChannels];
  }
  refreshUI();
};

export const selectChannel = (channelId) => {
  state.chat.selectedChannelId = channelId;
  state.chat.replyingTo = null;
  refreshUI();
};

export const setReplyTarget = (message) => {
  state.chat.replyingTo = message;
  refreshUI();
};

export const addMessage = (channelId, message) => {
  const bucket = state.chat.messagesByChannel[channelId] || [];
  // Check if message already exists
  const existingIndex = bucket.findIndex((m) => m.id === message.id);

  if (existingIndex >= 0) {
    // Message exists - update it if new one is decrypted and old one wasn't
    const existing = bucket[existingIndex];
    if (existing.decryptionFailed && !message.decryptionFailed) {
      // Replace with decrypted version
      const newBucket = [...bucket];
      newBucket[existingIndex] = message;
      state.chat.messagesByChannel[channelId] = newBucket;
      refreshUI();
    }
    // Otherwise skip (don't add duplicate)
    return;
  }

  state.chat.messagesByChannel[channelId] = [...bucket, message];
  refreshUI();
};

export const setChannelMessages = (channelId, messages) => {
  state.chat.messagesByChannel[channelId] = messages;
  refreshUI();
};

export const getActiveChannelMessages = () => {
  if (!state.chat.selectedChannelId) return [];
  return state.chat.messagesByChannel[state.chat.selectedChannelId] || [];
};

// Remove a message and all its thread replies from a channel
export const removeMessageFromChannel = (channelId, messageId) => {
  const bucket = state.chat.messagesByChannel[channelId];
  if (!bucket) return;

  // Remove the message and any messages that are part of its thread
  // (parentId matches or they reference this message as thread root)
  state.chat.messagesByChannel[channelId] = bucket.filter((m) => {
    // Keep messages that aren't the deleted one and aren't in its thread
    return m.id !== messageId && m.parentId !== messageId;
  });
  refreshUI();
};

// Unread state management
export const setUnreadState = (unreadState) => {
  state.chat.unreadState = unreadState || {};
  refreshUI();
};

export const incrementUnread = (channelId) => {
  const current = state.chat.unreadState[channelId] || { unread: 0, mentions: 0 };
  state.chat.unreadState[channelId] = {
    ...current,
    unread: current.unread + 1,
  };
  refreshUI();
};

export const clearUnread = (channelId) => {
  if (state.chat.unreadState[channelId]) {
    state.chat.unreadState[channelId] = { unread: 0, mentions: 0 };
  }
  // Also clear session mentions when clearing unread
  if (state.chat.sessionMentions[channelId]) {
    delete state.chat.sessionMentions[channelId];
  }
  refreshUI();
};

export const incrementSessionMention = (channelId) => {
  state.chat.sessionMentions[channelId] = (state.chat.sessionMentions[channelId] || 0) + 1;
  refreshUI();
};

export const getUnreadCount = (channelId) => {
  return state.chat.unreadState[channelId]?.unread || 0;
};

export const getSessionMentionCount = (channelId) => {
  return state.chat.sessionMentions[channelId] || 0;
};

export const onRefresh = (callback) => {
  refreshers.add(callback);
};

export const refreshUI = () => {
  refreshers.forEach((cb) => cb());
};
