# Auto-Research: CapeKayak Speed Optimization

## Goal
Iteratively improve the Next.js build performance and runtime speed of the CapeKayak admin dashboard. Each experiment makes ONE small change, measures the impact, and keeps or reverts it.

## Metric
**Next.js production build time** and **bundle size** (measured via `npm run build`).
Secondary: page load waterfall (sequential Supabase queries → parallel).

## What You Can Change
- Any file in `app/`, `components/`, or config files (`next.config.ts`, `tailwind.config.js`, `tsconfig.json`)
- You may NOT change: database schema, edge functions, .env files, package.json dependencies (no new installs)
- You may NOT change functionality — the app must behave identically after each change
- You may NOT remove features or UI elements

## What You Cannot Change
- No visual/functional changes to the app
- No new npm dependencies
- No database migrations
- No edge function changes

## Assessment Method
1. Run `npm run build 2>&1` and capture output
2. Extract: total build time, page sizes, first load JS sizes
3. Compare to the previous baseline in `progress.jsonl`
4. If improved or neutral → KEEP the change, log success
5. If worse → REVERT the change (`git checkout -- <files>`), log failure

## Experiment Loop
For each iteration:

1. **Read** `progress.jsonl` to see what's been tried and the current baseline
2. **Read** `candidates.md` to pick the next untried optimization
3. **Hypothesize** — write a 1-line hypothesis in the log
4. **Implement** — make exactly ONE change
5. **Build** — run `npm run build 2>&1`, capture full output
6. **Assess** — compare to baseline metrics
7. **Decide** — keep (if improved) or revert (if worse)
8. **Log** — append result to `progress.jsonl`
9. **Update** `candidates.md` — mark the candidate as tried with result
10. **Repeat** from step 1

## Log Format (progress.jsonl)
Each line is a JSON object:
```json
{"experiment": 1, "timestamp": "2026-04-01T18:00:00Z", "candidate": "description", "hypothesis": "...", "baseline_build_time": "45s", "new_build_time": "42s", "baseline_first_load_js": "120kB", "new_first_load_js": "115kB", "result": "KEPT", "files_changed": ["app/page.tsx"]}
```

## Important Rules
- ONE change per experiment. Never batch multiple optimizations.
- Always measure BEFORE and AFTER.
- If a build fails, revert immediately and log the failure.
- Never skip the assessment step.
- Update candidates.md after each experiment.
