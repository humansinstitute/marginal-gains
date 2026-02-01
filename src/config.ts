import { join } from "path";

import { getPublicKey, nip19 } from "nostr-tools";

export const PORT = Number(Bun.env.PORT ?? 3000);
export const SESSION_COOKIE = "nostr_session";
export const LOGIN_EVENT_KIND = 27235;
export const LOGIN_MAX_AGE_SECONDS = 60;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const COOKIE_SECURE = Bun.env.NODE_ENV === "production";
export const APP_NAME_DEFAULT = "Marginal Gains";
export const APP_TAG = "marginal-gains";
export const PUBLIC_DIR = join(import.meta.dir, "../public");
export const PUSH_CONTACT_EMAIL = Bun.env.PUSH_CONTACT_EMAIL || "admin@example.com";

// Nostr relays - comma separated list in env, or defaults
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.devvul.com",
  "wss://purplepag.es",
];
export const NOSTR_RELAYS: string[] = Bun.env.NOSTR_RELAYS
  ? Bun.env.NOSTR_RELAYS.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_RELAYS;

// Admin npubs - comma separated list in env (supports both ADMIN_NPUBS and ADMIN_NPUB)
export const ADMIN_NPUBS: string[] = (Bun.env.ADMIN_NPUBS ?? Bun.env.ADMIN_NPUB ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.startsWith("npub"));

export function isAdmin(npub: string): boolean {
  return ADMIN_NPUBS.includes(npub);
}

export const STATIC_FILES = new Map<string, string>([
  ["/favicon.ico", "favicon.png"],
  ["/favicon.png", "favicon.png"],
  ["/apple-touch-icon.png", "apple-touch-icon.png"],
  ["/icon-192.png", "icon-192.png"],
  ["/icon-512.png", "icon-512.png"],
  // manifest.webmanifest is now served dynamically from app-settings
  ["/app.js", "app.js"],
  ["/app.css", "app.css"],
  ["/sw.js", "sw.js"],
]);

// OpenRouter API configuration
export const OR_API_KEY = Bun.env.OR_API_KEY ?? "";

// Wingman bot configuration
export const WINGMAN_KEY = Bun.env.WINGMAN_KEY ?? "";

// Default Wingman settings
export const WINGMAN_DEFAULT_SYSTEM_PROMPT =
  "You are wingman, and you will be responding to user questions. Be direct, clever and kind.";
export const WINGMAN_DEFAULT_MODEL = "anthropic/claude-sonnet-4";

// Derive Wingman identity from nsec or hex private key
export function getWingmanIdentity(): {
  npub: string;
  pubkey: string;
  secretKey: Uint8Array;
} | null {
  if (!WINGMAN_KEY) {
    console.log("[Wingman] No WINGMAN_KEY configured");
    return null;
  }

  try {
    let secretKey: Uint8Array;

    if (WINGMAN_KEY.startsWith("nsec")) {
      // nsec format
      const decoded = nip19.decode(WINGMAN_KEY);
      if (decoded.type !== "nsec") {
        console.error("[Wingman] WINGMAN_KEY is not a valid nsec");
        return null;
      }
      secretKey = decoded.data as Uint8Array;
    } else if (/^[0-9a-fA-F]{64}$/.test(WINGMAN_KEY)) {
      // Hex format (64 hex chars = 32 bytes)
      secretKey = hexToBytes(WINGMAN_KEY);
    } else {
      console.error("[Wingman] WINGMAN_KEY must be nsec or 64-char hex");
      return null;
    }

    const pubkey = getPublicKey(secretKey);
    const npub = nip19.npubEncode(pubkey);

    console.log(`[Wingman] Identity loaded: ${npub.slice(0, 20)}...`);
    return { npub, pubkey, secretKey };
  } catch (err) {
    console.error("[Wingman] Failed to decode WINGMAN_KEY:", err);
    return null;
  }
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Startup logging for Wingman config
if (OR_API_KEY) {
  console.log(`[Wingman] OR_API_KEY configured (${OR_API_KEY.slice(0, 10)}...)`);
} else {
  console.log("[Wingman] OR_API_KEY not configured");
}

if (WINGMAN_KEY) {
  console.log(`[Wingman] WINGMAN_KEY configured (${WINGMAN_KEY.slice(0, 10)}...)`);
  // Eagerly validate the key on startup
  getWingmanIdentity();
} else {
  console.log("[Wingman] WINGMAN_KEY not configured");
}

// Key Teleport v2 configuration
// Only KEYTELEPORT_PRIVKEY is needed - decryption success validates the recipient
export const KEYTELEPORT_PRIVKEY = Bun.env.KEYTELEPORT_PRIVKEY ?? "";

// Welcome API configuration (for fetching user groups and invite codes)
export const WELCOME_API_URL = Bun.env.WELCOME_API_URL ?? "https://welcome.otherstuff.ai";

// Optikon visual boards integration
export const OPTIKON_URL = Bun.env.OPTIKON_URL ?? "https://optikon.otherstuff.ai";

// Derive Key Teleport identity from nsec or hex private key
export function getKeyTeleportIdentity(): {
  npub: string;
  pubkey: string;
  secretKey: Uint8Array;
} | null {
  if (!KEYTELEPORT_PRIVKEY) {
    return null;
  }

  try {
    let secretKey: Uint8Array;

    if (KEYTELEPORT_PRIVKEY.startsWith("nsec")) {
      const decoded = nip19.decode(KEYTELEPORT_PRIVKEY);
      if (decoded.type !== "nsec") {
        console.error("[KeyTeleport] KEYTELEPORT_PRIVKEY is not a valid nsec");
        return null;
      }
      secretKey = decoded.data as Uint8Array;
    } else if (/^[0-9a-fA-F]{64}$/.test(KEYTELEPORT_PRIVKEY)) {
      secretKey = hexToBytes(KEYTELEPORT_PRIVKEY);
    } else {
      console.error("[KeyTeleport] KEYTELEPORT_PRIVKEY must be nsec or 64-char hex");
      return null;
    }

    const pubkey = getPublicKey(secretKey);
    const npub = nip19.npubEncode(pubkey);

    return { npub, pubkey, secretKey };
  } catch (err) {
    console.error("[KeyTeleport] Failed to decode KEYTELEPORT_PRIVKEY:", err);
    return null;
  }
}

// Startup logging for Key Teleport config
if (KEYTELEPORT_PRIVKEY) {
  const identity = getKeyTeleportIdentity();
  if (identity) {
    console.log(`[KeyTeleport] Configured with pubkey ${identity.pubkey.slice(0, 12)}...`);
  }
}

// Startup logging for Welcome API config
if (WELCOME_API_URL) {
  console.log(`[Welcome API] URL: ${WELCOME_API_URL}`);
}
