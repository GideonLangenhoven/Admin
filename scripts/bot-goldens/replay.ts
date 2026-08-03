// Golden-set replay: old bot config vs v2, against a live tenant's real data.
//
//   OPENROUTER_MODEL=deepseek/deepseek-v4-pro \        # old arm's model
//   OPENROUTER_BOT_MODEL=deepseek/deepseek-v4-flash \  # new arm's model
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   OPENROUTER_API_KEY=... GEMINI_API_KEY=... \        # Gemini for KB query embeddings
//   BUSINESS_ID=<tenant uuid> \
//   deno run -A scripts/bot-goldens/replay.ts [--skip-old]
//
// Old arm = legacy prompt (mirror of wa-webhook buildGeminiInstruction) through
// llmText at reasoning xhigh — the Pro Think Max config. New arm = three-block
// v2 prompt through botReply. Judged on counters (action match, must_contain),
// tone by reading the printed messages. Re-run on every prompt or model change.

import { createClient } from "npm:@supabase/supabase-js@2";
import { llmText } from "../../supabase/functions/_shared/llm.ts";
import { botReply } from "../../supabase/functions/_shared/bot-llm.ts";
import { assembleBotSystem, buildBlockB, buildBlockC } from "../../supabase/functions/_shared/bot-prompt.ts";
import { retrieveKb } from "../../supabase/functions/_shared/kb.ts";
import { PLATFORM_INVARIANTS } from "../../supabase/functions/_shared/platform-invariants.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUSINESS_ID = Deno.env.get("BUSINESS_ID") || "";
const SKIP_OLD = Deno.args.includes("--skip-old");
if (!SUPABASE_URL || !SERVICE_KEY || !BUSINESS_ID) {
  console.error("Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUSINESS_ID");
  Deno.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY);

const goldens = JSON.parse(await Deno.readTextFile(new URL("./goldens.json", import.meta.url))).cases as Array<{
  id: string; input: string; expect_action: string[]; must_contain: string[]; notes: string;
}>;

// ── tenant data (same fields the webhook uses) ──
const { data: biz, error: bizErr } = await db.from("businesses")
  .select("id, name, ai_system_prompt, terminology, faq_json, booking_site_url, timezone")
  .eq("id", BUSINESS_ID).single();
if (bizErr || !biz) { console.error("business load failed", bizErr?.message); Deno.exit(1); }

const { data: tours } = await db.from("tours")
  .select("name, description, base_price_per_person, duration_minutes, hidden, active")
  .eq("business_id", BUSINESS_ID).eq("active", true);
const activeTours = (tours || []).filter((t: any) => !t.hidden && !String(t.name).includes("Private"));

const { data: slots } = await db.rpc("list_available_slots", {
  p_business_id: BUSINESS_ID,
  p_range_start: new Date(Date.now() + 3600e3).toISOString(),
  p_range_end: new Date(Date.now() + 5 * 24 * 3600e3).toISOString(),
  p_tour_id: null,
});
const tz = (biz as any).timezone || "Africa/Johannesburg";
const fmt = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const availabilitySummary = (slots || []).filter((s: any) => Number(s.available_capacity || 0) > 0).slice(0, 6)
  .map((s: any) => fmt(s.start_time) + " " + (s.tour_name || "") + " (" + s.available_capacity + " spots)").join("\n");

// ── legacy prompt (mirror of wa-webhook buildGeminiInstruction; keep in sync by eye) ──
function legacySystem(liveCtx: string): string {
  const faq = biz.faq_json && typeof biz.faq_json === "object"
    ? Object.entries(biz.faq_json).filter(([, v]) => typeof v === "string").map(([k, v]) => "Q: " + k + "\nA: " + v).join("\n") : "";
  const terms = biz.terminology && typeof biz.terminology === "object"
    ? Object.entries(biz.terminology).map(([k, v]) => k + "=" + String(v)).join(", ") : "";
  return [
    PLATFORM_INVARIANTS,
    String(biz.ai_system_prompt || "").trim(),
    "Use the tenant FAQ and terminology below. Keep replies short and factual.",
    terms ? "Terminology: " + terms : "",
    faq ? "FAQ:\n" + faq : "",
    liveCtx ? "Live context:\n" + liveCtx : "",
  ].filter(Boolean).join("\n\n");
}

