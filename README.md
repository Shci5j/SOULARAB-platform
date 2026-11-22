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
- File-backed local persistence for founder sessions, bookings, screen sessions, and public configuration; the local container deployment shares the public data volume with the founder service.
- Founder console to view service status, update the public status message, and review permit requests.
- Explicit-consent trial enrollment capped at 10 app-scoped installation IDs, permit submission, founder review, and self-revocation.
- CSRF protection, origin checks, restrictive content security policies, bounded request bodies, and an HMAC hash-chained audit log with a founder-only viewer.
- GitHub Actions syntax, functional, security, and container integration checks, plus scheduled CodeQL analysis and Dependabot updates.

## Local development
Use Node.js 24 or newer. Configure non-committed environment variables from the examples in `apps/public/.env.example` and `apps/admin/.env.example`. Use strong, unique secrets, set `AUDIT_LOG_SECRET` to a stable random value of at least 32 characters, Keep the audit key stable; rotating it requires a verified audit-log migration.

Start the public service with `npm run dev:public` and the founder service with `npm run dev:admin`. The default local addresses are ports 4000 and 3000 respectively.

Run verification with `node scripts/audit-integrity-smoke.mjs`, `node scripts/smoke.mjs`, and `node scripts/security-smoke.mjs`.

## Local container deployment
Copy `.env.compose.example` to `.env`, replace every placeholder with a unique secret, then run `docker compose up --build -d`. The public portal is available at `http://localhost:4000` and the private founder console at `http://localhost:3000`. Both ports bind to localhost only. Use `docker compose logs -f` to inspect services and `docker compose down` to stop them. Do not use `docker compose down --volumes` unless you intentionally want to delete the local data volumes.

## Delivery status
The public and founder interfaces, shared local single-instance persistence, explicit-consent booking flow, and founder review workflow are implemented. Production-grade shared storage, external audit anchoring, formal authority verification, production deployment, HTTPS termination, external secret management, monitoring, backups, and rollback remain pending. See `docs/ROADMAP.md` and `docs/ACTIVATION-POLICY.md`.

No production credentials belong in this repository. The founder service must be placed behind a private access policy before production use.
