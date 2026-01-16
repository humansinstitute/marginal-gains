/**
 * Onboarding module for invite code redemption
 * Handles both community onboarding and team invite onboarding
 */

import { deriveKeyFromCode } from "./communityCrypto.js";
import { EPHEMERAL_SECRET_KEY, ENCRYPTED_SECRET_KEY, AUTO_LOGIN_METHOD_KEY, AUTO_LOGIN_PUBKEY_KEY } from "./constants.js";
import { hide, show } from "./dom.js";
import { loadNostrLibs, bytesToHex, hexToBytes, buildUnsignedEvent } from "./nostr.js";
import { encryptWithPin, isSecureContext } from "./pinCrypto.js";
import { initPinModal, promptForNewPin } from "./pinModal.js";

// ============================================================
// Community Onboarding (existing flow)
// ============================================================

/**
 * Initialize community onboarding if needed
 */
export function initOnboarding() {
  // Only run if onboarding is needed (legacy community flow)
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
      const { redeemInviteCode } = await import("./communityCrypto.js");
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

// ============================================================
// Team Onboarding (new flow)
// ============================================================

/**
 * Initialize team onboarding page
 * Called when /?code={inviteCode} is accessed
 */
export function initTeamOnboarding() {
  // Only run on team onboarding page
  if (!window.__INVITE_CODE__) return;

  const inviteCode = window.__INVITE_CODE__;
  const preview = window.__INVITE_PREVIEW__;
  const isLoggedIn = window.__IS_LOGGED_IN__;

  console.log("[TeamOnboarding] Initializing", { inviteCode: inviteCode?.slice(0, 8) + "...", isLoggedIn });

  initPinModal();

  if (isLoggedIn) {
    // User is logged in - wire up join button
    wireJoinButton(inviteCode, preview);
    wireSwitchAccountButton();
  } else {
    // User needs to log in first
    wireLoginButtons(inviteCode, preview);
    wireBunkerForm(inviteCode, preview);
    wireSecretForm(inviteCode, preview);
  }
}

/**
 * Wire up login buttons for onboarding
 */
function wireLoginButtons(inviteCode, preview) {
  const buttons = document.querySelectorAll("[data-login-method]");

  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const method = button.getAttribute("data-login-method");
      if (!method) return;

      button.disabled = true;
      clearOnboardingError();

      try {
        if (method === "ephemeral") {
          await handleEphemeralLogin(inviteCode, preview);
        } else if (method === "extension") {
          await handleExtensionLogin(inviteCode, preview);
        }
      } catch (err) {
        console.error("[TeamOnboarding] Login error:", err);
        showOnboardingError(err?.message || "Login failed. Please try again.");
        button.disabled = false;
      }
    });
  });
}

/**
 * Handle ephemeral (new identity) login
 */
async function handleEphemeralLogin(inviteCode, preview) {
  if (!isSecureContext()) {
    throw new Error("PIN encryption requires HTTPS.");
  }

  // Prompt for PIN
  const pin = await promptForNewPin();
  if (!pin) {
    throw new Error("PIN is required to securely store your key.");
  }

  const { pure } = await loadNostrLibs();

  // Generate new secret key
  const secretBytes = pure.generateSecretKey();
  const secretHex = bytesToHex(secretBytes);

  // Encrypt and store
  const encrypted = await encryptWithPin(secretHex, pin);
  localStorage.setItem(ENCRYPTED_SECRET_KEY, encrypted);
  localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "secret");
  localStorage.setItem(EPHEMERAL_SECRET_KEY, secretHex);

  // Sign login event
  const unsignedEvent = buildUnsignedEvent("ephemeral");
  const signedEvent = pure.finalizeEvent(unsignedEvent, secretBytes);

  // Complete login and join
  await completeLoginAndJoin(signedEvent, "ephemeral", inviteCode, preview, secretHex);
}

/**
 * Handle extension (NIP-07) login
 */
async function handleExtensionLogin(inviteCode, preview) {
  if (!window.nostr?.signEvent) {
    throw new Error("No Nostr extension found. Please install nos2x, Alby, or another NIP-07 extension.");
  }

  const unsignedEvent = buildUnsignedEvent("extension");
  unsignedEvent.pubkey = await window.nostr.getPublicKey();
  const signedEvent = await window.nostr.signEvent(unsignedEvent);

  await completeLoginAndJoin(signedEvent, "extension", inviteCode, preview, null);
}

/**
 * Wire up bunker form
 */
