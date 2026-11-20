# Monitoring and alerting

Production monitoring must cover both services and the Admin-to-Public trust boundary.

Minimum signals:
- health and readiness failures;
- elevated authentication failures;
- repeated CSRF/origin rejection;
- Admin-to-Public authentication failures;
- privileged-operation failures;
- storage errors;
- backup failures;
- deployment/rollback failures.

The application already exposes health/readiness endpoints. Production must connect them to an external monitoring service and an operator-controlled notification channel.

A green application health endpoint alone is not proof that the complete platform is healthy; storage, dependencies, and the control path must also be monitored.
