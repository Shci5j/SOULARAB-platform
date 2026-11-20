# SOULARAB Platform Architecture

## Phase 1: Foundation

The platform is divided into two explicit trust zones:

1. **Public Platform** — user-facing surface.
2. **Founder Control Plane** — private administration and control surface.

Shared contracts live under `packages/core`. Documentation lives under `docs`.

### Security boundary
The private control plane must remain inaccessible to unauthenticated public traffic. Secrets and credentials must never be committed to this repository.

### Phase 2
Activate authentication, authorization, controlled communication, and runtime management.

### Phase 3
Operate, monitor, harden, and iterate the platform.
