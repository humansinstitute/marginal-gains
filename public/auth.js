import { chatUrl } from "./api.js";
import {
  AUTO_LOGIN_METHOD_KEY,
  AUTO_LOGIN_PUBKEY_KEY,
  BUNKER_CONNECTION_KEY,
  EPHEMERAL_SECRET_KEY,
  ENCRYPTED_SECRET_KEY,
  getRelays,
} from "./constants.js";
import { nostrConnectLog, bunkerLog, authLog } from "./debugLog.js";
import { closeAvatarMenu, fetchProfile } from "./avatar.js";
import { elements as el, hide, show } from "./dom.js";
import {
  buildUnsignedEvent,
  bytesToHex,
  decodeNsec,
  hexToBytes,
  loadNostrLibs,
  loadQRCodeLib,
} from "./nostr.js";
import { fetchSummaries } from "./summary.js";
import { clearError, showError } from "./ui.js";
import { setSession, setSummaries, state } from "./state.js";
import { encryptWithPin, decryptWithPin, isSecureContext } from "./pinCrypto.js";
import { initPinModal, promptForPin, promptForNewPin } from "./pinModal.js";

let autoLoginAttempted = false;

/**
 * Validates the current session with the server.
 * If session is invalid (401), clears client state and triggers auto-login.
 * This handles the case where server session expires while tab is hidden.
 */
const validateSession = async () => {
  if (!state.session) return;

  try {
    const res = await fetch("/chat/me");
    if (!res.ok) {
      authLog.info("Session expired on server, triggering re-login");
      setSession(null);
      autoLoginAttempted = false;
      void maybeAutoLogin();
    }
  } catch (err) {
    authLog.error("Session validation failed:", err);
  }
};

export const initAuth = () => {
  wireLoginButtons();
  wireForms();
  wireMenuButtons();
  wireQrModal();
  wireNostrConnectModal();
  wireSecretToggle();
  initPinModal();

  if (state.session) {
    void fetchSummaries();
  }

  // Check for Key Teleport first (URL param), then fragment login, then auto-login
  void checkKeyTeleport().then((handled) => {
    if (handled) return;
    return checkFragmentLogin();
  }).then(() => {
    if (!state.session) void maybeAutoLogin();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.session) {
        // Validate server session is still valid
        void validateSession();
      } else {
        void maybeAutoLogin();
      }
    }
  });
};

const wireLoginButtons = () => {
  const loginButtons = document.querySelectorAll("[data-login-method]");
  loginButtons.forEach((button) => {
    button.addEventListener("click", async (event) => {
      const target = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
      if (!target) return;
      const method = target.getAttribute("data-login-method");
      if (!method) return;
      target.disabled = true;
      clearError();
      try {
        // For new ephemeral key generation, use PIN-protected flow
        if (method === "ephemeral" && !localStorage.getItem(EPHEMERAL_SECRET_KEY)) {
          await handleNewEphemeralSignup(target);
          return;
        }
        const signedEvent = await signLoginEvent(method);
        await completeLogin(method, signedEvent);
      } catch (err) {
        console.error(err);
        showError(err?.message || "Login failed.");
      } finally {
        target.disabled = false;
      }
    });
  });
};

/**
 * Handle new ephemeral key generation with PIN protection
 * Treats it the same as importing an nsec
 */
const handleNewEphemeralSignup = async (button) => {
  try {
    // Check for secure context before PIN encryption
    if (!isSecureContext()) {
      showError("PIN encryption requires HTTPS. Please access via https:// or localhost.");
      return;
    }

    // Prompt for PIN to encrypt the new key
    const pin = await promptForNewPin();
    if (!pin) {
      showError("PIN is required to securely store your key.");
      return;
    }

    // Generate new secret key
    const { pure } = await loadNostrLibs();
    const secretBytes = pure.generateSecretKey();
    const secretHex = bytesToHex(secretBytes);

    // Encrypt and store the secret (same as nsec import)
    const encrypted = await encryptWithPin(secretHex, pin);
    localStorage.setItem(ENCRYPTED_SECRET_KEY, encrypted);
    localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "secret");

    // Also store unencrypted for current session operations
    // (will be cleared on logout, PIN-encrypted version persists)
    localStorage.setItem(EPHEMERAL_SECRET_KEY, secretHex);

    // Sign login event
    const signedEvent = pure.finalizeEvent(buildUnsignedEvent("ephemeral"), secretBytes);
    await completeLogin("ephemeral", signedEvent);
  } catch (err) {
    console.error(err);
    showError(err?.message || "Failed to create account.");
  } finally {
    button.disabled = false;
  }
};

