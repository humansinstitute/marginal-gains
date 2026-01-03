/**
 * Client-side wallet module for NWC integration
 * Handles encrypted storage and wallet connection flow
 */

import { encryptWithPin, decryptWithPin, isSecureContext } from './pinCrypto.js';
import { promptForPin, promptForNewPin } from './pinModal.js';
import { onEvent } from './liveUpdates.js';

const NWC_STORAGE_KEY = 'nwc_encrypted_uri';

// State
let walletConnected = false;

/**
 * Check if encrypted NWC URI exists in localStorage
 */
export function hasStoredWallet() {
  return !!localStorage.getItem(NWC_STORAGE_KEY);
}

/**
 * Store encrypted NWC URI
 */
export async function storeWalletUri(uri, pin) {
  if (!isSecureContext()) {
    throw new Error('Secure context required for encryption');
  }
  const encrypted = await encryptWithPin(uri, pin);
  localStorage.setItem(NWC_STORAGE_KEY, encrypted);
}

/**
 * Retrieve and decrypt NWC URI
 */
export async function getWalletUri(pin) {
  const encrypted = localStorage.getItem(NWC_STORAGE_KEY);
  if (!encrypted) {
    throw new Error('No wallet stored');
  }
  const uri = await decryptWithPin(encrypted, pin);
  if (!uri) {
    throw new Error('Invalid PIN');
  }
  return uri;
}

/**
 * Clear stored wallet
 */
export function clearStoredWallet() {
  localStorage.removeItem(NWC_STORAGE_KEY);
  walletConnected = false;
}

/**
 * Connect wallet to server (send decrypted URI)
 */
async function sendWalletToServer(uri) {
  const response = await fetch('/api/wallet/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uri }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to connect wallet');
  }
  walletConnected = true;
}

/**
 * Disconnect wallet from server
 */
export async function disconnectWallet() {
  await fetch('/api/wallet/disconnect', { method: 'DELETE' });
  walletConnected = false;
}

/**
 * Check wallet connection status
 */
export async function checkWalletStatus() {
  try {
    const response = await fetch('/api/wallet/status');
    const data = await response.json();
    walletConnected = data.connected;
    return data.connected;
  } catch {
    walletConnected = false;
    return false;
  }
}

/**
 * Get wallet balance from server
 */
export async function getBalance() {
  const response = await fetch('/api/wallet/balance');
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to get balance');
  }
  return response.json();
}

/**
 * Get cached transactions from server
 */
export async function getTransactions(limit = 50) {
  const response = await fetch(`/api/wallet/transactions?limit=${limit}`);
  if (!response.ok) {
    throw new Error('Failed to get transactions');
  }
  return response.json();
}

/**
 * Connect a new wallet (first time setup)
 */
export async function setupNewWallet(uri) {
  // Validate URI format
  if (!uri.startsWith('nostr+walletconnect://')) {
    throw new Error('Invalid NWC URI format. Should start with nostr+walletconnect://');
  }

  // Prompt for new PIN
  const pin = await promptForNewPin();
  if (!pin) {
    throw new Error('PIN required to encrypt wallet');
  }

  // Encrypt and store
  await storeWalletUri(uri, pin);

  // Connect to server
  await sendWalletToServer(uri);

  return true;
}

/**
 * Unlock existing wallet with PIN
 */
export async function unlockWallet() {
  if (!hasStoredWallet()) {
    throw new Error('No wallet stored');
  }

  // Prompt for PIN
  const pin = await promptForPin({
    title: 'Unlock Wallet',
    subtitle: 'Enter your PIN to connect wallet',
  });

  if (!pin) {
    throw new Error('PIN required to unlock wallet');
  }

  // Decrypt URI
  const uri = await getWalletUri(pin);

  // Connect to server
  await sendWalletToServer(uri);

  return true;
}

/**
 * Initialize wallet event handlers
 */
export function initWalletEvents() {
  onEvent('wallet:balance', (data) => {
    console.log('[Wallet] Balance update:', data);
    // Could update UI here if needed
  });

  onEvent('wallet:transaction', (data) => {
    console.log('[Wallet] Transaction:', data);
    // Could update UI here if needed
  });
}

/**
 * Render wallet connection UI element
 */
export function renderWalletStatus(container) {
  if (!container) return;

  const updateUI = async () => {
    const hasWallet = hasStoredWallet();
    const connected = await checkWalletStatus();

    container.innerHTML = `
      <div class="wallet-status">
        ${connected
          ? '<span class="wallet-connected">Wallet Connected</span>'
          : hasWallet
            ? '<button id="wallet-unlock-btn" class="btn btn-sm">Unlock Wallet</button>'
            : '<button id="wallet-setup-btn" class="btn btn-sm">Connect Wallet</button>'
        }
        ${hasWallet && !connected ? '<button id="wallet-clear-btn" class="btn btn-sm btn-danger">Clear</button>' : ''}
        ${connected ? '<button id="wallet-disconnect-btn" class="btn btn-sm">Disconnect</button>' : ''}
      </div>
    `;

    // Attach event handlers
    const unlockBtn = container.querySelector('#wallet-unlock-btn');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', async () => {
        try {
          await unlockWallet();
          updateUI();
        } catch (err) {
          alert(err.message);
        }
      });
    }

    const setupBtn = container.querySelector('#wallet-setup-btn');
    if (setupBtn) {
      setupBtn.addEventListener('click', async () => {
        const uri = prompt('Paste your NWC connection string (nostr+walletconnect://...)');
        if (uri) {
          try {
            await setupNewWallet(uri);
            updateUI();
          } catch (err) {
            alert(err.message);
          }
        }
      });
    }

    const clearBtn = container.querySelector('#wallet-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear your wallet connection?')) {
          clearStoredWallet();
          updateUI();
        }
      });
    }

    const disconnectBtn = container.querySelector('#wallet-disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        await disconnectWallet();
        updateUI();
      });
    }
  };

  updateUI();
}

// Auto-initialize when module loads
initWalletEvents();
