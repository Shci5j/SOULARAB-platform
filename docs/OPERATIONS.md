# Production Operations Checklist

## Deployment
- [ ] HTTPS enabled at the edge.
- [ ] Production secrets injected by an external secret manager.
- [ ] Admin service is not directly exposed to the public internet.
- [ ] Public service exposes only approved public routes.
- [ ] Health checks configured and monitored externally.
- [ ] Production configuration smoke check passes.

## Security
- [ ] Rotate ADMIN_SESSION_SECRET and SERVICE_CONTROL_TOKEN on schedule.
- [ ] Use a persistent shared session store with revocation.
- [ ] Use append-only persistent audit storage.
- [ ] Dependency and image vulnerability scanning passes.
- [ ] Configure alerting for authentication failures and privileged-operation failures.

## Recovery
- [ ] Document rollback target/version.
- [ ] Back up persistent audit/session data where applicable.
- [ ] Restore procedure tested in an isolated environment.
- [ ] Rollback procedure tested before production launch.

## Current implementation boundary
The repository now contains the CI security-scan workflow, production configuration validation, local-state backup helper, and production operations runbooks. These are preparation and verification controls; they do not by themselves provide a production database, external secret manager, external monitoring service, HTTPS edge, or a completed recovery test.
