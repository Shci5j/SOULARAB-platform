# Activation and Authorization Policy

## Mandatory activation gates

SOULARAB must remain inactive for any regulated or sensitive capability until both conditions are met:

1. A valid authorization or permit from the competent authority for the applicable jurisdiction has been received and manually verified.
2. The founder has explicitly approved the activation after reviewing the permit scope and expiry.

If either condition is absent, expired, unclear, or revoked, activation is denied by default.

## Trial enrollment

- The pilot is capped at 10 explicitly enrolled installations.
- Enrollment must be initiated by the user after seeing a clear explanation of what is registered and why.
- Use a random, app-scoped installation identifier. Do not collect IMEI, serial numbers, advertising IDs, or hidden hardware fingerprints.
- The installation identifier must be revocable and covered by a published retention policy before production.
- Reaching the 10-installation cap blocks further trial enrollment and directs the applicant to the formal authorization review process.

## Consent and sensitive capabilities

- No hidden collection of location, screen contents, microphone audio, camera images, messages, or other personal data.
- Request a device permission only at the moment the related feature is used, with a specific and truthful explanation.
- Refusal must not be bypassed or disguised.
- The user must be able to review and revoke optional permissions where the platform supports it.

## Founder review

A permit request remains pending until a human reviewer verifies its authenticity, issuing authority, jurisdiction, scope, and validity period. The system must record the reviewer, decision, timestamp, and reason. It must not infer legal authorization from an uploaded file or a user-supplied claim alone.

## Implementation status

This document defines the release policy. The permit registry, persistent installation counter, review queue, revocation controls, and consent receipts are not yet implemented. Do not treat the current public message control as an activation or authorization system.

## Production gate

No sensitive capability or public production rollout may be enabled until the policy is implemented, reviewed, tested, and approved for the applicable jurisdiction.
