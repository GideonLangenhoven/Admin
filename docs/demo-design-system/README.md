# Demo Design System — Context Pack

Companion to `docs/BRAND.md` and follows the same pattern as
`docs/LANDING_PAGE_SYSTEM_PROMPTS.md`. That system generates the ten landing
templates; this one generates the demo/marketing assets for
bookingtours.co.za, one feature at a time.

To produce one asset, give the design agent:

1. **`SYSTEM_PROMPT.md`** (verbatim, every time — this is the constant), and
2. **One** feature entry from `DEMO_ASSET_PLAN.md` (the variable).

That's it. Do not hand over the whole plan and ask for "all of them" — the
system prompt explicitly instructs a single asset per session so each one
can be reviewed and approved before the next is started.

## Files

- `SYSTEM_PROMPT.md` — identity, the BookingTours brand tokens (self-contained,
  no need to also attach `BRAND.md`), and the one-asset-per-session rule.
- `DEMO_ASSET_PLAN.md` — 13 numbered feature briefs (11 core + 2
  differentiators), each with what to show, the hook line, readiness status,
  and where in the product it lives. Same content as the shot-list artifact
  built earlier in this project, in portable markdown form.

## Sequence

Work through `DEMO_ASSET_PLAN.md` in order — it's numbered because the order
is the order you'll actually record in, not an arbitrary index. Skip an item
only if its readiness status says so (two items are flagged: combo bookings
needs a feature flag turned on first, OTA sync is currently staff-only).
