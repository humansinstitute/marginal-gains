import { hexToBytes } from "@noble/hashes/utils";
import { parseBolt11 } from "applesauce-common/helpers";
import { WalletConnect } from "applesauce-wallet-connect";
import {
  parseWalletConnectURI,
  type GetBalanceResult,
  type MakeInvoiceResult,
  type PayInvoiceResult,
  type WalletSupport,
} from "applesauce-wallet-connect/helpers";
import { firstValueFrom, filter, take, timeout as rxTimeout, type Observable } from "rxjs";

import { saveWalletTransaction, listWalletTransactions } from "../db";
import { createMessage } from "../db";

import { broadcast } from "./events";
import {
  isLightningAddress,
  isBolt11Invoice,
  resolveLightningAddress,
  executeLnurlPayment,
  type LnAddressPaymentResult,
} from "./lnurl";
import { getRelayPool } from "./relayPool";


import type { SlashCommandContext } from "./slashCommands";


const MSATS_PER_SAT = 1000;
const WALLET_CONNECT_TIMEOUT_MS = 15000;
const _PAY_TIMEOUT_MS = 60000; // Reserved for future spending limit hooks

// In-memory wallet instances per user (keyed by npub)
const wallets = new Map<string, WalletConnect>();
// In-memory decrypted URIs (keyed by npub) - set when user unlocks wallet
const walletUris = new Map<string, string>();

/**
 * Store the decrypted NWC URI for a user (called after client decrypts with PIN)
 */
export function setWalletUri(npub: string, uri: string): void {
  // Validate the URI first
  parseWalletConnectURI(uri);
  walletUris.set(npub, uri);
  // Clear any existing wallet instance so it reconnects with new URI
  disconnectWallet(npub);
}

/**
 * Check if a user has a wallet URI set in memory
 */
export function hasWalletUri(npub: string): boolean {
  return walletUris.has(npub);
}

/**
 * Remove wallet URI and disconnect
 */
export function clearWalletUri(npub: string): void {
  walletUris.delete(npub);
  disconnectWallet(npub);
}

/**
 * Create a WalletConnect instance from a URI
 */
function createWallet(uri: string): WalletConnect {
  const parsed = parseWalletConnectURI(uri);
  const secret = hexToBytes(parsed.secret);
  const pool = getRelayPool();
  const wallet = new WalletConnect({
    ...parsed,
    secret,
    subscriptionMethod: pool.subscription.bind(pool),
    publishMethod: pool.publish.bind(pool),
  });
  return wallet;
}

/**
 * Wait for wallet to report its supported methods
 */
async function awaitSupport(
  wallet: WalletConnect,
  timeoutMs = WALLET_CONNECT_TIMEOUT_MS
): Promise<WalletSupport> {
  const obs = (wallet as unknown as { support$?: unknown }).support$;
  if (!obs) throw new Error("Wallet support$ stream not available");
  return firstValueFrom(
    (obs as Observable<WalletSupport | null>).pipe(
      filter((s): s is WalletSupport => s !== null),
      take(1),
      rxTimeout({ first: timeoutMs })
    )
  );
}

/**
 * Get or create a connected wallet for a user
 */
