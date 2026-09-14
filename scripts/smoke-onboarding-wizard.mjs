#!/usr/bin/env node
// Happy-path smoke test for the onboarding-wizard edge function.
//
// Runs against a real deployment (or `supabase functions serve`), because the
// function is almost entirely database orchestration — the pure logic already
// has unit tests in supabase/functions/_shared/*.test.ts.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon key> \
//   INVITE_TOKEN=<token from super-admin -> Onboarding Invites> \
//   node scripts/smoke-onboarding-wizard.mjs
//
// It walks a real invite through every step and finishes by consuming the
// token, so use a throwaway invite, not a client's.

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const TOKEN = process.env.INVITE_TOKEN || "";
const RUN_COMPLETE = process.env.RUN_COMPLETE === "1";

if (!SUPABASE_URL || !ANON_KEY || !TOKEN) {
  console.error("SUPABASE_URL, SUPABASE_ANON_KEY and INVITE_TOKEN are all required.");
  process.exit(2);
}

let failures = 0;

async function call(action, payload = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-wizard`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ANON_KEY}`,
      "apikey": ANON_KEY,
    },
    body: JSON.stringify({ action, token: TOKEN, ...payload }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

async function main() {
  console.log("validate");
  const v = await call("validate");
  check("token accepted", v.status === 200 && v.body?.valid === true, JSON.stringify(v.body));
  if (v.status !== 200) {
    console.error("Cannot continue without a valid token.");
    process.exit(1);
  }

  console.log("rejects an unknown action");
  const bad = await call("definitely-not-an-action");
  check("unknown action refused", bad.status === 400, `status ${bad.status}`);

  console.log("save-step identity");
  const identity = await call("save-step", {
    step: "identity",
    data: {
      business_name: "Smoke Test Kayaking",
      business_tagline: "Paddle the bay",
      timezone: "Africa/Johannesburg",
      currency: "ZAR",
      subscription_status: "ACTIVE",  // must be ignored by the whitelist
    },
  });
  check("identity saved", identity.status === 200, JSON.stringify(identity.body));
  check(
    "whitelist dropped subscription_status",
    !(identity.body?.saved || []).includes("subscription_status"),
    JSON.stringify(identity.body?.saved),
  );

  console.log("save-step refunds");
  const refunds = await call("save-step", {
    step: "refunds",
    data: {
      refund_policy_tiers: [
        { hours_before: 2, refund_percent: 50 },
        { hours_before: 48, refund_percent: 100 },
      ],
      refund_policy_text: "Full refund up to 48 hours before departure.",
    },
  });
  check("refund tiers saved", refunds.status === 200, JSON.stringify(refunds.body));

  console.log("save-step tours (generates slots)");
  const tours = await call("save-step", {
    step: "tours",
    data: {
      tours: [{
        name: "Smoke Test Sunset Paddle",
        base_price_per_person: 650,
        duration_minutes: 120,
        default_capacity: 8,
        ranges: [{
          start_date: iso(plusDays(1)),
          end_date: iso(plusDays(14)),
          times: ["09:00", "16:00"],
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
        }],
      }],
    },
  });
  check("tour created", tours.status === 200, JSON.stringify(tours.body));
  const created = tours.body?.tours?.[0]?.slots_created ?? 0;
  check("slots generated", created > 0, `slots_created=${created}`);

  console.log("tours rejects invalid input");
  const badTour = await call("save-step", {
    step: "tours",
    data: { tours: [{ name: "No price", base_price_per_person: 0, duration_minutes: 60 }] },
  });
  check("price of 0 refused", badTour.status === 400, `status ${badTour.status}`);

  console.log("prefill-website SSRF guard");
  const ssrf = await call("prefill-website", { url: "http://169.254.169.254/latest/meta-data/" });
  check("cloud metadata refused", ssrf.status === 400, JSON.stringify(ssrf.body));

  console.log("get-state");
  const state = await call("get-state");
  check("state returns business", state.status === 200 && !!state.body?.business, JSON.stringify(state.body?.error));
  check("no encrypted blobs leaked",
    state.body ? !JSON.stringify(state.body).includes("_encrypted") : false);
  check("tours reported with slot counts", (state.body?.tours || []).length > 0);

  console.log("go-live");
  const live = await call("go-live");
  check("go-live succeeded", live.status === 200, JSON.stringify(live.body));
  check("subscription created", live.body?.readiness?.subscription === true);
  check("policies seeded", live.body?.readiness?.policies === true);
  check("tenant now trading", live.body?.readiness?.trading === true);

  console.log("go-live is idempotent");
  const live2 = await call("go-live");
  check("second go-live also succeeds", live2.status === 200, JSON.stringify(live2.body?.error));

  console.log("check-test-booking");
  const booking = await call("check-test-booking");
  check("poll responds", booking.status === 200, JSON.stringify(booking.body));
  console.log(`  (found=${booking.body?.found} — expected false until a real booking is made)`);

  if (RUN_COMPLETE) {
    console.log("complete (consumes the token)");
    const done = await call("complete");
    check("token consumed", done.status === 200, JSON.stringify(done.body));
    const again = await call("complete");
    check("second complete refused", again.status === 401 || again.status === 409, `status ${again.status}`);
  } else {
    console.log("skipping complete (set RUN_COMPLETE=1 to consume the token)");
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke run threw:", err);
  process.exit(1);
});
