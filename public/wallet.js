/**
 * Wallet page main script
 * Handles NWC connection, balance display, and transactions
 */

console.log('[Wallet] Script loading...');

import { encryptWithPin, decryptWithPin, isSecureContext } from './pinCrypto.js';
import { promptForPin, promptForNewPin, initPinModal } from './pinModal.js';
import { initAvatarMenu } from './avatar.js';
import { initAppMenu } from './menu.js';

console.log('[Wallet] Imports loaded successfully');

const NWC_STORAGE_KEY = 'nwc_encrypted_uri';

// DOM elements
let connectSection;
let dashboard;
let balanceDisplay;
let transactionsList;
let connectForm;
let receiveModal;
let receiveForm;
let invoiceResult;
let sendModal;
let sendForm;
let sendAmountLabel;

/**
 * Check if encrypted NWC URI exists in localStorage
 */
function hasStoredWallet() {
  return !!localStorage.getItem(NWC_STORAGE_KEY);
}

/**
 * Store encrypted NWC URI
 */
async function storeWalletUri(uri, pin) {
  if (!isSecureContext()) {
    throw new Error('Secure context required for encryption');
  }
  const encrypted = await encryptWithPin(uri, pin);
  localStorage.setItem(NWC_STORAGE_KEY, encrypted);
}

/**
 * Retrieve and decrypt NWC URI
 */
async function getWalletUri(pin) {
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
function clearStoredWallet() {
  localStorage.removeItem(NWC_STORAGE_KEY);
}

/**
 * Check wallet connection status on server
 */
async function checkWalletStatus() {
  try {
    const response = await fetch('/api/wallet/status');
    const data = await response.json();
    return data.connected;
  } catch {
    return false;
  }
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
}

/**
 * Disconnect wallet from server
 */
async function disconnectFromServer() {
  await fetch('/api/wallet/disconnect', { method: 'DELETE' });
}

/**
 * Get wallet balance from server
 */
async function fetchBalance() {
  const response = await fetch('/api/wallet/balance');
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('[Wallet] Balance response not JSON:', text.slice(0, 200));
    throw new Error('Invalid response from server');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Failed to get balance');
  }
  return data;
}

/**
 * Get cached transactions from server
 */
async function fetchTransactions(limit = 50) {
  const response = await fetch(`/api/wallet/transactions?limit=${limit}`);
  if (!response.ok) {
    throw new Error('Failed to get transactions');
  }
  return response.json();
}

/**
 * Create an invoice
 */
async function createInvoice(amountSats, description) {
  // For now, we'll use the slash command approach via a special API
  // In a future iteration, we can call the wallet directly
  const response = await fetch('/api/wallet/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountSats, description }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to create invoice');
  }
  return response.json();
}

/**
 * Pay an invoice or lightning address
 */
async function payTarget(target, amountSats) {
  const response = await fetch('/api/wallet/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, amount: amountSats }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Payment failed');
  }
  return response.json();
}

/**
 * Format satoshi amount for display
 */
function formatSats(sats) {
  return sats.toLocaleString() + ' sats';
}

/**
 * Format millisats as sats
 */
function msatsToSats(msats) {
  return Math.floor(msats / 1000);
}

/**
 * Show connect section, hide dashboard
 */
function showConnectSection() {
  connectSection.hidden = false;
  dashboard.hidden = true;
}

/**
 * Show dashboard, hide connect section
 */
function showDashboard() {
  connectSection.hidden = true;
  dashboard.hidden = false;
}

/**
 * Update balance display
 */
async function updateBalance() {
  balanceDisplay.innerHTML = '<span class="wallet-balance-loading">Loading...</span>';
  try {
    const data = await fetchBalance();
    const sats = data.balanceSats || msatsToSats(data.balance || 0);
    balanceDisplay.innerHTML = `<span class="wallet-balance-value">${formatSats(sats)}</span>`;
  } catch (err) {
    balanceDisplay.innerHTML = `<span class="wallet-balance-error">Error: ${err.message}</span>`;
  }
}

/**
 * Update transactions list
 */