const wireForms = () => {
  const bunkerForm = document.querySelector("[data-bunker-form]");
  const secretForm = document.querySelector("[data-secret-form]");

  bunkerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = bunkerForm.querySelector("input[name='bunker']");
    if (!input?.value.trim()) {
      showError("Enter a bunker nostrconnect URI or NIP-05 handle.");
      return;
    }
    const bunkerInput = input.value.trim();
    const inputType = bunkerInput.startsWith("bunker://") ? "bunker://" : bunkerInput.startsWith("nostrconnect://") ? "nostrconnect://" : "NIP-05";
    bunkerLog.info("Form submitted", { inputType });
    bunkerForm.classList.add("is-busy");
    clearError();
    try {
      bunkerLog.info("Calling signLoginEvent...");
      const signedEvent = await signLoginEvent("bunker", bunkerInput);
      bunkerLog.info("Got signed event, completing login...");
      await completeLogin("bunker", signedEvent);
      bunkerLog.info("Login complete!");
      input.value = "";
    } catch (err) {
      bunkerLog.error("Form submission failed:", err?.message || err);
      showError(err?.message || "Unable to connect to bunker.");
    } finally {
      bunkerForm.classList.remove("is-busy");
    }
  });

  secretForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = secretForm.querySelector("input[name='secret']");
    const nsec = input?.value.trim();
    if (!nsec) {
      showError("Paste an nsec secret key to continue.");
      return;
    }

    // Check for secure context before PIN encryption
    if (!isSecureContext()) {
      showError("PIN encryption requires HTTPS. Please access via https:// or localhost.");
      return;
    }

    // Prompt for PIN to encrypt the secret
    const pin = await promptForNewPin();
    if (!pin) {
      showError("PIN is required to securely store your key.");
      return;
    }

    secretForm.classList.add("is-busy");
    clearError();
    try {
      // Decode and validate nsec
      const { nip19 } = await loadNostrLibs();
      const secretBytes = decodeNsec(nip19, nsec);
      const secretHex = bytesToHex(secretBytes);

      // Encrypt and store the secret
      const encrypted = await encryptWithPin(secretHex, pin);
      localStorage.setItem(ENCRYPTED_SECRET_KEY, encrypted);
      localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "secret");

      // Store unencrypted in sessionStorage for current session (needed for NIP-44 decryption)
      // Cleared when app closes - PIN re-entry required on next open
      sessionStorage.setItem(EPHEMERAL_SECRET_KEY, secretHex);

      // Sign in
      const signedEvent = await signLoginEvent("secret", nsec);
      await completeLogin("secret", signedEvent);
      input.value = "";
    } catch (err) {
      console.error(err);
      showError(err?.message || "Unable to sign in with secret.");
    } finally {
      secretForm.classList.remove("is-busy");
    }
  });
};

const wireMenuButtons = () => {
  el.exportSecretBtn?.addEventListener("click", handleExportSecret);

  el.copyIdBtn?.addEventListener("click", async () => {
    closeAvatarMenu();
    const npub = state.session?.npub;
    if (!npub) {
      alert("No ID available.");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(npub);
        alert("ID copied to clipboard.");
      } else {
        prompt("Copy your ID:", npub);
      }
    } catch (_err) {
      prompt("Copy your ID:", npub);
    }
  });

  el.logoutBtn?.addEventListener("click", async () => {
    closeAvatarMenu();
    await fetch("/auth/logout", { method: "POST" });
    setSummaries({ day: null, week: null });
    setSession(null);
    clearAutoLogin();
  });
};

const wireQrModal = () => {
  el.showLoginQrBtn?.addEventListener("click", () => {
    closeAvatarMenu();
    void openQrModal();
  });
  el.qrCloseBtn?.addEventListener("click", closeQrModal);
  el.qrModal?.addEventListener("click", (event) => {
    if (event.target === el.qrModal) closeQrModal();
  });
};

const openQrModal = async () => {
  if (!el.qrModal || !el.qrContainer) return;
  if (state.session?.method !== "ephemeral") {
    alert("Login QR is only available for ephemeral accounts.");
    return;
  }
  const stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
  if (!stored) {
    alert("No secret key found.");
    return;
  }
  try {
    const { nip19 } = await loadNostrLibs();
    const QRCode = await loadQRCodeLib();
    const secret = hexToBytes(stored);
    const nsec = nip19.nsecEncode(secret);
    const loginUrl = `${window.location.origin}/#code=${nsec}`;
    el.qrContainer.innerHTML = "";
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, loginUrl, { width: 256, margin: 2 });
    el.qrContainer.appendChild(canvas);
    show(el.qrModal);
    document.addEventListener("keydown", handleQrEscape);
  } catch (err) {
    console.error("Failed to generate QR code", err);
    alert("Failed to generate QR code.");
  }
};

const closeQrModal = () => {
  hide(el.qrModal);
  document.removeEventListener("keydown", handleQrEscape);
};

