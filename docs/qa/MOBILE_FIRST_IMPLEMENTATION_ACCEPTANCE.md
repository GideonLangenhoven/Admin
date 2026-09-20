# BookingTours mobile-first implementation acceptance

Date: 2026-09-15  
Worktree: local admin repository plus nested `booking/` repository  
Production writes, deploys, provider sends and payments: **none**

## Status

- **Implementation: COMPLETE** for the local source contract M01-M12.
- **Mobile release verification: PENDING** because browser screenshot/interaction automation and physical-device checks could not run on this host.
- Release decision: **do not publish as mobile-verified** until the browser and physical-device gates below pass.

This distinction is intentional: both production builds and the focused mocked regressions pass, but build success is not being presented as device evidence.

## Scope and implementation

Admin changes:

- `components/AppShell.tsx`, `components/MobileMenuDrawer.tsx`: five fixed phone destinations; permission-aware redistribution; grouped, unmounted More dialog; Escape, focus loop and focus restoration; compact operator header; `dvh` shell; demo banner and sandbox-warning split.
- `app/page.tsx`: phone dashboard order is Today/date, compact pax summary, manifest/roll call, revenue rows, then secondary cards and weather. Phone manifest and roll call use complete labels and 44px check-in controls; desktop tables remain.
- `app/bookings/page.tsx`: full-name phone booking rows, explicit guest/departure controls, a viewport-safe action sheet, and one shared action definition consumed by mobile and desktop. Payment reminders, unpaid override, reschedule link, refund, cancellation and invoice actions retain their existing handlers and disabled rules.
- `components/DemoActionGuide.tsx` and `supabase/functions/_shared/demo-guide.ts`: centered feature-linked explanations with action-specific copy; opening an explanation dismisses the underlying mobile action sheet.
- `app/globals.css`, `app/new-booking/page.tsx`, `app/settings/page.tsx`: 44px mobile control floor, 16px admin inputs, larger steppers and setting shortcuts while preserving desktop density.

Customer changes in the nested repository:

- `booking/app/book/page.tsx`: edge-to-edge 44px phone calendar, one bottom progression bar per booking step, the same `grandTotal`/`finalTotal` state and `submitBooking` handler as desktop, focused validation, safe content padding and no ordinary bottom navigation on the active flow.
- `booking/app/combo/[id]/page.tsx`: equivalent single bars for combo selection/details, shared combo total and submit handler, and a phone-safe calendar.
- `booking/app/components/BottomNav.tsx`: ordinary Home/Voucher/Bookings navigation remains on non-checkout routes, including `/my-bookings`, and is removed only for `/book`, `/combo/*` and embeds.
- `booking/app/components/ChatWidget.tsx`, `ChatCalendar.tsx`: full usable-viewport phone sheet, internal message scrolling, visible 44px header/composer/actions, focus containment/restoration, route-aware launcher offset, reduced-motion Lottie handling and asset-failure fallback.
- `booking/app/page.tsx`: verified the all-operator `hero_title?.trim()` opt-in rule remains in place and configured tour imagery/branding is retained.

Existing demo infrastructure retained and covered by regression checks:

- `scripts/provision-demo-account.mjs` configures Claire's logo, three activity images and Lottie avatar.
- `public/demo/claires-hiking/logo.png` is the local logo asset.
- `supabase/migrations/20260915043000_refresh_claires_demo_dates.sql` rolls Claire's synthetic data to the login day, and `app/api/admin/login/route.ts` invokes it only for the read-only account.
- Demo-hidden routes remain Guide App, Customers, Reviews, Failed Notifications and OTA Channels. They are not hidden from otherwise entitled non-demo operators.

No backend payment, pricing, capacity, refund, authentication, tenant-isolation or permission semantics were changed for this mobile work.

## M01-M12 matrix

`PASS` below means the local implementation exists and passed build/type/source or mocked regression evidence. Browser-only observations are separately marked NOT RUN and do not upgrade release readiness.

| ID | Implementation location | Automated evidence | Viewport/browser evidence | Status | Remaining action |
| --- | --- | --- | --- | --- | --- |
| M01 | `AppShell.tsx`, `app/globals.css`, both booking calendars | `mobile-first-implementation.test.ts`; both TypeScript/build checks | Browser matrix NOT RUN | PASS | Execute overflow, 44px, reflow, 767/768 and 1023/1024 checks. |
| M02 | `AppShell.tsx`, `MobileMenuDrawer.tsx` | Unit assertions for exact route set, unmounted drawer and focus/Escape hooks | Keyboard/browser journey NOT RUN | PASS | Run full/restricted-role controls journey and inspect More screenshots. |
| M03 | `app/page.tsx` | Unit order/target regression; admin build | 390 × 844 first-viewport inspection NOT RUN | PASS | Confirm first departure is visible with the isolated populated fixture. |
| M04 | `app/bookings/page.tsx` | Mobile source regression and TypeScript | Expanded group screenshot NOT RUN | PASS | Inspect long names, many guests, bulk selection and phone contact presentation. |
| M05 | Shared `BookingRowAction` list and `MobileActionSheet` in `app/bookings/page.tsx` | Action parity assertion; demo catalogue tests | Action outcomes through controls NOT RUN | PASS | Execute paid/pending/cancelled/refund/reschedule fixture matrix. |
| M06 | Global mobile control floor; existing responsive New Booking/settings/inbox; larger steppers | Build/type/lint; existing source paths inspected | Form, settings and keyboard-open inbox journeys NOT RUN | PASS | Run success/failure retention and keyboard-open screenshots. |
| M07 | `AppShell`, `DemoActionGuide`, shared demo catalogue, login refresh function | Demo catalogue/help/account tests passed; 40 final contract tests and the broader unit run passed | Centered-dialog and every-action demo journey NOT RUN; future isolated DB refresh NOT RUN | PASS | Run demo action crawler plus +60/+180-day database fixture without production writes. |
| M08 | `booking/app/page.tsx`; provisioned Claire assets | Storefront and hero source regressions; booking build | Two-palette browsing screenshots NOT RUN | PASS | Run null/blank/filled hero fixtures for two operators in a browser. |
| M09 | `/book` and `/combo/*` single mobile bars; `BottomNav` route scope | Shared-state/source assertions; booking TypeScript/build | Complete mocked checkout journey NOT RUN | PASS | Execute pricing/voucher/promo/hold/retry/payment-return fixtures through controls. |
| M10 | `ChatWidget.tsx`, `ChatCalendar.tsx` | Viewport/focus/reduced-motion source regression; booking build | 320 × 568, landscape and keyboard tests NOT RUN | PASS | Execute chat connection/retry, long thread, Lottie failure and reduced-motion browser checks. |
| M11 | Native semantics, focus loops, pending guards and existing error states in affected components | TypeScript/build plus 292 focused cross-cutting unit tests | Automated accessibility and all edge-state journeys NOT RUN | PASS | Run the supplied geometry/accessibility suite and manual keyboard review. |
| M12 | Shared shells/components and unchanged backend policies | Both independent production builds; tenant/role/payment unit set | Second palette, restricted role, embed/voucher/tablet/desktop screenshots NOT RUN | PASS | Complete cross-tenant browser matrix before release. |

