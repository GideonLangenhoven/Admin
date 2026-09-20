# Role, action, and tenant matrix

Status: source-derived G0 draft. Rows marked **decision required** are not authorization to change behavior.

| Identity | Scope | Browse tenant operations | Check in own-tenant guest | Refund own-tenant booking | Settings / credentials | Cross-tenant support | Mutating demo/live side effects |
|---|---|---:|---:|---:|---:|---:|---:|
| Anonymous | Deliberate public columns only | Public catalogue only | No | No | No | No | No |
| Customer capability/session | Verified owned objects | Own customer journey | No staff check-in | Customer cancellation choice only; never operator refund authority | No | No | Only explicitly owned customer actions |
| `OPERATOR` | Active own tenant | Yes | Yes | **Decision required:** User Manual/help say yes; older security table says no | No, except explicitly delegated section | No | Yes, subject to action checks |
| Legacy `ADMIN` | Active own tenant | Yes | Yes | Existing docs imply yes; compatibility must be preserved | Limited according to current legacy contract | No | Yes, subject to action checks |
| `MAIN_ADMIN` | Active own tenant | Yes | Yes | Yes | Yes | No | Yes, subject to action checks |
| `SUPER_ADMIN` | Platform support, exact role | Yes | Only when explicitly targeting a validated tenant/object | Support path must be explicit and attributable | Platform controls | Yes, with validated target | Yes, never from a substring role match |
| `read_only` demo | Isolated synthetic demo tenant | Yes | No | No | No | No | No real message, payment, credential, upload, or customer mutation |
| Suspended staff | None | No private operations | No | No | No | No | No |
| Service identity | Named internal operation only | No implied human authority | Only after original caller/object checks | Only through constrained durable operation | Server-only | Only as designed | Never treats possession of service key as original authority |

## Invariants

1. Identity, action permission, tenant authority, object ownership, and subscription/trading state are independent checks.
2. A browser business selector, origin, cookie, local storage, request body, or service-key wrapper is not tenant authority.
3. Demo browsing remains available, while POST/side-effect paths remain blocked at API, Edge, RPC/RLS, Storage, and worker boundaries.
4. Refunds retain recorded-capture limits, durable reservation, stable provider idempotency keys, and pending/unknown outcomes.
5. Unknown roles fail closed; exact legacy roles remain compatible until an approved migration changes them.

## Evidence and gaps

- Current source has `read_only` checks in `getCallerAdmin`, shared Edge auth, and refund handling; behavioral coverage is incomplete.
- `batch-refund` already authenticates and prevalidates booking ownership before service-key forwarding. Its unresolved defects are action permission, request-derived audit attribution, unchecked audit writes, and pending-result collapse.
- The owner must resolve OPERATOR refund authority before SEC-03 changes. MFA assurance policy is also unapproved and not inferred here.
