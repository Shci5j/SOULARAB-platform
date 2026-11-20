# Secret management

Production secrets must not be committed to Git.

Required secrets currently include ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SESSION_SECRET, SERVICE_CONTROL_TOKEN, and AUDIT_LOG_SECRET.

The production target is an external secret manager with workload identity or short-lived access, versioned values, audited access, staged rotation, and rollback to the previous version when verification fails.

Until a provider is selected and integrated, deployment must inject these values through a controlled secret-management mechanism. The repository .env examples are templates only.

Rotation:
1. Generate a new value.
2. Deploy it alongside dependent services.
3. Verify readiness and authenticated Admin-to-Public communication.
4. Verify audit integrity.
5. Revoke the previous value only after successful verification.
