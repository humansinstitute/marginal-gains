/**
 * Onboarding module for invite code redemption
 * Handles the onboarding lobby for users who need a community key
 */

import { redeemInviteCode } from "./communityCrypto.js";
import { hide, show } from "./dom.js";

/**
 * Initialize onboarding if needed
 */
export function initOnboarding() {
  // Only run if onboarding is needed
  if (!window.__NEEDS_ONBOARDING__) return;

  const form = document.querySelector("[data-invite-form]");
  const input = document.querySelector("[data-invite-input]");
  const submitBtn = document.querySelector("[data-invite-submit]");
  const errorEl = document.querySelector("[data-invite-error]");

  if (!form || !input) return;

  // Format input as user types (add dashes)
  input.addEventListener("input", (e) => {
    let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");

    // Insert dashes at positions 4 and 8
    if (value.length > 4) {
      value = value.slice(0, 4) + "-" + value.slice(4);
    }
    if (value.length > 9) {
      value = value.slice(0, 9) + "-" + value.slice(9);
    }

    // Limit to 14 characters (XXXX-XXXX-XXXX)
    value = value.slice(0, 14);

    e.target.value = value;
  });

  // Handle form submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const code = input.value.trim();
    if (!code) return;

    hide(errorEl);
    submitBtn.disabled = true;
    submitBtn.textContent = "Joining...";

    try {
      const result = await redeemInviteCode(code);

      if (result.success) {
        // Reload the page to show the chat
        window.location.reload();
      } else {
        showError(errorEl, result.error || "Invalid invite code");
        submitBtn.disabled = false;
        submitBtn.textContent = "Join Community";
      }
    } catch (err) {
      console.error("[Onboarding] Error redeeming invite:", err);
      showError(errorEl, "Something went wrong. Please try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Join Community";
    }
  });
}

function showError(el, message) {
  if (!el) return;
  el.textContent = message;
  show(el);
}
