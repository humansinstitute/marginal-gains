# Threat Model

This document summarizes who can see what data in Marginal Gains, covering encryption at rest, in transit, and the implications of AI assistant access.

## Overview

Marginal Gains uses end-to-end encryption (E2EE) for message content. The server stores only ciphertext and cannot read messages. Different channel types have different encryption models.

## Encryption Summary by Channel Type

| Channel Type | Encryption Key | Who Has Access | Server Can Read? |
|--------------|----------------|----------------|------------------|
| **Public channels** | Community key (AES-256-GCM) | All onboarded community members | No |
| **Private channels** | Per-channel key (AES-256-GCM) | Group members only | No |
| **DMs** | Per-channel key (AES-256-GCM) | Two participants only | No |
| **Note to self** | Per-channel key (AES-256-GCM) | Owner only | No |

## What the Server Can See

| Data | Visible to Server? | Notes |
|------|-------------------|-------|
| Message ciphertext | Yes | Encrypted blob, unreadable |
| Message plaintext | **No** | Never stored or transmitted in clear |
| Message timestamps | Yes | When messages were sent |
| Message author (npub) | Yes | Who sent the message |
| Slash commands used | Yes | Extracted client-side before encryption (e.g., `["wingman"]`) |
| @Mentions | Yes | Extracted client-side before encryption (npubs only) |
| Channel membership | Yes | Who is in which channels/groups |
| Channel names & metadata | Yes | Channel titles, descriptions |
| User profiles | Yes | Display names, avatars |
| Wrapped encryption keys | Yes | NIP-44 ciphertext, server cannot decrypt |
| Invite code hashes | Yes | SHA256 hash only, not plaintext codes |

## What Other Users Can See

| Data | Community Members | Group Members | Non-Members |
|------|-------------------|---------------|-------------|
| Public channel messages | Yes (decrypted) | Yes (decrypted) | No access |
| Private channel messages | No | Yes (decrypted) | No access |
| DM messages | No | N/A | No access |
| Personal notes | No | N/A | No access |
| Channel existence | Yes | Yes | No |
| User presence/profiles | Yes | Yes | Limited |

## Key Management

### Key Wrapping (NIP-44)

Each user's copy of a channel key is encrypted to their Nostr public key using NIP-44:

```
Channel Key (AES-256) → NIP-44 Encrypt(recipient_pubkey) → Wrapped Key Blob
```

- Server stores wrapped blobs, cannot unwrap without recipient's private key
- Keys can be pre-distributed to users who haven't logged in yet
- Each user decrypts their wrapped key client-side using their Nostr signing key

### Message Authentication

Messages are not just encrypted but also signed:

```
Plaintext → Sign as Nostr Event (kind 9420) → AES-GCM Encrypt → Ciphertext
```

This prevents:
- Message forgery (anyone with channel key impersonating others)
- Message tampering (modifying encrypted content)

---

## Wingman AI Assistant

Wingman is an AI assistant that can respond to `/wingman` commands in threads. Because it runs server-side and calls external AI providers, special care is needed.

### Wingman Identity

- Wingman has its own Nostr keypair (configured via `WINGMAN_KEY` env var)
- Treated as a regular user in the system
- Has an npub like any other user

### Wingman Access Model

| Channel Type | Wingman Can Access? | How to Grant Access |
|--------------|--------------------|--------------------|
| **Public channels** (no community encryption) | Yes | Automatic |
| **Public channels** (with community encryption) | Only if onboarded | Admin includes Wingman during bootstrap |
| **Private channels** | Only if added to group | Admin adds Wingman's npub to the group |
| **DMs with Wingman** | Yes | Direct conversation |
| **DMs between others** | No | Cannot be added |
| **Note to self** | **Never** | Explicitly blocked |

### Wingman Icon Indicator

Channels where Wingman has access display a goose icon (![wingman](/wingman-icon.png)) next to the channel name. This provides visual confirmation of which conversations the AI can read.

### Privacy Warning

When adding Wingman to a private group, users see a confirmation dialog:

> "Please be aware adding Wingman to your group has privacy implications and conversation threads may get leaked to 3rd party AI or server logs.
>
> Continue?"

### Slash Commands in Encrypted Channels

For `/wingman` and other slash commands to work in encrypted channels, the client extracts command metadata **before encryption** and sends it as unencrypted JSON alongside the ciphertext:

```
Client: "/wingman help me with X"
         ↓
Parse commands: ["wingman"]
         ↓
Encrypt message content
         ↓
POST { content: <ciphertext>, encrypted: true, commands: ["wingman"] }
         ↓
Server: Sees "wingman" command in metadata, triggers handler
         ↓
Wingman: Uses its own key to decrypt and respond
```

This allows the server to route commands without reading the encrypted content.

### @Mentions and Notifications

Similarly, @mentions are extracted client-side before encryption to enable push notifications:

```
Client: "Hey nostr:npub1abc... check this out"
         ↓
Parse mentions: ["npub1abc..."]
         ↓
Encrypt message content
         ↓
POST { content: <ciphertext>, encrypted: true, mentions: ["npub1abc..."] }
         ↓
Server: Sends "Alice mentioned you" notification to npub1abc...
        (notification body: "in an encrypted message" - no content exposed)
```

The mentioned user receives a notification without the server ever seeing the decrypted message.

### What Wingman Sends to AI Providers

When `/wingman` is invoked in a thread:

