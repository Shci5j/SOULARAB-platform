# HTTPS and production edge

The production edge must terminate HTTPS with a trusted certificate, redirect HTTP to HTTPS, enforce modern TLS, keep the founder console behind a private access policy, expose only approved public routes, preserve secure forwarding headers, and prevent direct public exposure of the admin service.

The current Docker Compose setup binds both services to localhost for local deployment. Production requires an explicit edge/reverse-proxy deployment and must not expose the admin service directly.

Before launch, verify certificate renewal, HTTPS-only access, secure cookies, trusted-origin configuration, public/admin network separation, and health checks through the intended edge.
