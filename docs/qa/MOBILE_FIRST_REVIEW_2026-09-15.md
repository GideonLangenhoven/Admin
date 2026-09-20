# Mobile-first review, 15 September 2026

## Verdict

Not yet at flagship mobile quality. The admin has real responsive layouts, but important workflows still use compressed desktop UI and have unequal action availability. The customer booking implementation has stronger touch-friendly foundations, but its chat panel has a short-screen sizing defect. A physical-device release sign-off is still required.

## Scope and confidence

- Live: Claire's admin dashboard and bookings at an explicitly verified 390 × 844 CSS-pixel responsive viewport in Chrome. The review tab was separate from the original tab.
- Source: shared admin shell, mobile navigation, bookings, selected settings/new-booking controls, customer home, booking flow, header, bottom navigation, chatbot, styles, and mobile test coverage.
- Automated: 34 focused unit tests passed across `demo-action-guide`, `demo-help-chat`, and `storefront-checkout-updates`.
- The browser-control session repeatedly stalled and eventually became unavailable. No complete customer mobile walkthrough, real-device Safari/Android check, keyboard-open check, network benchmark, or end-to-end transaction was completed.
- No real booking, cancellation, refund, payment, or guest message was submitted. Unit checkout tests use mocks. Their success is not evidence of a successful real payment.
- Local source is a dirty worktree; source-only findings are labelled and should be checked against deployed builds during remediation.

## Audit health

These are provisional assessments of inspected implementation, not device certification.

| Dimension | Score / 4 | Evidence |
| --- | --- | --- |
| Accessibility | 2 | Labels and focus treatments exist, but offscreen navigation remains exposed and several controls are too small for comfortable touch. |
| Performance | Not scored | Images use responsive sizes/lazy loading, but no current mobile timing or frame-rate measurement was completed. |
| Responsive design | 1 | Live revenue overlap, clipped export control, missing mobile actions, and source-confirmed fixed chat height. |
| Theming | 2 | Shared tokens exist, but booking/action UI also uses fixed gray/status colors. Dark-mode contrast remains unverified. |
| Design anti-patterns | 1 | Oversized hero metric, repeated decorative cards, and pervasive glass styling consume attention and phone space. |

No aggregate score is issued because performance and device coverage are incomplete. The anti-pattern check fails the mobile-first bar: decorative dashboard statistics appear before the operational manifest and roll call. This is not an assertion that every screen has been visually reviewed.

## Priority findings

### P1: Mobile booking actions differ from desktop

Location: `app/bookings/page.tsx:2247`, `:2358`, `:2428`.

The departure's Cancel Slot action is inside `hidden ... lg:table-cell`. The mobile guest actions omit Payment Reminder and Allow Without Payment / Require Payment, while desktop includes them. The live 390px accessibility tree confirms that the departure action is absent. Other pages may offer alternative routes; this finding is about the bookings workflow, not global backend capability.

Impact: a phone admin cannot perform the same operations from the same working screen. Recommendation: use one shared action definition for desktop and mobile, with a touch-friendly departure/guest action sheet. Command: `$impeccable adapt`.

### P1: Revenue values overlap at ordinary phone width

Location: `app/page.tsx:702`.

Observed live at 390 × 844: the last-seven-days and this-month values, both R13 530, run into each other. The implementation keeps three columns, 28px figures, and internal padding at all widths.

Impact: financial summaries become difficult to distinguish. Recommendation: reflow the mobile summary into legible rows or a compact primary figure with secondary lines, and test larger amounts. Command: `$impeccable layout`.

### P1: Guest and settings controls are not comfortable touch targets

Location: `app/bookings/page.tsx:2286`, `:2352`, `:2502`; `app/settings/page.tsx:1907`; `app/new-booking/page.tsx:1277`.

Source confirms 10–11px guest details, names truncated to 80px, mobile action buttons with 10px text and 2px vertical padding, unpadded small tour-management links, and 28px add-on steppers. These are well below a comfortable 44px touch target in several places. This is an ergonomic finding; 44px alone is not being presented as the WCAG AA threshold.

Impact: harder outdoor reading, more mis-taps, and cramped adjacent financial/destructive actions. Recommendation: readable guest rows with full names, clear payment state, and adequately spaced action targets. Command: `$impeccable adapt`.

### P1: Customer chatbot does not fit short viewports

Location: `booking/app/components/ChatWidget.tsx:184`; `booking/app/globals.css:903`.

Source-confirmed: the open panel is 32rem high and sits 5.75rem above the bottom on mobile, without a viewport-based maximum height. At a standard 16px root size this needs 604px before any top clearance. A 568px viewport places its top 36px offscreen. Keyboard-open behaviour is unverified and needs separate testing.

