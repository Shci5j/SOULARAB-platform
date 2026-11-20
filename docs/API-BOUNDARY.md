# API Boundary

The public application and founder control plane are separate trust zones.

Administrative commands must terminate at an authenticated and authorized admin service. Public clients may consume approved public endpoints but cannot invoke privileged control operations.

Every privileged operation should produce an audit event containing actor, action, target, timestamp, result, and correlation identifier.
