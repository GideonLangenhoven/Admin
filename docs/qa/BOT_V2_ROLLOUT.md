# WhatsApp bot v2 — rollout, monitoring, and spec deviations (2026-08-03)

Implements the "System Prompt v2" spec (three-block cached prompt, JSON output
contract, non-thinking Flash) on top of the same-day Fix-7 work in
`_shared/llm.ts` (Flash default, reasoning off, `llm_usage` metering, `user`
key). The two land together.

## What shipped

| Piece | Where |
|---|---|
| Block A (frozen contract + examples), Block B/C builders | `supabase/functions/_shared/bot-prompt.ts` |
| JSON-contract completion (validate → retry once → Gemini degrade) | `supabase/functions/_shared/bot-llm.ts` (+ `bot-llm.test.ts`, 6 tests) |
| v2 brain + dispatch in the webhook, flag-gated | `supabase/functions/wa-webhook/index.ts` (`botAnswerV2`, `buildBotSystemForTurn`, `logLlmUsage`) |
| `llm_usage` table (base + v2 columns, self-sufficient) | `supabase/migrations/20260803130000_llm_usage.sql` + `security-baseline.json` rls row |
| Golden set + A/B replay harness | `scripts/bot-goldens/` |

The deterministic state machine stays in front (tier-0): buttons, lists, FAQ
matches, availability, weather-concern intercept, payment intercepts, and the
booking flow are untouched. v2 takes over only the free-text tail — the two
call sites that previously hit `wa-ask` / `wa-faq` — plus the THANKS ack
(silent instead of a paid "You're welcome" message when the flag is `on`).

## The flag

`WA_BOT_V2` (edge function env) — default **`shadow`**:

- `off` — legacy path only.
- `shadow` — legacy path answers exactly as today; after the send, the v2 call
  runs and logs to `llm_usage` (`fn='wa-v2-shadow'`, `shadow=true`), nothing
  is sent. This is the comparison period.
- `on` — v2 answers the free-text turns: one message, **no trailing
  "Anything else?" buttons** on the LLM path; acks go silent. The legacy path
  remains the automatic fallback whenever v2 returns nothing valid (both
  providers down or double parse failure), so `on` can never dead-end a reply.

Rollback is `WA_BOT_V2=off` (or unset + redeploy of nothing — default is
shadow, which sends nothing new). Model override: `OPENROUTER_BOT_MODEL`
(default `deepseek/deepseek-v4-flash`; verified live on OpenRouter,
$0.14/M in, $0.28/M out, cached reads 0.1×).

POPIA provider constraints (`_shared/openrouter-provider.ts`, applied to both
the legacy `llmText` path and v2 `botReply`; all unset = today's routing):

- `OPENROUTER_PROVIDER_IGNORE=deepseek` — exclude first-party (China-hosted)
  DeepSeek endpoints; only US/EU hosts serve the model.
- `OPENROUTER_DATA_COLLECTION=deny` — route only to providers that do not
  collect/store user data.
- `OPENROUTER_ZDR=true` — Zero Data Retention endpoints only (strongest,
  smallest pool).

## Dispatch semantics (`botAnswerV2`)

- `reply` → `sendText(out.message)` only. Only `out.message` ever reaches the
  customer; `plan`/`escalation_reason` are internal (a leaked plan is a
  sev-2 — the validator also rejects messages that contain a nested plan).
- `silent` → nothing sent, state → MENU.
- `escalate` → holding message + `status='HUMAN'` + `human_takeover` log
  (same machinery the deterministic HUMAN intent uses).
- `flow` → optional lead-in message, then the existing deterministic flow:
  `availability_check` tries `handleSmartAvail`, otherwise/`booking_capture`
  re-enters `handleMsg("book")`.
- `template` → logged as unexpected and swallowed: while answering an inbound
  the 24h window is open by definition, and real closed-window sends are
  handled reactively by the Meta 131047 fallback in `sendWA`.

## Rollout steps

1. Apply `20260803130000_llm_usage.sql` (idempotent), run
   `npm run check-security-drift` → must exit 0 (baseline already has the
   `llm_usage` rls row).
2. Deploy `wa-webhook` (flag defaults to `shadow`).
3. Run the goldens (see below) and let shadow accumulate a few days of real
   traffic in `llm_usage`.
4. Compare (SQL below + spot-read shadow outputs in logs), then set
   `WA_BOT_V2=on`.
5. Keep `off` as the one-command rollback for two weeks.

## Goldens / A-B replay

```sh
OPENROUTER_MODEL=deepseek/deepseek-v4-pro \
OPENROUTER_BOT_MODEL=deepseek/deepseek-v4-flash \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
OPENROUTER_API_KEY=... GEMINI_API_KEY=... \
BUSINESS_ID=<tenant uuid> \
deno run -A scripts/bot-goldens/replay.ts        # --skip-old for v2-only
```

Old arm = legacy prompt at Pro/`xhigh` (the pre-Fix-7 config). New arm = v2.
Counters: action correctness, must_contain, escalation recall, prefix-cache
hit %. 14 cases: sanitised real inbounds + the spec's coverage list (silence,
consolidation, not-in-KB, complaint, medical, weather go/no-go). Re-run on
every prompt or model change. Contract validator: `cd supabase/functions &&
deno test --allow-env _shared/bot-llm.test.ts`.

