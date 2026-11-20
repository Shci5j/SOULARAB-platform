# Production storage and backups

The current JSON files are development storage and must not be treated as the production data plane.

Production requires shared persistent storage for founder sessions and revocation state, audit records, activation/authorization state, and public runtime configuration.

The production storage implementation must provide atomic writes or transactions, concurrent access from multiple service instances, durable persistence, access control, encryption at rest where supported, backup capability, and tested restore.

The repository includes a local-state backup helper for development and migration preparation. It is not a substitute for production backups.

Before production launch, select the shared storage technology, migrate the file-backed records, perform a backup, restore into an isolated environment, and verify application behavior against the restored state.