function wireBunkerForm(inviteCode, preview) {
  const form = document.querySelector("[data-bunker-form]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = form.querySelector("input[name='bunker']");
    const bunkerInput = input?.value.trim();
    if (!bunkerInput) return;

    form.classList.add("is-busy");
    clearOnboardingError();

    try {
      const { pure, nip46 } = await loadNostrLibs();
      const pointer = await nip46.parseBunkerInput(bunkerInput);
      if (!pointer) {
        throw new Error("Unable to parse bunker URI.");
      }

      const clientSecret = pure.generateSecretKey();
      const signer = new nip46.BunkerSigner(clientSecret, pointer);
      await signer.connect();

      const signedEvent = await signer.signEvent(buildUnsignedEvent("bunker"));
      await signer.close();

      await completeLoginAndJoin(signedEvent, "bunker", inviteCode, preview, null);
      input.value = "";
    } catch (err) {
      console.error("[TeamOnboarding] Bunker error:", err);
      showOnboardingError(err?.message || "Unable to connect to bunker.");
    } finally {
      form.classList.remove("is-busy");
    }
  });
}

/**
 * Wire up secret (nsec) form
 */
function wireSecretForm(inviteCode, preview) {
  const form = document.querySelector("[data-secret-form]");
  if (!form) return;

  // Wire toggle button
  const toggleBtn = form.querySelector("[data-toggle-secret]");
  toggleBtn?.addEventListener("click", () => {
    const input = form.querySelector("input[name='secret']");
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    toggleBtn.textContent = isPassword ? "\u{1F648}" : "\u{1F441}";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = form.querySelector("input[name='secret']");
    const nsec = input?.value.trim();
    if (!nsec) return;

    if (!isSecureContext()) {
      showOnboardingError("PIN encryption requires HTTPS.");
      return;
    }

    const pin = await promptForNewPin();
    if (!pin) {
      showOnboardingError("PIN is required to securely store your key.");
      return;
    }

    form.classList.add("is-busy");
    clearOnboardingError();

    try {
      const { pure, nip19 } = await loadNostrLibs();

      // Decode nsec
      const decoded = nip19.decode(nsec);
      if (decoded.type !== "nsec") {
        throw new Error("Invalid nsec format.");
      }
      const secretBytes = decoded.data;
      const secretHex = bytesToHex(secretBytes);

      // Encrypt and store
      const encrypted = await encryptWithPin(secretHex, pin);
      localStorage.setItem(ENCRYPTED_SECRET_KEY, encrypted);
      localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "secret");
      sessionStorage.setItem(EPHEMERAL_SECRET_KEY, secretHex);

      // Sign login event
      const signedEvent = pure.finalizeEvent(buildUnsignedEvent("secret"), secretBytes);

      await completeLoginAndJoin(signedEvent, "secret", inviteCode, preview, secretHex);
      input.value = "";
    } catch (err) {
      console.error("[TeamOnboarding] Secret login error:", err);
      showOnboardingError(err?.message || "Unable to sign in with secret.");
    } finally {
      form.classList.remove("is-busy");
    }
  });
}

/**
 * Complete login and join team
 */
async function completeLoginAndJoin(signedEvent, method, inviteCode, preview, secretHex) {
  showLoading(true);

  try {
    // Step 1: Login to server
    const loginRes = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, event: signedEvent }),
    });

    if (!loginRes.ok) {
      const data = await loginRes.json().catch(() => ({}));
      throw new Error(data?.message || "Login failed.");
    }

    const session = await loginRes.json();
    localStorage.setItem(AUTO_LOGIN_PUBKEY_KEY, session.pubkey);

    // Step 2: Redeem invite and get encrypted keys
    const redeemRes = await fetch("/api/team-invites/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: inviteCode }),
    });

    const redeemData = await redeemRes.json();

    if (!redeemData.success) {
      throw new Error(redeemData.error || "Failed to join team.");
    }

    // Already a member - redirect
    if (redeemData.alreadyMember) {
      window.location.href = `/t/${redeemData.team.slug}/chat`;
      return;
    }

    // Step 3: Zero-knowledge key exchange for team key (if present)
    if (redeemData.encryptedTeamKey) {
      await performKeyExchange(inviteCode, redeemData.encryptedTeamKey, redeemData.team.slug, session.pubkey, secretHex);
    }

    // Step 4: Redirect to team chat
    window.location.href = `/t/${redeemData.team.slug}/chat`;
  } catch (err) {
    showLoading(false);
    throw err;
  }
}

/**
 * Perform zero-knowledge key exchange for team key
 * Decrypt team key with invite-derived key, re-encrypt to user's pubkey
 */