const handleQrEscape = (event) => {
  if (event.key === "Escape") closeQrModal();
};

// Nostr Connect state
let nostrConnectAbort = null;
let nostrConnectTimer = null;

const wireNostrConnectModal = () => {
  const btn = document.querySelector("[data-nostr-connect]");
  const modal = document.querySelector("[data-nostr-connect-modal]");
  const closeBtn = document.querySelector("[data-nostr-connect-close]");
  const cancelBtn = document.querySelector("[data-nostr-connect-cancel]");
  const copyBtn = document.querySelector("[data-nostr-connect-copy]");

  btn?.addEventListener("click", () => {
    void openNostrConnectModal();
  });

  closeBtn?.addEventListener("click", closeNostrConnectModal);
  cancelBtn?.addEventListener("click", closeNostrConnectModal);

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) closeNostrConnectModal();
  });

  copyBtn?.addEventListener("click", async () => {
    const uriInput = document.querySelector("[data-nostr-connect-uri]");
    if (!uriInput?.value) return;
    try {
      await navigator.clipboard.writeText(uriInput.value);
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 2000);
    } catch (_err) {
      prompt("Copy this URI:", uriInput.value);
    }
  });
};

const openNostrConnectModal = async () => {
  nostrConnectLog.info("Opening modal, starting connection flow");
  const modal = document.querySelector("[data-nostr-connect-modal]");
  const qrContainer = document.querySelector("[data-nostr-connect-qr]");
  const uriInput = document.querySelector("[data-nostr-connect-uri]");
  const statusEl = document.querySelector("[data-nostr-connect-status]");
  const timerEl = document.querySelector("[data-nostr-connect-timer]");

  if (!modal || !qrContainer || !uriInput) return;

  // Show modal
  show(modal);
  document.addEventListener("keydown", handleNostrConnectEscape);

  // Clear previous state
  qrContainer.innerHTML = "<p>Generating...</p>";
  uriInput.value = "";
  if (statusEl) statusEl.textContent = "Generating connection...";
  if (timerEl) timerEl.textContent = "";

  try {
    const { pure, nip19 } = await loadNostrLibs();
    const QRCode = await loadQRCodeLib();

    // Generate ephemeral client keypair
    const clientSecretKey = pure.generateSecretKey();
    const clientPubkey = pure.getPublicKey(clientSecretKey);
    nostrConnectLog.info("Generated client pubkey", { pubkey: clientPubkey });

    // Generate random secret for verification
    const secretBytes = new Uint8Array(32);
    crypto.getRandomValues(secretBytes);
    const secret = bytesToHex(secretBytes);

    // Get app metadata
    const appName = window.__APP_NAME__ || "Marginal Gains";
    const appUrl = window.location.origin;
    const appImage = window.__APP_FAVICON__
      ? new URL(window.__APP_FAVICON__, appUrl).href
      : `${appUrl}/favicon.png`;

    // Build nostrconnect:// URI
    const relays = getRelays();
    nostrConnectLog.info("Using relays", { relays });
    const params = new URLSearchParams();
    relays.forEach((r) => params.append("relay", r));
    params.append("secret", secret);
    params.append("name", appName);
    params.append("url", appUrl);
    params.append("image", appImage);

    const nostrConnectUri = `nostrconnect://${clientPubkey}?${params.toString()}`;
    nostrConnectLog.info("Generated URI", { uri: nostrConnectUri.replace(secret, "***") });

    // Display URI
    uriInput.value = nostrConnectUri;

    // Generate QR code
    qrContainer.innerHTML = "";
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, nostrConnectUri, { width: 256, margin: 2 });
    qrContainer.appendChild(canvas);

    if (statusEl) statusEl.textContent = "Waiting for connection...";

    // Start countdown timer (60 seconds)
    let timeLeft = 60;
    if (timerEl) timerEl.textContent = `${timeLeft}s remaining`;
    nostrConnectTimer = setInterval(() => {
      timeLeft--;
      if (timerEl) timerEl.textContent = `${timeLeft}s remaining`;
      if (timeLeft <= 0) {
        closeNostrConnectModal();
        showError("Connection timed out. Please try again.");
      }
    }, 1000);

    // Set up abort controller
    nostrConnectAbort = new AbortController();

    // Wait for connection via NIP-46
    const result = await waitForNostrConnect(
      clientSecretKey,
      clientPubkey,
      secret,
      relays,
      nostrConnectAbort.signal
    );

    if (result) {
      nostrConnectLog.info("Connection successful", { remoteSignerPubkey: result.remoteSignerPubkey, signedEventPubkey: result.signedEvent?.pubkey });
      // Store bunker connection for persistence
      const connectionData = {
        clientSecretKey: bytesToHex(clientSecretKey),
        remoteSignerPubkey: result.remoteSignerPubkey,
        relays,
      };
      localStorage.setItem(BUNKER_CONNECTION_KEY, JSON.stringify(connectionData));
      localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "bunker");
      nostrConnectLog.info("Stored connection data for auto-login");

      closeNostrConnectModal();

      // Complete login with the signed event
      nostrConnectLog.info("Completing login with signed event");
      await completeLogin("bunker", result.signedEvent);
    } else {
      nostrConnectLog.warn("waitForNostrConnect returned null/undefined");
    }
  } catch (err) {
    if (err.name === "AbortError") {
      nostrConnectLog.info("Connection aborted by user");
      return;
    }
    nostrConnectLog.error("Connection failed", { error: err?.message || err });
    closeNostrConnectModal();
    showError(err?.message || "Failed to establish connection.");
  }
};

