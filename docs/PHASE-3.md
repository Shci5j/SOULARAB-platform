# Phase 3 — Operations

## Goals
- Harden runtime behavior before deployment.
- Add health/readiness checks and operational visibility.
- Keep secrets outside source control.
- Prepare persistent audit/session storage and secret rotation.
- Establish a repeatable deployment and rollback workflow.

## Implemented in the current repository
- Public and admin health and readiness endpoints.
- Configurable request, header, and keep-alive timeouts for both services.
- Bounded request-body buffering with explicit 400/413 responses for malformed or oversized JSON requests.
- Production Secure session-cookie enforcement.
- Functional and security smoke-test scripts.
- GitHub Actions workflow configured to run syntax, functional, and security checks.
- Secret-rotation procedure documented.
- Audit events include actor, action, target, timestamp, result, and correlation ID.
- Public and founder web interfaces with same-origin content security policies.

## Not implemented yet
- Periodic cleanup of expired in-memory sessions and rate-limit entries. Expired sessions are removed when accessed; rate-limit history is pruned on subsequent login attempts. No background cleanup task is configured.
- Production-grade shared session storage with cross-instance invalidation (current file-backed store is single-instance development only).
- Persistent, append-only audit storage with retention controls.
- External secret-manager integration.
- External monitoring and alerting.
- Deployment rollback automation.
- Dependency and container/image vulnerability scanning.
- Production configuration validation and enforced HTTPS termination.

## Required before production
- HTTPS termination and secure transport.
- Keep the admin service behind a private network/edge access policy.
- Production-grade shared session storage with revocation across instances.
- Persistent audit storage, access controls, backups, and retention policy.
- Secret-manager integration and tested rotation.
- External monitoring/alerting.
- Documented and tested deployment rollback.
- Dependency and container/image scanning.
- Production configuration validation.

## Operational rule
No production credentials are stored in the repository. No automatic deletion or retention cleanup is enabled without an explicitly approved policy.