| Data | Sent to AI Provider? | Notes |
|------|---------------------|-------|
| Thread messages (decrypted) | **Yes** | Full conversation context |
| Message authors (display names) | **Yes** | For context |
| Message timestamps | **Yes** | For context |
| Channel name | No | Not included |
| Other channels' messages | No | Only the specific thread |
| User private keys | No | Never leaves client/server |

### Wingman Server-Side Decryption

When Wingman needs to read encrypted messages:

1. Server checks if Wingman has access to the channel
2. If yes, server uses Wingman's private key to unwrap the channel key
3. Server decrypts messages to build context for AI
4. Decrypted content is sent to OpenRouter API
5. AI response is posted back to the thread

**Important**: This decryption happens server-side. The server operator can configure Wingman's key and thus could potentially access any channel Wingman is added to.

### Wingman Access Denied Messages

If Wingman is invoked in a channel it cannot access, it responds with a helpful message:

| Scenario | Wingman's Response |
|----------|-------------------|
| Personal notes | "I can't access personal notes - they're encrypted to you only." |
| Private channel (not in group) | "I don't have access to this private channel. Add me to the group to enable AI assistance." |
| Community encryption (not onboarded) | "I haven't been onboarded to this community yet. Ask an admin to add me." |

---

## Threat Scenarios

### Scenario: Database Breach

**Threat**: Attacker gains read access to the SQLite database.

| Data Exposed | Risk Level | Mitigation |
|--------------|------------|------------|
| Message content | **None** | All messages encrypted at rest |
| User profiles | Medium | Names, avatars visible |
| Channel structure | Medium | Who is in which groups |
| Wrapped keys | **None** | Cannot decrypt without user private keys |
| Invite code hashes | Low | Cannot reverse SHA256 to get codes |

### Scenario: Server Operator is Malicious

**Threat**: Server admin wants to read private messages.

| Attack Vector | Possible? | Mitigation |
|---------------|-----------|------------|
| Read database directly | No | Only ciphertext stored |
| Intercept messages in transit | No | Encrypted client-side before sending |
| Add themselves to groups | **Yes** | But requires visible admin action |
| Configure Wingman to access channels | **Yes** | Users see Wingman icon, must approve adding |
| Log decrypted Wingman context | **Yes** | Trust model: don't add Wingman to sensitive channels |

### Scenario: Removed Group Member

**Threat**: User removed from private channel wants to continue reading.

| Attack | Possible? | Notes |
|--------|-----------|-------|
| Read new messages | No | Server enforces access control |
| Read old messages (if key cached) | Theoretically | Key rotation not implemented yet |
| Re-add themselves | No | Only admins/owners can add members |

### Scenario: AI Provider Data Retention

**Threat**: OpenRouter or downstream AI provider retains/logs conversation data.

| Risk | Mitigation |
|------|------------|
| Message content logged by AI provider | Only affects channels where Wingman has access |
| Training on private data | Review AI provider's data policies |
| Data breach at AI provider | Limit Wingman access to non-sensitive channels |

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ User's Private Key (extension or ephemeral)             │    │
│  │ - Never leaves browser                                  │    │
│  │ - Used for NIP-44 unwrapping and message signing        │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Decrypted Messages (in memory only)                     │    │
│  │ - Decrypted for display                                 │    │
│  │ - Never sent back to server in plaintext                │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS (TLS)
                              │ Only ciphertext crosses this boundary
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SERVER (Bun)                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Wingman's Private Key (env var)                         │    │
│  │ - Used for Wingman's channel access only                │    │
│  │ - Server operator has access                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ SQLite Database                                         │    │
│  │ - Encrypted message blobs                               │    │
│  │ - Wrapped key blobs                                     │    │
│  │ - Metadata (timestamps, authors, channels)              │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS (when Wingman invoked)
                              │ Decrypted thread context
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL AI PROVIDER                          │
│  - Receives decrypted messages from Wingman-accessible threads  │
│  - Subject to provider's data handling policies                 │
│  - Outside our trust boundary                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cryptographic Algorithms

| Purpose | Algorithm | Key Size | Library |
|---------|-----------|----------|---------|
| Message encryption | AES-256-GCM | 256 bits | Web Crypto API |
| Key wrapping | NIP-44 (ChaCha20-Poly1305 + HKDF) | 256 bits | nostr-tools |
| Message signing | Schnorr (secp256k1) | 256 bits | nostr-tools |
| Invite code hashing | SHA-256 | N/A | Web Crypto API |
| Invite key derivation | HKDF-SHA256 | 256 bits | Web Crypto API |

---

## Recommendations

### For Users

1. **Don't add Wingman to sensitive channels** - AI providers may log data
2. **Use a browser extension for keys** - More secure than ephemeral keys
3. **Verify the Wingman icon** - Know which channels have AI access
4. **Personal notes are safest** - Wingman explicitly cannot access them

### For Administrators

1. **Bootstrap Wingman during community setup** - Include in initial key distribution
2. **Review group memberships** - Wingman access is visible via icon
3. **Consider AI provider policies** - Choose providers with appropriate data handling
4. **Backup Wingman's key securely** - Required for Wingman to function after restart

### For Self-Hosters

1. **Protect `WINGMAN_KEY`** - Anyone with this key can decrypt Wingman-accessible channels
2. **Use HTTPS** - Prevents interception of wrapped keys
3. **Secure database backups** - Contains all encrypted data (safe) and metadata (sensitive)
4. **Review server logs** - Ensure decrypted content isn't being logged