const blockB = buildBlockB({
  name: biz.name,
  aiPrompt: biz.ai_system_prompt,
  terminology: biz.terminology,
  faqJson: biz.faq_json,
  bookingUrl: (biz as any).booking_site_url || null,
  tours: activeTours.map((t: any) => ({ name: t.name, price: Number(t.base_price_per_person || 0), durationMinutes: Number(t.duration_minutes || 0), description: t.description })),
});

const nowIso = new Date().toISOString();
const nowText = new Date(nowIso).toLocaleString("en-ZA", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dayName = new Date(nowIso).toLocaleString("en-ZA", { timeZone: tz, weekday: "long" });

const looksEscalated = (t: string) => /\b(team|human|agent|connect|get back to you|reach out)\b/i.test(t);

let newActionHits = 0, newContainHits = 0, oldContainHits = 0, newEscalateOk = 0, oldEscalateOk = 0, escalateCases = 0;
let cachedTotal = 0, promptTotal = 0;

for (const g of goldens) {
  console.log("\n════ " + g.id + " ── \"" + g.input + "\" (expect " + g.expect_action.join("|") + ")");
  const kbHits = await retrieveKb(db, BUSINESS_ID, g.input);
  const blockC = buildBlockC({
    nowText, dayName, windowOpen: true, outboundCount24h: 1, returning: false,
    availabilitySummary: availabilitySummary || null, kbHits,
  });
  const system = assembleBotSystem(blockB, blockC);
  const mustEscalate = g.expect_action.length === 1 && g.expect_action[0] === "escalate";
  if (mustEscalate) escalateCases++;

  // new arm
  const r = await botReply({ system, user: g.input, userKey: "goldens:" + g.id, label: "golden-" + g.id });
  if (!r) {
    console.log("  v2: NO VALID JSON (both providers)");
  } else {
    const actionOk = g.expect_action.includes(r.out.action);
    const containOk = g.must_contain.every((m) => (r.out.message || "").toLowerCase().includes(m.toLowerCase()));
    if (actionOk) newActionHits++;
    if (containOk) newContainHits++;
    if (mustEscalate && r.out.action === "escalate") newEscalateOk++;
    cachedTotal += r.usage.cachedTokens; promptTotal += r.usage.promptTokens;
    console.log("  v2 [" + (actionOk ? "action✓" : "action✗ " + r.out.action) + (containOk ? " contain✓" : " contain✗") +
      " grounded:" + r.out.grounded + " cached:" + r.usage.cachedTokens + "/" + r.usage.promptTokens + "]");
    console.log("  v2 msg: " + (r.out.message ? r.out.message.replace(/\n/g, " ⏎ ").slice(0, 240) : "(silent)"));
  }

  // old arm
  if (!SKIP_OLD) {
    const liveCtx = (availabilitySummary ? "Next available:\n" + availabilitySummary + "\n" : "") +
      kbHits.map((h) => "- " + (h.title ? h.title + ": " : "") + h.content).join("\n");
    const oldOut = await llmText({
      system: legacySystem(liveCtx), user: g.input, maxTokens: 200, temperature: 0.7,
      timeoutMs: 60000, reasoning: "xhigh", label: "golden-old-" + g.id,
    });
    if (oldOut) {
      const containOk = g.must_contain.every((m) => oldOut.toLowerCase().includes(m.toLowerCase()));
      if (containOk) oldContainHits++;
      if (mustEscalate && looksEscalated(oldOut)) oldEscalateOk++;
      console.log("  old [" + (containOk ? "contain✓" : "contain✗") + "] msg: " + oldOut.replace(/\n/g, " ⏎ ").slice(0, 240));
    } else {
      console.log("  old: NO REPLY");
    }
  }
}

console.log("\n──── SUMMARY over " + goldens.length + " goldens ────");
console.log("v2 action correctness:  " + newActionHits + "/" + goldens.length);
console.log("v2 must_contain:        " + newContainHits + "/" + goldens.length + (SKIP_OLD ? "" : "   old: " + oldContainHits + "/" + goldens.length));
console.log("escalation recall:      v2 " + newEscalateOk + "/" + escalateCases + (SKIP_OLD ? "" : "   old(heuristic) " + oldEscalateOk + "/" + escalateCases));
console.log("v2 prefix-cache reads:  " + cachedTotal + " of " + promptTotal + " prompt tokens (" + (promptTotal ? Math.round(100 * cachedTotal / promptTotal) : 0) + "%)");
console.log("\nSpot-check the printed messages for tone; counters don't read vibes.");
