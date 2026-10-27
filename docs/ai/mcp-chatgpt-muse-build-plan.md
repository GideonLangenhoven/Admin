# BookingTours MCP server implementation plan for ChatGPT and Muse

Implementation update, 4 October 2026: safe local ChatGPT work has now been implemented and tested. Use [the current implementation/release handoff](mcp-implementation.md) for results and remaining gates. Muse stays independently blocked; no new connector deployment or approval is implied. The plan below retains its original planning evidence.

Prepared 3 October 2026 for another implementation model. This is a plan only. Its scope is authenticated, read-only operator access through ChatGPT and Meta Muse. It does not authorize implementation in this turn, a production migration, live enablement, deployment or connector submission.

## Outcome and scope

Build one shared business read service with two separately configured provider adapters. Deliver working, tested MCP URLs for ChatGPT and Muse when each provider's requirements and release gates are satisfied. A provider can remain blocked without preventing safe work on the other.

Expose exactly these three business tools:

| Tool | Required scopes | Result |
| --- | --- | --- |
| `list_departures` | `departures:read` | Bounded, paginated departure schedule; no confirmed availability |
| `get_departure_availability` | `departures:read`, `availability:read` | Existing capacity-service snapshot, including existing holds; no new hold |
| `get_departure_attention_summary` | `departures:read`, `attention:read` | Aggregate outstanding-payment booking counts and outstanding-waiver participant counts |

Keep the pilot restricted to current, unsuspended `MAIN_ADMIN` members of the selected business, with the existing trading/subscription gate and a maximum seven-day connection grant. Do not widen roles in this project.

Excluded: marketing website changes, SEO/discovery prompts, conversion tracking, other AI providers, customer-facing booking tools, and public directory publication. Do not change booking/capacity rules, Yoco payments, refunds, webhooks, waiver acceptance, WhatsApp, CRM, marketing consent, subscriptions or customer terms. No guest names, contacts, notes, documents, payment credentials or individual waiver records may reach providers. Preserve Supabase Auth, RLS and current database permissions; do not introduce Firebase or replace the backend.

## Current repository and evidence

The application is `/Users/gideonlangenhoven/dev/capekayak`. `/Users/gideonlangenhoven/BookingToursSite` is the separate marketing project. At planning time, the application branch is `feature/simple-view-2026-09-20`, HEAD is `43304b65314c2b9974f939304e7b2ebae0a62c0c`, and the working tree contains substantial unrelated changes. These are observations, not instructions to reset or switch branches. The next model must inspect the current state again and preserve concurrent work.

Read applicable `AGENTS.md` files, `CLAUDE.md`, `docs/production-readiness/STATE.md`, the relevant readiness findings and these files before editing:

| Existing file | Reuse and limitation |
| --- | --- |
| `app/lib/agent-tools.ts` | Authoritative tool schemas, descriptions, scopes, limits and annotations; global external access is currently disabled |
| `app/lib/agent-read-service.ts` | Shared input validation, authorization, object checks, authoritative reads, freshness and redacted errors; current credential contract is a fixture contract |
| `app/api/agent/read/route.ts` | Deliberate `503 INTEGRATION_DISABLED`; not an MCP endpoint |
| `supabase/agent-foundation.local.sql` | Unapplied local grant/observation/waiver-aggregate candidate, outside the production migration ledger |
| `tests/helpers/chatgpt-mcp-fixture.ts` | Local-only Fetch/MCP adapter; no listener, real OAuth or production route. Never deploy or tunnel this fixture |
| `tests/helpers/agent-read-fixture.ts` | Synthetic rows and mocked Auth shared by tests |
| `tests/unit/agent-read-service.test.ts` | Shared-service security and business-rule fixtures |
| `tests/unit/chatgpt-mcp-fixture.test.ts` | MCP initialization, descriptors and call fixtures |
| `tests/agent-foundation-local.mjs` | Disposable local PostgreSQL checks for the SQL candidate |
| `docs/ai/agent-read-foundation.md` | Existing contracts and limitations |
| `docs/ai/chatgpt-connection-setup.md` | Current connection UI observations and release blockers |
| `docs/ai/chatgpt-connection-verification-20261003.json` | Exact previous commands, results and evidence boundaries |

Previous checks passed: 138 read-service fixtures, 36 MCP fixtures and 17 existing acquisition fixtures, plus focused lint, application/fixture TypeScript and an isolated application build. These are prior results, not checks performed while writing this plan. No real ChatGPT OAuth journey or Muse journey has passed. The disabled foundation was deployed previously; the later MCP fixture and provider-context change are local. Reconcile the live deployment rather than assuming the working tree equals production.