const waitForNostrConnect = async (clientSecretKey, clientPubkey, secret, relays, signal) => {
  nostrConnectLog.info("Setting up subscription for NIP-46 events");
  const { pure, nip19, nip44, SimplePool } = await loadNostrLibs();

  const pool = new SimplePool();
  const filter = { kinds: [24133], "#p": [clientPubkey], since: Math.floor(Date.now() / 1000) - 10 };
  nostrConnectLog.info("Subscription filter", { filter });

  return new Promise((resolve, reject) => {
    // Handle abort
    signal.addEventListener("abort", () => {
      nostrConnectLog.info("Subscription aborted");
      pool.close(relays);
      reject(new DOMException("Aborted", "AbortError"));
    });

    // Subscribe to kind 24133 events addressed to our client pubkey
    const sub = pool.subscribeMany(
      relays,
      [filter],
      {
        onevent: async (event) => {
          nostrConnectLog.info("Received event", { from: event.pubkey, kind: event.kind });
          try {
            // Decrypt the content using NIP-44
            const conversationKey = nip44.v2.utils.getConversationKey(clientSecretKey, event.pubkey);
            const decrypted = nip44.v2.decrypt(event.content, conversationKey);
            const message = JSON.parse(decrypted);

            nostrConnectLog.info("Decrypted message", { message });

            // Handle "connect" response with our secret
            if (message.result === secret || message.result === "ack") {
              nostrConnectLog.info("Received valid connect response");
              const remoteSignerPubkey = event.pubkey;

              // Now request get_public_key to get the user's actual pubkey
              nostrConnectLog.info("Requesting get_public_key from signer");
              const userPubkey = await requestFromSigner(
                pool,
                relays,
                clientSecretKey,
                clientPubkey,
                remoteSignerPubkey,
                { method: "get_public_key", params: [] }
              );
              nostrConnectLog.info("Got user pubkey", { userPubkey });

              // Request sign_event for login
              nostrConnectLog.info("Requesting sign_event for login");
              const unsignedEvent = buildUnsignedEvent("bunker");
              const signResult = await requestFromSigner(
                pool,
                relays,
                clientSecretKey,
                clientPubkey,
                remoteSignerPubkey,
                { method: "sign_event", params: [JSON.stringify(unsignedEvent)] }
              );
              nostrConnectLog.info("Got signed event result");

              const signedEvent = JSON.parse(signResult);
              nostrConnectLog.info("Parsed signed event", { pubkey: signedEvent?.pubkey });
              sub.close();
              pool.close(relays);

              resolve({ remoteSignerPubkey, signedEvent });
            } else if (message.error) {
              nostrConnectLog.warn("Received error from signer", { error: message.error });
            } else {
              nostrConnectLog.info("Message not a connect response", { result: message.result });
            }
          } catch (err) {
            nostrConnectLog.error("Error processing event", { error: err?.message || err });
          }
        },
        oneose: () => {
          nostrConnectLog.info("End of stored events, waiting for new events...");
        },
      }
    );
  });
};

