import {
  AUTO_LOGIN_METHOD_KEY,
  AUTO_LOGIN_PUBKEY_KEY,
  DEFAULT_RELAYS,
  EPHEMERAL_SECRET_KEY,
  ENCRYPTED_SECRET_KEY,
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
    localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "ephemeral");
    localStorage.setItem(AUTO_LOGIN_PUBKEY_KEY, session.pubkey);
  } else if (method === "secret") {
    // Keep encrypted secret - it was stored during login
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
    const res = await fetch("/chat/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });
    console.log("[Login] Save response:", res.status);
  } catch (err) {
    console.error("[Login] Failed to save user:", err);
  }

  await fetchSummaries();
  window.location.href = "/chat";
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
};
