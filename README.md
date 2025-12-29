# Marginal Gains

A simple self-hosted community chat (like Slack) with Nostr ID integration. Sign in with your Nostr keys, no email or password required.

## Features

- **Nostr Authentication** - Login with any Nostr browser extension (nos2x, Alby, etc.)
- **Channels** - Public and private channels with threaded replies
- **Direct Messages** - Private 1:1 conversations
- **File Uploads** - Paste or drag-drop images and files directly into chat
- **@Mentions** - Tag users with autocomplete
- **Groups** - Control access to private channels via group membership
- **Admin Panel** - Manage groups and channel settings

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0+)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/marginalgains.git
cd marginalgains

# Install dependencies
bun install

# Start the server
bun start
```

The app creates `marginal-gains.sqlite` on first run.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | - | Set to `production` for secure cookies |
| `ADMIN_NPUBS` | - | Comma-separated list of admin npub addresses |
| `DB_PATH` | `marginal-gains.sqlite` | Path to SQLite database file |

Example:
```bash
PORT=4000 ADMIN_NPUBS=npub1abc...,npub1xyz... bun start
```

## Development

```bash
# Run with hot reload
bun dev

# Lint code
bun run lint

# Reset database
bun run reset-db
```

## Project Structure

```
src/
  config.ts          # App configuration
  db.ts              # SQLite database schema and queries
  server.ts          # Bun HTTP server and routing
  routes/            # API route handlers
    auth.ts          # Nostr authentication
    chat.ts          # Channels, messages, DMs
    groups.ts        # Group management
    assets.ts        # File uploads
    settings.ts      # Admin settings
  render/            # Server-side HTML rendering
    home.ts          # Home page
    chat.ts          # Chat interface
    settings.ts      # Admin settings page
  services/          # Business logic
    auth.ts          # Session management

public/
  app.js             # Main entry point
  chat.js            # Chat functionality
  auth.js            # Nostr login flow
  mentions.js        # @mention autocomplete
  uploads.js         # File upload handling
  messageRenderer.js # Message display
  liveUpdates.js     # Server-sent events
  app.css            # Main styles
  mobile.css         # Mobile responsive styles
  settings.css       # Admin page styles
```

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Language**: TypeScript
- **Database**: SQLite (Bun built-in)
- **Auth**: Nostr NIP-07 / NIP-98
- **Frontend**: Vanilla JS with ES modules
- **Real-time**: Server-Sent Events (SSE)

## License

MIT