const requestFromSigner = async (pool, relays, clientSecretKey, clientPubkey, remoteSignerPubkey, request) => {
  nostrConnectLog.info("requestFromSigner", { method: request.method });
  const { pure, nip44 } = await loadNostrLibs();

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const fullRequest = { id: requestId, ...request };
    nostrConnectLog.info("Sending request", { id: requestId, method: request.method });

    // Encrypt and send request
    const conversationKey = nip44.v2.utils.getConversationKey(clientSecretKey, remoteSignerPubkey);
    const encrypted = nip44.v2.encrypt(JSON.stringify(fullRequest), conversationKey);

    const requestEvent = pure.finalizeEvent(
      {
        kind: 24133,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", remoteSignerPubkey]],
        content: encrypted,
      },
      clientSecretKey
    );

    // Publish request
    nostrConnectLog.info("Publishing request to relays", { relays });
    pool.publish(relays, requestEvent);

    // Subscribe for response
    const sub = pool.subscribeMany(
      relays,
      [{ kinds: [24133], "#p": [clientPubkey], since: Math.floor(Date.now() / 1000) - 10 }],
      {
        onevent: async (event) => {
          try {
            const respConversationKey = nip44.v2.utils.getConversationKey(clientSecretKey, event.pubkey);
            const decrypted = nip44.v2.decrypt(event.content, respConversationKey);
            const message = JSON.parse(decrypted);

            if (message.id === requestId) {
              nostrConnectLog.info("Received response for request", { id: requestId });
              sub.close();
              if (message.error) {
                nostrConnectLog.error("Signer returned error", { error: message.error });
                reject(new Error(message.error));
              } else {
                nostrConnectLog.info("Request successful", { resultType: typeof message.result });
                resolve(message.result);
              }
            }
          } catch (err) {
            nostrConnectLog.error("Error parsing response", { error: err?.message || err });
          }
        },
      }
    );

    // Timeout after 30 seconds
    setTimeout(() => {
      nostrConnectLog.warn("Request timed out after 30s", { method: request.method });
      sub.close();
      reject(new Error("Request timed out"));
    }, 30000);
  });
};

const closeNostrConnectModal = () => {
  const modal = document.querySelector("[data-nostr-connect-modal]");
  hide(modal);
  document.removeEventListener("keydown", handleNostrConnectEscape);

  // Clear timer
  if (nostrConnectTimer) {
    clearInterval(nostrConnectTimer);
    nostrConnectTimer = null;
  }

  // Abort any pending connection
  if (nostrConnectAbort) {
    nostrConnectAbort.abort();
    nostrConnectAbort = null;
  }
};

const handleNostrConnectEscape = (event) => {
  if (event.key === "Escape") closeNostrConnectModal();
};

const wireSecretToggle = () => {
  document.querySelectorAll("[data-toggle-secret]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrapper = btn.closest(".secret-input-wrapper");
      const input = wrapper?.querySelector("input[name='secret']");
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      btn.textContent = isPassword ? "\u{1F648}" : "\u{1F441}";
      btn.setAttribute("aria-label", isPassword ? "Hide secret" : "Show secret");
    });
  });
};

/**
 * Check for Key Teleport login via URL parameter
 * Flow: ?keyteleport=<blob>&ic=<invite_code> -> POST to server -> receive ncryptsec -> prompt PIN -> decrypt -> login -> auto-redeem invite
 */
const checkKeyTeleport = async () => {
  const url = new URL(window.location.href);
  const blob = url.searchParams.get("keyteleport");
  if (!blob) return false;

  // Capture invite code before clearing URL params
  const inviteCode = url.searchParams.get("ic");

  // Clear the URL parameters immediately to prevent replay
  url.searchParams.delete("keyteleport");
  url.searchParams.delete("ic");
  history.replaceState(null, "", url.pathname + url.search);

  authLog.info("Key Teleport: Processing teleport request");

  // Show the overlay to indicate teleport in progress
  const overlay = document.querySelector("[data-keyteleport-overlay]");
  if (overlay) show(overlay);

  try {
    // Check for secure context before PIN operations
    if (!isSecureContext()) {
      showError("Key Teleport requires HTTPS. Please access via https:// or localhost.");
      if (overlay) hide(overlay);
      return true;
    }

    // Send the blob to the server for decryption and key retrieval
    const response = await fetch("/api/keyteleport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blob }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Key Teleport failed");
    }

    const { ncryptsec } = await response.json();
    if (!ncryptsec) {
      throw new Error("No key received from teleport");
    }

    // Hide overlay before showing PIN prompt
    if (overlay) hide(overlay);

    authLog.info("Key Teleport: Received ncryptsec, prompting for PIN");

    // Prompt for 6-digit PIN to decrypt the ncryptsec
    const pin = await promptForPin({
      title: "Key Teleport",
      subtitle: "Enter your 6-digit PIN to unlock",
    });

    if (!pin) {
      showError("PIN is required to complete key teleport.");
      return true;
    }

    // Decrypt the ncryptsec using NIP-49
    const { nip49, pure, nip19 } = await loadNostrLibs();

    let secretBytes;
    try {
      secretBytes = nip49.decrypt(ncryptsec, pin);
    } catch (err) {
      authLog.error("Key Teleport: PIN decryption failed", err);
      showError("Wrong PIN. Please try again.");
      return true;
    }

    const secretHex = bytesToHex(secretBytes);
    authLog.info("Key Teleport: Successfully decrypted key");

    // Store the ncryptsec (already encrypted with PIN) for auto-login
    localStorage.setItem(ENCRYPTED_SECRET_KEY, ncryptsec);
    localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "secret");

    // Store unencrypted in sessionStorage for current session operations
    sessionStorage.setItem(EPHEMERAL_SECRET_KEY, secretHex);

    // Sign login event and complete login
    const signedEvent = pure.finalizeEvent(buildUnsignedEvent("secret"), secretBytes);
    authLog.info("Key Teleport: Completing login");
    await completeLogin("secret", signedEvent, { skipRedirect: true }); // Don't redirect yet

    // If we have an invite code, auto-redeem it
    if (inviteCode) {
      authLog.info("Key Teleport: Auto-redeeming invite code");
      try {
        const redeemResponse = await fetch("/api/team-invites/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: inviteCode }),
        });
        const redeemData = await redeemResponse.json();
        if (redeemData.success && redeemData.team) {
          authLog.info(`Key Teleport: Joined team ${redeemData.team.slug}`);
          // Redirect to the team chat
          window.location.href = `/t/${redeemData.team.slug}/chat`;
          return true;
        } else if (redeemData.alreadyMember && redeemData.team) {
          authLog.info(`Key Teleport: Already a member of ${redeemData.team.slug}`);
          window.location.href = `/t/${redeemData.team.slug}/chat`;
          return true;
        } else {
          authLog.warn("Key Teleport: Invite redemption failed", redeemData.error);
        }
      } catch (err) {
        authLog.error("Key Teleport: Invite redemption error", err);
      }
    }

    // Default redirect if no invite code or redemption failed
    window.location.href = "/";
    return true;
  } catch (err) {
    console.error("Key Teleport failed", err);
    if (overlay) hide(overlay);
    showError(err?.message || "Key Teleport failed.");
    return true;
  }
};