async function updateTransactions() {
  transactionsList.innerHTML = '<p class="wallet-empty">Loading transactions...</p>';
  try {
    const data = await fetchTransactions();
    const txs = data.transactions || [];

    if (txs.length === 0) {
      transactionsList.innerHTML = '<p class="wallet-empty">No transactions yet</p>';
      return;
    }

    const html = txs.map(tx => {
      const isIncoming = tx.type === 'incoming';
      const sats = msatsToSats(tx.amount_msats);
      const date = new Date(tx.created_at).toLocaleDateString();
      const desc = tx.description || (isIncoming ? 'Received' : 'Sent');
      const stateClass = tx.state === 'settled' ? 'settled' : tx.state === 'pending' ? 'pending' : 'failed';

      return `<div class="wallet-tx ${isIncoming ? 'incoming' : 'outgoing'} ${stateClass}">
        <div class="wallet-tx-icon">${isIncoming ? '+' : '-'}</div>
        <div class="wallet-tx-details">
          <span class="wallet-tx-desc">${escapeHtml(desc)}</span>
          <span class="wallet-tx-date">${date}</span>
        </div>
        <div class="wallet-tx-amount ${isIncoming ? 'positive' : 'negative'}">
          ${isIncoming ? '+' : '-'}${formatSats(sats)}
        </div>
      </div>`;
    }).join('');

    transactionsList.innerHTML = html;
  } catch (err) {
    transactionsList.innerHTML = `<p class="wallet-error">Failed to load transactions: ${err.message}</p>`;
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Handle wallet connection form submit
 */
async function handleConnect(e) {
  e.preventDefault();
  console.log('[Wallet] handleConnect called');

  const input = connectForm.querySelector('[data-nwc-input]');
  const uri = input.value.trim();
  console.log('[Wallet] URI length:', uri.length, 'starts with nwc:', uri.startsWith('nostr+walletconnect://'));

  if (!uri) {
    alert('Please enter your NWC connection string');
    return;
  }

  if (!uri.startsWith('nostr+walletconnect://')) {
    alert('Invalid NWC URI format. Should start with nostr+walletconnect://');
    return;
  }

  try {
    // Prompt for new PIN to encrypt the URI
    console.log('[Wallet] Calling promptForNewPin...');
    const pin = await promptForNewPin();
    console.log('[Wallet] PIN result:', pin ? 'got pin' : 'null/cancelled');
    if (!pin) {
      return; // User cancelled
    }

    // Encrypt and store locally
    await storeWalletUri(uri, pin);

    // Send to server
    await sendWalletToServer(uri);

    // Clear input
    input.value = '';

    // Show dashboard
    showDashboard();
    await updateBalance();
    await updateTransactions();

  } catch (err) {
    alert('Failed to connect wallet: ' + err.message);
  }
}

/**
 * Handle unlock existing wallet
 */
async function handleUnlock() {
  try {
    const pin = await promptForPin({
      title: 'Unlock Wallet',
      subtitle: 'Enter your PIN to connect wallet',
    });

    if (!pin) {
      return; // User cancelled
    }

    // Decrypt URI
    const uri = await getWalletUri(pin);

    // Send to server
    await sendWalletToServer(uri);

    // Show dashboard
    showDashboard();
    await updateBalance();
    await updateTransactions();

  } catch (err) {
    if (err.message === 'Invalid PIN') {
      alert('Wrong PIN. Please try again.');
    } else {
      alert('Failed to unlock wallet: ' + err.message);
    }
  }
}

/**
 * Handle disconnect
 */
async function handleDisconnect() {
  if (!confirm('Disconnect wallet? You can reconnect later with your PIN.')) {
    return;
  }

  try {
    await disconnectFromServer();
    showConnectSection();
  } catch (err) {
    alert('Failed to disconnect: ' + err.message);
  }
}

/**
 * Handle full wallet clear
 */
async function handleClearWallet() {
  if (!confirm('Clear wallet completely? You will need to enter your NWC string again.')) {
    return;
  }

  try {
    await disconnectFromServer();
  } catch {
    // Ignore disconnect errors
  }

  clearStoredWallet();
  showConnectSection();
}

/**
 * Check if target is a lightning address
 */
function isLightningAddress(target) {
  return target.includes('@') && target.includes('.');
}

/**
 * Open receive modal
 */
function openReceiveModal() {
  receiveModal.hidden = false;
  invoiceResult.hidden = true;
  receiveForm.reset();
}

/**
 * Close receive modal
 */
function closeReceiveModal() {
  receiveModal.hidden = true;
}

/**
 * Open send modal
 */
function openSendModal() {
  sendModal.hidden = false;
  sendForm.reset();
  sendAmountLabel.hidden = true;
  const resultEl = sendModal.querySelector('[data-send-result]');
  if (resultEl) resultEl.hidden = true;
}

/**
 * Close send modal
 */
function closeSendModal() {
  sendModal.hidden = true;
}

/**
 * Handle receive form submit
 */
async function handleReceive(e) {
  e.preventDefault();
  const formData = new FormData(receiveForm);
  const amount = parseInt(formData.get('amount'), 10);
  const description = formData.get('description') || '';

  if (!amount || amount <= 0) {
    alert('Please enter a valid amount');
    return;
  }

  const submitBtn = receiveForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';

  try {
    const data = await createInvoice(amount, description);

    // Show invoice
    const invoiceText = invoiceResult.querySelector('[data-invoice-text]');
    invoiceText.textContent = data.invoice;
    invoiceResult.hidden = false;

    // Update transactions after creating invoice
    await updateTransactions();

  } catch (err) {
    alert('Failed to create invoice: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Invoice';
  }
}

/**
 * Handle send form submit
 */
async function handleSend(e) {
  e.preventDefault();
  const formData = new FormData(sendForm);
  const target = formData.get('target')?.trim();
  const amount = formData.get('amount') ? parseInt(formData.get('amount'), 10) : null;

  if (!target) {
    alert('Please enter an invoice or lightning address');
    return;
  }

  // If lightning address, require amount
  if (isLightningAddress(target) && (!amount || amount <= 0)) {
    alert('Please enter an amount for lightning address payments');
    return;
  }

  const submitBtn = sendForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Paying...';

  try {
    const data = await payTarget(target, amount);

    // Show success
    const resultEl = sendModal.querySelector('[data-send-result]');
    const successEl = sendModal.querySelector('[data-send-success]');
    successEl.textContent = 'Payment successful!';
    if (data.preimage) {
      successEl.textContent += ` Preimage: ${data.preimage.slice(0, 16)}...`;
    }
    resultEl.hidden = false;
    sendForm.hidden = true;

    // Update balance and transactions
    await updateBalance();
    await updateTransactions();

  } catch (err) {
    alert('Payment failed: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Pay';
  }
}

/**
 * Handle send target input change (show/hide amount field)
 */
function handleSendTargetChange(e) {
  const target = e.target.value.trim();
  sendAmountLabel.hidden = !isLightningAddress(target);
}

/**
 * Copy invoice to clipboard
 */
async function copyInvoice() {
  const invoiceText = invoiceResult.querySelector('[data-invoice-text]');
  if (invoiceText) {
    try {
      await navigator.clipboard.writeText(invoiceText.textContent);
      alert('Invoice copied to clipboard!');
    } catch {
      // Fallback for older browsers
      const range = document.createRange();
      range.selectNode(invoiceText);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      document.execCommand('copy');
      window.getSelection().removeAllRanges();
      alert('Invoice copied!');
    }
  }
}

/**
 * Initialize page
 */
async function init() {
  // Get DOM elements
  connectSection = document.querySelector('[data-wallet-connect-section]');
  dashboard = document.querySelector('[data-wallet-dashboard]');
  balanceDisplay = document.querySelector('[data-wallet-balance]');
  transactionsList = document.querySelector('[data-wallet-transactions]');
  connectForm = document.querySelector('[data-wallet-connect-form]');
  receiveModal = document.querySelector('[data-receive-modal]');
  receiveForm = document.querySelector('[data-receive-form]');
  invoiceResult = document.querySelector('[data-invoice-result]');
  sendModal = document.querySelector('[data-send-modal]');
  sendForm = document.querySelector('[data-send-form]');
  sendAmountLabel = document.querySelector('[data-amount-label]');

  // Initialize shared modules
  console.log('[Wallet] Initializing...');
  console.log('[Wallet] connectForm:', connectForm);
  initPinModal();
  initAvatarMenu();
  initAppMenu();

  // Check current state
  const hasWallet = hasStoredWallet();
  const isConnected = await checkWalletStatus();

  if (isConnected) {
    // Already connected, show dashboard
    showDashboard();
    await updateBalance();
    await updateTransactions();
  } else if (hasWallet) {
    // Has stored wallet but not connected, try to unlock
    showConnectSection();
    // Auto-prompt for unlock
    await handleUnlock();
  } else {
    // No wallet, show connect form
    showConnectSection();
  }

  // Event listeners
  console.log('[Wallet] Attaching form submit listener to:', connectForm);
  connectForm?.addEventListener('submit', handleConnect);

  // Dashboard buttons
  document.querySelector('[data-refresh-balance]')?.addEventListener('click', updateBalance);
  document.querySelector('[data-wallet-receive]')?.addEventListener('click', openReceiveModal);
  document.querySelector('[data-wallet-send]')?.addEventListener('click', openSendModal);
  document.querySelector('[data-wallet-disconnect]')?.addEventListener('click', handleDisconnect);

  // Receive modal
  document.querySelector('[data-close-receive]')?.addEventListener('click', closeReceiveModal);
  receiveForm?.addEventListener('submit', handleReceive);
  document.querySelector('[data-copy-invoice]')?.addEventListener('click', copyInvoice);

  // Send modal
  document.querySelector('[data-close-send]')?.addEventListener('click', closeSendModal);
  sendForm?.addEventListener('submit', handleSend);
  document.querySelector('[data-send-target]')?.addEventListener('input', handleSendTargetChange);

  // Close modals on overlay click
  receiveModal?.addEventListener('click', (e) => {
    if (e.target === receiveModal) closeReceiveModal();
  });
  sendModal?.addEventListener('click', (e) => {
    if (e.target === sendModal) closeSendModal();
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
