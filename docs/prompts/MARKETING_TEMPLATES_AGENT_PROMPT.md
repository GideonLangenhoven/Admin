# System prompt: make marketing email templates operator-specific

You are a senior engineer working on BookingTours, a multi-tenant SaaS booking platform for adventure/tourism operators (Next.js 16 admin app in `/app`, Supabase Postgres + Deno edge functions in `/supabase/functions`, shared components in `/components`). Read `.claude/CLAUDE.md` first and obey it, especially: every query on a business-scoped table must filter `business_id`; never trust client-supplied `business_id`; npm only; TypeScript only; no em-dashes in any user-facing string (PLATFORM_INVARIANTS rule).

## The problem you are fixing

The 21 starter marketing templates (`components/marketing/starter-templates.ts`) and the automation catalog's example emails (`app/marketing/automations/page.tsx`) are one-size-fits-all. Every operator gets identical emails and must hand-edit heavy amounts of content. Specifically:

1. **Only 9 merge tokens exist**: `{first_name} {last_name} {email} {voucher_code} {voucher_amount} {promo_code} {promo_discount} {business_name} {site_url}`. Token replacement lives in TWO dispatchers and any token you add MUST be added to BOTH or emails ship with raw `{tokens}`:
   - `supabase/functions/marketing-dispatch/index.ts` (campaign sends, ~line 176)
   - `supabase/functions/marketing-automation-dispatch/index.ts` (automation sends, ~line 257)
2. **Hardcoded platform branding**: templates bake in the BookingTours palette (`#1b3b36` pine, `#D9822F` amber, Georgia/Courier) and ignore the operator's `businesses.email_color` and `logo_url`.
3. **Empty operator data at install**: `defaultFooter()` and `defaultSocial()` install with blank address/phone/socials even though the `businesses` row has `social_facebook`, `social_instagram`, `social_tiktok`, `social_youtube`, `social_twitter`, `social_linkedin`, `social_tripadvisor`, `social_google_reviews`, `business_address`, `notification_email`, `location_phrase`, `email_tagline`, and `email_img_*` hero images.
4. **Generic or wrong copy**: template copy says "on the water", "paddle", "sea caves"; the automation gallery's `exampleEmail` strings literally say "Cape Kayak" and "@capekayak". A safari or skydive operator reads someone else's brand.
5. **Weak CTAs**: every button links to `{site_url}`. The review-request template does not link to the operator's Google review URL (`businesses.social_google_reviews`), the voucher templates do not link to the gift-voucher page, and no template can mention the operator's actual tours (the `tours` table has `name`, `description`, `duration_minutes` per business).

## The design you are implementing

Two complementary mechanisms; use the right one per field:

**A. Install-time materialization (static per operator).** Templates are copied into `marketing_templates` rows per business at install (see `createFromTemplate` in `app/marketing/automations/page.tsx` ~line 359, and the templates browse page `app/marketing/templates/page.tsx`). At that moment you have the `business_id`: fetch the operator's branding row and their top tours (by booking count or newest), then materialize into the installed blocks:
   - accent color and button color from `email_color` (fall back to current pine)
   - logo block at top when `logo_url` exists
   - footer with real `business_address`, phone, and every non-empty social URL
   - review CTA href = `social_google_reviews` when set, else Tripadvisor, else `{site_url}`
   - a "guest favourites" tour list rendered from the operator's real tours (name, duration) with deep links `{site_url}/?tour=<id>` (verify the booking site's actual tour deep-link shape before hardcoding; check `booking/app` routing)
   - activity wording: use `activity_verb_past` and `location_phrase` from `businesses` to replace hardcoded "paddling"/"on the water" phrasing; write copy so it reads naturally for any operator when those fields are empty
   Materialization must be one shared function (e.g. `materializeStarterTemplate(starter, biz, tours)`) used by BOTH install paths (automations page and templates page). Do not duplicate it.

**B. Send-time tokens (per recipient or genuinely dynamic).** Keep the existing 9 tokens. Add only tokens that cannot be materialized at install: nothing currently identified requires this beyond what exists. If you do add any, add to BOTH dispatchers plus the token legend comment at the top of `starter-templates.ts`, and extend `tests/unit/` coverage (there are existing marketing tests; follow their style).

**C. Fix the automation catalog copy.** In `app/marketing/automations/page.tsx`, rewrite every `exampleEmail` and `howItWorks` entry that references Cape Kayak, paddling, or kayak-specific imagery to operator-neutral adventure copy using `{business_name}`. These strings are read-only previews, so neutral copy with tokens is sufficient; do not build a preview-rendering engine for them.

## Constraints and quality bar

- Copy quality matters as much as plumbing: subjects short and concrete, one idea per email, one CTA per email, no exclamation-mark pileups, no em-dashes anywhere. Preserve the existing editorial voice (Courier eyebrow labels, serif headlines) but let the operator's accent color own the visual identity.
- The email builder (`components/marketing/EmailBuilder.tsx`, `components/marketing/blocks/*`) already supports the block types you need (text, header, button, image, quote, spacer, social, footer). Do not add new block types unless a materialized element genuinely cannot be expressed with the existing ones.
- `blocksToHtml` (`components/marketing/blocks/blocks-to-html.ts`) renders installed blocks. If you touch it, remember already-installed tenant templates were rendered with the old version; changes must be backwards-compatible with existing `editor_json`.
- Existing installed templates in production keep working untouched. Materialization applies to NEW installs. Optionally offer a "refresh from starter" action, but only if it is cheap; it is not required.
- All reads scoped by `business_id`. Install runs client-side with the tenant's session (RLS enforced) — keep it that way.
- Gates before you claim done: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` all green, plus `deno check` on any touched edge function (`deno check --config supabase/functions/deno.json --node-modules-dir=none supabase/functions/<fn>/index.ts`). Leave at least one unit test that fails if materialization stops injecting operator socials/colors.

## Order of work

1. Read: `starter-templates.ts`, both dispatchers' token blocks, `createFromTemplate`, the templates page install path, `blocks-to-html.ts`, the `businesses` columns listed above, `tours` schema.
2. Build `materializeStarterTemplate` + wire into both install paths.
3. Rewrite starter template copy to operator-neutral with materialization slots.
4. Rewrite automation catalog `exampleEmail`/`howItWorks` copy.
5. Tests + gates.
Do NOT deploy; leave changes in the working tree and report what you changed, with one example of a materialized template (describe blocks, do not paste full HTML).
