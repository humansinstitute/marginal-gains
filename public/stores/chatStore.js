/**
 * Chat store for Alpine.js
 * Manages reactive state for chat UI with Dexie persistence
 *
 * IMPORTANT: This is NOT an ES module - it must load synchronously before Alpine.js
 * to ensure createChatStore is available when Alpine parses x-data attributes.
 */

/**
 * Chat store factory - creates Alpine reactive store
 * @param {Object} initialData - Server-provided initial state
 * @returns {Object} Alpine reactive store
 */
window.createChatStore = function (initialData) {
  // Pre-process initial data
  var channels = (initialData.channels || []).map(function (ch) {
    return { ...ch, id: String(ch.id) };
  });
  var dmChannels = (initialData.dmChannels || []).map(function (ch) {
    return { ...ch, id: String(ch.id) };
  });

  console.log(
    "[ChatStore] Creating store with",
    channels.length,
    "channels,",
    dmChannels.length,
    "DM channels"
  );

  return {
    // ========== Channel State ==========
    channels: channels,
    dmChannels: dmChannels,
    personalChannel: initialData.personalChannel || null,
    selectedChannelId: initialData.selectedChannelId
      ? String(initialData.selectedChannelId)
      : null,

    // ========== Channel Layout (Sections) ==========
    channelLayout: null, // { sections: [{ id, name, channelIds }] }
    arrangeMode: false,
    _editLayout: null, // working copy during arrange mode

    // ========== Message State (Windowed) ==========
    messages: [], // Currently visible messages (windowed)
    messageCount: 0, // Total messages in channel
    windowStart: 0, // First visible message index
    windowSize: 50, // Messages to render at once
    bufferSize: 20, // Extra messages to preload

    // Grouped messages for thread display
    threadMap: new Map(), // parentId -> [replies]
    rootMessages: [], // Messages with no parent (thread roots)

    // ========== Thread Panel State ==========
    openThreadId: null,
    threadMessages: [],
    threadRoot: null,

    // ========== UI State ==========
    loading: false,
    syncing: false,
    error: null,
    isNearBottom: true,
    hasNewMessages: false,

    // ========== Connection State ==========
    connectionState: "disconnected",

    // ========== Unread Tracking ==========
    unreadCounts: initialData.unreadCounts || {},
    mentionCounts: initialData.mentionCounts || {},

    // ========== Pinned Messages ==========
    pinnedMessageIds: new Set(),

    // ========== Dependencies (injected after init) ==========
    _deps: {
      getAuthorDisplayName: function (npub) {
        return npub ? npub.slice(0, 8) + "..." : "Unknown";
      },
      getAuthorAvatarUrl: function (npub) {
        return "https://robohash.org/" + (npub || "nostr") + ".png?set=set3";
      },
      escapeHtml: function (str) {
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      },
      formatTimestamp: function (ts) {
        return new Date(ts).toLocaleTimeString();
      },
      renderMessageBody: function (body) {
        return body;
      },
      currentUserNpub: null,
      isAdmin: false,
      canPin: false,
    },

    // ========== Lifecycle ==========
    init: function () {
      console.log("[ChatStore] Initializing...");

      // Setup scroll handler for windowing
      this.setupScrollHandler();

      // Load initial channel if set
      if (this.selectedChannelId) {
        this.loadMessages();
      }

      console.log("[ChatStore] Initialized");
    },

    /**
     * Inject dependencies from chat.js
     */
    setDependencies: function (deps) {
      if (deps.getAuthorDisplayName)
        this._deps.getAuthorDisplayName = deps.getAuthorDisplayName;
      if (deps.getAuthorAvatarUrl)
        this._deps.getAuthorAvatarUrl = deps.getAuthorAvatarUrl;
      if (deps.escapeHtml) this._deps.escapeHtml = deps.escapeHtml;
      if (deps.formatTimestamp) this._deps.formatTimestamp = deps.formatTimestamp;
      if (deps.renderMessageBody)
        this._deps.renderMessageBody = deps.renderMessageBody;
      if (deps.currentUserNpub !== undefined)
        this._deps.currentUserNpub = deps.currentUserNpub;
      if (deps.isAdmin !== undefined) this._deps.isAdmin = deps.isAdmin;
      if (deps.canPin !== undefined) this._deps.canPin = deps.canPin;
      if (deps.getDmDisplayName)
        this._deps.getDmDisplayName = deps.getDmDisplayName;
      if (deps.onChannelSelect)
        this._deps.onChannelSelect = deps.onChannelSelect;
    },

    // ========== Channel Methods ==========

    /**
     * Select a channel and load its messages
     */
    selectChannel: async function (channelId) {
      var id = String(channelId);
      if (this.selectedChannelId === id) return;

      console.log("[ChatStore] Selecting channel:", id);
      this.selectedChannelId = id;
      this.loading = true;
      this.error = null;
      this.hasNewMessages = false;
      this.windowStart = 0;

      // Clear thread panel when changing channels
      this.closeThread();

      await this.loadMessages();
      this.loading = false;
    },

    /**
     * Get a channel by ID
     */
    getChannelById: function (channelId) {
      var id = String(channelId);
      var found = this.channels.find(function (c) {
        return c.id === id;
      });
      if (found) return found;

      found = this.dmChannels.find(function (c) {
        return c.id === id;
      });
      if (found) return found;

      if (this.personalChannel && this.personalChannel.id === id) {
        return this.personalChannel;
      }
      return null;
    },

    /**
     * Get the currently selected channel
     */
    getSelectedChannel: function () {
      return this.getChannelById(this.selectedChannelId);
    },

    /**
     * Update channels list
     */
    updateChannels: function (channels, type) {
      var self = this;
      var mapped = channels.map(function (ch) {
        return { ...ch, id: String(ch.id) };
      });

      if (type === "dm") {
        self.dmChannels = mapped;
      } else if (type === "personal") {
        self.personalChannel = mapped[0] || null;
      } else {
        self.channels = mapped;
      }
    },

    // ========== Channel Layout Methods ==========

    /**
     * Set layout from server response
     */
    setChannelLayout: function (layout) {
      this.channelLayout = layout || null;
    },

    /**
     * Get sections for display. Returns array of { id, name, channels[] }.
     * Uses _editLayout during arrange mode, channelLayout otherwise.
     */
    getChannelSections: function () {
      var layout = this.arrangeMode ? this._editLayout : this.channelLayout;
      if (!layout || !layout.sections || layout.sections.length === 0) return [];
      var self = this;
      return layout.sections.map(function (section) {
        var sectionChannels = [];
        (section.channelIds || []).forEach(function (cid) {
          var ch = self.channels.find(function (c) {
            return c.id === String(cid);
          });
          if (ch) sectionChannels.push(ch);
        });
        return { id: section.id, name: section.name, channels: sectionChannels };
      });
    },

    /**
     * Get channels not in any section (shown at top as "Ungrouped"),
     * ordered by channelOrder if available.
     */
    getUngroupedChannels: function () {
      var layout = this.arrangeMode ? this._editLayout : this.channelLayout;
      // Collect IDs placed in sections
      var placed = new Set();
      if (layout && layout.sections) {
        layout.sections.forEach(function (s) {
          (s.channelIds || []).forEach(function (cid) {
            placed.add(String(cid));
          });
        });
      }
      var ungrouped = this.channels.filter(function (ch) {
        return !placed.has(ch.id);
      });
      // Sort by channelOrder if available
      if (layout && layout.channelOrder && layout.channelOrder.length > 0) {
        var orderMap = {};
        layout.channelOrder.forEach(function (id, idx) {
          orderMap[String(id)] = idx;
        });
        ungrouped.sort(function (a, b) {
          var ai = orderMap[a.id] !== undefined ? orderMap[a.id] : 99999;
          var bi = orderMap[b.id] !== undefined ? orderMap[b.id] : 99999;
          return ai - bi;
        });
      }
      return ungrouped;
    },

    /**
     * Check if layout has any sections
     */
    hasLayout: function () {
      var layout = this.arrangeMode ? this._editLayout : this.channelLayout;
      return layout && layout.sections && layout.sections.length > 0;
    },

    /**
     * Enter arrange mode (admin only)
     */
    enterArrangeMode: function () {
      this.arrangeMode = true;
      this._editLayout = this.channelLayout
        ? JSON.parse(JSON.stringify(this.channelLayout))
        : { sections: [] };
      // Initialize channelOrder from current ungrouped channel order if not set
      if (!this._editLayout.channelOrder) {
        var placed = new Set();
        (this._editLayout.sections || []).forEach(function (s) {
          (s.channelIds || []).forEach(function (cid) { placed.add(String(cid)); });
        });
        this._editLayout.channelOrder = this.channels
          .filter(function (ch) { return !placed.has(ch.id); })
          .map(function (ch) { return Number(ch.id); });
      }
    },

    /**
     * Cancel arrange mode without saving
     */
    cancelArrangeMode: function () {
      this.arrangeMode = false;
      this._editLayout = null;
    },

    /**
     * Add a new section during arrange mode
     */
    addSection: function (name) {
      if (!this._editLayout) return;
      this._editLayout.sections.push({
        id: "s" + Date.now(),
        name: name || "New Section",
        channelIds: [],
      });
    },

    /**
     * Rename a section during arrange mode
     */
    renameSection: function (sectionId, newName) {
      if (!this._editLayout) return;
      var section = this._editLayout.sections.find(function (s) {
        return s.id === sectionId;
      });
      if (section) section.name = newName;
    },

    /**
     * Remove a section during arrange mode (channels go back to ungrouped)
     */
    removeSection: function (sectionId) {
      if (!this._editLayout) return;
      this._editLayout.sections = this._editLayout.sections.filter(function (s) {
        return s.id !== sectionId;
      });
    },

    /**
     * Move a channel into a section at a given position during arrange mode
     */
    moveChannelToSection: function (channelId, sectionId, position) {
      if (!this._editLayout) return;
      var cid = Number(channelId);
      // Remove from all sections first
      this._editLayout.sections.forEach(function (s) {
        s.channelIds = s.channelIds.filter(function (id) {
          return id !== cid;
        });
      });
      // Remove from channelOrder
      if (this._editLayout.channelOrder) {
        this._editLayout.channelOrder = this._editLayout.channelOrder.filter(function (id) {
          return id !== cid;
        });
      }
      // Handle ungrouped drop
      if (sectionId === "__ungrouped__" || sectionId === "ungrouped") {
        if (!this._editLayout.channelOrder) this._editLayout.channelOrder = [];
        if (typeof position === "number") {
          this._editLayout.channelOrder.splice(position, 0, cid);
        } else {
          this._editLayout.channelOrder.push(cid);
        }
        return;
      }
      var target = this._editLayout.sections.find(function (s) {
        return s.id === sectionId;
      });
      if (!target) return;
      if (typeof position === "number") {
        target.channelIds.splice(position, 0, cid);
      } else {
        target.channelIds.push(cid);
      }
    },

    /**
     * Move a section to a new position during arrange mode
     */
    moveSectionTo: function (sectionId, newIndex) {
      if (!this._editLayout) return;
      var sections = this._editLayout.sections;
      var idx = sections.findIndex(function (s) { return s.id === sectionId; });
      if (idx < 0) return;
      var removed = sections.splice(idx, 1)[0];
      sections.splice(newIndex, 0, removed);
    },

    /**
     * Save arrangement - calls the PUT endpoint. Returns a promise.
     */
    saveArrangement: function () {
      var self = this;
      if (!self._editLayout) return Promise.resolve();
      var teamSlug = window.__TEAM_SLUG__;
      if (!teamSlug) return Promise.resolve();
      return fetch("/t/" + teamSlug + "/api/channel-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sections: self._editLayout.sections,
          channelOrder: self._editLayout.channelOrder || [],
        }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.layout) {
            self.channelLayout = data.layout;
          }
          self.arrangeMode = false;
          self._editLayout = null;
        })
        .catch(function (err) {
          console.error("[ChatStore] Failed to save layout:", err);
        });
    },

    // ========== Message Methods ==========

    /**
     * Load messages for the selected channel
     */
    loadMessages: async function () {
      if (!this.selectedChannelId) return;

      // This will be called by chatSync after hydrating from Dexie
      // For now, just prepare the state
      this.messages = [];
      this.threadMap = new Map();
      this.rootMessages = [];
      this.messageCount = 0;
    },

    /**
     * Set messages for display (called by sync service after fetching)
     */
    setMessages: function (messages) {
      var self = this;

      // Store all messages
      self.messages = messages;
      self.messageCount = messages.length;

      // Group by parent for thread display
      self.threadMap = new Map();
      self.rootMessages = [];

      messages.forEach(function (m) {
        if (m.parentId) {
          var bucket = self.threadMap.get(m.parentId) || [];
          bucket.push(m);
          self.threadMap.set(m.parentId, bucket);
        } else {
          self.rootMessages.push(m);
        }
      });

      console.log(
        "[ChatStore] Set",
        messages.length,
        "messages,",
        self.rootMessages.length,
        "threads"
      );

      // Auto-scroll if near bottom
      if (self.isNearBottom) {
        self.$nextTick(function () {
          self.scrollToBottom();
        });
      }
    },

    /**
     * Add a new message (from SSE or send)
     */
    onMessageAdded: function (message) {
      var self = this;
      var msg = { ...message, id: String(message.id) };

      // Add to messages array
      self.messages.push(msg);
      self.messageCount++;

      // Update thread grouping
      if (msg.parentId) {
        var bucket = self.threadMap.get(msg.parentId) || [];
        bucket.push(msg);
        self.threadMap.set(msg.parentId, bucket);

        // Update thread panel if open
        if (self.openThreadId === msg.parentId) {
          self.threadMessages.push(msg);
        }
      } else {
        self.rootMessages.push(msg);
      }

      // Handle scroll and new message indicator
      if (self.isNearBottom) {
        self.$nextTick(function () {
          self.scrollToBottom();
        });
      } else {
        self.hasNewMessages = true;
      }
    },

    /**
     * Remove a message
     */
    onMessageDeleted: function (messageId) {
      var self = this;
      var id = String(messageId);

      // Remove from messages array
      self.messages = self.messages.filter(function (m) {
        return m.id !== id;
      });
      self.messageCount = self.messages.length;

      // Remove from root messages
      self.rootMessages = self.rootMessages.filter(function (m) {
        return m.id !== id;
      });

      // Remove from thread replies
      self.threadMap.forEach(function (replies, parentId) {
        var filtered = replies.filter(function (m) {
          return m.id !== id;
        });
        if (filtered.length !== replies.length) {
          self.threadMap.set(parentId, filtered);
        }
      });

      // Update thread panel if open
      if (self.openThreadId) {
        self.threadMessages = self.threadMessages.filter(function (m) {
          return m.id !== id;
        });
      }
    },

    /**
     * Update message reactions
     */
    onMessageReaction: function (messageId, reactions) {
      var id = String(messageId);
      var msg = this.messages.find(function (m) {
        return m.id === id;
      });
      if (msg) {
        msg.reactions = reactions;
      }
    },

    // ========== Windowing Methods ==========

    /**
     * Get visible threads for rendering
     */
    getVisibleThreads: function () {
      // For now, return all root messages
      // TODO: Implement windowing based on scroll position
      return this.rootMessages;
    },

    /**
     * Get replies for a thread root message
     */
    getRepliesForThread: function (messageId) {
      return this.threadMap.get(String(messageId)) || [];
    },

    /**
     * Get last reply for a thread
     */
    getLastReply: function (messageId) {
      var replies = this.getRepliesForThread(messageId);
      return replies.length > 0 ? replies[replies.length - 1] : null;
    },

    /**
     * Get reply count for a thread
     */
    getReplyCount: function (messageId) {
      return this.getRepliesForThread(messageId).length;
    },

    /**
     * Update window based on scroll position
     */
    updateWindow: function (container) {
      if (!container) return;

      var scrollTop = container.scrollTop;
      var scrollHeight = container.scrollHeight;
      var clientHeight = container.clientHeight;

      // Check if near bottom (within 100px)
      this.isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;

      // TODO: Implement virtual scrolling for large message lists
      // For now, we render all messages and rely on the browser
    },

    /**
     * Setup scroll handler for the message list
     */
    setupScrollHandler: function () {
      var self = this;
      var container = document.querySelector("[data-thread-list]");
      if (!container) return;

      var ticking = false;
      container.addEventListener(
        "scroll",
        function () {
          if (!ticking) {
            requestAnimationFrame(function () {
              self.updateWindow(container);
              ticking = false;
            });
            ticking = true;
          }
        },
        { passive: true }
      );
    },

    /**
     * Scroll to bottom of message list
     */
    scrollToBottom: function () {
      var container = document.querySelector("[data-thread-list]");
      if (container) {
        container.scrollTop = container.scrollHeight;
        this.hasNewMessages = false;
      }
    },

    /**
     * Handle click on new messages indicator
     */
    onNewMessagesClick: function () {
      this.scrollToBottom();
    },

    // ========== Thread Panel Methods ==========

    /**
     * Open thread panel for a message
     */
    openThread: function (messageId) {
      var id = String(messageId);
      console.log("[ChatStore] Opening thread:", id);

      // Find the root message
      var root = this.messages.find(function (m) {
        return m.id === id;
      });
      if (!root) return;

      this.openThreadId = id;
      this.threadRoot = root;
      this.threadMessages = this.getRepliesForThread(id);
    },

    /**
     * Close thread panel
     */
    closeThread: function () {
      this.openThreadId = null;
      this.threadRoot = null;
      this.threadMessages = [];
    },

    /**
     * Check if thread panel is open
     */
    isThreadOpen: function () {
      return this.openThreadId !== null;
    },

    // ========== Unread Methods ==========

    /**
     * Increment unread count for a channel
     */
    incrementUnread: function (channelId) {
      var id = String(channelId);
      this.unreadCounts[id] = (this.unreadCounts[id] || 0) + 1;
    },

    /**
     * Clear unread count for a channel
     */
    clearUnread: function (channelId) {
      var id = String(channelId);
      this.unreadCounts[id] = 0;
    },

    /**
     * Get unread count for a channel
     */
    getUnreadCount: function (channelId) {
      return this.unreadCounts[String(channelId)] || 0;
    },

    /**
     * Check if channel has unread messages (and is not active)
     */
    hasUnread: function (channelId) {
      var id = String(channelId);
      return this.getUnreadCount(id) > 0 && !this.isChannelActive(id);
    },

    /**
     * Increment mention count for a channel
     */
    incrementMention: function (channelId) {
      var id = String(channelId);
      this.mentionCounts[id] = (this.mentionCounts[id] || 0) + 1;
    },

    /**
     * Get mention count for a channel
     */
    getMentionCount: function (channelId) {
      return this.mentionCounts[String(channelId)] || 0;
    },

    // ========== Channel Sidebar Methods ==========

    /**
     * Check if a channel is currently active/selected
     */
    isChannelActive: function (channelId) {
      return this.selectedChannelId === String(channelId);
    },

    /**
     * Get display name for a DM channel
     */
    getDmDisplayName: function (dm) {
      if (!dm || !dm.otherNpub) return "DM";
      // Check if we have a cached user name via deps
      if (this._deps.getDmDisplayName) {
        return this._deps.getDmDisplayName(dm);
      }
      // Fallback to short npub
      var trimmed = dm.otherNpub.replace(/^npub1/, "");
      return trimmed.slice(0, 4) + "…" + trimmed.slice(-4);
    },

    /**
     * Handle channel click - called from Alpine template
     */
    onChannelClick: function (channelId) {
      var self = this;
      var id = String(channelId);

      // Update local state immediately
      self.selectedChannelId = id;
      self.loading = true;
      self.messages = [];
      self.rootMessages = [];
      self.hasNewMessages = false;
      self.closeThread();

      // Clear unread for this channel
      self.clearUnread(id);

      // Notify chat.js to handle the rest (fetch messages, update URL, etc.)
      if (self._deps.onChannelSelect) {
        self._deps.onChannelSelect(id);
      }
    },

    // ========== Pinned Messages ==========

    /**
     * Set pinned message IDs
     */
    setPinnedMessages: function (messageIds) {
      this.pinnedMessageIds = new Set(
        messageIds.map(function (id) {
          return String(id);
        })
      );
    },

    /**
     * Check if a message is pinned
     */
    isPinned: function (messageId) {
      return this.pinnedMessageIds.has(String(messageId));
    },

    // ========== Connection State ==========

    /**
     * Update connection state
     */
    setConnectionState: function (state) {
      this.connectionState = state;
    },

    // ========== Rendering Helpers ==========

    /**
     * Get author display name
     */
    getAuthorName: function (npub) {
      return this._deps.getAuthorDisplayName(npub);
    },

    /**
     * Get author avatar URL
     */
    getAvatarUrl: function (npub) {
      return this._deps.getAuthorAvatarUrl(npub);
    },

    /**
     * Format timestamp for display
     */
    formatTime: function (timestamp) {
      return this._deps.formatTimestamp(timestamp);
    },

    /**
     * Render message body with mentions, links, etc.
     */
    renderBody: function (body) {
      return this._deps.renderMessageBody(body);
    },

    /**
     * Escape HTML
     */
    escape: function (str) {
      return this._deps.escapeHtml(str);
    },

    // ========== Permission Helpers ==========

    /**
     * Check if current user can delete a message
     */
    canDeleteMessage: function (authorNpub) {
      return (
        this._deps.currentUserNpub === authorNpub || this._deps.isAdmin
      );
    },

    /**
     * Check if current user can pin messages
     */
    canPinMessage: function () {
      return this._deps.canPin || false;
    },

    /**
     * Check if current user has reacted with this reaction
     */
    hasUserReacted: function (reaction) {
      if (!reaction || !reaction.reactors) return false;
      return reaction.reactors.includes(this._deps.currentUserNpub);
    },
  };
};
