# Security Baseline

1. Secrets are environment-only and never committed.
2. Admin routes require authentication and authorization.
3. Public traffic cannot directly invoke privileged admin operations.
4. Administrative actions must be auditable.
5. Inter-service communication must use authenticated requests.
6. Production deployment must use HTTPS.
