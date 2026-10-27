# BookingTours MCP implementation and release handoff

Deployment checkpoint, 4 October 2026: the complete Admin runtime is published as dpl_EhJYZbZS9hY5sZHKo28sMxq2eXSw. Public agent/OAuth discovery requests return 503 INTEGRATION_DISABLED with no-store; ChatGPT and Muse remain unavailable for connection. The isolated synthetic staging project reference, gateway/schema provisioning and real hosted consent/provider checks remain pending. The new local MCP SQL was not applied. See [the release verification](../production-readiness/evidence/ALL_CHANGES_DEPLOYMENT_20261004.json). Earlier local/deployment statements below are historical checkpoints.

Updated 4 October 2026. The application code is implemented locally; external access remains disabled by default. No production migration, deployment, provider connection, directory submission or customer-data write was performed in this implementation pass. Preserve the wider `PAUSED_BY_USER` / `FAILED_GATE` verdict.

Continuation, 4 October 2026: repository lint configuration is corrected without changing rule severities; DOMPurify is patched to 3.4.16. The final local suite passes 1,988 tests in 123 files with 1 intentional skip, including 48 real local PostgreSQL/OAuth/MCP backend cases. Production-mode build and whole-repository lint pass (259 configured warnings). The production-only npm audit has zero findings; the full audit retains seven high build-tool findings from unpatched braces. See [the continuation release review](mcp-release-review-20261004.md) and [its evidence](mcp-release-preparation-20261004.json). External access remains disabled; no new deployment or SQL application occurred.

The inspected application is `/Users/gideonlangenhoven/dev/capekayak`, branch `feature/simple-view-2026-09-20`, commit `43304b65314c2b9974f939304e7b2ebae0a62c0c`. The current workspace is the separate marketing repository. Unrelated changes are preserved. No branch switch is required. Supabase Auth/RLS, existing business rules and deployment boundaries remain in place.

| Area | Specified | Implemented | Tested | Deployed | Platform approved | Customer available |
| --- | --- | --- | --- | --- | --- | --- |
| Shared reads | Yes | Existing service + restricted production gateway | Synthetic fixtures and real local PostgreSQL | Earlier disabled service and foundation schema only; new gateway/extension are local | No | No |
| ChatGPT OAuth/MCP | Yes | Node routes, discovery, DCR, PKCE, opaque tokens, refresh/revoke, quota | Local OAuth/SDK/database with injected identity; separate real local Supabase Auth identity tests | No | No | No |
| Consent/disconnect | Yes | Existing settings + native Auth validation + atomic grant/token revocation | Local backend + real local native Supabase sign-in; browser consent journey untested | No | No | No |
| Muse | Separate specification | Independently closed route; no active protocol/auth adapter | Closed-route tests only | No | No | No |

Detailed verification commands, counts, failures, file hashes and evidence boundaries are in [the implementation record](mcp-implementation-verification-20261004.json). This supersedes the earlier fixture-only connection status, not the historical deployment evidence. See [the security decision](mcp-security-decision.md) and [existing operation contracts](agent-read-foundation.md).

On 4 October, seven additional checks exercised the actual operator identity function against official local native Supabase Auth, using a synthetic account and no mocked Auth calls. Valid sign-in, missing/opaque/forged credentials, absent configuration, application-log exclusion and identity deletion passed. The account was removed. The saved opt-in test and 161 focused passing regressions are recorded in [the native Auth rehearsal](mcp-native-auth-rehearsal.md). This does not prove browser consent, the restricted TLS gateway, HTTPS deployment or either provider connection.

## Implemented contract

Exactly three tools share the authoritative schemas and service:

| Tool | Inputs | Scopes | Result and limits |
| --- | --- | --- | --- |
| `list_departures` | Business UUID, explicit-offset start/end instants; optional tour UUID, limit and offset | `departures:read` | Schedule only. Default 25/max 50 rows, max offset 1,000, max 31 days; stable start/id ordering and one extra pagination row. Does not confirm seats. |
| `get_departure_availability` | Business and departure UUIDs | `departures:read availability:read` | Canonical remaining capacity including existing holds, observation/retrieval time and freshness. No new hold; booking eligibility is not evaluated. Missing/stale capacity is null. |
| `get_departure_attention_summary` | Business and departure UUIDs | `departures:read attention:read` | Outstanding payment bookings and outstanding waiver participants only. Limits: 500 bookings, 1,000 people per booking and bounded waiver evidence. Incomplete/stale evidence and unresolved reschedules are unknown/null, never zero issues. |

All operations require current unsuspended, non-read-only `MAIN_ADMIN` membership in the token's business, an active seven-day grant, current identity and eligible trading status. Every supplied object ID is authorized independently. Membership/role changes revoke old agent consent atomically; restoring the role requires a new grant. Caller-selected business/provider/identity headers are not proof of access. External tokens cannot be used as native Supabase JWTs.

