# Role, action, and tenant matrix

Current user decisions are recorded in APPROVALS.json. Implementation and release verification remain separate from policy authorization.

| Identity | Tenant scope | Browse | Check-in | Refund | Settings/credentials | Side effects |
|---|---|---:|---:|---:|---:|---:|
| Anonymous | Deliberate public fields only | Public catalogue | No | No | No | Only explicit public customer flows |
| Customer capability/session | Verified owned objects | Own journey | No staff action | Customer cancellation choice only | No | Only owned customer actions |
| `OPERATOR` | Active own tenant | Yes | Yes | Yes — user confirmed 21 September 2026 | Explicitly delegated areas only | Yes, after action and object checks |
| Legacy `ADMIN` | Active own tenant | Yes | Yes | Yes — exact active own-tenant role in accepted refund server patch | Current legacy limits | Yes, after checks |
| `MAIN_ADMIN` | Active own tenant | Yes | Yes | Yes | Yes | Yes, after checks |
| Exact `SUPER_ADMIN` | Platform support with validated target | Yes | Explicit attributable support path | Explicit attributable support path | Platform controls; MFA-verified on-behalf bank/API changes and verified MFA recovery | Explicit target business and durable actor/target audit; never via substring role matching |
| `read_only` demo | Bound synthetic tenant | Yes | No | No | No | No messages, payments, credentials, uploads, or customer mutation |
| Suspended staff | None | No private data | No | No | No | No |
| Service identity | Named internal operation only | No implied human authority | Only after original caller/object validation | Constrained durable operation only | Server only | Possession of service credentials is not caller authority |

Every protected action independently verifies identity, active state, exact role/action permission, tenant authority, object relationship, and applicable commercial/financial state. Browser selectors, origins, cookies, local storage, request bodies, caches, and elevated wrappers are not authority. Unknown roles fail closed; exact legacy roles remain compatible until an approved migration changes them. User approved MFA for invoice bank changes and WhatsApp/Yoco linking, with verified platform-admin-assisted recovery. Super Admin may act on behalf of the target operator using their own MFA and an attributable audit; ordinary bookings remain accessible during recovery. Local enrollment, enforcement and recovery controls are implemented; real Auth validation remains an external gate.
