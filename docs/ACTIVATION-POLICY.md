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

The repository now includes a file-backed registry for app-scoped installation IDs, a 10-installation trial cap, permit requests, founder review, and user revocation. Enrollment and permit-data submission require separate explicit consent and record the consent version. The local JSON store is single-instance development storage only; it is not a production-grade shared database. Manual review records the founder's verification assertion but does not independently verify the authority. Do not treat an approved record as legal advice or as permission to collect data beyond the permit's verified scope. No sensitive capability is enabled by this workflow.

The 10-installation cap counts registered app installations, not verified physical devices. Clearing browser storage can create a new app-scoped ID; the current system does not use hardware fingerprints or device attestation. A production-grade device limit requires a privacy-reviewed, platform-supported attestation mechanism.

## Production gate

No sensitive capability or public production rollout may be enabled until the policy is implemented, reviewed, tested, and approved for the applicable jurisdiction.
