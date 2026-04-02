# Speed Optimization Candidates

Ordered by expected impact (highest first). Each candidate is ONE atomic change.

## Critical — Query & Runtime Performance

- [x] **C1: Parallelize dashboard queries** — Convert 7 sequential `await` calls in `app/page.tsx` load() to `Promise.all()`. Expected: faster page load, no bundle change.
- [x] **C2: Enable React Compiler** — Change `reactCompiler: false` to `true` in `next.config.ts`. Expected: automatic memoization, fewer re-renders.
- [x] **C3: Add loading.tsx to root** — Create `app/loading.tsx` with a lightweight spinner. Expected: perceived performance improvement via Suspense.
- [x] **C4: Lazy-load Windguru widget** — Wrap WindguruWidget in `dynamic(() => import(...), { ssr: false })`. Expected: reduce initial JS bundle, defer external script.

## High — Bundle Size Reduction

- [ ] **H1: Tree-shake date-fns** — Replace `import { format } from 'date-fns'` with direct subpath imports `import format from 'date-fns/format'` across all files. Expected: smaller bundle.
- [x] **H2: Dynamic import jsPDF** *(already done — reports/page.tsx uses dynamic import)* — jsPDF is only used in invoices. Wrap with `dynamic import()` so it's not in main bundle. Expected: reduce first-load JS.
- [x] **H3: Dynamic import RichTextEditor + ExternalBookingSettings** — Only used in marketing/settings. Lazy-load it. Expected: reduce first-load JS for non-marketing pages.
- [ ] **H4: Analyze and remove unused Lucide icons** — Check if all imported icons are actually used. Expected: minor bundle reduction.

## Medium — Component Optimization

- [ ] **M1: Extract dashboard sub-components** — Split `app/page.tsx` (889 lines) into ManifestCard, RefundCard, InboxCard, WeatherCard components. Expected: better code splitting, tree shaking.
- [ ] **M2: Memoize expensive manifest computation** — The `grouped` useMemo in page.tsx recalculates on every render. Add proper dependency arrays. Expected: fewer re-renders.
- [ ] **M3: useCallback for inline handlers** — Dashboard has inline `onMouseEnter`/`onMouseLeave` on table rows. Wrap in useCallback. Expected: fewer child re-renders.
- [ ] **M4: Debounce Nominatim geocoding** — Weather location lookup fires on every keystroke. Add 500ms debounce. Expected: fewer API calls, smoother UI.

## Low — Config & Build Optimization

- [ ] **L1: Enable Next.js output: 'standalone'** — Add `output: 'standalone'` to next.config.ts. Expected: smaller deployment size.
- [x] **L2: Add modularizeImports for lucide-react** — Configure Next.js to auto-tree-shake icon imports. Expected: smaller bundle.
- [ ] **L3: Configure image optimization domains** — Add known image domains to next.config.ts for Next/Image optimization. Expected: faster image loads.
- [ ] **L4: Enable SWC minification explicitly** — Ensure `swcMinify: true` in config. Expected: faster builds, smaller output.