## Monitoring (from `llm_usage`)

```sql
-- prefix-cache hit rate (want ≥ 80% after day one)
select fn, sum(cached_tokens)::float / nullif(sum(prompt_tokens),0) as cache_hit
from llm_usage where created_at > now() - interval '1 day' group by fn;

-- JSON validity (parse_fail rows are logged with action='parse_fail')
select count(*) filter (where action='parse_fail')::float / nullif(count(*),0) as parse_fail_rate
from llm_usage where fn like 'wa-v2%' and created_at > now() - interval '1 day';

-- grounded:false rate — the hallucination canary; investigate spikes same-day
select count(*) filter (where grounded = false)::float / nullif(count(*),0) as ungrounded_rate
from llm_usage where fn like 'wa-v2%' and action <> 'parse_fail' and created_at > now() - interval '1 day';

-- action mix (silent share = messages saved)
select action, count(*) from llm_usage where fn like 'wa-v2%'
and created_at > now() - interval '7 day' group by action order by 2 desc;

-- messages per conversation (the number that becomes an invoice on 1 Oct)
select business_id, count(*)::float / count(distinct to_phone) as msgs_per_customer
from wa_messages where created_at > now() - interval '7 day' and status='SENT'
group by business_id;
```

## Deviations from the spec doc (each verified against reality)

1. **No `session_id` parameter exists on OpenRouter.** The API reference lists
   no such field; `user` is an abuse-detection identifier only. DeepSeek
   prompt caching is automatic and keyed on the prompt prefix — the
   byte-stable block ordering is what earns cache hits. We send
   `user: business:wa_id` for parity with `_shared/llm.ts`.
2. **No `response_format`.** OpenRouter structured outputs are
   `json_schema`-typed with per-provider support that varies for DeepSeek; a
   rejecting provider would error every call. The contract is prompt-enforced
   and validated server-side with one corrective retry (which the spec
   mandates anyway), then degrades to Gemini with native JSON mime type.
3. **The LLM is not the router.** The spec's tier-0 principle is kept literal:
   the state machine handles acks, flows, FAQ, availability, weather and
   window logic deterministically; v2 owns only the free-text tail. The
   window-closed/`template` branch of the contract is therefore unreachable
   in practice (kept for future outbound reuse).
4. **No Meta WhatsApp Flows exist** — `flow` maps to the existing list/button
   booking state machine.
5. **Mark-as-read on silent is not implemented** (the webhook never marks
   read today; adding it means threading the Meta message id through
   `handleMsg`). Follow-up nicety, not a regression.
6. **Block A examples were de-em-dashed** (PLATFORM_INVARIANTS rule 12) and
   EX2 grounds its departure time in live availability instead of a fixed
   daily time (rule 1: tours have no fixed session times).
7. **Block B is rebuilt per request, not stored.** It's deterministic from
   the tenant row (sorted tours/FAQ keys, no timestamps), so bytes are
   identical across requests — same cache effect as the spec's
   regenerate-on-edit cache without new storage.
8. **Legacy paths keep their trailing "Anything else?" buttons** (surgical
   change); the v2 path drops them per the one-message rule. When `on` proves
   out, the same treatment on the deterministic FAQ/receipt paths is the next
   message-count win.
9. **web-chat and the admin help bot are out of scope** here; they picked up
   Flash/reasoning-off/metering via the same-day `_shared/llm.ts` change and
   can adopt the v2 contract later.

## Coordination note

Two sessions worked this same day: Fix 7 (`llm.ts` Flash default + reasoning
off + `user` key + metering, `web-chat`/`admin-help-chat` param plumbing) and
this v2 build. The duplicate `llm_usage` migrations were consolidated into
`20260803130000_llm_usage.sql` (self-sufficient CREATE + v2 ALTERs; the
table did not yet exist in prod at consolidation time). Byte-diff the working
tree before deploying — both efforts share `wa-webhook/index.ts`.
