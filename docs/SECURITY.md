# Security Baseline

1. Secrets are environment-only and never committed.
2. Admin routes require authentication and authorization.
3. Admin sessions use signed HttpOnly/SameSite cookies.
4. State-changing privileged requests require CSRF validation.
5. Login attempts are rate-limited.
6. Public traffic cannot directly invoke privileged admin operations.
7. Administrative actions are auditable with actor, action, target, timestamp, result, and correlation ID.
8. Admin-to-public control calls use a dedicated authenticated service token.
9. Inputs and request bodies are size-limited and validated.
10. Production deployment must use HTTPS and secure secret injection.
