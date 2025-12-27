import { closeAvatarMenu } from "./avatar.js";
import { elements as el, escapeHtml, hide, show } from "./dom.js";
import { addMessage, getActiveChannelMessages, selectChannel, setChatEnabled, setReplyTarget, state, upsertChannel, setChannelMessages } from "./state.js";

export const initChat = () => {
  // Ensure chat is hidden on init - only show when user explicitly opens it
  hide(el.chatShell);
  hide(el.channelModal);
  wireChatEntryPoints();
  wireChannelModal();
  wireComposer();
};

async function fetchChannels() {
  if (!state.session) return;
  try {
    const res = await fetch("/chat/channels");
    if (!res.ok) return;
    const channels = await res.json();
    channels.forEach((ch) => upsertChannel({
      id: String(ch.id),
      name: ch.name,
      displayName: ch.display_name,
      description: ch.description,
      isPublic: ch.is_public === 1,
    }));
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
  } catch (_err) {
    // Ignore fetch errors
  }
}

function wireChatEntryPoints() {
  el.openChatBtn?.addEventListener("click", async () => {
    if (!state.session) return;
    setChatEnabled(true);
    closeAvatarMenu();
    await fetchChannels();
    if (state.chat.selectedChannelId) {
      await fetchMessages(state.chat.selectedChannelId);
    }
  });
  el.exitChatBtn?.addEventListener("click", () => {
    setChatEnabled(false);
    closeAvatarMenu();
  });
}

function wireChannelModal() {
  const closeModal = () => hide(el.channelModal);
  el.channelModal?.addEventListener("click", (event) => {
    if (event.target === el.channelModal) closeModal();
  });
  el.newChannelTriggers?.forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!state.session) return;
      show(el.channelModal);
    })
  );
  el.closeChannelModalBtns?.forEach((btn) => btn.addEventListener("click", closeModal));
  el.channelForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.session) return;
    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get("name") || "").trim().toLowerCase() || "untitled",
      displayName: String(data.get("displayName") || "").trim() || "Untitled channel",
      description: String(data.get("description") || "").trim(),
      isPublic: data.get("isPublic") === "on",
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
      }
    } catch (_err) {
      // Ignore errors
    }

    hide(el.channelModal);
    event.currentTarget.reset();
  });
}

function wireComposer() {
  el.chatInput?.addEventListener("input", () => {
    const hasText = Boolean(el.chatInput.value.trim());
    if (hasText && state.chat.selectedChannelId) el.chatSendBtn?.removeAttribute("disabled");
    else el.chatSendBtn?.setAttribute("disabled", "disabled");
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
  if (!state.session || !state.chat.enabled) {
    hide(el.chatShell);
    hide(el.channelModal);
    return;
  }
  show(el.chatShell);
  renderChannels();
  renderThreads();
};

function renderChannels() {
  if (!el.chatChannelList) return;
  const channels = state.chat.channels;
  el.chatChannelList.innerHTML = channels
    .map((channel) => {
      const isActive = channel.id === state.chat.selectedChannelId;
      return `<button class="chat-channel${isActive ? " active" : ""}" data-channel-id="${channel.id}">
        <div class="chat-channel-name">#${channel.name}</div>
        <p class="chat-channel-desc">${channel.displayName}</p>
      </button>`;
    })
    .join("");
  el.chatChannelList.querySelectorAll("[data-channel-id]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const channelId = btn.dataset.channelId;
      selectChannel(channelId);
      await fetchMessages(channelId);
    })
  );
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
    .map((message) => renderThread(message, byParent))
    .join("");
  el.chatThreadList.querySelectorAll("[data-reply-id]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.replyId;
      const target = messages.find((m) => m.id === targetId);
      setReplyTarget(target || null);
      show(el.replyTarget);
      if (el.replyTarget && target) {
        el.replyTarget.textContent = `Replying to ${formatNpubShort(target.author)}`;
      }
      el.chatInput?.focus();
    })
  );
}

function renderThread(message, byParent) {
  const replies = byParent.get(message.id) || [];
  const replyMarkup = replies.map((reply) => renderMessage(reply)).join("");
  return `<article class="chat-thread">
    ${renderMessage(message)}
    ${replyMarkup ? `<div class="chat-thread-replies">${replyMarkup}</div>` : ""}
  </article>`;
}

function renderMessage(message) {
  return `<div class="chat-message">
    <div class="chat-message-meta">
      <span class="chat-message-author">${formatNpubShort(message.author)}</span>
      <time>${new Date(message.createdAt).toLocaleTimeString()}</time>
    </div>
    <p class="chat-message-body">${escapeHtml(message.body)}</p>
    <button type="button" class="text-btn" data-reply-id="${message.id}">Reply</button>
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

function formatNpubShort(npub) {
  if (!npub) return "anon";
  const trimmed = npub.replace(/^npub1/, "");
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
