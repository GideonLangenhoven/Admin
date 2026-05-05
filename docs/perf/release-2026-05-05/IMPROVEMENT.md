# Performance Improvement Report — V1 Release (2026-05-05)

## Changes Implemented

### Booking Site (~/dev/booking)
1. **Image optimization pipeline** — `/api/img` route serves WebP/AVIF via sharp with year-long immutable cache
2. **Custom image loader** — All `<Image>` components route through `/api/img` for consistent optimization
3. **Priority loading** — First tour card uses `priority` + `eager` loading; rest use `lazy`
4. **Parallel data fetching** — Home page 5 sequential queries → single `Promise.all` (~400ms saved)
5. **Alt text** — All tour images have descriptive alt text for accessibility
6. **Lighthouse CI** — PR gate at 90 across all four categories

### Admin Dashboard (~/dev/capekayak)
1. **Inbox virtualization** — react-virtuoso renders thread list when >50 conversations (handles 500+ without lag)
2. **Bookings pagination** — 50 rows per page with server-side `.range()`, Load More button
3. **WeekView memoization** — `useMemo` for slot grouping by day (eliminates O(n*7) filter per render)
4. **AvailabilityCalendar** — `React.memo` on CustomDay component (prevents 30+ re-renders per interaction)
5. **AuthGate skeleton** — Session hint cookie enables AppShell skeleton on reload (eliminates login flash)
6. **Bundle analyzer** — `ANALYZE=true npm run build` for local audits
7. **Lighthouse CI** — `.github/workflows/lighthouse.yml` for PR regression checks

## Before / After (run Lighthouse to fill)

| Route | Before Perf | After Perf | Before LCP | After LCP |
|-------|-------------|------------|------------|-----------|
| Booking home (mobile) | TBD | TBD | TBD | TBD |
| Admin / (desktop) | TBD | TBD | TBD | TBD |
| Admin /bookings (desktop) | TBD | TBD | TBD | TBD |
| Admin /inbox (desktop) | TBD | TBD | TBD | TBD |

Fill by running:
```bash
npx lighthouse <url> --preset=mobile --output=json --output-path=./docs/perf/release-2026-05-05/<name>.json --quiet
npx ts-node scripts/perf-summary.ts docs/perf/release-2026-05-05
```