const checkFragmentLogin = async () => {
  const hash = window.location.hash;
  if (!hash.startsWith("#code=")) return;
  const nsec = hash.slice(6);
  if (!nsec || !nsec.startsWith("nsec1")) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return;
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    const { nip19 } = await loadNostrLibs();
    const secretBytes = decodeNsec(nip19, nsec);
    const secretHex = bytesToHex(secretBytes);
    localStorage.setItem(EPHEMERAL_SECRET_KEY, secretHex);
    const signedEvent = await signLoginEvent("ephemeral");
    await completeLogin("ephemeral", signedEvent);
  } catch (err) {
    console.error("Fragment login failed", err);
    showError(err?.message || "Login failed.");
  }
};

const maybeAutoLogin = async () => {
  if (autoLoginAttempted || state.session) return;
  autoLoginAttempted = true;

  const method = localStorage.getItem(AUTO_LOGIN_METHOD_KEY);

  // Handle ephemeral auto-login
  if (method === "ephemeral") {
    const hasSecret = !!localStorage.getItem(EPHEMERAL_SECRET_KEY);
    if (!hasSecret) {
      autoLoginAttempted = false;
      return;
    }
    try {
      const signedEvent = await signLoginEvent("ephemeral");
      await completeLogin("ephemeral", signedEvent);
    } catch (err) {
      console.error("Auto login failed", err);
      clearAutoLogin();
      autoLoginAttempted = false;
    }
    return;
  }

  // Handle PIN-protected secret auto-login
  if (method === "secret") {
    const encryptedSecret = localStorage.getItem(ENCRYPTED_SECRET_KEY);
    if (!encryptedSecret) {
      autoLoginAttempted = false;
      return;
    }

    // Check for secure context before PIN decryption
    if (!isSecureContext()) {
      console.warn("[Auth] PIN decryption requires HTTPS");
      autoLoginAttempted = false;
      return;
    }

    // Detect format: ncryptsec (NIP-49) vs legacy (PBKDF2+AES-GCM)
    const isNip49 = encryptedSecret.startsWith("ncryptsec1");

    // Prompt for PIN
    const pin = await promptForPin({
      title: "Welcome back",
      subtitle: "Enter your PIN to unlock",
    });

    if (!pin) {
      autoLoginAttempted = false;
      return;
    }

    try {
      let secretBytes;
      let secretHex;

      if (isNip49) {
        // NIP-49 ncryptsec format (from Key Teleport)
        const { nip49, pure } = await loadNostrLibs();
        try {
          secretBytes = nip49.decrypt(encryptedSecret, pin);
          secretHex = bytesToHex(secretBytes);
        } catch (err) {
          authLog.error("NIP-49 decryption failed", err);
          autoLoginAttempted = false;
          showError("Wrong PIN. Try again.");
          return;
        }
      } else {
        // Legacy PBKDF2+AES-GCM format
        secretHex = await decryptWithPin(encryptedSecret, pin);
        if (!secretHex) {
          // Wrong PIN - let them try again
          autoLoginAttempted = false;
          showError("Wrong PIN. Try again.");
          return;
        }
        secretBytes = hexToBytes(secretHex);
      }

      // Store unencrypted in sessionStorage for current session (needed for NIP-44 decryption)
      // Cleared when app closes - PIN re-entry required on next open
      sessionStorage.setItem(EPHEMERAL_SECRET_KEY, secretHex);

      // Convert hex to bytes for signing
      const { pure } = await loadNostrLibs();
      const signedEvent = pure.finalizeEvent(buildUnsignedEvent("secret"), secretBytes);
      await completeLogin("secret", signedEvent);
    } catch (err) {
      console.error("Auto login with PIN failed", err);
      autoLoginAttempted = false;
    }
    return;
  }

  // Handle bunker auto-login (from Nostr Connect)
  if (method === "bunker") {
    bunkerLog.info("Starting auto-login flow");
    const connectionJson = localStorage.getItem(BUNKER_CONNECTION_KEY);
    if (!connectionJson) {
      bunkerLog.info("No stored connection data found");
      autoLoginAttempted = false;
      return;
    }

    try {
      const connection = JSON.parse(connectionJson);
      const { clientSecretKey, remoteSignerPubkey, relays } = connection;
      bunkerLog.info("Loaded connection", { remoteSignerPubkey: remoteSignerPubkey?.slice(0, 16) + "...", relays });

      if (!clientSecretKey || !remoteSignerPubkey || !relays?.length) {
        bunkerLog.warn("Invalid connection data", {
          hasClientSecret: !!clientSecretKey,
          hasRemoteSigner: !!remoteSignerPubkey,
          hasRelays: !!relays?.length,
        });
        clearAutoLogin();
        autoLoginAttempted = false;
        return;
      }

      bunkerLog.info("Attempting auto-login via NIP-46...");

      const { pure, nip44, SimplePool } = await loadNostrLibs();
      const clientSecret = hexToBytes(clientSecretKey);
      const clientPubkey = pure.getPublicKey(clientSecret);
      bunkerLog.info("Client pubkey", { pubkey: clientPubkey });
      const pool = new SimplePool();

      try {
        // Request sign_event for login
        bunkerLog.info("Requesting sign_event from remote signer");
        const unsignedEvent = buildUnsignedEvent("bunker");
        const signResult = await requestFromSigner(
          pool,
          relays,
          clientSecret,
          clientPubkey,
          remoteSignerPubkey,
          { method: "sign_event", params: [JSON.stringify(unsignedEvent)] }
        );

        bunkerLog.info("Received signed event from signer");
        const signedEvent = JSON.parse(signResult);
        bunkerLog.info("Signed event pubkey", { pubkey: signedEvent?.pubkey });
        pool.close(relays);

        bunkerLog.info("Completing login...");
        await completeLogin("bunker", signedEvent);
        bunkerLog.info("Auto-login successful!");
      } catch (err) {
        bunkerLog.error("Sign request failed", { error: err?.message || err });
        pool.close(relays);
        throw err;
      }
    } catch (err) {
      bunkerLog.error("Auto-login failed", { error: err?.message || err });
      // Don't clear auto-login on failure - user may just need to approve in signer
      autoLoginAttempted = false;
    }
    return;
  }

  autoLoginAttempted = false;
};

