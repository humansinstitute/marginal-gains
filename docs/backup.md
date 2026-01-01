# Database Backup Guide

This guide covers backing up and restoring the Marginal Gains SQLite database.

## Overview

Marginal Gains uses SQLite, which stores all data in a single file (`marginal-gains.sqlite`). Regular backups ensure you can recover from hardware failures, accidental deletions, or corruption.

## Backup Script

A backup script is included at `scripts/backup-db.sh`. It:

- Uses SQLite's `.backup` command (safe while server is running)
- Compresses backups with gzip
- Auto-deletes backups older than 30 days
- Works on both Linux and macOS

### Configuration

The script auto-detects the database location relative to the repository. You can override settings via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `<repo>/marginal-gains.sqlite` | Path to database file |
| `BACKUP_DIR` | `~/backup` | Where to store backups |
| `KEEP_DAYS` | `30` | Days to retain old backups |

### Manual Backup

```bash
# Run from anywhere (auto-detects db location)
/path/to/marginalgains/scripts/backup-db.sh

# Or with custom settings
DB_PATH=/custom/path/db.sqlite BACKUP_DIR=/mnt/backups ./scripts/backup-db.sh
```

## Automated Backups with Cron

Edit your crontab:

```bash
crontab -e
```

Add a daily backup at 3am:

```bash
0 3 * * * /path/to/marginalgains/scripts/backup-db.sh >> /var/log/backup-db.log 2>&1
```

Or with custom paths:

```bash
0 3 * * * BACKUP_DIR=/mnt/backups /path/to/marginalgains/scripts/backup-db.sh >> /var/log/backup-db.log 2>&1
```

## Copying Backups Off-Server

### Using rsync (recommended)

Rsync only transfers new/changed files, making it efficient for regular syncs:

```bash
# Basic usage
rsync -avz user@server:~/backup/ ~/local-backups/marginalgains/

# With specific SSH key
rsync -avz -e "ssh -i ~/.ssh/mykey" user@server:~/backup/ ~/local-backups/marginalgains/
```

### Using scp

```bash
# Copy all backups
scp user@server:~/backup/marginal-gains-*.sqlite.gz ~/local-backups/

# Copy specific backup
scp user@server:~/backup/marginal-gains-20241231_030000.sqlite.gz ~/local-backups/
```

### SSH Config for Convenience

Add to `~/.ssh/config`:

```
Host prod
    HostName your-server.com
    User youruser
    IdentityFile ~/.ssh/your_key
```

Then simply:

```bash
rsync -avz prod:~/backup/ ~/local-backups/marginalgains/
```

## Restoring from Backup

1. **Stop the server**
   ```bash
   # If using systemd
   sudo systemctl stop marginalgains

   # Or kill the process
   pkill -f "bun.*server.ts"
   ```

2. **Decompress the backup**
   ```bash
   gunzip marginal-gains-20241231_030000.sqlite.gz
   ```

3. **Replace the database**
   ```bash
   # Backup current (corrupted/old) database just in case
   mv /path/to/marginal-gains.sqlite /path/to/marginal-gains.sqlite.old

   # Copy in the backup
   cp marginal-gains-20241231_030000.sqlite /path/to/marginal-gains.sqlite
   ```

4. **Start the server**
   ```bash
   sudo systemctl start marginalgains
   # Or
   bun start
   ```

## Important Notes

### WAL Mode

SQLite may use Write-Ahead Logging (WAL), which creates additional files:
- `marginal-gains.sqlite-wal`
- `marginal-gains.sqlite-shm`

The backup script uses SQLite's `.backup` command which handles WAL correctly. If copying files manually while the server is running, copy all three files together.

### Backup Verification

Periodically verify your backups are valid:

```bash
# Decompress a backup
gunzip -k marginal-gains-20241231_030000.sqlite.gz

# Check integrity
sqlite3 marginal-gains-20241231_030000.sqlite "PRAGMA integrity_check;"

# Should output: ok
```

### Retention Policy

The default 30-day retention can be adjusted:

```bash
# Keep 90 days of backups
KEEP_DAYS=90 ./scripts/backup-db.sh
```

For critical data, consider:
- Daily backups retained for 30 days
- Weekly backups retained for 3 months
- Monthly backups retained for 1 year