export async function getWallet(npub: string): Promise<WalletConnect> {
  const existing = wallets.get(npub);
  if (existing) {
    return existing;
  }

  const uri = walletUris.get(npub);
  if (!uri) {
    throw new Error("Wallet not connected. Please connect your wallet first.");
  }

  const wallet = createWallet(uri);
  wallets.set(npub, wallet);

  // Wait for support to ensure connection is established
  try {
    await awaitSupport(wallet);
  } catch (error) {
    // Clean up on connection failure
    wallets.delete(npub);
    throw new Error(
      `Failed to connect to wallet: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return wallet;
}

/**
 * Disconnect and clean up a user's wallet
 */
export function disconnectWallet(npub: string): void {
  const wallet = wallets.get(npub);
  if (wallet) {
    try {
      (wallet as unknown as { stop?: () => void })?.stop?.();
    } catch {
      // Ignore cleanup errors
    }
    wallets.delete(npub);
  }
}

/**
 * Get wallet balance
 */
export async function getBalance(npub: string): Promise<GetBalanceResult> {
  const wallet = await getWallet(npub);
  return wallet.getBalance();
}

/**
 * Create an invoice
 */
export async function makeInvoice(
  npub: string,
  amountSats: number,
  description?: string
): Promise<MakeInvoiceResult> {
  const wallet = await getWallet(npub);
  const amountMsats = amountSats * MSATS_PER_SAT;
  const result = await wallet.makeInvoice(amountMsats, {
    description: description || undefined,
  });

  // Cache the transaction locally
  saveWalletTransaction(
    npub,
    "incoming",
    result.amount ?? amountMsats,
    result.invoice ?? null,
    result.payment_hash ?? null,
    result.state === "settled" ? "settled" : "pending",
    description ?? null
  );

  return result;
}

/**
 * Pay a BOLT11 invoice
 */
export async function payInvoice(
  npub: string,
  invoice: string
): Promise<PayInvoiceResult> {
  const wallet = await getWallet(npub);

  // Parse invoice to get amount
  const parsed = parseBolt11(invoice);
  const amountMsats = parsed?.amount ?? 0;

  const result = await wallet.payInvoice(invoice);

  // Cache the transaction locally
  saveWalletTransaction(
    npub,
    "outgoing",
    amountMsats,
    invoice,
    result.preimage ?? null,
    "settled",
    null
  );

  return result;
}

/**
 * Pay a Lightning address
 */
export async function payLightningAddress(
  npub: string,
  address: string,
  amountSats: number,
  comment?: string
): Promise<LnAddressPaymentResult> {
  const wallet = await getWallet(npub);
  const resolved = await resolveLightningAddress(address);
  const amountMsats = amountSats * MSATS_PER_SAT;

  const result = await executeLnurlPayment({
    wallet,
    resolved,
    amountMsats,
    comment,
  });

  // Cache the transaction locally
  saveWalletTransaction(
    npub,
    "outgoing",
    amountMsats,
    result.invoice,
    result.payResult.preimage ?? null,
    "settled",
    `To: ${address}`
  );

  return result;
}

/**
 * Get cached transactions for a user
 */
export function getTransactions(npub: string, limit = 50) {
  return listWalletTransactions(npub, limit);
}

// ============================================================================
// Slash Command Handlers
// ============================================================================

function formatSats(msats: number): string {
  const sats = Math.floor(msats / MSATS_PER_SAT);
  return `${sats.toLocaleString()} sats`;
}

/**
 * Post a wallet response message to the channel
 */
function postWalletMessage(
  ctx: SlashCommandContext,
  content: string
): void {
  const message = createMessage(
    ctx.channelId,
    "wallet-bot",
    content,
    ctx.threadRootId,
    ctx.message.id,
    null
  );

  if (message) {
    broadcast({
      type: "message:new",
      data: { ...message, channelId: ctx.channelId },
      channelId: ctx.channelId,
      recipientNpubs: [ctx.authorNpub],
    });
  }
}

/**
 * Handle /balance command
 */
export async function handleBalanceCommand(ctx: SlashCommandContext): Promise<void> {
  try {
    if (!hasWalletUri(ctx.authorNpub)) {
      postWalletMessage(ctx, "⚠️ Wallet not connected. Connect your wallet in settings first.");
      return;
    }

    const result = await getBalance(ctx.authorNpub);
    const balanceStr = formatSats(result.balance);
    postWalletMessage(ctx, `💰 Balance: ${balanceStr}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    postWalletMessage(ctx, `❌ Failed to get balance: ${msg}`);
  }
}

/**
 * Handle /pay command
 * Usage: /pay <invoice|lnaddress> [amount_sats]
 */
export async function handlePayCommand(ctx: SlashCommandContext): Promise<void> {
  try {
    if (!hasWalletUri(ctx.authorNpub)) {
      postWalletMessage(ctx, "⚠️ Wallet not connected. Connect your wallet in settings first.");
      return;
    }

    const args = ctx.args.trim();
    if (!args) {
      postWalletMessage(ctx, "Usage: /pay <invoice|lnaddress> [amount_sats]");
      return;
    }

    const parts = args.split(/\s+/);
    const target = parts[0];
    const amountArg = parts[1];

    if (isBolt11Invoice(target)) {
      // Pay BOLT11 invoice
      postWalletMessage(ctx, "⏳ Paying invoice...");
      const result = await payInvoice(ctx.authorNpub, target);
      postWalletMessage(ctx, `✅ Payment sent! Preimage: ${result.preimage?.slice(0, 16)}...`);
    } else if (isLightningAddress(target)) {
      // Pay Lightning address
      if (!amountArg) {
        postWalletMessage(ctx, "Usage: /pay user@domain.com <amount_sats>");
        return;
      }
      const amountSats = parseInt(amountArg, 10);
      if (isNaN(amountSats) || amountSats <= 0) {
        postWalletMessage(ctx, "❌ Invalid amount. Please specify a positive number of sats.");
        return;
      }

      postWalletMessage(ctx, `⏳ Paying ${amountSats} sats to ${target}...`);
      const result = await payLightningAddress(ctx.authorNpub, target, amountSats);

      let successMsg = `✅ Paid ${formatSats(result.amountMsats)} to ${target}`;
      if (result.successAction) {
        const sa = result.successAction as { tag?: string; message?: string; url?: string };
        if (sa.tag === "message" && sa.message) {
          successMsg += `\n📝 ${sa.message}`;
        } else if (sa.tag === "url" && sa.url) {
          successMsg += `\n🔗 ${sa.url}`;
        }
      }
      postWalletMessage(ctx, successMsg);
    } else {
      postWalletMessage(ctx, "❌ Invalid target. Provide a BOLT11 invoice (lnbc...) or Lightning address (user@domain.com)");
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    postWalletMessage(ctx, `❌ Payment failed: ${msg}`);
  }
}

/**
 * Handle /receive command
 * Usage: /receive <amount_sats> [description]
 */
export async function handleReceiveCommand(ctx: SlashCommandContext): Promise<void> {
  try {
    if (!hasWalletUri(ctx.authorNpub)) {
      postWalletMessage(ctx, "⚠️ Wallet not connected. Connect your wallet in settings first.");
      return;
    }

    const args = ctx.args.trim();
    if (!args) {
      postWalletMessage(ctx, "Usage: /receive <amount_sats> [description]");
      return;
    }

    const parts = args.split(/\s+/);
    const amountArg = parts[0];
    const description = parts.slice(1).join(" ") || undefined;

    const amountSats = parseInt(amountArg, 10);
    if (isNaN(amountSats) || amountSats <= 0) {
      postWalletMessage(ctx, "❌ Invalid amount. Please specify a positive number of sats.");
      return;
    }

    postWalletMessage(ctx, `⏳ Creating invoice for ${amountSats} sats...`);
    const result = await makeInvoice(ctx.authorNpub, amountSats, description);

    if (result.invoice) {
      postWalletMessage(
        ctx,
        `📥 Invoice for ${formatSats(result.amount ?? amountSats * MSATS_PER_SAT)}:\n\`\`\`\n${result.invoice}\n\`\`\``
      );
    } else {
      postWalletMessage(ctx, "❌ Failed to create invoice - no invoice returned");
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    postWalletMessage(ctx, `❌ Failed to create invoice: ${msg}`);
  }
}
