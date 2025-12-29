// Message rendering module
import { escapeHtml } from "./dom.js";

// Dependencies injected via init
let getAuthorDisplayName = () => "Unknown";
let getAuthorAvatarUrl = () => "https://robohash.org/nostr.png?set=set3";
let getContext = () => ({ session: null, isAdmin: false });
let userCache = null;

// Initialize with dependencies from chat.js
export function init(deps) {
  if (deps.getAuthorDisplayName) getAuthorDisplayName = deps.getAuthorDisplayName;
  if (deps.getAuthorAvatarUrl) getAuthorAvatarUrl = deps.getAuthorAvatarUrl;
  if (deps.getContext) getContext = deps.getContext;
  if (deps.userCache) userCache = deps.userCache;
}

// Format timestamp as dd/mm/yy @ hh:mm
export function formatReplyTimestamp(dateStr) {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} @ ${hours}:${minutes}`;
}

// Get icon for file type
export function getFileIcon(ext) {
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

// Parse message body and render mentions, images, and file links
export function renderMessageBody(body) {
  // First escape the whole body
  let html = escapeHtml(body);

  // Match nostr:npub1... patterns (npub is 63 chars after "npub1")
  const mentionRegex = /nostr:(npub1[a-z0-9]{58})/g;

  html = html.replace(mentionRegex, (_match, npub) => {
    const user = userCache?.get(npub);
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

// Render message action menu (copy for all, delete for author or admin)
export function renderMessageMenu(message) {
  const ctx = getContext();
  const canDelete = ctx.session?.npub === message.author || ctx.isAdmin;

  return `<div class="message-menu">
    <button class="message-menu-trigger" data-message-menu="${message.id}" aria-label="Message options">&#8942;</button>
    <div class="message-menu-dropdown" data-message-dropdown="${message.id}" hidden>
      <button class="message-menu-item" data-copy-message="${message.id}">Copy</button>
      ${canDelete ? `<button class="message-menu-item danger" data-delete-message="${message.id}">Delete</button>` : ""}
    </div>
  </div>`;
}

// Render compact message (with optional avatar)
export function renderMessageCompact(message, { showAvatar = false } = {}) {
  const avatarHtml = showAvatar
    ? `<img class="chat-message-avatar" src="${escapeHtml(getAuthorAvatarUrl(message.author))}" alt="" loading="lazy" />`
    : "";
  const menuHtml = renderMessageMenu(message);
  return `<div class="chat-message${showAvatar ? " chat-message-with-avatar" : ""}" data-message-id="${message.id}">
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

// Render full message with avatar
export function renderMessageFull(message) {
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

// Render a reply preview with mini avatar, timestamp, and view thread link
export function renderReplyPreview(reply, replyCount) {
  const avatarUrl = getAuthorAvatarUrl(reply.author);
  const authorName = getAuthorDisplayName(reply.author);
  const timestamp = formatReplyTimestamp(reply.createdAt);
  const moreReplies = replyCount > 1 ? `+${replyCount - 1} more` : "";

  return `<div class="chat-reply">
    <img class="chat-reply-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />
    <div class="chat-reply-content">
      <div class="chat-reply-meta">
        <span class="chat-reply-author">${escapeHtml(authorName)}</span>
        <span class="chat-reply-time">${timestamp}</span>
      </div>
      <p class="chat-message-body">${renderMessageBody(reply.body)}</p>
      <span class="chat-reply-thread-link">${moreReplies ? moreReplies + " · " : ""}... view thread</span>
    </div>
  </div>`;
}

// Render collapsed thread view
export function renderCollapsedThread(message, byParent) {
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
      ` : ""}
    </div>
  </article>`;
}

// Group messages by parent ID
export function groupByParent(messages) {
  const map = new Map();
  messages.forEach((m) => {
    const key = m.parentId || null;
    const bucket = map.get(key) || [];
    bucket.push(m);
    map.set(key, bucket);
  });
  return map;
}
