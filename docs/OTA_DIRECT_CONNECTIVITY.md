# Direct OTA connectivity: blocked pending partner access

## Current status

BookingTours does not yet have Viator/GetYourGuide connectivity-partner approval or certified supplier adapters. Do not sell these channels as working integrations.

The repository contains prototype handlers, not verified supplier API implementations. The Viator prototype uses a Partner API client; this must not be assumed to implement Viator's supplier connectivity contract. Neither manually signed test payloads nor saved product mappings prove compatibility with either provider.

`supabase/functions/_shared/ota-readiness.ts` blocks both channels in the settings API, webhook handlers, availability jobs and reconciliation job. This is a code-level release boundary, not an operator setting. Existing credentials and mappings are preserved, but previously enabled rows cannot bypass the boundary. Webhooks/jobs return HTTP 503 with `OTA_NOT_READY`; configuration attempts return HTTP 409. Mapping preparation remains available. Operators must manage marketplace bookings manually meanwhile.

The generic `/functions/v1/external-booking` API is separate. It accepts BookingTours' own request format, with per-business/source API keys and HMAC signatures for mutations. A source named VIATOR does not turn it into a native Viator adapter. Its mappings are in `external_product_mappings`; the OTA prototypes use `ota_product_mappings`.

## Getting access

Apply to each provider as BookingTours, a reservation-system/connectivity provider, not merely as an individual tour supplier or affiliate. Ask their connectivity team for:

- Eligibility and approval steps for a new reservation-system partner.
- Current supplier-side API specification and supported integration model.
- Sandbox access, test supplier/products, authentication and credential provisioning.
- Required availability, pricing, booking, amendment and cancellation operations.
- Certification cases, retry/error contracts, rate limits and launch approval requirements.

Provide a truthful description of the product, intended operators and inventory. Do not claim certification or commit operators to launch dates before approval. Operator accounts/product codes may be useful for testing but do not replace platform access. Provider eligibility and certification requirements must be confirmed directly; they have not been verified in this repository.

## Engineering release checklist (still outstanding)

Implement against the supplied contracts, not the prototype payload guesses. Release each channel independently only after its evidence is recorded.

- [ ] Official contract versions, credentials and sandbox fixtures obtained.
- [ ] Provider-specific request/response adapters and authentication implemented.
- [ ] Exact operator + product + option mapping, with explicit missing/ambiguous mapping errors and tenant-owned active tours.
- [ ] Tenant-local departure time, currency, price categories, closed slots and sold-out availability implemented according to the provider contract.
- [ ] Shared transactional booking operations: booking write and capacity reservation/release commit or roll back together; race-safe checks prevent overselling.
- [ ] Retry-safe event processing: scope by tenant/channel and provider event identity, distinguish successive amendments, detect payload conflicts, mark success only after transaction commit and allow failed deliveries to retry.
- [ ] Date/time/product/option/quantity amendments move capacity atomically; cancelled bookings cannot be amended.
- [ ] Creation, amendment and cancellation errors propagate; no success acknowledgement for lost bookings.
- [ ] Reconciliation is paginated, retryable and based on supported provider endpoints; actionable operator alerts report unresolved failures.
- [ ] Sandbox test bookings are isolated from live inventory, messages and payments. The old `test_mode` only changes outbound hosts and is not adequate isolation.
- [ ] Runtime/database tests cover concurrent booking, duplicate delivery, successive amendments, failed delivery then retry, cancellation, closed/full slots, daylight-saving/timezone boundaries and cross-tenant isolation.
- [ ] Provider certification passed and launch permission recorded.
- [ ] Replace the shared prototype release block with the certified per-channel implementation. Do not simply flip the boolean to enable these prototypes.

The current guard makes the known option-matching, retry and rescheduling defects unreachable. It does not repair or certify the underlying prototypes.

## Generic API credential remediation

Authentication and operator settings now read `hmac_secret_encrypted`, not the retired plaintext column. The service-only decryption RPC supplies the secret. A missing encryption key, decryption error or empty decrypted value for an encrypted credential fails closed; it must never downgrade to API-key-only authentication.

Credentials intentionally created without HMAC can check availability only. The UI says so. If the API key write succeeds but the separate HMAC write fails, the UI reports partial failure, preserves the new API key for copying, and does not present the unsaved HMAC as usable. Retry HMAC setup before giving the credential to a partner. Credential creation/rotation is still a two-step operation, not a transactional provisioning API.

The public `backfill_hmac` action is retired (HTTP 410). HMAC changes require a JWT-authenticated MAIN_ADMIN for the credential's business or SUPER_ADMIN.

### Deployment and migration precautions

1. Inspect the target database before deploying. If legacy plaintext credentials remain, use a trusted administrative migration process to encrypt every non-null plaintext secret with the deployed `SETTINGS_ENCRYPTION_KEY`, using the service-only `set_external_booking_credentials` RPC. Never put plaintext secrets or encryption keys into committed SQL, logs or terminal output.
2. Verify no legacy non-null secret lacks an encrypted counterpart, and verify decryption works with the deployment key. Do not deploy the encrypted-only reader against unbackfilled credentials: those would appear availability-only. Preserve/rotate keys deliberately, not by guessing a new encryption key.
3. The existing `20260502120000_encrypt_external_booking_hmac_secret_phase2.sql` guards and drops the plaintext column. Coordinate its application with the encrypted-only reader/UI; the old reader does not work after that drop. This pass adds no new migration.
4. Notify affected operators that native OTA processing will stop. Deploy all five guarded edge handlers (`viator-webhook`, `getyourguide-webhook`, both availability-sync functions, `ota-reconcile`) together with the Next application. Deploy `external-booking` after the credential prerequisite is verified. Deploying only the UI does not stop old edge handlers.
5. Verify HTTP 503/409 readiness responses and absence of outbound OTA traffic, including for previously enabled rows. Consider pausing the existing OTA cron schedules operationally to avoid repeated expected 503 alerts; retain their definitions for later certified replacements.
6. Test the generic API in an isolated tenant: signed availability/create/modify/cancel, duplicate creation, invalid signature, missing key and decrypted-secret failure. It has no first-class sandbox, so do not test against live inventory or send real customer messages.

No provider access, certification, production migration or deployment is performed by the repository changes themselves.
