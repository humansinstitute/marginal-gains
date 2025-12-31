#!/bin/bash
# Backup SQLite database with timestamp
# Works on Linux and macOS

# Get the directory where this script lives, then find repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration - defaults to db in repo root
DB_PATH="${DB_PATH:-$REPO_DIR/marginal-gains.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backup}"
KEEP_DAYS="${KEEP_DAYS:-30}"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/marginal-gains-$TIMESTAMP.sqlite"

# Perform backup using SQLite's backup command (safe while running)
if sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"; then
    echo "Backup created: $BACKUP_FILE"

    # Compress the backup
    gzip "$BACKUP_FILE"
    echo "Compressed: $BACKUP_FILE.gz"
else
    echo "Backup failed!" >&2
    exit 1
fi

# Clean up old backups (older than KEEP_DAYS)
find "$BACKUP_DIR" -name "marginal-gains-*.sqlite.gz" -mtime +$KEEP_DAYS -delete
echo "Cleaned up backups older than $KEEP_DAYS days"