Observed runtime/dependencies: Node 22.23.3, Next.js 16.3.3, `@modelcontextprotocol/server` 2.3.0, `mcp-handler` 2.2.0 and Zod 4.5.4. MCP packages currently serve development tests. Review runtime compatibility before moving the necessary packages to production dependencies; do not upgrade unrelated packages opportunistically.

The latest recorded dependency audit has nine existing advisories, including a critical Next.js advisory. Recheck and triage those findings before a release; prior passing tests do not clear them. The broader readiness checkpoint remains `PAUSED_BY_USER` / `FAILED_GATE` and must not be rewritten as passed by this work.

## Architecture and proposed addresses

Use the existing application hosting if its runtime and transport tests pass. Proposed routes are:

- ChatGPT: `https://admin.bookingtours.co.za/api/mcp/chatgpt`
- Muse: `https://admin.bookingtours.co.za/api/mcp/muse`

These are proposed addresses only. Neither is a verified working endpoint. The earlier `/api/mcp` address was also a proposal. Explicit provider paths make independent audience checks, configuration, rollout and disconnection easier to inspect; do not add an unnecessary alias.

Request path: provider adapter → external credential validation → current connection and membership authorization → shared read service → existing authoritative business functions under database protections → minimal MCP result.

Keep provider-specific protocol/authentication metadata in the adapters. Keep all capacity, payment-count, waiver-count, pagination and freshness rules in the shared service. The route must supply a fixed trusted provider context; caller input must never choose the provider or bypass authorization. Do not build a general plugin framework or add models/LLM calls to this backend.

## Phase 1 Verify provider contracts and freeze the design

Produce a short contract matrix covering transport/version, client registration, redirect URIs, issuer, resource/audience, scopes, token refresh/revocation, tool metadata, discovery, request limits and review access for each provider. Attach official source links, verification date and any portal-derived evidence without credentials.

