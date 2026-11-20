# Phase 3 — Operations

## Goals
- Harden runtime behavior before deployment.
- Add health/readiness checks and operational visibility.
- Keep secrets outside source control.
- Prepare persistent audit/session storage and secret rotation.
- Establish a repeatable deployment and rollback workflow.

## Implemented in this phase
- Admin and public readiness endpoints.
- Runtime request timeout and connection timeout controls.
- Periodic cleanup of expired in-memory sessions and rate-limit entries.
- Production Secure session-cookie enforcement.
- Automated security smoke checks for origin, CSRF, session-cookie, security-header, and internal-boundary controls.
- CI executes both functional and security smoke verification.
- Secret rotation procedure documented.

## Current implementation
- Runtime health endpoints exist for admin and public services.
- Phase 2 smoke verification runs in GitHub Actions.
- Environment examples define the required runtime secret boundary.
- Audit events include actor, action, target, timestamp, result, and correlation ID.

## Required before production
- HTTPS termination and secure transport.
- Persistent session storage with server-side invalidation.
- Persistent, append-only audit storage with retention controls.
- Secret manager integration and rotation procedure.
- External monitoring/alerting.
- Deployment rollback procedure.
- Dependency and container/image scanning.
- Production configuration validation.

## Operational rule
No production credentials are stored in the repository.