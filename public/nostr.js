import { APP_TAG, LOGIN_KIND } from "./constants.js";

export const loadNostrLibs = async () => {
  if (!window.__NOSTR_LIBS__) {
    const base = "https://esm.sh/nostr-tools@2.7.2";
    const [pure, nip19, nip46, nip44, nip49, pool] = await Promise.all([
      import(`${base}/pure?bundle`),
      import(`${base}/nip19?bundle`),
      import(`${base}/nip46?bundle`),
      import(`${base}/nip44?bundle`),
      import(`${base}/nip49?bundle`),
      import(`${base}/pool?bundle`),
    ]);
    window.__NOSTR_LIBS__ = {
      pure,
      nip19,
      nip46,
      nip44,
      nip49,
      SimplePool: pool.SimplePool,
    };
  }
  return window.__NOSTR_LIBS__;
};

export const loadApplesauceLibs = async () => {
  if (!window.__APPLESAUCE_LIBS__) {
    window.__APPLESAUCE_LIBS__ = {
      relay: await import("https://esm.sh/applesauce-relay@4.0.0?bundle"),
      helpers: await import("https://esm.sh/applesauce-core@4.0.0/helpers?bundle"),
      rxjs: await import("https://esm.sh/rxjs@7.8.1?bundle"),
    };
  }
  return window.__APPLESAUCE_LIBS__;
};

export const loadQRCodeLib = async () => {
  if (!window.__QRCODE_LIB__) {
    const mod = await import("https://esm.sh/qrcode@1.5.3");
    window.__QRCODE_LIB__ = mod.default || mod;
  }
  return window.__QRCODE_LIB__;
};

export const hexToBytes = (hex) => {
  if (!hex) return new Uint8Array();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
};

export const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

export const decodeNsec = (nip19, input) => {
  // Validate input format first
  if (!input || typeof input !== "string") {
    throw new Error("Please enter an nsec key.");
  }

  const trimmed = input.trim();
  if (!trimmed.startsWith("nsec1")) {
    throw new Error("Key must start with 'nsec1'. Got: " + trimmed.slice(0, 10) + "...");
  }

  // nsec keys are 63 characters (nsec1 + 58 chars)
  if (trimmed.length !== 63) {
    throw new Error(`Invalid nsec length: ${trimmed.length} chars (expected 63).`);
  }

  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nsec" || !decoded.data) {
      throw new Error("Decoded but not a valid nsec key.");
    }
    if (decoded.data instanceof Uint8Array) return decoded.data;
    if (Array.isArray(decoded.data)) return new Uint8Array(decoded.data);
    throw new Error("Unable to read nsec payload.");
  } catch (err) {
    // Preserve original error message for debugging
    throw new Error(err.message || "Failed to decode nsec key.");
  }
};

export const buildUnsignedEvent = (method) => ({
  kind: LOGIN_KIND,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["app", APP_TAG],
    ["method", method],
  ],
  content: "Authenticate with Other Stuff To Do",
});