const signLoginEvent = async (method, supplemental) => {
  if (method === "ephemeral") {
    const { pure } = await loadNostrLibs();
    let stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
    if (!stored) {
      stored = bytesToHex(pure.generateSecretKey());
      localStorage.setItem(EPHEMERAL_SECRET_KEY, stored);
    }
    const secret = hexToBytes(stored);
    return pure.finalizeEvent(buildUnsignedEvent(method), secret);
  }

  if (method === "extension") {
    if (!window.nostr?.signEvent) {
      throw new Error("No NIP-07 browser extension found.");
    }
    const event = buildUnsignedEvent(method);
    event.pubkey = await window.nostr.getPublicKey();
    return window.nostr.signEvent(event);
  }

  if (method === "bunker") {
    bunkerLog.info("signLoginEvent - parsing bunker input");
    const { pure, nip46 } = await loadNostrLibs();
    const pointer = await nip46.parseBunkerInput(supplemental || "");
    if (!pointer) {
      bunkerLog.error("Failed to parse bunker input", { input: supplemental });
      throw new Error("Unable to parse bunker details.");
    }
    bunkerLog.info("Parsed pointer", { pubkey: pointer.pubkey?.slice(0, 16) + "...", relays: pointer.relays });
    const clientSecret = pure.generateSecretKey();
    const signer = new nip46.BunkerSigner(clientSecret, pointer);
    bunkerLog.info("Connecting to signer...");
    await signer.connect();
    bunkerLog.info("Connected! Requesting signature...");
    try {
      const signedEvent = await signer.signEvent(buildUnsignedEvent(method));
      bunkerLog.info("Got signature", { pubkey: signedEvent?.pubkey });
      return signedEvent;
    } finally {
      bunkerLog.info("Closing signer connection");
      await signer.close();
    }
  }

  if (method === "secret") {
    const { pure, nip19 } = await loadNostrLibs();
    const secret = decodeNsec(nip19, supplemental || "");
    return pure.finalizeEvent(buildUnsignedEvent(method), secret);
  }

  throw new Error("Unsupported login method.");
};

