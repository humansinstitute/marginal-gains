import { chatUrl } from "./api.js";
import {
  AUTO_LOGIN_METHOD_KEY,
  AUTO_LOGIN_PUBKEY_KEY,
  BUNKER_CONNECTION_KEY,
  EPHEMERAL_SECRET_KEY,
  ENCRYPTED_SECRET_KEY,
  getRelays,
} from "./constants.js";
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

  void checkFragmentLogin().then(() => {
    if (!state.session) void maybeAutoLogin();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !state.session) {
      void maybeAutoLogin();
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
    bunkerForm.classList.add("is-busy");
    clearError();
    try {
      const signedEvent = await signLoginEvent("bunker", input.value.trim());
      await completeLogin("bunker", signedEvent);
      input.value = "";
    } catch (err) {
      console.error(err);
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
    const params = new URLSearchParams();
    relays.forEach((r) => params.append("relay", r));
    params.append("secret", secret);
    params.append("name", appName);
    params.append("url", appUrl);
    params.append("image", appImage);

    const nostrConnectUri = `nostrconnect://${clientPubkey}?${params.toString()}`;

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
      // Store bunker connection for persistence
      const connectionData = {
        clientSecretKey: bytesToHex(clientSecretKey),
        remoteSignerPubkey: result.remoteSignerPubkey,
        relays,
      };
      localStorage.setItem(BUNKER_CONNECTION_KEY, JSON.stringify(connectionData));
      localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "bunker");

      closeNostrConnectModal();

      // Complete login with the signed event
      await completeLogin("bunker", result.signedEvent);
    }
  } catch (err) {
    if (err.name === "AbortError") {
      // User cancelled
      return;
    }
    console.error("Nostr Connect failed:", err);
    closeNostrConnectModal();
    showError(err?.message || "Failed to establish connection.");
  }
};

const waitForNostrConnect = async (clientSecretKey, clientPubkey, secret, relays, signal) => {
  const { pure, nip19, nip44, SimplePool } = await loadNostrLibs();

  const pool = new SimplePool();

  return new Promise((resolve, reject) => {
    // Handle abort
    signal.addEventListener("abort", () => {
      pool.close(relays);
      reject(new DOMException("Aborted", "AbortError"));
    });

    // Subscribe to kind 24133 events addressed to our client pubkey
    const sub = pool.subscribeMany(
      relays,
      [{ kinds: [24133], "#p": [clientPubkey], since: Math.floor(Date.now() / 1000) - 10 }],
      {
        onevent: async (event) => {
          try {
            // Decrypt the content using NIP-44
            const conversationKey = nip44.v2.utils.getConversationKey(clientSecretKey, event.pubkey);
            const decrypted = nip44.v2.decrypt(event.content, conversationKey);
            const message = JSON.parse(decrypted);

            console.log("[NostrConnect] Received message:", message);

            // Handle "connect" response with our secret
            if (message.result === secret || message.result === "ack") {
              const remoteSignerPubkey = event.pubkey;

              // Now request get_public_key to get the user's actual pubkey
              const userPubkey = await requestFromSigner(
                pool,
                relays,
                clientSecretKey,
                clientPubkey,
                remoteSignerPubkey,
                { method: "get_public_key", params: [] }
              );

              // Request sign_event for login
              const unsignedEvent = buildUnsignedEvent("bunker");
              const signResult = await requestFromSigner(
                pool,
                relays,
                clientSecretKey,
                clientPubkey,
                remoteSignerPubkey,
                { method: "sign_event", params: [JSON.stringify(unsignedEvent)] }
              );

              const signedEvent = JSON.parse(signResult);
              sub.close();
              pool.close(relays);

              resolve({ remoteSignerPubkey, signedEvent });
            }
          } catch (err) {
            console.error("[NostrConnect] Error processing event:", err);
          }
        },
        oneose: () => {
          console.log("[NostrConnect] End of stored events");
        },
      }
    );
  });
};

const requestFromSigner = async (pool, relays, clientSecretKey, clientPubkey, remoteSignerPubkey, request) => {
  const { pure, nip44 } = await loadNostrLibs();

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const fullRequest = { id: requestId, ...request };

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
              sub.close();
              if (message.error) {
                reject(new Error(message.error));
              } else {
                resolve(message.result);
              }
            }
          } catch (err) {
            console.error("[NostrConnect] Error parsing response:", err);
          }
        },
      }
    );

    // Timeout after 30 seconds
    setTimeout(() => {
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
      const secretHex = await decryptWithPin(encryptedSecret, pin);
      if (!secretHex) {
        // Wrong PIN - let them try again
        autoLoginAttempted = false;
        showError("Wrong PIN. Try again.");
        return;
      }

      // Convert hex to bytes for signing
      const secretBytes = hexToBytes(secretHex);
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
    const connectionJson = localStorage.getItem(BUNKER_CONNECTION_KEY);
    if (!connectionJson) {
      autoLoginAttempted = false;
      return;
    }

    try {
      const connection = JSON.parse(connectionJson);
      const { clientSecretKey, remoteSignerPubkey, relays } = connection;

      if (!clientSecretKey || !remoteSignerPubkey || !relays?.length) {
        console.warn("[Auth] Invalid bunker connection data");
        clearAutoLogin();
        autoLoginAttempted = false;
        return;
      }

      console.log("[Auth] Attempting bunker auto-login...");

      const { pure, nip44, SimplePool } = await loadNostrLibs();
      const clientSecret = hexToBytes(clientSecretKey);
      const clientPubkey = pure.getPublicKey(clientSecret);
      const pool = new SimplePool();

      try {
        // Request sign_event for login
        const unsignedEvent = buildUnsignedEvent("bunker");
        const signResult = await requestFromSigner(
          pool,
          relays,
          clientSecret,
          clientPubkey,
          remoteSignerPubkey,
          { method: "sign_event", params: [JSON.stringify(unsignedEvent)] }
        );

        const signedEvent = JSON.parse(signResult);
        pool.close(relays);

        await completeLogin("bunker", signedEvent);
      } catch (err) {
        pool.close(relays);
        throw err;
      }
    } catch (err) {
      console.error("Bunker auto login failed", err);
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
    const { pure, nip46 } = await loadNostrLibs();
    const pointer = await nip46.parseBunkerInput(supplemental || "");
    if (!pointer) throw new Error("Unable to parse bunker details.");
    const clientSecret = pure.generateSecretKey();
    const signer = new nip46.BunkerSigner(clientSecret, pointer);
    await signer.connect();
    try {
      return await signer.signEvent(buildUnsignedEvent(method));
    } finally {
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

const completeLogin = async (method, event) => {
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

  // Redirect based on team context
  if (session.currentTeamSlug) {
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
