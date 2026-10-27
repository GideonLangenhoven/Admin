# Direct OTA connectivity: blocked pending partner access

## Viator pre-application update (2026-10-20)

The owner confirmed there is no approved Viator pilot operator and no technical-evaluation approval. The immediate next step is an eligibility enquiry and identifying a genuine registered operator using BookingTours. The [onboarding preparation](integrations/viator/ONBOARDING.md) includes an honest enquiry draft, the current code gaps and supporting evidence. No new provider development, test credentials or activation was introduced in this review.

The owner requested continued use of the existing pre-launch Supabase project. Future hosted evaluation tests may use that project with an implemented, verified isolated namespace and synthetic data. The existing shared-table OTA handlers do not yet support this isolation; never set the project-wide boundary to SANDBOX as a substitute. This updates the earlier requirement for a separate project/database while preserving the isolation requirement.

## Current status (2026-10-08)

BookingTours has no Viator/GetYourGuide connectivity-partner approval or certification. The OTA fixes, migration `20261008120000_ota_transactions` and cleanup-worker update were deployed on 2026-10-08. All five public OTA entrypoints still return HTTP 503 `OTA_NOT_READY`, activation/credentials remain blocked in settings, and the production database boundary remains `BLOCKED`. This is a locally verified candidate for individual, scheduled departures, not a certified integration. Existing cron schedules were preserved. Deployment source, permissions and readiness checks are recorded in [the deployment evidence](production-readiness/evidence/OTA_FIXES_DEPLOYMENT_20261008.json).

The incorrect affiliate Viator Partner API client, GYG OAuth/Bearer client, speculative webhook formats and guessed remote booking-list reconciliation endpoints have been removed. Actual supplier handlers and service-role availability worker wiring replace them behind the permanent public release boundary. Unsupported reconciliation remains explicitly unavailable; there is no claim that marketplace counts were compared. Operators continue managing marketplace bookings manually.

The separate generic `/functions/v1/external-booking` API accepts BookingTours' own payload/HMAC format. Naming its source VIATOR does not make it a native provider adapter.

## Authoritative contracts

The candidate follows the public contracts retrieved on 2026-10-08:

- [Viator Reservation System API](https://docs.viator.com/supplier-api/technical/): reservation-system hosted JSON POST APIs; per-operator API keys, v2 `X-Api-Key`, legacy v1 body `ApiKey`; `POST /tourlist`, `/v2/availability/calendar`, `/v2/availability/check`, `/v2/reserve`, `/booking`, `/booking-amendment`, `/booking-cancellation`. Booking/cancellation remain v1 envelopes, not invented v2 webhooks. Viator supplies the supplier ID/API key after evaluation and approval. Registered Viator operators using the reservation system are a development prerequisite.
- [GYG overview](https://integrator.getyourguide.com/documentation/overview), [supplier endpoints](https://integrator.getyourguide.com/documentation/supplier_endpoints) and [provider endpoints](https://integrator.getyourguide.com/documentation/gyg_endpoints): HTTP Basic in both directions, with platform-wide incoming credentials rather than per-operator OAuth tokens. Mandatory incoming `GET /1/get-availabilities/`, `POST /1/reserve/`, `/1/cancel-reservation/`, `/1/book/`, `/1/cancel-booking/` exist in the candidate. Expected GYG errors use HTTP 200 and `errorCode`, never success `data` alongside an error. GYG replacements reserve/book with the same GYG reference, receive a new supplier booking reference, then cancel the old supplier reference.
- [GYG new reservation-system registration](https://gygconnectivity.zendesk.com/hc/en-us/articles/30171424267037-How-Do-I-Register-my-new-Reservation-System-and-What-Are-the-Next-Steps): registration, review and testing are required; local tests confer no partnership or launch approval.

Outbound notifications use the documented `POST /v2/notification/events` (Viator API key; 204 or fully successful 207) and `POST /1/notify-availability-update` (GYG Basic; 202). Provider-issued sandbox routing/credentials must be obtained and verified. No guessed sandbox domain, booking-list endpoint or automatic reconciliation purchase is included.

## Implemented behavior

`ota_apply_operation` is one PostgreSQL transaction for reservation, booking, amendment, cancellation, inventory counters and completed retry result. Tenant serialization and ordered source/destination slot locks serialize with existing direct checkout holds. All capacity checks subtract both booked and held seats. Failed event/booking/customer/counter writes roll back together and remain retryable. Exact tenant-owned active tour + product + option mappings and exact operator-local departure times replace product-only matching and the 30-minute tolerance. Zero/negative quantities, full/closed/past departures, ambiguous mappings and cancelled-booking amendments fail explicitly.

Completed events are scoped by business/channel/database environment and stable request identity. Meaningful payload conflicts fail. Viator `Retry` and authentication/transport fields do not create false conflicts. Book retries are checked before mutable mappings/tours/categories; changing the current catalogue cannot turn a confirmed retry into a second booking or failed confirmation. Viator booking/cancellation can fall back to stable booking identity when `ExternalReference` is absent. **Viator amendments require a stable unique `ExternalReference`**: the public field is optional, so this safety restriction must be agreed and contract-tested before enabling amendments. A timestamp/content hash cannot safely identify an old retry versus a later A-to-B-to-A change.

GYG supplier references are globally unique, alphanumeric 24-character references, separate from booking UUIDs and GYG references. Replacement A → B → A creates a new reservation/booking only after the earlier A booking is cancelled; delayed retries while A is active return its original reservation. Old cancellations cannot target replacements. One-hour holds retain their original price. GYG retailPrice/currency sent with booking are informational and cannot cause price-discrepancy rejection. Viator's optional amount is stored as known net only when provided; otherwise an explicit local quote is used and OTA net remains null. GYG gross is the held retail quote; net settlement is unknown and remains null. Customer linking/stats and waiver invalidation for added guests/tour changes are preserved.

Availability uses requested bounded windows and paginated ordered reads. GYG emits every existing departure, including zero vacancies for closed/cancelled/sold-out slots, using the activity's local ISO offset, configured currency and integer minor-unit category prices. Viator uses operator-local dates/times, monetary major units and contract-shaped available/unavailable events; closed events are omitted as the contract interprets omission as unavailable. Missing departure times on v1 booking/amendment are accepted only if that local date has exactly one departure. Category prices are explicit; the existing adult slot override does not overwrite distinct child/category prices.

Availability workers compare stored snapshots and notify changes, including zero-vacancy closures when a departure/mapping disappears. They include Viator supplier ID, propagate provider 207 partial rejection, retain retryable snapshots on failure and never report successful sync after a database failure. Atomic OTA expiry releases only expired OTA holds and runs independently of normal direct-booking cleanup in `cron-tasks`; an OTA error cannot prevent direct hold cleanup. Expiry work is bounded. Reconciliation is unavailable until a supported provider export/feed and its pagination/window contract are supplied.

## Isolation and honest setup

The new migration defaults `ota_runtime_boundary` to `BLOCKED`. Service, anonymous and authenticated roles cannot read/change it; RLS is enabled. The transaction RPC rejects all writes unless a **separate, administratively provisioned sandbox database** is marked SANDBOX. LIVE is not an allowed activation setting. There is no environment-variable or operator-toggle release bypass. Existing booking triggers can send messages and affect marketing/payments: never mark the production database SANDBOX, or run tests against live inventory. Sandbox provisioning must also isolate mail/message/payment credentials and destinations. The local harness accepts only a disposable Unix-socket PostgreSQL instance and never reads `.env` or accepts a remote URL.

Preparation fields in `ota_product_mappings` are supplier-owned IDs despite the legacy `external_*` names:

- Viator `external_product_code` + `external_option_code` identify reservation-system product/option, not affiliate marketplace codes; `supplier_option_id` identifies the v2 bookable option.
- GYG `external_product_code` is the supplier product ID representing one GYG option; option code is null. Codes must resolve to exactly one business across platform-wide ingress; ambiguous/cross-tenant mappings fail.
- `category_prices` is a configured category → operator-currency major-unit price map; empty means only ADULT at the tour base price. No unconfigured age band is invented. `catalog` contains truthful Viator name/description/countryCode/destinationCode/destinationName; missing metadata fails TourList rather than fabricating geography.
- Viator integration `config_json.supplier_id` is provider-issued. `notification_base_url` must be the provider-issued HTTPS host; the worker rejects non-provider hosts. Incoming per-operator credentials use the existing encrypted credentials RPC. GYG incoming `GYG_SUPPLIER_USERNAME/PASSWORD` and outgoing `GYG_NOTIFICATION_USERNAME/PASSWORD` are different platform credential pairs, not activation switches. The existing service-role worker token authenticates sync requests behind the public guard.

Do not expose these preparation fields as a working integration or provision sandbox credentials in production. Apply database changes before deploying dependent workers only as part of a separately approved release.

## Remaining engineering and external prerequisites

The following are **not** solved by entering credentials:

- GYG requires multi-supplier systems to support GROUP inventory/pricing and time-period products. The current booking model is per-person scheduled departures; GROUP is explicitly rejected and no opening-hours/group-seat model is fabricated. These mandatory modes must be implemented and certified before GYG production approval. Add-ons/tiered/category-specific inventories and optional product/redemption APIs are not implemented in this candidate.
- Viator unit/tiered pricing and opening-hours products are not supported. Viator notification enable-after-calendar and disable-on-invalid-provider-connection lifecycle needs agreement/implementation before notification launch. Amendment stable-transaction identity must be agreed for the optional ExternalReference field.
- Provider registration/technical evaluation, authorized registered operators, issued credentials, exact sandbox notification routing and test products, sandbox authentication/rate/retry/error cases, mandatory product-mode implementation, provider contract testing/certification and explicit launch approval remain outstanding.
- No supported remote reconciliation feed is verified. Counts/missing-booking reconciliation must not be advertised until one is supplied.
- Only a reviewed per-provider certified deployment can replace the public guard and database boundary. Flipping the existing boolean alone leaves the database blocked and does not make these candidates production-ready.

## Local verification

```sh
./node_modules/.bin/vitest run tests/unit/ota-supplier-contracts.test.ts tests/unit/ota-runtime.test.ts tests/unit/external-integration-readiness.test.ts
node tests/ota-transactions-local.mjs /private/tmp/capekayak-db-test-<random> <port>
deno check --no-config supabase/functions/_shared/ota-supplier.ts supabase/functions/_shared/ota-backend.ts supabase/functions/_shared/ota-availability.ts supabase/functions/_shared/viator.ts supabase/functions/_shared/getyourguide.ts
```

The PostgreSQL harness creates/drops its own random fixture database, applies the real candidate migration and executes the actual handlers/backend through a test-only PostgreSQL transport. It covers last-seat concurrency, shared direct/OTA holds, all-or-nothing write failures, failed-then-retried events, tenant isolation, exact options, multiple reschedules, cancelled amendments, repeated cancellation, GYG A → B → A replacement, and Viator contract-shaped retries. Unit tests exercise authentication, malformed/invalid requests, closures/local dates/DST, minor-unit prices and network-stubbed notifications. These are local regression tests, not provider sandbox/certification evidence.

## Generic API credential remediation

Authentication and operator settings now read `hmac_secret_encrypted`, not the retired plaintext column. The service-only decryption RPC supplies the secret. A missing encryption key, decryption error or empty decrypted value for an encrypted credential fails closed; it must never downgrade to API-key-only authentication.

Credentials intentionally created without HMAC can check availability only. The UI says so. If the API key write succeeds but the separate HMAC write fails, the UI reports partial failure, preserves the new API key for copying, and does not present the unsaved HMAC as usable. Retry HMAC setup before giving the credential to a partner. Credential creation/rotation is still a two-step operation, not a transactional provisioning API.

The public `backfill_hmac` action is retired (HTTP 410). HMAC changes require a JWT-authenticated MAIN_ADMIN for the credential's business or SUPER_ADMIN.

### Deployment and migration precautions

1. Inspect the target database before deploying. If legacy plaintext credentials remain, use a trusted administrative migration process to encrypt every non-null plaintext secret with the deployed `SETTINGS_ENCRYPTION_KEY`, using the service-only `set_external_booking_credentials` RPC. Never put plaintext secrets or encryption keys into committed SQL, logs or terminal output.
2. Verify no legacy non-null secret lacks an encrypted counterpart, and verify decryption works with the deployment key. Do not deploy the encrypted-only reader against unbackfilled credentials: those would appear availability-only. Preserve/rotate keys deliberately, not by guessing a new encryption key.
3. The existing `20260502120000_encrypt_external_booking_hmac_secret_phase2.sql` guards and drops the plaintext column. Coordinate its application with the encrypted-only reader/UI; the old reader does not work after that drop. That generic-API remediation is separate from the new `20261008120000_ota_transactions.sql` candidate migration.
4. Notify affected operators that native OTA processing will stop. Deploy all five guarded edge handlers (`viator-webhook`, `getyourguide-webhook`, both availability-sync functions, `ota-reconcile`) together with the Next application. Deploy `external-booking` after the credential prerequisite is verified. Deploying only the UI does not stop old edge handlers.
5. Verify HTTP 503/409 readiness responses and absence of outbound OTA traffic, including for previously enabled rows. Consider pausing the existing OTA cron schedules operationally to avoid repeated expected 503 alerts; retain their definitions for later certified replacements.
6. Test the generic API in an isolated tenant: signed availability/create/modify/cancel, duplicate creation, invalid signature, missing key and decrypted-secret failure. It has no first-class sandbox, so do not test against live inventory or send real customer messages.

These deployed changes do not provide provider access or certification and do not activate live OTA processing.
