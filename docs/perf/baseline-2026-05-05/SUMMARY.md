# Lighthouse Performance Baseline — 2026-05-05

Run Lighthouse to populate this file:

```bash
# Booking site (mobile)
npx lighthouse https://booking.bookingtours.co.za/cape-kayak \
  --preset=perf --output=json --output-path=./docs/perf/baseline-2026-05-05/booking-home-mobile.json --quiet

# Admin (desktop)
npx lighthouse https://admin.bookingtours.co.za/ \
  --preset=desktop --output=json --output-path=./docs/perf/baseline-2026-05-05/admin-dashboard-desktop.json --quiet
npx lighthouse https://admin.bookingtours.co.za/bookings \
  --preset=desktop --output=json --output-path=./docs/perf/baseline-2026-05-05/admin-bookings-desktop.json --quiet
npx lighthouse https://admin.bookingtours.co.za/inbox \
  --preset=desktop --output=json --output-path=./docs/perf/baseline-2026-05-05/admin-inbox-desktop.json --quiet
```

Then generate the table:
```bash
npx ts-node scripts/perf-summary.ts docs/perf/baseline-2026-05-05
```

## Expected improvements from this pass

| Area | Change | Expected Impact |
|------|--------|-----------------|
| Booking home data fetch | Sequential → Promise.all | -400ms TTFB |
| Tour card images | priority + lazy loading | -200ms LCP |
| Image route (/api/img) | WebP/AVIF + year cache | -50% image bytes |
| Admin inbox | Virtuoso at >50 threads | No scroll lag at 500+ |
| Admin bookings | 50/page pagination | -80% initial payload |
| WeekView | useMemo slot grouping | Eliminates O(n*7) filter |
| AvailabilityCalendar | React.memo on CustomDay | -70% re-renders |
| AuthGate | Session hint skeleton | Eliminates login flash |
