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
  heroSection: document.querySelector("[data-hero-section]"),
  workSection: document.querySelector("[data-work-section]"),
  chatShell: document.querySelector("[data-chat-shell]"),
  chatInput: document.querySelector("[data-chat-input]"),
  chatSendBtn: document.querySelector("[data-send-chat]"),
  chatThreadList: document.querySelector("[data-thread-list]"),
  chatChannelList: document.querySelector("[data-channel-list]"),
  activeChannel: document.querySelector("[data-active-channel]"),
  replyTarget: document.querySelector("[data-reply-target]"),
  exitChatBtn: document.querySelector("[data-exit-chat]"),
  channelModal: document.querySelector("[data-channel-modal]"),
  channelForm: document.querySelector("[data-channel-form]"),
  closeChannelModalBtns: document.querySelectorAll("[data-close-channel-modal]"),
  newChannelTriggers: document.querySelectorAll("[data-new-channel-trigger]"),
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