const completeLogin = async (method, event, options = {}) => {
  const { skipRedirect = false } = options;

  const response = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, event }),
  });
  if (!response.ok) {
    let message = "Login failed.";
    try {
      const data = await response.json();
      if (data?.message) message = data.message;
    } catch (_err) {}
    throw new Error(message);
  }
  const session = await response.json();
  setSession(session);
  if (method === "ephemeral") {
    // If we have a PIN-encrypted key, use "secret" method for auto-login
    // Otherwise fall back to unencrypted ephemeral (legacy)
    if (localStorage.getItem(ENCRYPTED_SECRET_KEY)) {
      localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "secret");
    } else {
      localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "ephemeral");
    }
    localStorage.setItem(AUTO_LOGIN_PUBKEY_KEY, session.pubkey);
  } else if (method === "secret") {
    // Keep encrypted secret - it was stored during login
    localStorage.setItem(AUTO_LOGIN_PUBKEY_KEY, session.pubkey);
  } else if (method === "bunker") {
    // Bunker connection was already stored - just save the pubkey
    localStorage.setItem(AUTO_LOGIN_PUBKEY_KEY, session.pubkey);
  } else {
    clearAutoLogin();
  }

  // Fetch profile from relays and save to server database
  try {
    console.log("[Login] Fetching profile for", session.pubkey);
    const profile = await fetchProfile(session.pubkey);
    console.log("[Login] Got profile:", profile);
    const userData = {
      npub: session.npub,
      pubkey: session.pubkey,
      displayName: profile?.displayName || profile?.name || null,
      name: profile?.name || null,
      about: profile?.about || null,
      picture: profile?.picture || null,
      nip05: profile?.nip05 || null,
    };
    console.log("[Login] Saving user data:", userData);
    const res = await fetch(chatUrl("/users"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });
    console.log("[Login] Save response:", res.status);
  } catch (err) {
    console.error("[Login] Failed to save user:", err);
  }

  await fetchSummaries();

  // If skipRedirect is true, return session without redirecting
  if (skipRedirect) {
    return session;
  }

  // Redirect priority: 1) return path, 2) team context, 3) default
  const returnPath = window.__RETURN_PATH__;
  // Only allow relative paths starting with / to prevent open redirects
  if (returnPath && returnPath.startsWith("/") && !returnPath.startsWith("//")) {
    window.location.href = returnPath;
  } else if (session.currentTeamSlug) {
    // User has a team context - go directly to team chat
    window.location.href = `/t/${session.currentTeamSlug}/chat`;
  } else {
    // No team context - go to teams page to select one
    window.location.href = "/teams";
  }
};

const handleExportSecret = async () => {
  closeAvatarMenu();
  if (state.session?.method !== "ephemeral") {
    alert("Export is only available for ephemeral accounts.");
    return;
  }
  const stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
  if (!stored) {
    alert("No secret key found.");
    return;
  }
  try {
    const { nip19 } = await loadNostrLibs();
    const secret = hexToBytes(stored);
    const nsec = nip19.nsecEncode(secret);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(nsec);
      alert("Secret key copied to clipboard!\n\nKeep this safe - anyone with this key can access your account.");
    } else {
      prompt("Copy your secret key (keep it safe):", nsec);
    }
  } catch (err) {
    console.error(err);
    alert("Failed to export secret key.");
  }
};

const clearAutoLogin = () => {
  localStorage.removeItem(AUTO_LOGIN_METHOD_KEY);
  localStorage.removeItem(AUTO_LOGIN_PUBKEY_KEY);
  localStorage.removeItem(ENCRYPTED_SECRET_KEY);
  localStorage.removeItem(BUNKER_CONNECTION_KEY);
  // Clear unencrypted secret from both storage types
  sessionStorage.removeItem(EPHEMERAL_SECRET_KEY);
  localStorage.removeItem(EPHEMERAL_SECRET_KEY);
};

// Export for settings page
export const clearBunkerConnection = () => {
  localStorage.removeItem(BUNKER_CONNECTION_KEY);
  const method = localStorage.getItem(AUTO_LOGIN_METHOD_KEY);
  if (method === "bunker") {
    localStorage.removeItem(AUTO_LOGIN_METHOD_KEY);
    localStorage.removeItem(AUTO_LOGIN_PUBKEY_KEY);
  }
};

export const hasBunkerConnection = () => {
  return !!localStorage.getItem(BUNKER_CONNECTION_KEY);
};
