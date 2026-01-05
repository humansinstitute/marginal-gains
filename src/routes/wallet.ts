import { jsonResponse, unauthorized } from "../http";
import { renderWalletPage } from "../render/wallet";
import { isLightningAddress, isBolt11Invoice } from "../services/lnurl";
import {
  setWalletUri,
  hasWalletUri,
  clearWalletUri,
  getBalance,
  getTransactions,
  makeInvoice,
  payInvoice,
  payLightningAddress,
} from "../services/wallet";

import type { Session } from "../types";

/**
 * GET /wallet
 * Render wallet page
 */
export function handleWalletPage(session: Session | null): Response {
  // Redirect unauthenticated users to home
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/" },
    });
  }

  const page = renderWalletPage(session);
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/**
 * POST /api/wallet/connect
 * Receive decrypted NWC URI from client and store in memory
 */
export async function handleWalletConnect(
  req: Request,
  session: Session | null
): Promise<Response> {
  if (!session) return unauthorized();

  try {
    const body = (await req.json()) as { uri?: string };
    const uri = body.uri;

    if (!uri || typeof uri !== "string") {
      return jsonResponse({ error: "Missing or invalid uri" }, 400);
    }

    // Validate and store the URI
    setWalletUri(session.npub, uri);

    return jsonResponse({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: msg }, 400);
  }
}

/**
 * DELETE /api/wallet/disconnect
 * Clear wallet connection from memory
 */
export function handleWalletDisconnect(
  _req: Request,
  session: Session | null
): Response {
  if (!session) return unauthorized();

  clearWalletUri(session.npub);

  return jsonResponse({ success: true });
}

/**
 * GET /api/wallet/status
 * Check if wallet is connected
 */
export function handleWalletStatus(
  _req: Request,
  session: Session | null
): Response {
  if (!session) return unauthorized();

  const connected = hasWalletUri(session.npub);

  return jsonResponse({ connected });
}

/**
 * GET /api/wallet/balance
 * Get wallet balance via NWC
 */
export async function handleWalletBalance(
  _req: Request,
  session: Session | null
): Promise<Response> {
  console.log("[Wallet] Balance request, session:", session ? session.npub : "null");

  if (!session) {
    console.log("[Wallet] No session, returning unauthorized");
    return unauthorized();
  }

  if (!hasWalletUri(session.npub)) {
    console.log("[Wallet] No wallet URI for user");
    return jsonResponse({ error: "Wallet not connected" }, 400);
  }

  try {
    console.log("[Wallet] Fetching balance for", session.npub);
    const result = await getBalance(session.npub);
    console.log("[Wallet] Balance result:", result.balance);
    return jsonResponse({
      balance: result.balance,
      balanceSats: Math.floor(result.balance / 1000),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Wallet] Balance error:", msg);
    return jsonResponse({ error: msg }, 500);
  }
}

/**
 * GET /api/wallet/transactions
 * Get cached transaction history
 */
export function handleWalletTransactions(
  req: Request,
  session: Session | null
): Response {
  if (!session) return unauthorized();

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  const transactions = getTransactions(session.npub, limit);

  return jsonResponse({ transactions });
}

/**
 * POST /api/wallet/invoice
 * Create a Lightning invoice
 */
export async function handleWalletInvoice(
  req: Request,
  session: Session | null
): Promise<Response> {
  if (!session) return unauthorized();

  if (!hasWalletUri(session.npub)) {
    return jsonResponse({ error: "Wallet not connected" }, 400);
  }

  try {
    const body = (await req.json()) as { amount?: number; description?: string };
    const amount = body.amount;
    const description = body.description;

    if (!amount || typeof amount !== "number" || amount <= 0) {
      return jsonResponse({ error: "Invalid amount" }, 400);
    }

    const result = await makeInvoice(session.npub, amount, description);

    return jsonResponse({
      invoice: result.invoice,
      amount: result.amount,
      paymentHash: result.payment_hash,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: msg }, 500);
  }
}

/**
 * POST /api/wallet/pay
 * Pay a Lightning invoice or address
 */
export async function handleWalletPay(
  req: Request,
  session: Session | null
): Promise<Response> {
  if (!session) return unauthorized();

  if (!hasWalletUri(session.npub)) {
    return jsonResponse({ error: "Wallet not connected" }, 400);
  }

  try {
    const body = (await req.json()) as { target?: string; amount?: number };
    const target = body.target?.trim();
    const amount = body.amount;

    if (!target) {
      return jsonResponse({ error: "Missing target (invoice or lightning address)" }, 400);
    }

    if (isBolt11Invoice(target)) {
      // Pay BOLT11 invoice
      const result = await payInvoice(session.npub, target);
      return jsonResponse({
        success: true,
        preimage: result.preimage,
      });
    } else if (isLightningAddress(target)) {
      // Pay Lightning address
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return jsonResponse({ error: "Amount required for lightning address" }, 400);
      }

      const result = await payLightningAddress(session.npub, target, amount);
      return jsonResponse({
        success: true,
        preimage: result.payResult.preimage,
        successAction: result.successAction,
      });
    } else {
      return jsonResponse({ error: "Invalid target. Provide a BOLT11 invoice or lightning address" }, 400);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: msg }, 500);
  }
}