Results retain validated IANA zone or null, database observation time, UTC retrieval time, fifteen-second maximum age and explicit freshness/data status. The observation window is not a transactional capacity guarantee. The authenticated server instructions provide the selected business UUID. The configured zone is returned by reads; before the first schedule query, the operator must supply explicit-offset bounds or confirm the business zone. A host must ask before converting a relative date such as “tomorrow” when that zone is unknown. No fourth lookup tool or guessed zone is introduced. No guest names, contacts, notes, waiver documents, payment credentials or individual records are sent to providers.

Body limit: 16 KiB, five-second input/upstream/statement timeouts, bounded SDK response buffering and a thirty-second route runtime ceiling. Read quota: 30/minute per user/business in PostgreSQL across instances. Initial pilot abuse quota: 60/minute shared OAuth and separately shared metadata/transport; connection management is 60/minute per user/business. Quota failure denies access. No cache; responses use `no-store`.

Fixed errors distinguish disabled/upstream (503), authentication (401), permission/grant/scope (403), inaccessible objects (404), invalid/excessive inputs (400), oversized bodies (413), stalled input (408) and rate limit (429). SDK errors retain protocol codes with redacted messages. Scope/revocation errors include OAuth challenges where applicable.

## Provider contracts

| Contract | ChatGPT local implementation | Muse |
| --- | --- | --- |
| Runtime/transport | Node 22.23.3, Next 16.3.8, Fetch/Streamable HTTP; stateless POST; GET/DELETE 405 when enabled | Exact accepted transport/version not supplied |
| SDK protocols | `2025-11-25` initialize/list/call and `2026-07-28` discover/list/call tested locally | No compatibility claim |
| Client/auth | DCR public client, authorization code + S256 PKCE, exact allowlisted redirect, `resource` at authorization/token exchange | Registration, client identity, redirect and token requirements missing |
| Discovery/tool metadata | HTTPS issuer/resource documents, OAuth schemes + `_meta` mirror, read-only annotations and reauthorization challenges | READ documentation specified; platform classification/review pending |
| Token lifecycle | Access ≤10 minutes, code ≤60 seconds, absolute grant ≤7 days, refresh rotation/replay revocation and RFC 7009 revocation | Independently blocked; no token reuse from ChatGPT |

The current-protocol SDK requires matching protocol/method/name headers and a request envelope in `params._meta`. Its codec strips top-level OpenAI auth extensions; the thin adapter restores the fixed shared OAuth declaration on the serialized response. This is tested SDK behavior, not a completed ChatGPT connection. CIMD, Redis, subscriptions, sampling, elicitation, write tools and external model calls are absent.