Impact: the chat header/close control can be clipped on short screens. Recommendation: reuse the existing admin chat's viewport-bounded sheet approach, account for safe areas, and verify keyboard-open typing. Command: `$impeccable harden`.

### P1: Closed mobile drawer remains exposed to assistive navigation

Location: `components/MobileMenuDrawer.tsx:67`.

The mounted drawer is only translated offscreen when closed. Its links and Close menu button remain in the live accessibility tree. There is no closed-state `inert`/unmounting, open-state focus containment, or Escape handling in this component.

Impact: invisible duplicate navigation can be encountered by keyboard/screen-reader users. Recommendation: use a native dialog or correctly managed drawer with focus restoration and hidden-state exclusion. Command: `$impeccable harden`.

### P2: Entire admin menu is placed in the bottom navigation

Location: `components/AppShell.tsx:443`.

Confirmed live and in source: every visible navigation item becomes a 74px tab in a horizontal strip with its scrollbar hidden. Claire's demo has 20 items. Inbox, refunds, and settings require scrolling/searching rather than remaining predictable destinations.

Recommendation: keep four or five stable destinations, such as Today, Bookings, New Booking, Inbox, and More. Put the complete menu behind More. Command: `$impeccable distill`.

### P2: Export control is clipped on the bookings screen

Location: `app/bookings/page.tsx:1500`.

Observed live at 390px: Export with Sensitive Data extends past the right edge. Heading and both non-wrapping export buttons share an unwrapped flex row.

Recommendation: move exports into a secondary menu or wrap the toolbar without widening the screen. Command: `$impeccable layout`.

### P2: Demo banner uses excessive phone space

Location: `components/AppShell.tsx:411`.

Observed live: the booking-site link competes horizontally with the explanation, leaving the explanation in a very narrow, many-line column. The banner remains above the independently scrolling main content.

Recommendation: one short demo status line, with the customer-site link below or in the menu. Preserve the clear no-real-actions disclosure. Command: `$impeccable clarify`.

### P2: Customer booking progression is not designed around thumb reach

Location: `booking/app/book/page.tsx:617`, `:749`, `:926`; `booking/app/components/BottomNav.tsx:34`.

Source-only: calendar, time, guest quantity, optional extras, and continuation stack vertically. On the details step, payment follows the details, optional discounts/vouchers, consent controls, and summary. The persistent bottom navigation remains general site navigation rather than the current booking action. No viewport-pinned total/Continue control exists.

Recommendation: evaluate a compact mobile total/Continue bar during booking, with secondary site navigation moved out of its way. Do not duplicate totals or obscure validation errors. Confirm the actual scrolling burden in a completed live walkthrough before choosing the final layout. Command: `$impeccable adapt`.

## Positive findings

- Customer booking fields are 16px below the small breakpoint; phone and email use appropriate input types.
- Customer quantity controls are 48px, bottom-navigation items have explicit minimum touch dimensions, and the layout stacks at mobile widths.
- Tour images use responsive sizes, prioritise the first image, and lazy-load later images.
- The demo explanation uses a native dialog, a dynamic-viewport maximum height, a 44px close control, and feature-linked headings.
- Admin help chat already has a bounded mobile sheet, providing an existing pattern to reuse.
- Reduced-motion CSS exists in both apps.
- All 34 selected logic tests passed. No application changes were made during this audit.

## Systemic cause and next pass

The main problem is not absence of breakpoints. Desktop information density and independently maintained action lists are being carried into mobile. Prefer shared behaviour with device-appropriate presentation, using existing components rather than building a separate mobile application.

Recommended order: `$impeccable adapt` for action parity/navigation/targets; `$impeccable layout` for revenue/toolbars; `$impeccable harden` for chat and drawer; `$impeccable clarify` for the demo banner; then `$impeccable polish`.

The user can request these individually or together. Re-run `$impeccable audit` after fixes.

## Required acceptance checks before claiming mobile-first readiness

- iPhone Safari and Android Chrome, including 360px, 390px, 430px, short-screen, landscape, enlarged text, and keyboard-open states.
- Admin: find today's departure, expand guests, check in, add booking, edit/rebook, payment reminder, unpaid override, weather cancellation, refund review, inbox, and activity settings.
- Customer: activity selection, date/time/quantity/extras, contact entry, discounts/vouchers, validation, sandbox payment/return, confirmation, lookup, reschedule, cancellation, and chatbot.
- Use isolated test records and sandbox services for mutations. Keep Claire's demo read-only.
- Verify no horizontal page overflow, clipped controls, overlapping totals, inaccessible hidden navigation, or actions missing relative to desktop.
- Measure slow-network loading and recovery. Do not treat the existing desktop-only Playwright project or mobile route-visibility checks as full mobile journey coverage: `tests/e2e/full-journey.spec.ts:90` navigates directly to routes rather than exercising those workflows.