## Build, type and lint evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Admin production build | PASS, exit 0 | `npm run build`; webpack compiled, TypeScript passed, 83 static/dynamic routes processed. |
| Booking default build | FAIL in sandbox | `npm run build`; Turbopack panicked while trying to bind an internal port (`EPERM`). No source/type failure was reported. |
| Booking webpack build | PASS, exit 0 | `./node_modules/.bin/next build --webpack`; compiled, TypeScript passed, 28 routes processed. |
| Admin TypeScript | PASS, exit 0 | `./node_modules/.bin/tsc --noEmit --incremental false`. |
| Booking TypeScript | PASS, exit 0 | `./node_modules/.bin/tsc --noEmit --incremental false`. |
| Scoped admin lint | PASS with 0 errors | Existing warnings remain in already-dirty files; no rules were suppressed. |
| Scoped booking lint | PASS with 0 errors, 8 warnings | Warnings are existing unused state/hook dependency/image advisories in `app/book/page.tsx`. |
| Local built-route HTTP checks | PASS | Admin `/`, booking `/`, booking `/book`: HTTP 200. This is route availability only, not visual evidence. |

## Automated regressions

Final focused contract command:

```bash
npm run test:unit -- \
  tests/unit/mobile-first-implementation.test.ts \
  tests/unit/demo-action-guide.test.ts \
  tests/unit/demo-help-chat.test.ts \
  tests/unit/storefront-checkout-updates.test.ts
```

Result: **40/40 passed**, exit 0.

Broader affected regression command covered mobile, demo, booking realtime/success, help-chat navigation/actions, tenant branding/headers, voucher/partial checkout, My Bookings and web-chat identity.

Result: **292/292 passed across 15 files**, exit 0. Provider calls in those tests use fixtures/mocks; this is not a live provider integration claim.

New runnable checks:

- `tests/unit/mobile-first-implementation.test.ts`: six focused source/contract regressions capable of detecting route inflation, missing action parity, incorrect booking-nav scope, missing shared totals, clipped fixed-height chat regressions, undersized calendars and the blank-hero regression.
- `tests/e2e/mobile-first-layout.spec.ts`: control-driven local screenshot/geometry suite for the required viewport edges, 44px controls, no-overflow checks, admin More focus, dashboard ordering, booking actions, customer bars, chat containment and `/my-bookings` navigation.

## Browser, screenshot and interaction gate

Status: **NOT RUN**.

The computer-use service returned `No browser is available` on its first attempt to open `http://127.0.0.1:3001`. Per the task's host-control rule, no alternate browser automation was used to bypass that restriction. Consequently:

- No after screenshots or visual baselines were produced.
- The 320/360/390/430, landscape, tablet, desktop and breakpoint-edge matrix is NOT RUN.
- Light/dark admin, two palettes, 200% reflow, automated accessibility, focus order and modal semantics are NOT RUN in a browser.
- Control-driven admin/customer/demo journeys C1-C11 are NOT RUN.

See [the evidence README](evidence/mobile-first/README.md) and [the runnable Playwright matrix](../../tests/e2e/mobile-first-layout.spec.ts). It requires an isolated admin fixture and mocked provider boundaries.

## Provider, performance and real-device gate

- Isolated provider integration: **NOT RUN**; no isolated provider credentials were supplied and no provider mutation was attempted.
- Before/after browser performance: **NOT RUN**; the unavailable browser prevents comparable throttled measurements.
- Physical iPhone Safari: **NOT RUN**; no physical-device surface/model was available.
- Physical Android Chrome: **NOT RUN**; no physical-device surface/model was available.
- Mobile release verification therefore remains **PENDING**.

Required release follow-up: run `tests/e2e/mobile-first-layout.spec.ts` against both local builds with a disposable seeded admin, fix and rerun any failure, then execute the physical-device checklist in M12's prompt on one iPhone Safari and one Android Chrome. Record screenshots, device/OS/browser versions, keyboard/safe-area results, and same-environment performance measurements in this report before changing the release status to PASSED.
