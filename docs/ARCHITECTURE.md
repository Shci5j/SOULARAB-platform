# SOULARAB Platform Architecture

## Trust zones

1. **Public Platform** — user-facing portal and approved public endpoints in `apps/public`.
2. **Founder Control Plane** — private login, administration UI, and privileged APIs in `apps/admin`.
3. **Shared Core** — configuration, token utilities, and audit contracts in `packages/core`.

The founder console talks to the public service through a dedicated server-to-server token. Browser clients never receive that token.

## Current request flow

- Visitors load the public portal and read the public service status.
- The founder authenticates to the admin service using environment-configured credentials.
- The admin service issues a signed HttpOnly/SameSite session and CSRF token.
- Privileged browser requests are checked for a valid founder session and CSRF token.
- The admin service calls the public service over the internal control route using the service token.
- Privileged actions create audit events.

## Security boundary

- The admin service must remain behind private network or edge access controls.
- Public endpoints never expose privileged control operations.
- Secrets remain outside source control and browser bundles.
- Optional device, screen, microphone, and location access must never be covert; each capability requires a clear purpose and explicit user action/consent.
- Device registration, if introduced, must use a random app-scoped identifier rather than IMEI or other hardware identifiers.

## Persistence boundary

Founder sessions are persisted locally in a JSON file using hashed session-token keys and server-side revocation. Public configuration and activation records use separate local JSON files. Audit events use a local append-only HMAC hash chain. Integrity is checked before new events are appended; a failed chain blocks further audit writes and makes the admin readiness check fail. Legacy entries are marked as unverified. The local file is not an external immutable audit sink; without an external checkpoint, truncation of the log tail cannot be independently detected. The HMAC key must remain stable; key rotation requires a documented migration. These file-backed stores are single-instance development baselines, not production or multi-instance storage. A production-grade shared store is required before deployment.

## Phase 2

Implement persistent state, the authority-permit review process, capped trial enrollment, founder approvals, and user-facing consent controls. Activation must fail closed when a required authority permit or founder approval is missing.

## Phase 3

Deploy, monitor, back up, rotate secrets, scan dependencies, and test recovery only after the production release gate is satisfied.
