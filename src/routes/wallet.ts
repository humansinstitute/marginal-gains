import { jsonResponse, unauthorized } from "../http";
import {
  setWalletUri,
  hasWalletUri,
  clearWalletUri,
  getBalance,
  getTransactions,
} from "../services/wallet";

import type { Session } from "../types";

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
  if (!session) return unauthorized();

  if (!hasWalletUri(session.npub)) {
    return jsonResponse({ error: "Wallet not connected" }, 400);
  }

  try {
    const result = await getBalance(session.npub);
    return jsonResponse({
      balance: result.balance,
      balanceSats: Math.floor(result.balance / 1000),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
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