[OpenAI authentication](https://developers.openai.com/plugins/build/auth) and [MCP server guidance](https://developers.openai.com/plugins/build/mcp-server) were checked on 3 October. The actual personal account's linking journey remains untested. The owner-observed Plugins → Add → Create custom MCP server flow is retained; full CDP access is unrelated.

[Muse guidelines](https://muse.ai/platform/docs) were checked independently on 3 October. Operator reporting is a proposed read-only submission scope. Exact technical onboarding, test portal/account access, review and customer availability are unverified. The Muse route always rejects access, including if someone sets an environment flag.

## Configuration and release prerequisites

No production values or credentials are in these documents. The following server-only configuration must be provided for an isolated staging pilot:

| Variable | Requirement |
| --- | --- |
| `AGENT_CHATGPT_ENABLED` | Defaults off; literal `true` only for an authorized pilot after gates pass |
| `AGENT_PUBLIC_ORIGIN` | Exact canonical HTTPS origin, without credentials/path/query/hash |
| `AGENT_CHATGPT_REDIRECT_URIS` | JSON list of exact ChatGPT redirects copied/verified against its management page and supported official callback mode; max 8 |
| `AGENT_PILOT_BUSINESS_IDS` | JSON list of explicitly approved business UUIDs; max 100; intersected with DB pilot allowlist |
| `AGENT_DATABASE_URL` | TLS-verified credential for `bookingtours_agent_gateway`, max 5 connections; never postgres/service-role/app credentials; no TLS-disabling URL flags |
| `AGENT_DATABASE_CA` | Optional Supabase root CA PEM downloaded from the test project's Database settings; accepts actual or escaped newlines and retains certificate/hostname verification |
| Existing public Supabase URL/key | Required for native operator identity validation; no extra service-role key |

Both environment and private database provider gates must agree. The new SQL seeds both providers disabled with empty pilot lists. The concurrent 3 October [release record](../production-readiness/evidence/ALL_EXCEPT_AGENT_SERVICE_DEPLOYMENT_20261003.json) reports foundation migration `20261003160000_agent_read_foundation` applied with disabled defaults and zero grants, and the newer service binding excluded. Those records were inspected; this pass made no independent live database check. The local foundation source differs from that migration only in comments. For a fresh disposable rehearsal database, apply the versioned foundation migration, then `supabase/agent-mcp.local.sql`. The new extension remains outside the migration ledger and unapplied. For a future production release, extend the already-existing reviewed foundation; do not recreate its table or reapply the foundation migration. Do not run a generic migration push.

Before live activation:

1. Review the actual schema, invoker-function privileges, RLS, role ownership and existing PUBLIC definer/table privileges. Prove native permissions remain unchanged; the runtime gate must pass with a separately provisioned restricted TLS credential. Confirm hosting/pooler connection and timeout compatibility.
2. Rehearse the candidate SQL and grants with an isolated staging tenant. Verify native Supabase sign-in, MFA/session behavior, business selection, consent/denial and redirect-state preservation through the existing AuthGate. The OAuth/backend suite injected identity. Separate native Auth tests verify only identity checking and cannot clear the browser/consent gate.
3. Test the external credential against real Supabase REST/RPC, Edge and Admin entry points: it must read no private data and perform no native writes. Repeat expiry, role/membership removal, identity ban/deletion, disconnect and mid-read revocation; normal app sessions must retain their original access.
4. Use MCP Inspector over the actual HTTPS deployment, then a dedicated real ChatGPT test connection. Verify discovery, DCR/PKCE, both required protocol framing and actual scopes, safe aggregate results, refresh, unlink/revoke and expiry. Test direct requests, clear indirect operator questions, unrelated travel advice, private-data/write requests and injected instructions.
5. Review the remaining unpatched build-tool dependency findings, review retention/monitoring/operational ownership, and obtain a concrete scoped release decision without changing the paused wider readiness verdict. Only then enable the named pilot businesses. Public directory submission/approval is a later separate action.

New Next toolchain pins are 16.3.8, above the documented 16.3.6 fix for [GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j). This removes the earlier critical audit finding; it does not establish application exploitability or a clean platform audit. The 4 October continuation patches DOMPurify to 3.4.16 and fixes the lint configuration. Seven high build-tool advisories remain in the `braces` chain, with no published patched version; the production-only audit is clear. Review this build-input risk before release. No forced major upgrades, overrides or rule-severity changes were made.

## Operator setup after release gates pass

Proposed ChatGPT Server URL: `https://admin.bookingtours.co.za/api/mcp/chatgpt`. It is **not a working live endpoint from this implementation**; verify the published HTTPS URL before pasting it. The earlier `/api/agent/read` remains deliberately closed.

1. In ChatGPT Plugins → Add → Create custom MCP server (or the older Create MCP App label), enter name `BookingTours operator pilot` and description `Read departures, capacity snapshots, and aggregate payment and waiver counts for your authorised BookingTours business.`
2. Select Server URL and the verified HTTPS ChatGPT endpoint; choose OAuth. DCR is implemented, so do not substitute an OpenAI API key, Supabase key, password or ordinary operator session. If the actual form requests client credentials, stop and reconcile its client-auth requirements with the public-client implementation.
3. Review/accept ChatGPT's risk text personally. Complete native BookingTours sign-in when prompted, confirm the selected business and only the requested read scopes, then approve the unchecked consent box. A grant expires after seven days; linking is not marketing consent.
4. In the chat, request departures in the configured business zone, capacity for one departure and aggregate payment/waiver counts. Check observation time and null/unknown results. Confirm no private-data or write tool appears. Tool-selection behavior still needs real-platform verification.
5. Disconnect in Settings → AI agent connections, or revoke through the provider's supported unlink flow. Verify subsequent calls/refresh fail and the normal operator session still works. Revocation and native disconnect remain available when the provider read switch is off, provided the issuer origin/database configuration remains present.

The connection page lists the owner's most recent 50 grants; it does not initiate linking and has no working-looking Connect button. Muse needs its own documented client/auth setup and acceptance tests before adding any consent or Connect flow.

## Website coordination

Use [the existing public-safe handoff](website-handoff.public.md) and maintained website product-facts contract. The safe current message is development/testing, with no live ChatGPT/Muse availability or platform approval claim. No SEO prompts, live marketing-copy endpoint, pricing copy/configuration or marketing website files were changed.

This MCP-only implementation adds no acquisition events, pixels or tracking dependencies. The existing report/consent behavior is preserved. Demo click, accepted lead, account created, trial activated and authoritative operator subscription payment remain distinct; traveller payments and connector linking are not subscription conversions. Website-to-signup attribution still requires coordinated campaign allowlists, consent and an opaque server-side intake handoff across separate deployments; no shared cookie/storage or inferred ChatGPT/Muse attribution is assumed.

## Rollback and blockers

Disable the ChatGPT environment and DB provider switches; revoke/disconnect affected grants and token families. Keep revocation configuration accessible. Do not revoke ordinary Supabase sessions, delete business records or drop production schemas as rollback. The old closed read endpoint and hard-disabled Muse route remain closed.

Outstanding: restricted staging/production credential and catalog review; actual schema/pooler rehearsal; native browser/MFA/consent and deployed restricted-gateway bypass tests; actual HTTPS Inspector/ChatGPT linking/tool-selection journey; the unpatched build-tool audit findings; operational retention/release authorization; Muse's exact protocol/auth/client contract and test/review access. No connector is deployed, approved or available to customers by this work.