async function performKeyExchange(inviteCode, encryptedTeamKey, teamSlug, _userPubkey, secretHex) {
  // Skip if no encrypted key or it's empty/invalid
  if (!encryptedTeamKey || typeof encryptedTeamKey !== "string" || encryptedTeamKey.length < 10) {
    console.log("[TeamOnboarding] No valid encrypted team key - skipping key exchange");
    return;
  }

  console.log("[TeamOnboarding] Performing key exchange for team key...");

  // Get user's secret key for wrapping
  let userSecretHex = secretHex;
  if (!userSecretHex) {
    userSecretHex = sessionStorage.getItem(EPHEMERAL_SECRET_KEY) || localStorage.getItem(EPHEMERAL_SECRET_KEY);
  }

  // For extension users, we can't re-encrypt with NIP-44 (no access to private key)
  // In this case, we skip key exchange - they'll need another method for encrypted content
  if (!userSecretHex) {
    console.log("[TeamOnboarding] No secret key available - skipping key exchange for extension user");
    return;
  }

  const userSecretBytes = hexToBytes(userSecretHex);
  const { pure, nip44 } = await loadNostrLibs();
  const derivedUserPubkey = pure.getPublicKey(userSecretBytes);

  // Derive encryption key from invite code
  const inviteKey = await deriveKeyFromCode(inviteCode);

  try {
    // Decrypt team key (encrypted with invite-derived key)
    const decrypted = await decryptWithInviteKey(encryptedTeamKey, inviteKey);

    // Re-encrypt to user's pubkey using NIP-44
    const conversationKey = nip44.v2.utils.getConversationKey(userSecretBytes, derivedUserPubkey);
    const userWrappedTeamKey = nip44.v2.encrypt(decrypted, conversationKey);

    // Store user's wrapped team key
    await fetch("/api/team-invites/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamSlug,
        teamKey: userWrappedTeamKey,
      }),
    });

    console.log("[TeamOnboarding] Key exchange completed successfully");
  } catch (err) {
    // Log the error but don't fail the whole join flow
    // The user is already a team member, they just won't have the key for encrypted content
    console.error("[TeamOnboarding] Key exchange failed (non-fatal):", err);
    // Don't throw - let the user continue to the team chat
  }
}

/**
 * Decrypt a value with the invite-derived key
 */
async function decryptWithInviteKey(encryptedBase64, inviteKey) {
  const encrypted = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    inviteKey,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Wire up join button for logged-in users
 */
function wireJoinButton(inviteCode, preview) {
  const joinBtn = document.querySelector("[data-join-team]");
  if (!joinBtn) return;

  joinBtn.addEventListener("click", async () => {
    joinBtn.disabled = true;
    clearOnboardingError();
    showLoading(true);

    try {
      // Get user's secret for key exchange
      const secretHex = sessionStorage.getItem(EPHEMERAL_SECRET_KEY) || localStorage.getItem(EPHEMERAL_SECRET_KEY);

      // Redeem invite
      const redeemRes = await fetch("/api/team-invites/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode }),
      });

      const redeemData = await redeemRes.json();

      if (!redeemData.success) {
        throw new Error(redeemData.error || "Failed to join team.");
      }

      if (redeemData.alreadyMember) {
        window.location.href = `/t/${redeemData.team.slug}/chat`;
        return;
      }

      // Key exchange for team key (if present)
      if (redeemData.encryptedTeamKey) {
        await performKeyExchange(inviteCode, redeemData.encryptedTeamKey, redeemData.team.slug, null, secretHex);
      }

      // Redirect
      window.location.href = `/t/${redeemData.team.slug}/chat`;
    } catch (err) {
      console.error("[TeamOnboarding] Join error:", err);
      showOnboardingError(err?.message || "Failed to join team. Please try again.");
      joinBtn.disabled = false;
      showLoading(false);
    }
  });
}

/**
 * Wire up switch account button
 */
function wireSwitchAccountButton() {
  const switchBtn = document.querySelector("[data-switch-account]");
  if (!switchBtn) return;

  switchBtn.addEventListener("click", async () => {
    // Logout and reload page
    await fetch("/auth/logout", { method: "POST" });
    window.location.reload();
  });
}

// ============================================================
// UI Helpers
// ============================================================

function showError(el, message) {
  if (!el) return;
  el.textContent = message;
  show(el);
}

function showOnboardingError(message) {
  // Try both onboarding-specific and auth panel error elements
  const el = document.querySelector("[data-login-error]") || document.querySelector("[data-onboarding-error]");
  if (!el) return;
  el.textContent = message;
  show(el);
}

function clearOnboardingError() {
  const el = document.querySelector("[data-login-error]") || document.querySelector("[data-onboarding-error]");
  if (!el) return;
  el.textContent = "";
  hide(el);
}

function showLoading(isLoading) {
  const loadingEl = document.querySelector("[data-onboarding-loading]");
  if (isLoading) {
    show(loadingEl);
  } else {
    hide(loadingEl);
  }
}

// ============================================================
// Auto-initialize
// ============================================================

// Initialize based on page type
if (window.__INVITE_CODE__) {
  // Team onboarding page
  document.addEventListener("DOMContentLoaded", initTeamOnboarding);
} else if (window.__NEEDS_ONBOARDING__) {
  // Legacy community onboarding
  document.addEventListener("DOMContentLoaded", initOnboarding);
}
