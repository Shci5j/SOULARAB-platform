# Rollback and recovery

Every production release must have a known rollback target before deployment.

Procedure:
1. Record the release identifier and configuration version.
2. Create or verify the current backup.
3. Deploy the new release.
4. Run readiness and smoke checks.
5. If checks fail, stop traffic to the failed release.
6. Restore the previous application version and compatible configuration.
7. Restore data only when required.
8. Re-run readiness, smoke, authentication, and Admin-to-Public checks.
9. Record the incident and final release state.

A recovery test is mandatory before public production launch. An untested backup is not a verified backup.
