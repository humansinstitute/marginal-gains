export const elements = {
  loginPanel: document.querySelector("[data-login-panel]"),
  sessionControls: document.querySelector("[data-session-controls]"),
  errorTarget: document.querySelector("[data-login-error]"),
  logoutBtn: document.querySelector("[data-logout]"),
  copyIdBtn: document.querySelector("[data-copy-id]"),
  heroInput: document.querySelector("[data-hero-input]"),
  heroHint: document.querySelector("[data-hero-hint]"),
  avatarButton: document.querySelector("[data-avatar]"),
  avatarImg: document.querySelector("[data-avatar-img]"),
  avatarFallback: document.querySelector("[data-avatar-fallback]"),
  avatarMenu: document.querySelector("[data-avatar-menu]"),
  openChatBtn: document.querySelector("[data-open-chat]"),
  summaryPanel: document.querySelector("[data-summary-panel]"),
  summaryUpdated: document.querySelector("[data-summary-updated]"),
  summaryDay: document.querySelector("[data-summary-day]"),
  summaryDayText: document.querySelector("[data-summary-day-text]"),
  summaryWeek: document.querySelector("[data-summary-week]"),
  summaryWeekText: document.querySelector("[data-summary-week-text]"),
  summarySuggestions: document.querySelector("[data-summary-suggestions]"),
  summarySuggestionsText: document.querySelector("[data-summary-suggestions-text]"),
  qrModal: document.querySelector("[data-qr-modal]"),
  qrCloseBtn: document.querySelector("[data-qr-close]"),
  qrContainer: document.querySelector("[data-qr-container]"),
  showLoginQrBtn: document.querySelector("[data-show-login-qr]"),
  exportSecretBtn: document.querySelector("[data-export-secret]"),
  viewProfileBtn: document.querySelector("[data-view-profile]"),
  profileModal: document.querySelector("[data-profile-modal]"),
  profileCloseBtn: document.querySelector("[data-profile-close]"),
  profileAvatar: document.querySelector("[data-profile-avatar]"),
  profileName: document.querySelector("[data-profile-name]"),
  profileNip05: document.querySelector("[data-profile-nip05]"),
  profileAbout: document.querySelector("[data-profile-about]"),
  profileNpub: document.querySelector("[data-profile-npub]"),
  profileView: document.querySelector("[data-profile-view]"),
  profileEditBtn: document.querySelector("[data-profile-edit]"),
  profileEditForm: document.querySelector("[data-profile-edit-form]"),
  profileEditName: document.querySelector("[data-profile-edit-name]"),
  profileEditAbout: document.querySelector("[data-profile-edit-about]"),
  profileEditPicture: document.querySelector("[data-profile-edit-picture]"),
  profileEditCancel: document.querySelector("[data-profile-edit-cancel]"),
  profileEditStatus: document.querySelector("[data-profile-edit-status]"),
  heroSection: document.querySelector("[data-hero-section]"),
  workSection: document.querySelector("[data-work-section]"),
  chatShell: document.querySelector("[data-chat-shell]"),
  chatInput: document.querySelector("[data-chat-input]"),
  chatSendBtn: document.querySelector("[data-send-chat]"),
  mentionPopup: document.querySelector("[data-mention-popup]"),
  chatThreadList: document.querySelector("[data-thread-list]"),
  chatChannelList: document.querySelector("[data-channel-list]"),
  activeChannel: document.querySelector("[data-active-channel]"),
  replyTarget: document.querySelector("[data-reply-target]"),
  exitChatBtn: document.querySelector("[data-exit-chat]"),
  channelModal: document.querySelector("[data-channel-modal]"),
  channelForm: document.querySelector("[data-channel-form]"),
  closeChannelModalBtns: document.querySelectorAll("[data-close-channel-modal]"),
  newChannelTriggers: document.querySelectorAll("[data-new-channel-trigger]"),
  // Thread panel elements (inline, not overlay)
  threadPanel: document.querySelector("[data-thread-panel]"),
  threadMessages: document.querySelector("[data-thread-messages]"),
  threadInput: document.querySelector("[data-thread-input]"),
  threadSendBtn: document.querySelector("[data-thread-send]"),
  closeThreadBtn: document.querySelector("[data-close-thread]"),
  // App menu elements
  hamburgerBtn: document.querySelector("[data-hamburger-toggle]"),
  appMenu: document.querySelector("[data-app-menu]"),
  appMenuOverlay: document.querySelector("[data-app-menu-overlay]"),
  appMenuClose: document.querySelector("[data-app-menu-close]"),
  // Mobile navigation elements
  chatLayout: document.querySelector("[data-chat-layout]"),
  backToChannelsBtn: document.querySelector("[data-back-to-channels]"),
  backToMessagesBtn: document.querySelector("[data-back-to-messages]"),
  // Channel settings elements
  channelSettingsBtn: document.querySelector("[data-channel-settings]"),
  channelSettingsModal: document.querySelector("[data-channel-settings-modal]"),
  channelSettingsForm: document.querySelector("[data-channel-settings-form]"),
  channelSettingsId: document.querySelector("[data-channel-settings-id]"),
  channelSettingsDisplayName: document.querySelector("[data-channel-settings-display-name]"),
  channelSettingsDescription: document.querySelector("[data-channel-settings-description]"),
  channelSettingsPublic: document.querySelector("[data-channel-settings-public]"),
  channelPublicToggle: document.querySelector("[data-channel-public-toggle]"),
  channelGroupsSection: document.querySelector("[data-channel-groups-section]"),
  channelGroupsList: document.querySelector("[data-channel-groups-list]"),
  channelAddGroup: document.querySelector("[data-channel-add-group]"),
  closeChannelSettingsBtns: document.querySelectorAll("[data-close-channel-settings]"),
  channelDangerZone: document.querySelector("[data-channel-danger-zone]"),
  deleteChannelBtn: document.querySelector("[data-delete-channel]"),
  // DM elements
  dmList: document.querySelector("[data-dm-list]"),
  personalSection: document.querySelector("[data-personal-section]"),
  newDmTrigger: document.querySelector("[data-new-dm-trigger]"),
  dmModal: document.querySelector("[data-dm-modal]"),
  dmSearch: document.querySelector("[data-dm-search]"),
  dmUserList: document.querySelector("[data-dm-user-list]"),
  closeDmModalBtns: document.querySelectorAll("[data-close-dm-modal]"),
};

export const show = (el) => el?.removeAttribute("hidden");
export const hide = (el) => el?.setAttribute("hidden", "hidden");
export const setText = (el, text) => {
  if (el) el.textContent = text;
};
export const focusHeroInput = () => {
  const input = document.getElementById("title");
  if (input) input.focus();
};

export const escapeHtml = (str) => {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return str.replace(/[&<>"']/g, (c) => escapes[c]);
};
