/**
 * PIN Modal - numpad interface for entering 4-digit PINs
 */

import { hide, show } from "./dom.js";

let currentPin = "";
let onComplete = null;
let onCancel = null;
let isConfirmMode = false;
let firstPin = "";

const getElements = () => ({
  modal: document.querySelector("[data-pin-modal]"),
  title: document.querySelector("[data-pin-title]"),
  subtitle: document.querySelector("[data-pin-subtitle]"),
  dots: document.querySelectorAll("[data-pin-dot]"),
  error: document.querySelector("[data-pin-error]"),
  digitBtns: document.querySelectorAll("[data-pin-digit]"),
  clearBtn: document.querySelector("[data-pin-clear]"),
  backBtn: document.querySelector("[data-pin-back]"),
  cancelBtn: document.querySelector("[data-pin-cancel]"),
});

/**
 * Initialize PIN modal event listeners
 */
export function initPinModal() {
  const el = getElements();
  if (!el.modal) return;

  // Digit buttons
  el.digitBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const digit = btn.dataset.pinDigit;
      addDigit(digit);
    });
  });

  // Clear button
  el.clearBtn?.addEventListener("click", () => {
    currentPin = "";
    updateDots();
    hideError();
  });

  // Backspace button
  el.backBtn?.addEventListener("click", () => {
    currentPin = currentPin.slice(0, -1);
    updateDots();
    hideError();
  });

  // Cancel button
  el.cancelBtn?.addEventListener("click", () => {
    closePinModal();
    onCancel?.();
  });

  // Click outside to cancel
  el.modal?.addEventListener("click", (e) => {
    if (e.target === el.modal) {
      closePinModal();
      onCancel?.();
    }
  });

  // Keyboard support
  document.addEventListener("keydown", (e) => {
    // Only handle when modal is visible
    if (el.modal?.hidden) return;

    // Digit keys 0-9
    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault();
      addDigit(e.key);
      return;
    }

    // Backspace to delete
    if (e.key === "Backspace") {
      e.preventDefault();
      currentPin = currentPin.slice(0, -1);
      updateDots();
      hideError();
      return;
    }

    // Escape to cancel
    if (e.key === "Escape") {
      e.preventDefault();
      closePinModal();
      onCancel?.();
      return;
    }
  });
}

function addDigit(digit) {
  if (currentPin.length >= 4) return;
  currentPin += digit;
  updateDots();
  hideError();

  if (currentPin.length === 4) {
    // Small delay for visual feedback
    setTimeout(() => {
      if (isConfirmMode) {
        handleConfirmPin();
      } else {
        handlePinComplete();
      }
    }, 150);
  }
}

function updateDots() {
  const el = getElements();
  el.dots.forEach((dot, i) => {
    dot.classList.toggle("filled", i < currentPin.length);
  });
}

function showError(message = "Wrong PIN. Try again.") {
  const el = getElements();
  if (el.error) {
    el.error.textContent = message;
    show(el.error);
  }
}

function hideError() {
  const el = getElements();
  hide(el.error);
}

function handlePinComplete() {
  onComplete?.(currentPin);
}

function handleConfirmPin() {
  if (currentPin === firstPin) {
    onComplete?.(currentPin);
  } else {
    currentPin = "";
    updateDots();
    showError("PINs don't match. Try again.");
    // Reset to first entry
    firstPin = "";
    isConfirmMode = false;
    const el = getElements();
    if (el.title) el.title.textContent = "Create PIN";
    if (el.subtitle) el.subtitle.textContent = "Choose a 4-digit PIN to protect your key";
  }
}

/**
 * Open PIN modal to get an existing PIN
 * @param {Object} options
 * @param {string} options.title - Modal title
 * @param {string} options.subtitle - Modal subtitle
 * @returns {Promise<string|null>} The entered PIN, or null if cancelled
 */
export function promptForPin({ title = "Enter PIN", subtitle = "Enter your 4-digit PIN" } = {}) {
  return new Promise((resolve) => {
    const el = getElements();
    if (!el.modal) {
      resolve(null);
      return;
    }

    currentPin = "";
    isConfirmMode = false;
    firstPin = "";

    if (el.title) el.title.textContent = title;
    if (el.subtitle) el.subtitle.textContent = subtitle;
    updateDots();
    hideError();

    onComplete = (pin) => {
      closePinModal();
      resolve(pin);
    };

    onCancel = () => {
      resolve(null);
    };

    show(el.modal);
  });
}

/**
 * Open PIN modal to create and confirm a new PIN
 * @returns {Promise<string|null>} The confirmed PIN, or null if cancelled
 */
export function promptForNewPin() {
  return new Promise((resolve) => {
    const el = getElements();
    if (!el.modal) {
      resolve(null);
      return;
    }

    currentPin = "";
    isConfirmMode = false;
    firstPin = "";

    if (el.title) el.title.textContent = "Create PIN";
    if (el.subtitle) el.subtitle.textContent = "Choose a 4-digit PIN to protect your key";
    updateDots();
    hideError();

    onComplete = (pin) => {
      if (!isConfirmMode) {
        // First entry - ask for confirmation
        firstPin = pin;
        isConfirmMode = true;
        currentPin = "";
        updateDots();
        if (el.title) el.title.textContent = "Confirm PIN";
        if (el.subtitle) el.subtitle.textContent = "Enter the same PIN again";
      } else {
        // Confirmation successful
        closePinModal();
        resolve(pin);
      }
    };

    onCancel = () => {
      resolve(null);
    };

    show(el.modal);
  });
}

/**
 * Close the PIN modal
 */
export function closePinModal() {
  const el = getElements();
  hide(el.modal);
  currentPin = "";
  firstPin = "";
  isConfirmMode = false;
  onComplete = null;
  onCancel = null;
}
