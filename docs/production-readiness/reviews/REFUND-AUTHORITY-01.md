# REFUND-AUTHORITY-01: APPROVE_TASK

Independent security/money review, 2026-09-21. Approval covers the frozen, narrow server authorization/audit/result patch; it is not deployment or full refund-flow certification. No task-blocking finding was reproduced.

Requested reviewer: Astra/xhigh. Parent reports the local turn_context records `gpt-6-astra`, effort `xhigh` for this reviewer. That is observable source metadata, not backend attestation. No delegated reviewer or implementation edits.

Reviewed baseline `75b0b05d97741b012a7fcdfedcd6cf146cbbe9fa`, current HEAD `c61e9dbeef8bf32e9e01b7b5875bbcb543183e24`; intervening commit touches dependency files/test only. Before/after SHA-256 values match `../validation.md`; final hashes are retained in `check-results.json`. Only the two refund handlers and new authority test constitute the reviewed patch. Unrelated offline/docs work excluded.

Validation: affected four files/76 tests pass, including all 31 authority regressions; ESLint, Edge type-check, and diff whitespace checks pass. Independent `authority-chain.cjs` adds 44 passing synthetic checks through actual `requireAuth` → actual batch handler → actual refund handler, with all database/provider/delivery access replaced by in-memory stubs. The first Edge invocation rejected an unsupported CLI flag; the corrected check passed.

Active own-tenant OPERATOR, ADMIN, MAIN_ADMIN and exact SUPER_ADMIN retain cash and manual initiation/completion. Unknown/substrings/lowercase roles, suspended/read-only users, foreign ordinary users, invalid tokens, and empty configured credentials fail closed. Both primary/rotated nonempty credentials work through bearer and apikey handler paths. The wrapper forwards original credentials, so downstream authorization is rechecked. Tenant/actor attribution ignores forged body fields and uses booking rows/verified identity; mixed/duplicate batches and initial audit failure stop before submission.

Completed/pending/manual/failed/unknown/unprocessed outcomes stay separate. Final audit failure preserves completed results and leaves booking state intact; notification failure stays completed. Existing captures, reservation RPCs, original merchant/mode, operation/provider identifiers, and voucher accounting remain unchanged. No migration, consent, identity, ownership, branding, settings, or persisted customer data change belongs to this patch. No remote DB/provider calls, messages, payments, deployments, commits, or pushes occurred.

Open integration hazards, outside this approval:

- `batch-refund` has no repository caller and no `supabase/config.toml` entry disabling legacy gateway JWT verification. Handler-only rotated/apikey tests do not certify gateway reachability; resolve before adoption.
- `batch-refund/index.ts:135` remains synchronous; browser/function termination can leave remaining items unprocessed without durable execution.
- Current UI calls `process-refund` directly. `app/lib/booking-actions.ts:28` still accepts pending `ok:true` as generic success, and `app/bookings/page.tsx:1155` treats non-2xx follow-up errors as refund failure. Consumer outcome handling remains an explicit follow-up.
