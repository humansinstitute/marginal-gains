# Backlog

## Security Enhancements

### Encrypted Data at Rest in SQLite

**Priority:** Medium
**Status:** To Explore

Investigate options for encrypting all data at rest in SQLite:

- **SQLCipher**: Full database encryption, transparent to application code
  - Pros: Battle-tested, AES-256, page-level encryption
  - Cons: Requires native bindings, may need different Bun/SQLite setup

- **Application-level encryption**: Encrypt sensitive fields before storage
  - Pros: Works with any SQLite, granular control
  - Cons: Can't query encrypted fields, key management complexity

- **SQLite SEE (Encryption Extension)**: Official paid extension
  - Pros: Official support, multiple algorithms
  - Cons: Commercial license required

**Considerations:**
- Key management strategy (env var, HSM, derived from admin key?)
- Performance impact on queries
- Backup/restore procedures with encryption
- Migration path for existing unencrypted data

**Related:** Private channels currently store messages in plaintext. Once encryption at rest is implemented, private channel data will be protected even if database file is compromised.
