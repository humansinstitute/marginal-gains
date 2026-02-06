import { getAppName, getFaviconUrl } from "../routes/app-settings";

import { renderAppMenu, renderKeyTeleportSetupModal, renderPinModal, renderUnlockCodeModal } from "./components";

import type { TeamBranding } from "../routes/app-settings";
import type { DeepLink, Session } from "../types";

export function renderChatPage(
  session: Session | null,
  deepLink?: DeepLink,
  needsOnboarding = false,
  teamSlug?: string,
  branding?: TeamBranding
) {
  const bodyClass = needsOnboarding ? "chat-page onboarding-mode" : "chat-page";
  return `<!doctype html>
<html lang="en">
${renderHead(branding)}
<body class="${bodyClass}">
  <main class="chat-app-shell">
    ${renderChatHeader(session, needsOnboarding, branding)}
    ${!session ? renderAuthRequired() : needsOnboarding ? renderOnboardingLobby() : renderChatContent()}
  </main>
  ${renderSessionSeed(session, deepLink, needsOnboarding, teamSlug)}
  <script type="module" src="/app.js?v=3"></script>
</body>
</html>`;
}

function renderHead(branding?: TeamBranding) {
  const appName = branding?.name || getAppName();
  const faviconUrl = branding?.iconUrl || getFaviconUrl() || "/favicon.png";
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
  <title>Chat - ${appName}</title>
  <meta name="theme-color" content="#6b3a6b" />
  <meta name="application-name" content="${appName}" />
  <link rel="icon" type="image/png" href="${faviconUrl}" />
  <link rel="apple-touch-icon" href="${faviconUrl}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css?v=3" />
  <script defer src="/lib/alpine.min.js"></script>
  <script src="/stores/chatStore.js"></script>
</head>`;
}

function renderChatHeader(session: Session | null, needsOnboarding = false, branding?: TeamBranding) {
  const appName = branding?.name || getAppName();
  const faviconUrl = branding?.iconUrl || getFaviconUrl() || "/favicon.png";
  // Hide menu during onboarding - user can only enter invite code or log out
  if (needsOnboarding) {
    return `<header class="chat-page-header">
      <div class="header-left">
        <img src="${faviconUrl}" alt="" class="app-logo" />
        <h1 class="app-title">${appName}</h1>
      </div>
      <div class="header-right">
        ${session ? renderOnboardingAvatarMenu(session) : ""}
      </div>
    </header>`;
  }

  return `<header class="chat-page-header">
    <div class="header-left">
      <button class="hamburger-btn" type="button" data-hamburger-toggle aria-label="Menu">
        <span class="hamburger-icon"></span>
      </button>
      <img src="${faviconUrl}" alt="" class="app-logo" />
      <h1 class="app-title">${appName}</h1>
    </div>
    <div class="header-right">
      ${session ? renderAvatarMenu(session) : ""}
    </div>
    ${renderAppMenu(session, "chat")}
  </header>`;
}

function renderOnboardingAvatarMenu(session: Session) {
  return `<div class="session-controls" data-session-controls>
    <button class="avatar-chip" type="button" data-avatar title="Account menu">
      <span class="avatar-fallback" data-avatar-fallback>${formatAvatarFallback(session.npub)}</span>
      <img data-avatar-img alt="Profile photo" loading="lazy" hidden />
    </button>
    <div class="avatar-menu" data-avatar-menu hidden>
      <button type="button" data-logout>Log out</button>
    </div>
  </div>`;
}

function renderAvatarMenu(session: Session) {
  return `<div class="session-controls" data-session-controls>
    <button class="avatar-chip" type="button" data-avatar title="Account menu">
      <span class="avatar-fallback" data-avatar-fallback>${formatAvatarFallback(session.npub)}</span>
      <img data-avatar-img alt="Profile photo" loading="lazy" hidden />
    </button>
    <div class="avatar-menu" data-avatar-menu hidden>
      <button type="button" data-view-profile>View Profile</button>
      <button type="button" data-export-secret ${session.method === "ephemeral" ? "" : "hidden"}>Export Secret</button>
      <button type="button" data-show-login-qr ${session.method === "ephemeral" ? "" : "hidden"}>Show Login QR</button>
      <button type="button" data-copy-id>Copy ID</button>
      <a href="/wallet" class="avatar-menu-link">Wallet</a>
      <button type="button" data-logout>Log out</button>
    </div>
  </div>`;
}

function renderChatContent() {
  return `<section class="chat-shell chat-shell-page" data-chat-shell x-data="createChatStore(window.__CHAT_INIT__ || {})" x-init="init()">
    <div class="chat-layout" data-chat-layout data-mobile-view="channels">
      <aside class="chat-channels-sidebar">
        <div class="chat-section-header">
          <h3>Channels</h3>
          <button type="button" class="text-btn" data-new-channel-trigger>+ New</button>
        </div>
        <div class="chat-list" data-channel-list>
          <template x-for="channel in channels" :key="channel.id">
            <button class="chat-channel"
              :class="{ 'active': isChannelActive(channel.id), 'unread': hasUnread(channel.id) }"
              :data-channel-id="channel.id"
              :title="channel.displayName || channel.name"
              @click="onChannelClick(channel.id)">
              <div class="chat-channel-name">
                <span x-text="'#' + channel.name"></span>
                <span x-show="channel.encrypted" class="channel-encrypted" title="E2E Encrypted">&#128737;</span>
                <span x-show="!channel.encrypted && !channel.isPublic" class="channel-lock" title="Private">&#128274;</span>
                <img x-show="channel.hasWingmanAccess" src="/wingman-icon.png" class="channel-wingman-icon" title="Wingman has access" alt="Wingman" />
                <span x-show="getMentionCount(channel.id) > 0 && !isChannelActive(channel.id)"
                  class="unread-badge mention"
                  x-text="'(' + (getMentionCount(channel.id) > 99 ? '99+' : getMentionCount(channel.id)) + ')'"></span>
              </div>
            </button>
          </template>
        </div>
        <div class="chat-section-header dm-section-header">
          <h3>Direct Messages</h3>
          <button type="button" class="text-btn" data-new-dm-trigger>+ New</button>
        </div>
        <div class="chat-list" data-dm-list>
          <template x-if="dmChannels.length === 0">
            <p class="dm-empty">No conversations yet</p>
          </template>
          <template x-for="dm in dmChannels" :key="dm.id">
            <button class="chat-channel dm-channel"
              :class="{ 'active': isChannelActive(dm.id), 'unread': hasUnread(dm.id) }"
              :data-channel-id="dm.id"
              @click="onChannelClick(dm.id)">
              <img class="dm-avatar clickable-avatar" :src="getAvatarUrl(dm.otherNpub)" :data-profile-npub="dm.otherNpub" alt="" loading="lazy" />
              <div class="dm-info">
                <div class="chat-channel-name">
                  <span x-text="getDmDisplayName(dm)"></span>
                  <span x-show="hasUnread(dm.id)"
                    class="unread-badge"
                    x-text="'(' + (getUnreadCount(dm.id) > 99 ? '99+' : getUnreadCount(dm.id)) + ')'"></span>
                </div>
              </div>
            </button>
          </template>
        </div>
        <div class="chat-personal-section" data-personal-section>
          <template x-if="personalChannel">
            <div>
              <div class="channel-divider"></div>
              <button class="chat-channel channel-personal"
                :class="{ 'active': isChannelActive(personalChannel.id) }"
                :data-channel-id="personalChannel.id"
                @click="onChannelClick(personalChannel.id)">
                <div class="chat-channel-name">
                  <span class="channel-note-icon" title="Personal notes">&#128221;</span>
                  <span x-text="personalChannel.displayName || 'Notes'"></span>
                </div>
                <p class="chat-channel-desc">Your private notes</p>
              </button>
            </div>
          </template>
        </div>
      </aside>
      <section class="chat-messages-area">
        <header class="chat-messages-header">
          <button type="button" class="chat-back-btn" data-back-to-channels>Channels</button>
          <div class="chat-channel-chip" data-active-channel>Pick a channel</div>
          <button type="button" class="channel-pinned-btn" data-channel-pinned hidden title="Pinned messages">&#128204;</button>
          <button type="button" class="channel-hang-btn" data-channel-hang hidden title="Start a hang">&#128222;</button>
          <button type="button" class="channel-settings-btn" data-channel-settings hidden title="Channel settings">&#9881;</button>
        </header>
        <div class="chat-threads" data-thread-list @scroll.passive="updateWindow($event.target)">
          <!-- Placeholder when no channel selected -->
          <template x-if="!selectedChannelId">
            <p class="chat-placeholder">Pick or create a channel to start chatting.</p>
          </template>

          <!-- Loading state -->
          <template x-if="selectedChannelId && loading">
            <p class="chat-placeholder">Loading messages...</p>
          </template>

          <!-- Empty state -->
          <template x-if="selectedChannelId && !loading && rootMessages.length === 0">
            <p class="chat-placeholder">No messages yet. Start the conversation!</p>
          </template>

          <!-- Message threads -->
          <template x-for="thread in getVisibleThreads()" :key="thread.id">
            <article class="chat-thread" :data-thread-id="thread.id">
              <div class="chat-thread-collapsed">
                <div class="chat-thread-first">
                  <div class="chat-message chat-message-with-avatar" :data-message-id="thread.id">
                    <img class="chat-message-avatar clickable-avatar" :src="getAvatarUrl(thread.author)" :data-profile-npub="thread.author" alt="" loading="lazy" />
                    <div class="chat-message-content">
                      <div class="chat-message-meta">
                        <span class="chat-message-author" x-text="getAuthorName(thread.author)"></span>
                        <time x-text="formatTime(thread.createdAt)"></time>
                      </div>
                      <p class="chat-message-body" x-html="renderBody(thread.body)"></p>
                      <!-- Reaction pills -->
                      <div class="message-reactions" x-show="thread.reactions && thread.reactions.length > 0">
                        <template x-for="reaction in (thread.reactions || [])" :key="reaction.emoji">
                          <button type="button"
                            class="reaction-pill"
                            :class="{ 'reacted': hasUserReacted(reaction) }"
                            :data-message-id="thread.id"
                            :data-emoji="reaction.emoji"
                            :title="reaction.reactors?.map(n => n.slice(0,12) + '...').join(', ')"
                            x-text="reaction.emoji + ' ' + reaction.count">
                          </button>
                        </template>
                      </div>
                      <!-- Message menu -->
                      <div class="message-menu">
                        <button class="message-menu-trigger" :data-message-menu="thread.id" aria-label="Message options">&#8942;</button>
                        <div class="message-menu-dropdown" :data-message-dropdown="thread.id" hidden>
                          <button class="message-menu-item" :data-copy-message="thread.id">Copy message text</button>
                          <button class="message-menu-item" :data-copy-thread="thread.id">Copy entire thread</button>
                          <button class="message-menu-item" :data-link-thread-to-task="thread.id">Link thread to task</button>
                          <template x-if="canPinMessage()">
                            <button class="message-menu-item"
                              x-show="!isPinned(thread.id)"
                              :data-pin-message="thread.id">Pin message</button>
                          </template>
                          <template x-if="canPinMessage()">
                            <button class="message-menu-item"
                              x-show="isPinned(thread.id)"
                              :data-unpin-message="thread.id">Unpin message</button>
                          </template>
                          <template x-if="canDeleteMessage(thread.author)">
                            <button class="message-menu-item danger" :data-delete-message="thread.id">Delete</button>
                          </template>
                        </div>
                      </div>
                    </div>
                    <!-- Quick react bar -->
                    <div class="quick-react-bar" :data-message-id="thread.id">
                      <button type="button" class="quick-react-btn" data-emoji="👍">👍</button>
                      <button type="button" class="quick-react-btn" data-emoji="❤️">❤️</button>
                      <button type="button" class="quick-react-btn" data-emoji="😂">😂</button>
                      <button type="button" class="quick-react-btn" data-emoji="🎉">🎉</button>
                      <button type="button" class="quick-react-btn" data-emoji="👀">👀</button>
                      <button type="button" class="quick-react-btn" data-emoji="🙏">🙏</button>
                      <button type="button" class="quick-react-btn add-reaction-btn" title="More reactions">+</button>
                    </div>
                  </div>
                </div>
                <!-- Reply preview -->
                <template x-if="getReplyCount(thread.id) > 0">
                  <div class="chat-reply" data-open-thread>
                    <img class="chat-reply-avatar clickable-avatar" :src="getAvatarUrl(getLastReply(thread.id)?.author)" :data-profile-npub="getLastReply(thread.id)?.author" alt="" loading="lazy" />
                    <div class="chat-reply-content">
                      <div class="chat-reply-meta">
                        <span class="chat-reply-author" x-text="getAuthorName(getLastReply(thread.id)?.author)"></span>
                        <span class="chat-reply-time" x-text="formatTime(getLastReply(thread.id)?.createdAt)"></span>
                      </div>
                      <p class="chat-message-body" x-html="renderBody(getLastReply(thread.id)?.body || '')"></p>
                      <span class="chat-reply-thread-link">
                        <span x-show="getReplyCount(thread.id) > 1" x-text="'+' + (getReplyCount(thread.id) - 1) + ' more · '"></span>
                        ... view thread
                      </span>
                    </div>
                  </div>
                </template>
                <!-- Reply prompt when no replies -->
                <template x-if="getReplyCount(thread.id) === 0">
                  <div class="chat-reply chat-reply-prompt" data-open-thread>
                    <div class="chat-reply-content">
                      <div class="chat-reply-input-placeholder">Send a reply...</div>
                    </div>
                  </div>
                </template>
              </div>
            </article>
          </template>

          <!-- New messages indicator -->
          <div class="new-message-indicator" x-show="hasNewMessages" @click="onNewMessagesClick()" x-cloak>
            New messages below ↓
          </div>
        </div>
        <div class="chat-composer">
          <div class="mention-popup" data-mention-popup hidden></div>
          <div class="chat-composer-row">
            <textarea class="chat-input" placeholder="Share an update, @name to mention" data-chat-input rows="2"></textarea>
            <div class="chat-composer-buttons">
              <button type="button" class="chat-attach-btn" data-attach-file title="Attach file">&#128206;</button>
              <input type="file" data-file-input hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" />
              <button type="button" class="chat-send-btn primary" data-send-chat disabled>Send</button>
            </div>
          </div>
        </div>
      </section>
      <aside class="chat-thread-panel" data-thread-panel :hidden="!isThreadOpen()">
        <header class="chat-thread-panel-header">
          <button type="button" class="chat-back-btn" data-back-to-messages @click="closeThread()">Back</button>
          <h3>Thread</h3>
          <div class="chat-thread-header-actions">
            <button type="button" class="chat-thread-tasks-btn" data-view-thread-tasks hidden title="View linked tasks">&#9745;</button>
            <button type="button" class="chat-thread-hang-btn" data-thread-hang title="Start a hang">&#128222;</button>
            <button type="button" class="chat-thread-expand" data-expand-thread title="Expand thread">|&larr;</button>
            <button type="button" class="chat-thread-expand" data-collapse-thread hidden title="Collapse thread">&rarr;|</button>
            <button type="button" class="chat-thread-close" data-close-thread @click="closeThread()">&times;</button>
          </div>
        </header>
        <div class="chat-thread-panel-messages" data-thread-messages>
          <!-- Thread root message -->
          <template x-if="threadRoot">
            <div class="chat-message chat-message-with-avatar thread-root-message" :data-message-id="threadRoot.id">
              <img class="chat-message-avatar clickable-avatar" :src="getAvatarUrl(threadRoot.author)" :data-profile-npub="threadRoot.author" alt="" loading="lazy" />
              <div class="chat-message-content">
                <div class="chat-message-meta">
                  <span class="chat-message-author" x-text="getAuthorName(threadRoot.author)"></span>
                  <time x-text="formatTime(threadRoot.createdAt)"></time>
                </div>
                <p class="chat-message-body" x-html="renderBody(threadRoot.body)"></p>
                <!-- Reaction pills for thread root -->
                <div class="message-reactions" x-show="threadRoot.reactions && threadRoot.reactions.length > 0">
                  <template x-for="reaction in (threadRoot.reactions || [])" :key="reaction.emoji">
                    <button type="button"
                      class="reaction-pill"
                      :class="{ 'reacted': hasUserReacted(reaction) }"
                      :data-message-id="threadRoot.id"
                      :data-emoji="reaction.emoji"
                      x-text="reaction.emoji + ' ' + reaction.count">
                    </button>
                  </template>
                </div>
                <!-- Message menu for thread root -->
                <div class="message-menu">
                  <button class="message-menu-trigger" :data-message-menu="threadRoot.id" aria-label="Message options">&#8942;</button>
                  <div class="message-menu-dropdown" :data-message-dropdown="threadRoot.id" hidden>
                    <button class="message-menu-item" :data-copy-message="threadRoot.id">Copy message text</button>
                    <button class="message-menu-item" :data-copy-thread="threadRoot.id">Copy entire thread</button>
                    <button class="message-menu-item" :data-link-thread-to-task="threadRoot.id">Link thread to task</button>
                    <template x-if="canDeleteMessage(threadRoot.author)">
                      <button class="message-menu-item danger" :data-delete-message="threadRoot.id">Delete</button>
                    </template>
                  </div>
                </div>
              </div>
              <!-- Quick react bar -->
              <div class="quick-react-bar" :data-message-id="threadRoot.id">
                <button type="button" class="quick-react-btn" data-emoji="👍">👍</button>
                <button type="button" class="quick-react-btn" data-emoji="❤️">❤️</button>
                <button type="button" class="quick-react-btn" data-emoji="😂">😂</button>
                <button type="button" class="quick-react-btn" data-emoji="🎉">🎉</button>
                <button type="button" class="quick-react-btn" data-emoji="👀">👀</button>
                <button type="button" class="quick-react-btn" data-emoji="🙏">🙏</button>
                <button type="button" class="quick-react-btn add-reaction-btn" title="More reactions">+</button>
              </div>
            </div>
          </template>
          <!-- Thread replies -->
          <template x-for="reply in threadMessages" :key="reply.id">
            <div class="chat-message chat-message-with-avatar" :data-message-id="reply.id">
              <img class="chat-message-avatar clickable-avatar" :src="getAvatarUrl(reply.author)" :data-profile-npub="reply.author" alt="" loading="lazy" />
              <div class="chat-message-content">
                <div class="chat-message-meta">
                  <span class="chat-message-author" x-text="getAuthorName(reply.author)"></span>
                  <time x-text="formatTime(reply.createdAt)"></time>
                </div>
                <p class="chat-message-body" x-html="renderBody(reply.body)"></p>
                <!-- Reaction pills -->
                <div class="message-reactions" x-show="reply.reactions && reply.reactions.length > 0">
                  <template x-for="reaction in (reply.reactions || [])" :key="reaction.emoji">
                    <button type="button"
                      class="reaction-pill"
                      :class="{ 'reacted': hasUserReacted(reaction) }"
                      :data-message-id="reply.id"
                      :data-emoji="reaction.emoji"
                      x-text="reaction.emoji + ' ' + reaction.count">
                    </button>
                  </template>
                </div>
                <!-- Message menu -->
                <div class="message-menu">
                  <button class="message-menu-trigger" :data-message-menu="reply.id" aria-label="Message options">&#8942;</button>
                  <div class="message-menu-dropdown" :data-message-dropdown="reply.id" hidden>
                    <button class="message-menu-item" :data-copy-message="reply.id">Copy message text</button>
                    <button class="message-menu-item" :data-link-thread-to-task="openThreadId">Link thread to task</button>
                    <template x-if="canDeleteMessage(reply.author)">
                      <button class="message-menu-item danger" :data-delete-message="reply.id">Delete</button>
                    </template>
                  </div>
                </div>
              </div>
              <!-- Quick react bar -->
              <div class="quick-react-bar" :data-message-id="reply.id">
                <button type="button" class="quick-react-btn" data-emoji="👍">👍</button>
                <button type="button" class="quick-react-btn" data-emoji="❤️">❤️</button>
                <button type="button" class="quick-react-btn" data-emoji="😂">😂</button>
                <button type="button" class="quick-react-btn" data-emoji="🎉">🎉</button>
                <button type="button" class="quick-react-btn" data-emoji="👀">👀</button>
                <button type="button" class="quick-react-btn" data-emoji="🙏">🙏</button>
                <button type="button" class="quick-react-btn add-reaction-btn" title="More reactions">+</button>
              </div>
            </div>
          </template>
        </div>
        <div class="chat-thread-panel-composer">
          <div class="chat-composer-row">
            <textarea placeholder="Reply to thread..." data-thread-input rows="2"></textarea>
            <div class="chat-composer-buttons">
              <button type="button" class="chat-attach-btn" data-thread-attach-file title="Attach file">&#128206;</button>
              <input type="file" data-thread-file-input hidden accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" />
              <button type="button" class="chat-send-btn primary" data-thread-send disabled>Reply</button>
            </div>
          </div>
        </div>
      </aside>
    </div>
    ${renderChannelModal()}
    ${renderChannelSettingsModal()}
    ${renderDmModal()}
    ${renderDmSettingsModal()}
    ${renderProfileModal()}
    ${renderTaskLinkModal()}
  </section>`;
}

function renderChannelModal() {
  return `<div class="chat-modal" data-channel-modal hidden>
    <div class="chat-modal-body channel-wizard">
      <header class="chat-modal-header">
        <h3>Create channel</h3>
        <button type="button" class="ghost" data-close-channel-modal>&times;</button>
      </header>
      <div class="wizard-step wizard-step-1" data-wizard-step-1>
        <p class="channel-type-prompt">What type of channel?</p>
        <div class="channel-type-buttons">
          <button type="button" class="channel-type-btn" data-select-channel-type="public">
            <span class="channel-type-icon">&#127758;</span>
            <span class="channel-type-label">Public</span>
            <span class="channel-type-desc">Anyone can view and join</span>
          </button>
          <button type="button" class="channel-type-btn" data-select-channel-type="private">
            <span class="channel-type-icon">&#128274;</span>
            <span class="channel-type-label">Private</span>
            <span class="channel-type-desc">Encrypted, group members only</span>
          </button>
        </div>
      </div>
      <div class="wizard-step wizard-step-2" data-wizard-step-2 style="display: none;">
        <div class="wizard-step-2-header">
          <span class="wizard-type-badge" data-wizard-type-badge></span>
        </div>
        <form class="chat-form" data-channel-form>
          <input type="hidden" name="isPublic" value="1" data-channel-is-public />
          <label>
            <span>Slug</span>
            <input name="name" required placeholder="my-channel" pattern="[a-z0-9-]+" title="Lowercase letters, numbers, and hyphens only" />
            <span class="field-hint">Lowercase, no spaces (e.g. team-updates)</span>
          </label>
          <label>
            <span>Description</span>
            <textarea name="description" rows="2" placeholder="What is this channel about?"></textarea>
          </label>
          <div class="channel-group-section" data-channel-group-section style="display: none;">
            <label>
              <span>Group</span>
              <select name="groupId" data-channel-group-select>
                <option value="">Select a group...</option>
              </select>
            </label>
            <span class="field-hint">Members of this group will have access</span>
          </div>
          <div class="chat-form-actions">
            <button type="button" class="ghost" data-channel-back>Back</button>
            <button type="submit" class="primary">Create</button>
          </div>
        </form>
      </div>
    </div>
  </div>`;
}

function renderChannelSettingsModal() {
  return `<div class="chat-modal" data-channel-settings-modal hidden>
    <div class="chat-modal-body channel-settings-body">
      <header class="chat-modal-header">
        <h3>Channel Settings</h3>
        <button type="button" class="ghost" data-close-channel-settings>&times;</button>
      </header>
      <form class="chat-form" data-channel-settings-form>
        <input type="hidden" name="channelId" data-channel-settings-id />
        <label>
          <span>Display name</span>
          <input name="displayName" required placeholder="General" data-channel-settings-display-name />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="2" placeholder="What is this channel about?" data-channel-settings-description></textarea>
        </label>
        <label class="chat-checkbox" data-channel-public-toggle>
          <input type="checkbox" name="isPublic" data-channel-settings-public />
          <span>Public channel</span>
        </label>
        <div class="channel-groups-section" data-channel-groups-section hidden>
          <label>
            <span>Assigned Groups</span>
          </label>
          <div class="channel-groups-list" data-channel-groups-list>
            <p class="channel-groups-empty">No groups assigned</p>
          </div>
          <div class="channel-groups-add">
            <select data-channel-add-group>
              <option value="">Add a group...</option>
            </select>
          </div>
        </div>
        <div class="channel-encryption-section" data-channel-encryption-section hidden>
          <label>
            <span>🔐 Encryption Keys</span>
          </label>
          <div class="encryption-status" data-encryption-status>
            <p>Loading key status...</p>
          </div>
          <button type="button" class="secondary" data-distribute-keys>Distribute Keys to Pending Members</button>
        </div>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-close-channel-settings>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
      <div class="channel-danger-zone" data-channel-danger-zone>
        <button type="button" class="danger" data-delete-channel>Delete Channel</button>
      </div>
    </div>
  </div>`;
}

function renderDmModal() {
  return `<div class="chat-modal" data-dm-modal hidden>
    <div class="chat-modal-body dm-modal-body">
      <header class="chat-modal-header">
        <h3>New Direct Message</h3>
        <button type="button" class="ghost" data-close-dm-modal>&times;</button>
      </header>
      <div class="dm-user-search">
        <input type="text" placeholder="Search users..." data-dm-search autocomplete="off" />
        <div class="dm-user-list" data-dm-user-list></div>
      </div>
    </div>
  </div>`;
}

function renderDmSettingsModal() {
  return `<div class="chat-modal" data-dm-settings-modal hidden>
    <div class="chat-modal-body dm-settings-body">
      <header class="chat-modal-header">
        <h3>Conversation Settings</h3>
        <button type="button" class="ghost" data-close-dm-settings>&times;</button>
      </header>
      <div class="dm-settings-content">
        <input type="hidden" data-dm-settings-id />
        <p class="dm-settings-info">Archive this conversation to remove it from your sidebar. Messages will not be deleted.</p>
        <div class="dm-danger-zone">
          <button type="button" class="danger" data-archive-dm>Archive Conversation</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderProfileModal() {
  return `<div class="profile-modal-overlay" data-profile-modal hidden>
    <div class="profile-modal">
      <button class="profile-modal-close" type="button" data-profile-close aria-label="Close">&times;</button>
      <div class="profile-view" data-profile-view>
        <div class="profile-header">
          <div class="profile-avatar" data-profile-avatar></div>
          <div class="profile-identity">
            <h2 class="profile-name" data-profile-name>Loading...</h2>
            <p class="profile-nip05" data-profile-nip05></p>
          </div>
        </div>
        <p class="profile-about" data-profile-about></p>
        <div class="profile-meta">
          <p class="profile-npub" data-profile-npub></p>
        </div>
        <button type="button" class="profile-edit-btn" data-profile-edit>Edit Profile</button>
      </div>
      <form class="profile-edit-form" data-profile-edit-form hidden>
        <label>
          <span>Display Name</span>
          <input type="text" name="displayName" data-profile-edit-name placeholder="Your name" />
        </label>
        <label>
          <span>About</span>
          <textarea name="about" data-profile-edit-about rows="3" placeholder="Tell us about yourself"></textarea>
        </label>
        <label>
          <span>Picture URL</span>
          <input type="url" name="picture" data-profile-edit-picture placeholder="https://..." />
        </label>
        <div class="profile-edit-actions">
          <button type="button" class="ghost" data-profile-edit-cancel>Cancel</button>
          <button type="submit" class="primary">Save & Publish</button>
        </div>
        <p class="profile-edit-status" data-profile-edit-status hidden></p>
      </form>
    </div>
  </div>`;
}

function renderTaskLinkModal() {
  return `<div class="chat-modal task-link-modal" data-task-link-modal hidden>
    <div class="chat-modal-body task-link-modal-body">
      <header class="chat-modal-header">
        <h3>Link to Task</h3>
        <button type="button" class="ghost" data-close-task-link>&times;</button>
      </header>
      <div class="task-link-tabs">
        <button type="button" class="task-link-tab active" data-task-tab="create">Create New</button>
        <button type="button" class="task-link-tab" data-task-tab="existing">Link Existing</button>
      </div>
      <form class="task-link-create-form" data-task-link-create>
        <label>
          <span>Board</span>
          <select name="board" data-task-board>
            <option value="">Personal</option>
          </select>
        </label>
        <label>
          <span>Title</span>
          <input name="title" required placeholder="Task title" />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="2" placeholder="Description (optional)"></textarea>
        </label>
        <label>
          <span>Priority</span>
          <select name="priority">
            <option value="sand">Sand (Low)</option>
            <option value="pebble" selected>Pebble (Normal)</option>
            <option value="rock">Rock (High)</option>
            <option value="boulder">Boulder (Critical)</option>
          </select>
        </label>
        <div class="chat-form-actions">
          <button type="button" class="ghost" data-close-task-link>Cancel</button>
          <button type="submit" class="primary">Create &amp; Link</button>
        </div>
      </form>
      <div class="task-link-existing" data-task-link-existing hidden>
        <div class="task-search-container">
          <select data-task-search-board class="task-search-board">
            <option value="all">All Boards</option>
            <option value="">Personal</option>
          </select>
          <input type="search" placeholder="Search tasks..." data-task-search autocomplete="off" />
        </div>
        <div class="task-search-results" data-task-results>
          <p class="task-search-empty">Search for tasks to link...</p>
        </div>
      </div>
    </div>
  </div>`;
}

function renderQrModal() {
  return `<div class="qr-modal-overlay" data-qr-modal hidden>
    <div class="qr-modal">
      <button class="qr-modal-close" type="button" data-qr-close aria-label="Close">&times;</button>
      <h2>Login QR Code</h2>
      <p>Scan this code with your mobile device to log in</p>
      <div class="qr-canvas-container" data-qr-container></div>
    </div>
  </div>`;
}

function renderAuthRequired() {
  const appName = getAppName();
  const logoUrl = getFaviconUrl() || "/logo.png";
  return `<section class="chat-auth-section">
    <div class="chat-auth-container">
      <img src="${logoUrl}" alt="${appName}" class="auth-logo" />
      <h2>Welcome to ${appName}</h2>
      <p class="auth-description">A nostr native community chat app, think slack, but client side encrypted and with a service that respects its users.</p>
      <section class="auth-panel" data-login-panel>
        <div class="keyteleport-overlay" data-keyteleport-overlay hidden>
          <div class="keyteleport-spinner"></div>
          <p>Key Teleport in Progress</p>
        </div>
        <div class="auth-actions">
          <button class="auth-option" type="button" data-login-method="ephemeral">Sign Up</button>
          <button class="auth-option auth-extension" type="button" data-login-method="extension">Log in with Nostr Extension</button>
        </div>
        <details class="auth-advanced">
          <summary>Advanced Options (nsec, bunker://...)</summary>
          <p>Connect to a remote bunker or sign in with your secret key.</p>
          <form data-bunker-form>
            <input name="bunker" placeholder="nostrconnect://… or name@example.com" autocomplete="off" />
            <button class="bunker-submit" type="submit">Connect bunker</button>
          </form>
          <form data-secret-form>
            <div class="secret-input-wrapper">
              <input type="password" name="secret" placeholder="nsec1…" autocomplete="off" />
              <button type="button" class="secret-toggle" data-toggle-secret aria-label="Show secret">&#128065;</button>
            </div>
            <button class="bunker-submit" type="submit">Sign in with secret</button>
          </form>
          <div class="keyteleport-setup-section">
            <p class="keyteleport-setup-label">Have a Welcome key manager?</p>
            <button class="keyteleport-setup-btn" type="button" data-keyteleport-setup>Setup Key Teleport</button>
          </div>
        </details>
        <p class="auth-error" data-login-error hidden></p>
      </section>
    </div>
    ${renderQrModal()}
    ${renderPinModal()}
    ${renderUnlockCodeModal()}
    ${renderKeyTeleportSetupModal()}
  </section>`;
}

function renderSessionSeed(
  session: Session | null,
  deepLink?: DeepLink,
  needsOnboarding = false,
  teamSlug?: string
) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
    window.__CHAT_PAGE__ = true;
    window.__DEEP_LINK__ = ${JSON.stringify(deepLink ?? null)};
    window.__NEEDS_ONBOARDING__ = ${needsOnboarding};
    window.__TEAM_SLUG__ = ${JSON.stringify(teamSlug ?? null)};
    window.__CHAT_INIT__ = {
      channels: [],
      dmChannels: [],
      personalChannel: null,
      selectedChannelId: ${JSON.stringify(deepLink?.channelId ?? null)},
      unreadCounts: {},
      mentionCounts: {}
    };
    window.__FEATURE_FLAGS__ = { alpineChat: true };
  </script>`;
}

function renderOnboardingLobby() {
  const appName = getAppName();
  return `<section class="onboarding-lobby" data-onboarding-lobby>
    <div class="onboarding-card">
      <div class="onboarding-icon">🔐</div>
      <h2>Welcome to ${appName}</h2>
      <p class="onboarding-desc">
        This community uses end-to-end encryption.
        Enter your invite code to get access.
      </p>
      <form class="onboarding-form" data-invite-form>
        <input
          type="text"
          name="inviteCode"
          placeholder="XXXX-XXXX-XXXX"
          class="invite-input"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          data-invite-input
          required
        />
        <button type="submit" class="primary onboarding-btn" data-invite-submit>
          Join Community
        </button>
      </form>
      <p class="onboarding-error" data-invite-error hidden></p>
      <p class="onboarding-hint">
        Don't have an invite code? Ask the community owner.
      </p>
    </div>
  </section>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "MG";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}
