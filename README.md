# SOULARAB Platform

SOULARAB is built as two separate trust zones: a public portal and a private founder control plane.

## Repository layout
- `apps/public` — public website and approved public API
- `apps/admin` — private founder console and privileged control API
- `packages/core` — shared configuration, security helpers, and audit contracts
- `docs` — architecture, security, activation policy, and operational plans

## Current capabilities
- Arabic RTL public portal with service status.
- Founder login using a signed, HttpOnly, SameSite session cookie, with hashed-token session persistence for single-instance development.
- Founder console to view service status, update the public status message, and review permit requests.
- Explicit-consent trial enrollment capped at 10 app-scoped installation IDs, permit submission, founder review, and self-revocation.
- CSRF protection, origin checks, restrictive content security policies, bounded request bodies, and audit events.
- GitHub Actions syntax, functional, and security smoke checks.

## Local development
Use Node.js 20 or newer. Configure non-committed environment variables from the examples in `apps/public/.env.example` and `apps/admin/.env.example`. Use strong, unique secrets and the same `SERVICE_CONTROL_TOKEN` in both services.

Start the public service with `npm run dev:public` and the founder service with `npm run dev:admin`. The default local addresses are ports 4000 and 3000 respectively.

Run verification with `node scripts/smoke.mjs` and `node scripts/security-smoke.mjs`.

## Delivery status
The public and founder interfaces are implemented as a foundation. Persistent data storage, formal authorization workflows, production deployment, and external monitoring are not yet implemented. See `docs/ROADMAP.md` and `docs/ACTIVATION-POLICY.md`.

No production credentials belong in this repository. The founder service must be placed behind a private access policy before production use.
