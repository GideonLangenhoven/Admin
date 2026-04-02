# Auto-Research Test Report — 2026-04-01T17:20:55.692Z

**Score: 81/81 (100.0%)**
Pass: 81 | Fail: 0 | Skip (manual): 17

## Failures

## All Results
| ID | Section | Test | Status | Detail |
|---|---|---|---|---|
| A1 | A | Admin login — route exists | PASS |  |
| A2 | A | Wrong password lockout — lockout logic exists | PASS |  |
| A3 | A | Forgot password — route exists | PASS |  |
| A4 | A | Password reset — route exists | PASS |  |
| A5 | A | Invite new admin — admin auth logic exists | PASS |  |
| A6 | A | New admin first login — setup link handler | PASS |  |
| A7 | A | Role permissions — privilege check in layout | PASS |  |
| A8 | A | Suspended subscription — check exists | PASS |  |
| B1 | B | Create tour — settings page exists | PASS |  |
| B5 | B | Generate slots — slots page exists | PASS |  |
| B6 | B | Week calendar — WeekView component | PASS |  |
| B7 | B | Edit slot — slots page has edit | PASS |  |
| C1 | C | Customer booking flow — C1 | SKIP | Requires manual/browser test |
| C2 | C | Customer booking flow — C2 | SKIP | Requires manual/browser test |
| C3 | C | Customer booking flow — C3 | SKIP | Requires manual/browser test |
| C4 | C | Customer booking flow — C4 | SKIP | Requires manual/browser test |
| C5 | C | Customer booking flow — C5 | SKIP | Requires manual/browser test |
| C6 | C | Customer booking flow — C6 | SKIP | Requires manual/browser test |
| C7 | C | Customer booking flow — C7 | SKIP | Requires manual/browser test |
| C8 | C | Customer booking flow — C8 | SKIP | Requires manual/browser test |
| C9 | C | Customer booking flow — C9 | SKIP | Requires manual/browser test |
| C10 | C | Customer booking flow — C10 | SKIP | Requires manual/browser test |
| C11 | C | Customer booking flow — C11 | SKIP | Requires manual/browser test |
| C12 | C | Customer booking flow — C12 | SKIP | Requires manual/browser test |
| C13 | C | Customer booking flow — C13 | SKIP | Requires manual/browser test |
| C14 | C | Customer booking flow — C14 | SKIP | Requires manual/browser test |
| C15 | C | Customer booking flow — C15 | SKIP | Requires manual/browser test |
| D1 | D | Chat widget — web-chat function exists | PASS |  |
| D2 | D | AI FAQ — web-chat has AI logic | PASS |  |
| D3 | D | Book via chat — booking flow in web-chat | PASS |  |
| D4 | D | Complete chat booking | SKIP | Requires manual/browser test |
| E1 | E | Create manual booking — page exists | PASS |  |
| E4 | E | Generate payment link — send-email function | PASS |  |
| E6 | E | Mark paid — manual-mark-paid function | PASS |  |
| E7 | E | Edit booking — bookings detail page | PASS |  |
| F1 | F | Waiver link in emails — waiver-form function | PASS |  |
| F6 | F | Auto waiver reminder — auto-messages function | PASS |  |
| G1 | G | Yoco checkout — create-checkout function | PASS |  |
| G2 | G | Payment webhook — yoco-webhook function | PASS |  |
| G4 | G | Voucher at checkout — voucher logic | PASS |  |
| G6 | G | Promo code percent — promo logic in checkout | PASS |  |
| G10 | G | Server-side price verification | PASS |  |
| H1 | H | Voucher management — vouchers page | PASS |  |
| I1 | I | OTP login — send-otp function | PASS |  |
| J1 | J | Day-before reminder — auto-messages exists | PASS |  |
| J5 | J | Hold expiry — cron-tasks exists | PASS |  |
| J9 | J | Abandoned cart recovery — abandoned cart logic | PASS |  |
| K1 | K | Cancel booking — refunds page | PASS |  |
| K3 | K | Process refund — process-refund function | PASS |  |
| K6 | K | Batch refund — batch-refund function | PASS |  |
| L1 | L | Weather cancel — weather-cancel function | PASS |  |
| L1b | L | Weather page exists | PASS |  |
| M1 | M | Rebook function exists | PASS |  |
| N1 | N | WhatsApp webhook — wa-webhook function | PASS |  |
| N5 | N | Admin reply — admin-reply function | PASS |  |
| N8 | N | Unread badge — NotificationBadge component | PASS |  |
| O1 | O | Broadcasts page exists | PASS |  |
| O2 | O | Broadcast function exists | PASS |  |
| P1 | P | Photos page exists | PASS |  |
| Q1 | Q | Invoice generation — confirm-booking has invoice | PASS |  |
| Q3 | Q | Invoices page exists | PASS |  |
| R1 | R | Daily manifest — dashboard has manifest | PASS |  |
| R2 | R | Check-in — dashboard has check-in | PASS |  |
| R5 | R | Weather widget — Windguru loaded | PASS |  |
| S1 | S | Reports page exists | PASS |  |
| T1 | T | Peak pricing page exists | PASS |  |
| U1 | U | Marketing dashboard — page exists | PASS |  |
| U2 | U | Contacts page | PASS |  |
| U6 | U | Templates page | PASS |  |
| U8 | U | Campaign dispatch — marketing-dispatch function | PASS |  |
| U10 | U | Track opens — marketing-track function | PASS |  |
| U11 | U | Track clicks — click tracking | PASS |  |
| U12 | U | Unsubscribe — unsubscribe function | PASS |  |
| U13 | U | Automations page | PASS |  |
| U14 | U | Automation detail page | PASS |  |
| U18 | U | Automation: generate_voucher step | PASS |  |
| U19 | U | Automation: generate_promo step | PASS |  |
| V1 | V | Promotions page exists | PASS |  |
| V1b | V | Promotions migration exists | PASS |  |
| W1 | W | Settings page exists | PASS |  |
| W4 | W | WhatsApp credentials — encrypted storage | PASS |  |
| W5 | W | Yoco credentials | PASS |  |
| X1 | X | Billing page exists | PASS |  |
| Y1 | Y | External booking function — check_availability | PASS |  |
| Y2 | Y | External booking — create_booking | PASS |  |
| Y5 | Y | Idempotent external booking | PASS |  |
| Y6 | Y | HMAC auth on external-booking | PASS |  |
| Z1 | Z | Super admin page exists | PASS |  |
| Z1b | Z | Onboard function exists | PASS |  |
| AA1 | AA | Double payment — idempotency_keys table | PASS |  |
| AA1b | AA | Yoco webhook uses idempotency | PASS |  |
| AA1c | AA | Paysafe webhook uses idempotency | PASS |  |
| AA14 | AA | Concurrent hold — atomic hold creation | PASS |  |
| BUILD | AB | Production build succeeds | SKIP | Requires manual/browser test |
| SEC1 | SEC | RLS enabled — bulk migration exists | PASS |  |
| SEC2 | SEC | .env in .gitignore | PASS |  |
| SEC3 | SEC | Security headers in next.config | PASS |  |
| SEC4 | SEC | Paysafe HMAC verification | PASS |  |