# Secret Rotation Procedure

## Secrets
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `SERVICE_CONTROL_TOKEN`

## Rotation order
1. Generate new high-entropy values outside the repository.
2. Inject the new values into the deployment secret manager.
3. Restart the affected services.
4. Verify `/ready` and the security smoke checks.
5. Confirm admin login and the admin-to-public control path.
6. Revoke the previous values after successful verification.

## Session secret impact
Rotating `ADMIN_SESSION_SECRET` invalidates all existing signed admin session cookies.

## Service token impact
Rotate `SERVICE_CONTROL_TOKEN` on both the admin and public services as one coordinated change. Never commit either value.

## Recovery
If verification fails, restore the previous secret values from the secret manager and repeat the health/readiness checks. Record the rotation event in the deployment change log.
