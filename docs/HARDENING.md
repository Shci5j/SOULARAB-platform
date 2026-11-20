# Runtime Hardening

- Security response headers are applied to service responses.
- Admin state-changing requests can be restricted by an explicit trusted origin.
- Admin and public services reject oversized request bodies.
- Privileged public endpoints require the dedicated service token.
- Production must place the admin service behind a private network/edge policy.
- Production secrets must be injected externally and rotated.
- Health endpoints expose service status only and never secrets.
