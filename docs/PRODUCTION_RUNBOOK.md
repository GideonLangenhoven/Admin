# Production Runbook

## E2E Test Suite

Run before any release that touches the booking flow.

### Prerequisites
1. Aonyx tenant has Yoco TEST MODE on (Settings > Credentials).
2. Tour "Morning Kayak Paddle" has slots in the upcoming month.
3. `ADMIN_EMAIL` and `ADMIN_PASSWORD` env vars set for an admin account.

### Run

```
ADMIN_EMAIL=justpassingpodcast@gmail.com ADMIN_PASSWORD='<pwd>' npm run test:e2e
```

Smoke-only (~10s): `npm run test:e2e:smoke`
Happy-path-only (~60s): `npm run test:e2e:happy`
View report after a run: `npm run test:e2e:report`

### Environment Overrides

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `https://aonyx.booking.bookingtours.co.za` | Customer-facing booking site |
| `ADMIN_URL` | `https://aonyx.admin.bookingtours.co.za` | Admin dashboard |
| `ADMIN_EMAIL` | (required) | Admin login email |
| `ADMIN_PASSWORD` | (required) | Admin login password |

### Test Bookings

Fixtures auto-tag bookings with the customer name "Playwright Test" so you can find and delete them in admin > Bookings.

### Troubleshooting

- **Test fails on "admin must show TEST MODE banner"**: Enable Yoco test mode in admin Settings > Credentials.
- **No available dates**: Ensure the tour has published slots in the upcoming month.
- **Yoco card form selectors fail**: Yoco may have changed their hosted checkout DOM. Update selectors in `tests/e2e/happy-path-booking.spec.ts`.
- **View failure details**: Run `npm run test:e2e:report` to open the HTML report with screenshots and traces.
