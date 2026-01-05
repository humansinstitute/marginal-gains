# Nostr Wallet Connect (NWC) Integration

This document describes the wallet functionality in Marginal Gains, which uses Nostr Wallet Connect (NIP-47) to enable Lightning payments directly from the chat interface.

## Overview

Users can connect their Lightning wallet via NWC and use slash commands to:
- Check their balance (`/balance`)
- Pay BOLT11 invoices or Lightning addresses (`/pay`)
- Generate invoices to receive payments (`/receive`)

## Setup

### 1. Get an NWC Connection String

Obtain an NWC connection string from a compatible wallet:
- [Alby](https://getalby.com) - Browser extension and mobile
- [Mutiny Wallet](https://mutinywallet.com) - Web and mobile
- [Coinos](https://coinos.io) - Web wallet
- Any NIP-47 compatible wallet

The connection string looks like:
```
nostr+walletconnect://pubkey?relay=wss://relay.example.com&secret=hex...
```

### 2. Connect Your Wallet

1. Go to your "Note to self" channel
2. The wallet connection UI will prompt you to paste your NWC string
3. Create a 4-digit PIN to encrypt the connection string
4. The wallet is now connected for your session

### 3. Unlock on Return

When you return to the app:
1. Click "Unlock Wallet"
2. Enter your PIN
3. The wallet reconnects automatically

## Slash Commands

All wallet commands work in the "Note to self" channel.

### `/balance`

Check your wallet balance.

```
/balance
```

Response:
```
💰 Balance: 50,000 sats
```

### `/pay`

Pay a BOLT11 invoice or Lightning address.

**Pay an invoice:**
```
/pay lnbc10u1p3...
```

**Pay a Lightning address:**
```
/pay user@getalby.com 1000
```

Response:
```
✅ Paid 1,000 sats to user@getalby.com
📝 Thanks for the coffee!
```

### `/receive`

Generate an invoice to receive payment.

```
/receive 5000 Coffee fund
```

Response:
```
📥 Invoice for 5,000 sats:
lnbc50u1p3...
```

## Security Model

### Client-Side Encryption

1. **NWC URI is encrypted with your PIN** using AES-256-GCM
2. Encrypted data stored in browser localStorage
3. PIN derives a key via PBKDF2 (100,000 iterations)
4. Decryption happens client-side only

### Server-Side Handling

1. **Decrypted URI sent to server over HTTPS** when you unlock
2. Server holds URI **in memory only** during your session
3. URI is **never stored in the database**
4. On logout or disconnect, URI is cleared from server memory

### Transaction Cache

- Transaction history is cached locally in SQLite
- This provides offline access to past transactions
- The NWC wallet remains the source of truth for balance

## API Endpoints

### `POST /api/wallet/connect`

Connect wallet by sending decrypted URI.

```json
{ "uri": "nostr+walletconnect://..." }
```

### `DELETE /api/wallet/disconnect`

Disconnect wallet and clear server-side URI.

### `GET /api/wallet/status`

Check if wallet is connected.

```json
{ "connected": true }
```

### `GET /api/wallet/balance`

Get current balance.

```json
{ "balance": 50000000, "balanceSats": 50000 }
```

### `GET /api/wallet/transactions`

Get cached transaction history.

```json
{
  "transactions": [
    {
      "id": 1,
      "type": "outgoing",
      "amount_msats": 1000000,
      "state": "settled",
      "description": "To: user@example.com",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

## Architecture

### Files

| File | Purpose |
|------|---------|
| `src/services/relayPool.ts` | Shared Nostr relay pool |
| `src/services/lnurl.ts` | Lightning address resolution |
| `src/services/wallet.ts` | Core wallet operations + command handlers |
| `src/routes/wallet.ts` | HTTP API endpoints |
| `src/db.ts` | `wallet_transactions` table for caching |
| `public/wallet.js` | Client-side wallet UI |

### Dependencies

```json
{
  "applesauce-core": "*",
  "applesauce-relay": "*",
  "applesauce-wallet-connect": "*",
  "rxjs": "^7.8.1"
}
```

## Spending Limits (Future)

A hook infrastructure is in place for implementing spending limits:

```typescript
// In src/services/wallet.ts
// TODO: Add beforePay hook for spending limit validation
export async function payInvoice(npub: string, invoice: string) {
  // Hook: check spending limits here
  // throw new Error("Daily limit exceeded") if needed

  const wallet = await getWallet(npub);
  return wallet.payInvoice(invoice);
}
```

Future enhancements could include:
- Daily/weekly spending limits
- Per-transaction limits
- Whitelist of allowed recipients
- Admin-controlled global limits

## Troubleshooting

### "Wallet not connected"

The wallet URI is not in server memory. Click "Unlock Wallet" and enter your PIN.

### "Invalid PIN"

The decryption failed. Make sure you're entering the correct PIN. If forgotten, clear the wallet and reconnect with a new PIN.

### "Failed to connect to wallet"

The NWC relay may be unreachable. Check:
- Your internet connection
- The relay specified in the NWC URI is online
- Your wallet service is running

### Payment fails

Common causes:
- Insufficient balance in your Lightning wallet
- Invoice expired
- Route not found (liquidity issues)

Check the error message for specific details.
