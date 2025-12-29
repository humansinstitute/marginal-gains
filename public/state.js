const refreshers = new Set();

export const state = {
  session: window.__NOSTR_SESSION__,
  isAdmin: false,
  summaries: { day: null, week: null },
  chat: {
    enabled: false,
    channels: [],
    selectedChannelId: null,
    replyingTo: null,
    messagesByChannel: {},
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

export const upsertChannel = (channel) => {
  const exists = state.chat.channels.find((c) => c.id === channel.id);
  state.chat.channels = exists
    ? state.chat.channels.map((c) => (c.id === channel.id ? channel : c))
    : [...state.chat.channels, channel];
  if (!state.chat.selectedChannelId) state.chat.selectedChannelId = channel.id;
  refreshUI();
};

// Update channels list and clean up messages for removed channels
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

export const onRefresh = (callback) => {
  refreshers.add(callback);
};

export const refreshUI = () => {
  refreshers.forEach((cb) => cb());
};
