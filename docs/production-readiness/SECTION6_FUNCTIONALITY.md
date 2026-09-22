# Section 6: functionality and existing-customer proof

Status: **local continuity passed; external gates remain open**.

The disposable PostgreSQL rehearsal upgraded the same 100 pre-existing synthetic staff records across 34 businesses and preserved their IDs, Auth links, tenants, emails, password hashes, roles, names, settings and suspension state. The full database regression passed 181 checks, including service-only setup-token claims, concurrent single-winner completion, claim recovery and durable notification queue behavior. Pricing now creates a versioned plan for new subscriptions while preserving existing plans, subscriptions and open billing lines. Arrival audit and direct-write privilege checks pass locally.

The integrated deployed-candidate regression suite passed 1,355 tests with one intentional skip. TypeScript, Edge checks, both production builds, the four-case Simple View browser run and the dependency audit pass. The browser run covers phone, tablet and desktop layouts, partial arrivals, payment controls, walk-in return routing, dark mode, focus, overflow, empty and error states. The later local capacity correction expands the disposable PostgreSQL suite from 181 to 188 passing checks and separately passes its focused unit tests, TypeScript and the Admin production build; it remains undeployed and earns no release credit.

Section 6 is not a production release pass. A complete deployed browser role matrix and genuine Yoco/WhatsApp sandbox journeys still require isolated targets and external credentials. The machine-readable detail is in SECTION6_COVERAGE.json; test:functionality:map passes and test:functionality:release must continue to fail until both external gates are complete.
