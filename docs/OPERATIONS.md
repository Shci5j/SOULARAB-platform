# Production Operations Checklist

## Deployment
- [ ] HTTPS enabled at the edge.
- [ ] Production secrets injected by a secret manager.
- [ ] Admin service is not directly exposed to the public internet.
- [ ] Public service exposes only approved public routes.
- [ ] Health checks configured.

## Security
- [ ] Rotate ADMIN_SESSION_SECRET and SERVICE_CONTROL_TOKEN on schedule.
- [ ] Use a persistent session store with revocation.
- [ ] Use append-only persistent audit storage.
- [ ] Enable dependency and image vulnerability scanning.
- [ ] Configure alerting for authentication failures and privileged-operation failures.

## Recovery
- [ ] Document rollback target/version.
- [ ] Back up persistent audit/session data where applicable.
- [ ] Verify restore procedure before production launch.