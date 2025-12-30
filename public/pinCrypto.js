/**
 * PIN-based encryption for storing secrets
 * Uses PBKDF2 for key derivation and AES-GCM for encryption
 */

/**
 * Check if Web Crypto API is available (requires HTTPS or localhost)
 * @returns {boolean}
 */
export function isSecureContext() {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

/**
 * Throw a helpful error if not in a secure context
 */
function requireSecureContext() {
  if (!isSecureContext()) {
    throw new Error(
      "PIN encryption requires HTTPS. " +
        "Please access via https:// or localhost."
    );
  }
}

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100000;

/**
 * Encrypt a secret with a 4-digit PIN
 * @param {string} secretHex - The secret as a hex string
 * @param {string} pin - 4-digit PIN
 * @returns {Promise<string>} Base64-encoded encrypted data
 */
export async function encryptWithPin(secretHex, pin) {
  requireSecureContext();
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Derive key from PIN using PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // Add a verification prefix so we can detect wrong PIN
  const dataToEncrypt = "OK:" + secretHex;
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(dataToEncrypt)
  );

  // Combine salt + iv + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a secret with a 4-digit PIN
 * @param {string} encryptedBase64 - Base64-encoded encrypted data
 * @param {string} pin - 4-digit PIN
 * @returns {Promise<string|null>} The decrypted secret hex, or null if PIN is wrong
 */
export async function decryptWithPin(encryptedBase64, pin) {
  requireSecureContext();
  try {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

    // Derive key from PIN using PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(pin),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    const decryptedText = decoder.decode(decrypted);

    // Verify the prefix
    if (!decryptedText.startsWith("OK:")) {
      return null;
    }

    return decryptedText.slice(3);
  } catch {
    // Decryption failed (wrong PIN)
    return null;
  }
}

/**
 * Check if there's an encrypted secret stored
 * @returns {boolean}
 */
export function hasEncryptedSecret() {
  return !!localStorage.getItem("nostr_encrypted_secret");
}

/**
 * Store encrypted secret
 * @param {string} encryptedData
 */
export function storeEncryptedSecret(encryptedData) {
  localStorage.setItem("nostr_encrypted_secret", encryptedData);
  localStorage.setItem("nostr_auto_login_method", "secret");
}

/**
 * Get stored encrypted secret
 * @returns {string|null}
 */
export function getEncryptedSecret() {
  return localStorage.getItem("nostr_encrypted_secret");
}

/**
 * Clear encrypted secret
 */
export function clearEncryptedSecret() {
  localStorage.removeItem("nostr_encrypted_secret");
}
