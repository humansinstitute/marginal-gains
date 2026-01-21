/**
 * Unlock Code Modal - paste-based interface for Key Teleport v2
 * User pastes throwaway nsec to decrypt their key
 */

import { hide, show } from "./dom.js";

let onComplete = null;
let onCancel = null;

const getElements = () => ({
  modal: document.querySelector("[data-unlock-modal]"),
  title: document.querySelector("[data-unlock-title]"),
  subtitle: document.querySelector("[data-unlock-subtitle]"),
  input: document.querySelector("[data-unlock-input]"),
  error: document.querySelector("[data-unlock-error]"),
  submitBtn: document.querySelector("[data-unlock-submit]"),
  cancelBtn: document.querySelector("[data-unlock-cancel]"),
});

/**
 * Initialize unlock modal event listeners
 */
export function initUnlockModal() {
  const el = getElements();
  if (!el.modal) return;

  // Submit button
  el.submitBtn?.addEventListener("click", () => {
    const code = el.input?.value?.trim();
    if (code) {
      handleSubmit(code);
    }
  });

  // Enter key to submit
  el.input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const code = el.input.value?.trim();
      if (code) {
        handleSubmit(code);
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeUnlockModal();
      onCancel?.();
    }
  });

  // Cancel button
  el.cancelBtn?.addEventListener("click", () => {
    closeUnlockModal();
    onCancel?.();
  });

  // Click outside to cancel
  el.modal?.addEventListener("click", (e) => {
    if (e.target === el.modal) {
      closeUnlockModal();
      onCancel?.();
    }
  });

  // Keyboard escape
  document.addEventListener("keydown", (e) => {
    if (el.modal?.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeUnlockModal();
      onCancel?.();
    }
  });
}

function handleSubmit(code) {
  onComplete?.(code);
}

/**
 * Show error message in the modal
 * @param {string} message - Error message to display
 */
export function showUnlockError(message = "Invalid unlock code. Please try again.") {
  const el = getElements();
  if (el.error) {
    el.error.textContent = message;
    show(el.error);
  }
  // Clear the input for retry
  if (el.input) {
    el.input.value = "";
    el.input.focus();
  }
}

function hideError() {
  const el = getElements();
  hide(el.error);
}

/**
 * Open unlock modal to get an unlock code
 * @param {Object} options
 * @param {string} options.title - Modal title
 * @param {string} options.subtitle - Modal subtitle
 * @returns {Promise<string|null>} The entered code, or null if cancelled
 */
export function promptForUnlockCode({
  title = "Paste Unlock Code",
  subtitle = "Paste the unlock code from your clipboard",
} = {}) {
  return new Promise((resolve) => {
    const el = getElements();
    if (!el.modal) {
      resolve(null);
      return;
    }

    if (el.title) el.title.textContent = title;
    if (el.subtitle) el.subtitle.textContent = subtitle;
    if (el.input) el.input.value = "";
    hideError();

    onComplete = (code) => {
      closeUnlockModal();
      resolve(code);
    };

    onCancel = () => {
      resolve(null);
    };

    show(el.modal);

    // Focus input and try to auto-paste from clipboard
    setTimeout(() => {
      el.input?.focus();
      // Try to auto-paste if clipboard contains nsec
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text && text.startsWith("nsec1") && el.input) {
            el.input.value = text;
          }
        })
        .catch(() => {
          // Clipboard read failed (permission denied), user will paste manually
        });
    }, 100);
  });
}

/**
 * Close the unlock modal
 */
export function closeUnlockModal() {
  const el = getElements();
  hide(el.modal);
  if (el.input) el.input.value = "";
  onComplete = null;
  onCancel = null;
}
