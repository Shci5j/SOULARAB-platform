# Roadmap

## Phase 1 — Foundation
- [x] Repository and workspace structure
- [x] Separate public application and private founder control plane
- [x] Shared core boundary and security documentation
- [x] Arabic RTL public portal
- [x] Founder login and initial management console
- [x] Admin-to-public authenticated control path

## Phase 2 — Activation
- [x] Founder authentication and session handling
- [x] CSRF and origin protections for privileged actions
- [x] Controlled admin-to-public communication
- [x] Initial runtime configuration management
- [ ] Production-grade shared storage for sessions, audit records, and platform state
- [x] Initial formal authorization and permit review workflow (manual verification required)
- [x] Explicit-consent trial enrollment capped at 10 app-scoped installations
- [x] Founder review queue with approve/reject and audit trail
- [x] User-facing enrollment consent and self-revocation; per-feature consent remains pending

## Phase 3 — Operations
- [x] Health and readiness endpoints
- [x] Request size and timeout hardening
- [x] Functional and security smoke tests in GitHub Actions
- [ ] Production deployment and HTTPS edge configuration
- [ ] External secret manager and tested rotation
- [ ] External monitoring and alerting
- [ ] Tested rollback and recovery
- [ ] Dependency and container/image vulnerability scanning

## Release gate
Do not activate sensitive capabilities or deploy publicly until legal authorization, explicit user consent, secure persistent storage, and the production security checklist are verified.