For ChatGPT, verify Streamable HTTP and OAuth discovery, authorization code with S256 PKCE, canonical HTTPS resource/audience matching, supported client registration and per-tool OAuth declarations. Copy actual redirect/client metadata from the connection management page; never guess callback URLs. Use [OpenAI authentication](https://developers.openai.com/plugins/build/auth) and [MCP server deployment guidance](https://developers.openai.com/plugins/build/mcp-server).

For Muse, obtain the exact technical onboarding contract and test access independently. Public [Muse guidelines](https://muse.ai/platform/docs) accept API/MCP documentation and allow read-only account reports or inventory analysis. They request endpoint/authentication details, test access and tool documentation, followed by review and end-to-end QA. They do not establish the exact transport version, client-registration rules, redirect URLs or token contract for BookingTours. Position this as operator reporting, not traveller booking. Confirm the submitted scope; do not add transaction tools to meet a different use case. General references to API keys do not authorize using a shared privileged key for tenant data.

Exit: ChatGPT contract is concrete; every Muse field is either verified or explicitly blocked. If Muse cannot confirm MCP support for this submission, stop its adapter track with the exact blocker. Do not silently substitute an API connector or claim OpenAI compatibility proves Muse compatibility.

## Phase 2 Prove token isolation before building the connection UI

This is the first hard technical gate. The current service expects a Supabase `aud=authenticated` token containing custom grant/resource/scope claims. That does not establish production MCP authorization. Ordinary Supabase user tokens may retain broader REST/RPC rights even if the MCP adapter exposes only reads. [Supabase OAuth documentation](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows) distinguishes identity OAuth scopes from database access governed by RLS.

Recommended external credential design: dedicated MCP access tokens, separate from ordinary BookingTours/Supabase session tokens, bound to one user, business, provider, client, resource, grant and exact scopes. Prefer opaque random tokens stored only as hashes if supported by the chosen standards-compliant issuer. Use an established OAuth implementation where practical; do not hand-roll protocol or cryptographic primitives.

Before selecting that design, prove how the backend will perform its reads while preserving RLS and existing user permissions. The existing `db` dependency requires the same validated user bearer token; a new opaque MCP token cannot simply be passed to `getClaims` or PostgREST. Write an architecture decision and a minimal real-auth/local-database spike resolving this boundary. Options must be supported by the actual Supabase configuration. Any internal delegated credential storage must use approved secret encryption, rotation and revocation, and must not reuse or revoke the operator's ordinary app session accidentally. Do not solve this by running business reads with an unrestricted service-role client or trusting caller-supplied identity headers.

Acceptance proof: a valid external MCP token can use only its approved read operations and cannot read private fields or perform writes through direct Supabase REST, RPC, Edge functions or existing Admin APIs. Normal application sessions must retain their existing permissions. If no supported RLS-preserving bridge can be demonstrated, record the exact architecture/access blocker and keep external access closed.

Use this planning default unless provider requirements require a documented change: access tokens last at most ten minutes, single-use authorization codes at most sixty seconds, rotated refresh credentials expire with the seven-day absolute grant, and refresh-token replay invalidates its token family. These timings are proposed implementation choices, not already implemented or platform mandates.

Exit: real signed/token-server validation and direct-bypass negative tests pass. Mocked claims alone cannot pass this gate.

## Phase 3 Build grants and operator authorization

Prepare reviewed local migrations for the selected issuer's minimum persistent state: grants, authorization codes, hashed token/refresh records and registered clients only if the implementation needs them. Reuse the existing grant candidate and issuer library storage where possible. Do not duplicate framework-managed tables or create a second identity system.

Bind grants to current Supabase identity, business, provider, registered client, resource, approved scopes, role at consent, creation time, absolute expiry and disconnect/revocation state. Prevent authenticated callers from self-issuing or broadening grants through direct database access. Keep RLS enabled, explicit grants least-privileged and existing policies intact. Review any narrowly privileged helper function's owner, fixed search path, executable roles, arguments and object checks; never expose arbitrary SQL or dynamic targets.

Build the operator flow using existing Supabase sign-in:

1. Validate the OAuth request, exact registered redirect and requested resource/scopes. Defend against CSRF, authorization-code replay and client/provider mix-ups. Bound any client metadata lookup and prevent SSRF.
2. Require a current unsuspended owner, select one permitted business, and show provider identity, the three read permissions and expiry. Denial must issue no grant or token.
3. Issue the grant and authorization code atomically only after consent; enforce S256 at token exchange and bind every exchange to the original request.
4. Provide a connection list showing provider, business, scopes, expiry and status. Disconnect must atomically deny new calls and refresh, then complete any required upstream revocation. Revocation failures must never restore local access.
5. Role, membership, suspension, identity deletion/ban and business-status changes must deny subsequent access. Recheck relevant authorization before releasing read results, as the shared service already does.

Put the small connection-management surface in the existing settings/integrations area; do not redesign the dashboard. Show a functioning Connect control only after the actual authorization flow passes integration tests. Connection consent must remain separate from analytics and email-marketing consent.

Exit: real grant creation, denial, expiry, refresh, disconnect and role-change tests pass in an isolated environment. Production migrations remain unapplied until a separately authorized release.

## Phase 4 Finish the shared production read boundary

Reuse `agent-tools.ts` and `agent-read-service.ts`. Separate external token verification from internal data access only to the extent required by Phase 2; do not make the service accept an unverified principal from a public request.

On every business operation verify credentials, token/resource/provider/client binding, required scopes, active grant, current membership/role and business eligibility. Validate every business, departure and optional tour ID against authorized ownership. Return a consistent non-disclosing not-found/forbidden response for foreign objects. A supplied business ID is never proof of permission.

Preserve these existing contract limits and semantics:

- Schedule window at most 31 days; page size 1–50 with default 25; offset at most 1,000; stable ordering and explicit pagination/truncation handling.
- Canonical `slot_available_capacity` logic, including existing holds. Reading capacity creates no hold and does not evaluate booking eligibility or guarantee a future booking.
- Attention payment unit is bookings; waiver unit is participants. Preserve existing accounting rules and the restricted aggregate RPC. Pending reschedules, incomplete evidence, malformed data and truncation must remain unknown. Waiver counts do not certify identity or legal validity.
- UTC timestamp inputs require explicit offsets. Return configured IANA zone, database observation time, retrieval time and freshness/data status. Preserve the fifteen-second freshness ceiling and null/unknown/stale results; never convert failures into available seats or zero outstanding issues.
- Bound individual upstream calls, JSON bodies and total requests. Start with the fixture's 16 KiB body ceiling and existing five-second upstream limit, then test SDK framing and actual provider behavior. Do not load an unbounded body before enforcing its limit.

Provide a safe way for the connected provider to know the selected business ID and configured time zone, using authenticated provider-supported context metadata/resources if available. This context needs the same grant checks. Otherwise document the required explicit inputs. Do not add a fourth business tool, disclose all tenants or guess the time zone.

Replace the process-local limiter with an atomic shared user/business quota, initially preserving 30 requests per minute across instances. Prefer an existing suitable store; an isolated Postgres quota table/function is an option, not a reason to buy infrastructure. Deny access if the quota service fails. Add bounded pre-authentication abuse controls for discovery/auth endpoints where appropriate. Security audit/quota bookkeeping is permitted; business-state writes are not.

Use `Cache-Control: no-store` initially. If caching is later necessary, bind it to provider, user, business, grant/access version, scope and query, and prove revocation invalidation. Log only allowlisted operation/outcome/timing/request identifiers and redacted or hashed identity references. Suppress SDK logs that include arguments, tokens, headers or raw upstream errors.

Exit: shared service and database tests prove unchanged business behavior, tenant isolation, bounded reads and no domain side effects.

## Phase 5 Add two thin MCP adapters

Create explicit provider routes, shared MCP serialization/registration only where the verified contracts match, and separate trusted configuration for clients, audiences and metadata. Both providers must be disabled by default on the server. Use independent provider switches and a pilot-business restriction; missing configuration must fail closed. A browser button or client environment variable cannot enable access.

Build the ChatGPT adapter first using the validated Node/Fetch runtime. Move required SDK packages into runtime dependencies when the application route actually imports them. Reuse the fixture's successful schema mapping, but remove all mock auth, synthetic data and test bypasses from production imports. Do not merely rename or mount the fixture handler.

Emit precisely the shared tool descriptions, input/output schemas, OAuth scopes and annotations. Verify the actual `tools/list` response: the current SDK's default registration omits OpenAI's top-level `securitySchemes`, and the fixture uses the supported list handler to include it. Pin and test the selected SDK behavior rather than relying on TypeScript declarations alone. Implement discovery and authorization challenges according to the verified OpenAI contract, including `WWW-Authenticate` and applicable tool-level `_meta["mcp/www_authenticate"]` handling.

Build the Muse adapter only after its exact contract is verified. Reuse business operations but configure Muse client identity, resource/audience, authentication, error mapping, tool classifications and permission behavior separately. Do not copy ChatGPT manifests, callback URLs, annotations or SDK extensions as an assumed Muse contract. Scope its documentation to the three read outcomes and respect Muse's user permission controls.

Negotiate and test actual client protocol versions, required HTTP methods, media types and streaming behavior. The local fixture has tested the 2025-11-25 protocol; that does not prove either provider's current end-to-end compatibility. Use canonical configured origins, strict permitted origins where relevant, and no arbitrary URL proxying, subscriptions, remote execution, sampling or extra tools.

Exit: both adapters pass real HTTP/protocol tests against the same service, or the Muse track is explicitly blocked with its independently disabled state. A ChatGPT token/grant must fail at the Muse route and vice versa.

## Phase 6 Verify security and business behavior

Keep separate evidence categories: synthetic fixtures, real local/staging backend integration, real ChatGPT journey, and real Muse journey. Passing one category must not be reported as another.

| Area | Required checks |
| --- | --- |
| Credentials | Missing, malformed, forged, wrong issuer/audience/client/provider, expired, future-issued, revoked and insufficient scope; refresh rotation/replay; code reuse and wrong PKCE |
| Access | Business A → B, foreign departure/tour, role change, membership removal, suspended/deleted identity, inactive business, expired/disconnected grant and changes during reads |
| Bypass | External MCP token against direct Supabase/Admin/Edge read and write routes; no extra data or privilege; unchanged ordinary user access |
| Defaults | Both disabled; one enabled without the other; missing configuration; pilot restrictions; no client-side flag bypass or test-mode import in production |
| Capacity | Existing bookings and holds, full/closed/cancelled departure, concurrent capacity changes, stale/future observations and missing data; no new hold |
| Attention | Correct booking/participant units, canonical payments, incomplete/legacy waiver records, pending reschedules, empty complete data, truncation and stale observations |
| Protocol | Initialize, discover/list and call exactly three tools; schemas, OAuth metadata/challenges, content/structured results and supported transport versions |
| Abuse and failure | Oversized/malformed requests, unsupported methods/actions, pagination/range limits, distributed throttling across instances, limiter failure, upstream timeout/failure and safe error redaction |
| Privacy and side effects | No PII/credentials in results, logs, traces or URLs; no booking/payment/refund/cancellation/waiver/message mutation |
| Real tool selection | Direct schedule/capacity request; indirect but clear departure-readiness request; no tool for guest lookup, travel advice or prohibited writes; ignore instructions embedded in retrieved content |

Baseline commands to rerun when implementation starts and after relevant changes:

```sh
npm run test:unit -- tests/unit/agent-read-service.test.ts tests/unit/chatgpt-mcp-fixture.test.ts
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/tsc --noEmit --project tests/tsconfig.agent-mcp.json
npm run lint -- app/lib/agent-read-service.ts tests/helpers/agent-read-fixture.ts tests/helpers/chatgpt-mcp-fixture.ts tests/unit/agent-read-service.test.ts tests/unit/chatgpt-mcp-fixture.test.ts
npm audit --json
```

Extend these checks to all new production/consent/issuer/adapter files and tests. Inspect the local PostgreSQL harness's prerequisites, then run it only against disposable data. Run the existing build with approved environment configuration; its production prebuild has an existing email-service authorization probe, so do not unknowingly run that against live services. Use MCP Inspector for actual HTTP/OAuth checks. Use synthetic operator tenants and dedicated provider test accounts before any live pilot. Do not run a broad production qualification, load or soak campaign as part of this plan.

Exit: record exact commands, counts, failures, source revision and environment; regression checks and negative paths pass. Address release-relevant dependency findings without unrelated redesign or forced broad upgrades.

## Phase 7 Prepare the release and real provider journeys

Produce a concrete release packet before requesting any outstanding production authorization: reviewed source diff, reversible migration plan, client/resource/redirect configuration, secrets names and storage locations without values, test evidence, exact endpoint URLs, owner pilot list, rollback and revocation procedures. Reconcile the current live source to preserve separately deployed work.

This plan and past deployment of the disabled foundation do not authorize new production migrations, live access, external submission or broader rollout resumption. Follow the current user authorization and readiness checkpoint when the implementation is ready. A scoped connector release must not silently change the platform's `FAILED_GATE` verdict.

For an authorized pilot release, deploy with both providers disabled, validate the migration and configuration, then enable only the reviewed provider and permitted businesses. Verify discovery, initialization, listing, all three reads, refresh/expiry, disconnect and disabled-state behavior on the real HTTPS deployment. Rollback must first stop external calls and revoke affected grants; retain schema/data needed by other versions and audit evidence rather than dropping production objects blindly.

ChatGPT pilot flow: Plugins → Add → Create custom MCP server (or Create MCP App), paste the verified ChatGPT URL, select OAuth, complete operator consent and run direct/indirect/negative tests. The owner's support update and observed form supersede older Developer mode UI instructions. Full CDP access is unrelated. Public directory submission is a separate optional future task.

Muse pilot flow: use its verified portal/onboarding process and a dedicated synthetic reviewer account. Prepare the three tools' classifications, bounded schemas, errors, permissions and demo instructions. Obtain the required provider review/test access and complete an actual linking/read/disconnect journey. The [Muse platform](https://muse.ai/platform) describes review before directory availability. Prepare submission material locally; do not submit or accept new external terms without the owner's authorization. Review approval cannot be promised by an implementation model.

## Implementation order and deliverables

Work in these dependency-sized changes: (1) provider contract and token-isolation decision/spike; (2) local grant/issuer storage and OAuth lifecycle; (3) shared authorization/data bridge and persistent limits; (4) ChatGPT adapter; (5) independently verified Muse adapter; (6) consent/connection settings and revocation integration; (7) protocol/backend/security tests; (8) release packet and provider setup guide. Implement enough consent handling to test OAuth before presenting the finished settings UI. Preserve unrelated staged and unstaged work; pushing and merging remain outside this plan.

Expected file areas are `app/lib/agent-*`, new provider MCP routes, the minimum issuer/auth routes and consent/settings components required by the chosen design, reviewed local SQL candidates, focused tests, and `docs/ai`. Final filenames should follow existing repository conventions; avoid creating placeholder infrastructure for unverified Muse requirements.

The implementing model must deliver:

- The reviewed code and local migration candidates, preserving existing work and business rules.
- A provider contract matrix and the token/RLS architecture decision with actual bypass-test evidence.
- Exact changed files and reproducible checks, clearly separating fixtures from real backend and platform tests.
- Exact working URL, auth/setup instructions, scopes, supported users and disconnect behavior for each provider that actually passes.
- Explicit remaining blockers and owner actions for any provider that cannot yet pass.
- A rollback/runbook and status ledger for each provider: **specified → implemented → tested → deployed → platform-approved where required → available to the authorized users**.

Do not report completion merely because routes compile, fixtures pass or a URL returns HTTP 200. The intended completion criterion is an authorized operator successfully linking each supported provider, using the three scoped reads, receiving correct unknown/stale behavior, and losing access after disconnect. If Muse access or approval is unavailable, report ChatGPT's independently verified status and Muse's exact blocked stage; do not describe both connectors as live.
