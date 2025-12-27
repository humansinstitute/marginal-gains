import { closeAvatarMenu, updateAvatar } from "./avatar.js";
import { elements as el, focusHeroInput, hide, show } from "./dom.js";
import { onRefresh, setChatEnabled, state } from "./state.js";
import { updateSummaryUI } from "./summary.js";
import { refreshChatUI } from "./chat.js";

export const initUI = () => {
  onRefresh(() => {
    updatePanels();
    updateSummaryUI();
    void updateAvatar();
    refreshChatUI();
  });
  updatePanels();
  updateSummaryUI();
  void updateAvatar();
  // Don't call refreshChatUI on init - chat starts hidden and stays hidden until user opens it
};

const updatePanels = () => {
  if (state.session) {
    hide(el.loginPanel);
    show(el.sessionControls);
    focusHeroInput();
  } else {
    show(el.loginPanel);
    hide(el.sessionControls);
    closeAvatarMenu();
    setChatEnabled(false);
  }
  toggleChatVisibility();
  updateHeroState();
};

const updateHeroState = () => {
  if (el.heroInput instanceof HTMLInputElement) {
    el.heroInput.disabled = !state.session;
    el.heroInput.placeholder = state.session ? "Add something else…" : "Add a task";
    if (state.session) {
      el.heroInput.focus();
    }
  }
  if (el.heroHint instanceof HTMLElement) {
    el.heroHint.setAttribute("hidden", "hidden");
  }
};

export const showError = (message) => {
  if (!el.errorTarget) return;
  el.errorTarget.textContent = message;
  el.errorTarget.removeAttribute("hidden");
};

export const clearError = () => {
  if (!el.errorTarget) return;
  el.errorTarget.textContent = "";
  el.errorTarget.setAttribute("hidden", "hidden");
};

function toggleChatVisibility() {
  const inChat = state.chat.enabled && state.session;
  if (inChat) {
    hide(el.heroSection);
    hide(el.workSection);
    hide(el.summaryPanel);
  } else {
    show(el.heroSection);
    show(el.workSection);
    // Don't show summaryPanel here - let updateSummaryUI handle it
  }
  // Chat shell visibility is handled by refreshChatUI in chat.js
}
