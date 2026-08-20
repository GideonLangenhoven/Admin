#!/usr/bin/env node
// BookingTours 5-year operating model. Plain arithmetic, no deps.
//
//   node docs/finance/model.mjs            -> markdown tables to stdout
//   node docs/finance/model.mjs --check    -> run the self-checks only
//
// Every assumption is a named constant in the ASSUMPTIONS block. Change one,
// re-run, and every table moves consistently. Prices marked [v] were verified
// against the vendor's public pricing page on 2026-08-05; [d] came from the
// live production database; [e] is an estimate and is what you should argue
// with first.
//
// Money is ZAR unless the name ends in Usd. Revenue is ex-VAT throughout.

// Hires are gated on TENANT COUNT, not on the calendar: the org grows when the
// book of business can carry it.

import assert from "node:assert";

/* ─────────────────────────── ASSUMPTIONS ─────────────────────────── */

const MONTHS = 60;
const START = { year: 2026, month: 9 }; // Sep 2026 = month 0

// FX: spot was R16.39/USD on 2026-08-05. Plan at a slightly weaker rand and
// depreciate it, since every infrastructure cost is USD-denominated. [e]
const FX_Y1 = 16.5;
const FX_DEPRECIATION = 0.04;

// ── Demand ──
// Honest starting point: 1 contracted tenant (R3 000 invoiced, PAST_DUE). The
// other 12 rows in `businesses` are test tenants. [d]
const START_TENANTS = 1;
const GROSS_ADDS_PER_YEAR = [26, 58, 122, 197, 306]; // [e] founder-led Y1, first AE ~Y2
const CHURN_PER_YEAR = [0.015, 0.015, 0.0125, 0.01, 0.01]; // monthly logo churn [e]
// SA operators buy ahead of the Oct-Apr season and go quiet in winter.
const ADD_SEASONALITY = { 9: 1.3, 10: 1.4, 11: 1.2, 12: 0.6, 1: 0.8, 2: 1.2, 3: 1.2, 4: 1.0, 5: 0.9, 6: 0.8, 7: 0.8, 8: 0.9 };
// Self-service seasonal pause is already built and pro-rates correctly
// (app/lib/platform-billing.ts). Winter-weighted share of tenants paused. [e]
const PAUSE_RATE = { 9: 0.02, 10: 0.02, 11: 0.02, 12: 0.02, 1: 0.02, 2: 0.02, 3: 0.03, 4: 0.05, 5: 0.08, 6: 0.12, 7: 0.14, 8: 0.10 };

// ── Price ──
// Live plan: R2 000/mo incl. 1 seat + R500/mo per extra seat (migration
// 20260716120000). [d] Blended subscription per tenant drifts down as a lower
// tier becomes necessary to reach past ~200 SA operators. [e]
const ARPA_SUBSCRIPTION = [2600, 2550, 2400, 2300, 2250];
// Usage revenue per active tenant per month. Live rates: R0.10/marketing email
// past quota, R0.15/AI reply past 5 000. [d] Adoption ramps. [e]
const ARPA_MARKETING_OVERAGE = [60, 110, 160, 200, 230];
const ARPA_AI_OVERAGE = [15, 30, 45, 60, 75];
// Optional platform fee per paid booking. Off in the base case. `paid_booking_events`
// already meters (business_id, booking_id, period_key), so this is an invoice
// line, not a payment-rails change. Paid bookings/tenant/month: the one real
// tenant runs ~45/30d today. [d]
const BOOKINGS_PER_TENANT = [70, 85, 100, 110, 120]; // [e]

// ── Cost of goods ──
const SUPABASE_PRO_USD = 25;              // [v]
const SUPABASE_TEAM_USD = 599;            // [v] switch when buyers ask for SSO/SOC2
const SUPABASE_TEAM_AT_TENANTS = 250;
const SUPABASE_COMPUTE_CREDIT_USD = 10;   // [v]
const SUPABASE_STORAGE_USD_GB = 0.125;    // [v] past 8 GB
const SUPABASE_EGRESS_USD_GB = 0.09;      // [v] past 250 GB
const SUPABASE_INVOCATIONS_USD_M = 2;     // [v] past 2M
const VERCEL_SEAT_USD = 20;               // [v]
const VERCEL_BANDWIDTH_USD_GB = 0.15;     // [v] past 1 TB
const VERCEL_INVOCATIONS_USD_M = 0.60;    // [v] past 1M
const VERCEL_EDGE_REQ_USD_M = 2;          // [v] past 10M
const VERCEL_CPU_USD_HR = 0.128;          // [v]
const VERCEL_INCLUDED_CREDIT_USD = 20;    // [v]
// Resend transactional tiers [v]: [emails included, $/mo]. Contacts live in our
// own Postgres and sends go through /emails/batch, so no Audiences plan. [d]
const RESEND_TIERS = [[3_000, 0], [50_000, 20], [100_000, 35], [200_000, 160], [500_000, 350], [1_000_000, 650], [1_500_000, 825], [2_500_000, 1150]];
// deepseek/deepseek-v4-pro on OpenRouter: $0.435/M in, $0.87/M out. [v]
// Live llm_usage averages 1 783 prompt tokens per web-faq reply [d]; budget
// 2 000 in / 600 out to cover reasoning tokens at the configured effort. [e]
const LLM_IN_USD_M = 0.435, LLM_OUT_USD_M = 0.87;
const LLM_TOKENS_IN = 2000, LLM_TOKENS_OUT = 600;
const LLM_OVERHEAD = 1.10; // Gemini embeddings + micro-classifiers [e]

// Per-tenant monthly infrastructure draw. [e] Re-derive from telemetry once
// 20+ real tenants are live; these are the softest numbers in the model.
const PER_TENANT = {
  supabaseStorageGb: 0.12, supabaseEgressGb: 2.0, supabaseInvocations: 15_000,
  vercelBandwidthGb: 8, vercelInvocations: 40_000, vercelEdgeRequests: 60_000, vercelCpuHours: 0.35,
};
const PLATFORM_FIXED = { supabaseInvocations: 120_000, vercelInvocations: 200_000, vercelEdgeRequests: 500_000, vercelCpuHours: 20 };
const EMAILS_PER_TENANT = [350, 500, 650, 800, 900];        // [e]
const AI_REPLIES_PER_TENANT = [400, 600, 800, 1000, 1200];  // [e]
// Yoco takes ~2.95% on the platform's OWN subscription collections; operators'
// card fees sit on their own Yoco accounts (businesses.yoco_secret_key). [d]
const PSP_RATE = 0.0295, PSP_CARD_SHARE = 0.70;
const SENTRY_USD = [26, 26, 80, 200, 300]; // [e]

// ── People ──
// `at` is the tenant count that triggers the hire. Gross annual ZAR at that
// point, inflated 6%/yr from month 0. Benchmarks: junior R270-400k, mid
// R350-490k, senior R600k-1m (SA, 2026).
const SALARY_INFLATION = 0.06;
const EMPLOYER_LOADING = 0.15; // UIF + SDL + benefits
const HIRES = [
  { at: 0, role: "Founder / CEO (product + sales)", zar: 540_000, fn: "G&A" },
  { at: 18, role: "Onboarding & Support Specialist", zar: 300_000, fn: "CS" },
  { at: 40, role: "Full-stack Engineer (mid)", zar: 620_000, fn: "ENG" },
  { at: 80, role: "Senior Full-stack Engineer", zar: 900_000, fn: "ENG" },
  { at: 110, role: "Support Specialist #2", zar: 300_000, fn: "CS" },
  { at: 140, role: "Account Executive #1", zar: 480_000, fn: "S&M" },
  { at: 180, role: "Platform / Backend Engineer", zar: 850_000, fn: "ENG" },
  { at: 230, role: "Finance & Ops Manager", zar: 480_000, fn: "G&A" },
  { at: 280, role: "Engineering Lead", zar: 1_150_000, fn: "ENG" },
  { at: 330, role: "Frontend Engineer", zar: 700_000, fn: "ENG" },
  { at: 380, role: "Marketing Manager", zar: 620_000, fn: "S&M" },
  { at: 430, role: "Support Specialist #3", zar: 320_000, fn: "CS" },
  { at: 500, role: "Account Executive #2", zar: 500_000, fn: "S&M" },
  { at: 560, role: "Support Specialist #4", zar: 320_000, fn: "CS" },
];
const COMMISSION_RATE = 0.08; // of first-year subscription value, AE-sourced half of adds [e]

// ── Other operating expense ──
// Programme spend only (ads, events, content, referral fees); sales payroll is
// separate and both are combined into the loaded CAC reported below. [e]
const PROGRAMME_CAC = [4500, 5000, 5500, 6000, 6500];
const TOOLS_PER_HEAD_MONTH = 1200;                                   // [e]
const OFFICE_MONTH = [0, 0, 15_000, 25_000, 35_000];                 // [e] remote until Y3
const PROFESSIONAL_MONTH = [8_000, 14_000, 25_000, 38_000, 52_000];  // [e] accounting, legal, insurance
const SECURITY_ANNUAL = [0, 60_000, 140_000, 200_000, 260_000];      // [e] pen test, cyber cover, POPIA
const CONTRACTORS_MONTH = [12_000, 18_000, 22_000, 25_000, 28_000];  // [e] design, content, specialist

const VAT_THRESHOLD = 1_000_000; // compulsory SA VAT registration, trailing 12 months

/* ─────────────────────────── ENGINE ─────────────────────────── */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const calMonth = (m) => ((START.month - 1 + m) % 12) + 1;
const calYear = (m) => START.year + Math.floor((START.month - 1 + m) / 12);
const yearOf = (m) => Math.floor(m / 12);
const fx = (m) => FX_Y1 * (1 + FX_DEPRECIATION) ** yearOf(m);
const label = (m) => `${MONTH_NAMES[calMonth(m) - 1]} ${calYear(m)}`;

const seasonWeights = (() => {
  const raw = Object.values(ADD_SEASONALITY);
  const mean = raw.reduce((a, b) => a + b) / raw.length;
  return Object.fromEntries(Object.entries(ADD_SEASONALITY).map(([k, v]) => [k, v / mean]));
})();

function resendCost(emails) {
  for (const [included, usd] of RESEND_TIERS) if (emails <= included) return usd;
  const [top, usd] = RESEND_TIERS.at(-1);
  return usd + Math.ceil((emails - top) / 1000) * 0.46; // past the published table [e]
}

function supabaseBaseUsd(tenants) {
  const plan = tenants >= SUPABASE_TEAM_AT_TENANTS ? SUPABASE_TEAM_USD : SUPABASE_PRO_USD;
  const compute = tenants < 30 ? 10 : tenants < 100 ? 15 : tenants < 250 ? 60 : tenants < 450 ? 110 : 210;
  const replica = tenants >= 450 ? 210 : 0; // read replica for reporting load [e]
  return plan + compute + replica - SUPABASE_COMPUTE_CREDIT_USD;
}

function run({ growth = 1, arpa = 1, bookingFee = 0 } = {}) {
  let tenants = START_TENANTS;
  let cash = 0, minCash = 0, minCashMonth = 0;
  const hiredAt = new Map(); // hire -> month index
  const months = [];

  for (let m = 0; m < MONTHS; m++) {
    const y = yearOf(m);
    const rate = fx(m);

    // ── demand ──
    const grossAdds = (GROSS_ADDS_PER_YEAR[y] / 12) * seasonWeights[calMonth(m)] * growth;
    const churned = tenants * CHURN_PER_YEAR[y];
    tenants = Math.max(0, tenants + grossAdds - churned);
    const billable = tenants * (1 - PAUSE_RATE[calMonth(m)]);

    // ── people: every hire fires the first month the tenant gate is crossed ──
    for (const h of HIRES) if (!hiredAt.has(h) && tenants >= h.at) hiredAt.set(h, m);
    const staff = [...hiredAt.entries()].filter(([, hm]) => hm <= m);
    const payrollByFn = { ENG: 0, CS: 0, "S&M": 0, "G&A": 0 };
    for (const [h] of staff) {
      const monthly = (h.zar * (1 + SALARY_INFLATION) ** yearOf(m) / 12) * (1 + EMPLOYER_LOADING);
      payrollByFn[h.fn] += monthly;
    }
    const payroll = Object.values(payrollByFn).reduce((a, b) => a + b, 0);
    const headcount = staff.length;
    const hasAE = staff.some(([h]) => h.fn === "S&M" && h.role.startsWith("Account"));

    // ── revenue (ex-VAT) ──
    const subscription = billable * ARPA_SUBSCRIPTION[y] * arpa;
    const marketingRev = billable * ARPA_MARKETING_OVERAGE[y] * arpa;
    const aiRev = billable * ARPA_AI_OVERAGE[y] * arpa;
    const bookingRev = billable * BOOKINGS_PER_TENANT[y] * bookingFee;
    const revenue = subscription + marketingRev + aiRev + bookingRev;
    const commission = hasAE ? grossAdds * ARPA_SUBSCRIPTION[y] * arpa * 12 * COMMISSION_RATE * 0.5 : 0;

    // ── cost of goods ──
    const emails = tenants * EMAILS_PER_TENANT[y];
    const replies = tenants * AI_REPLIES_PER_TENANT[y];

    const sbStorage = Math.max(0, tenants * PER_TENANT.supabaseStorageGb - 8) * SUPABASE_STORAGE_USD_GB;
    const sbEgress = Math.max(0, tenants * PER_TENANT.supabaseEgressGb - 250) * SUPABASE_EGRESS_USD_GB;
    const sbInvoc = Math.max(0, tenants * PER_TENANT.supabaseInvocations + PLATFORM_FIXED.supabaseInvocations - 2e6) / 1e6 * SUPABASE_INVOCATIONS_USD_M;
    const supabaseUsd = supabaseBaseUsd(tenants) + sbStorage + sbEgress + sbInvoc;

    const engSeats = staff.filter(([h]) => h.fn === "ENG" || h.fn === "G&A").length;
    const vcBandwidth = Math.max(0, tenants * PER_TENANT.vercelBandwidthGb - 1024) * VERCEL_BANDWIDTH_USD_GB;
    const vcInvoc = Math.max(0, tenants * PER_TENANT.vercelInvocations + PLATFORM_FIXED.vercelInvocations - 1e6) / 1e6 * VERCEL_INVOCATIONS_USD_M;
    const vcEdge = Math.max(0, tenants * PER_TENANT.vercelEdgeRequests + PLATFORM_FIXED.vercelEdgeRequests - 1e7) / 1e6 * VERCEL_EDGE_REQ_USD_M;
    const vcCpu = (tenants * PER_TENANT.vercelCpuHours + PLATFORM_FIXED.vercelCpuHours) * VERCEL_CPU_USD_HR;
    const vercelUsd = engSeats * VERCEL_SEAT_USD + Math.max(0, vcBandwidth + vcInvoc + vcEdge + vcCpu - VERCEL_INCLUDED_CREDIT_USD);

    const llmUsd = replies * ((LLM_TOKENS_IN * LLM_IN_USD_M + LLM_TOKENS_OUT * LLM_OUT_USD_M) / 1e6) * LLM_OVERHEAD;
    const emailUsd = resendCost(emails);

    const cogsUsd = supabaseUsd + vercelUsd + llmUsd + emailUsd + SENTRY_USD[y];
    const psp = revenue * PSP_RATE * PSP_CARD_SHARE;
    const cogs = cogsUsd * rate + psp;

    // ── operating expense ──
    const marketing = grossAdds * PROGRAMME_CAC[y];
    const opexOther = marketing + headcount * TOOLS_PER_HEAD_MONTH + OFFICE_MONTH[y]
      + PROFESSIONAL_MONTH[y] + SECURITY_ANNUAL[y] / 12 + CONTRACTORS_MONTH[y];
    const opex = payroll + commission + opexOther;

    const grossProfit = revenue - cogs;
    const ebitda = grossProfit - opex;
    cash += ebitda;
    if (cash < minCash) { minCash = cash; minCashMonth = m; }

    months.push({
      m, label: label(m), y, tenants, billable, grossAdds, churned,
      revenue, subscription, marketingRev, aiRev, bookingRev,
      cogs, supabaseUsd, vercelUsd, llmUsd, emailUsd, psp, grossProfit,
      payroll, payrollByFn, commission, marketing, opexOther, opex, ebitda, cash, headcount, emails, replies,
    });
  }
  return { months, minCash, minCashMonth, hiredAt };
}

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const zar = (n) => (Math.abs(n) >= 1e6 ? `R${(n / 1e6).toFixed(2)}m` : `R${Math.round(n).toLocaleString("en-ZA").replace(/,/g, " ")}`);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

/* ─────────────────────────── SELF-CHECKS ─────────────────────────── */

function selfCheck() {
  const { months, minCash } = run();
  for (const r of months) {
    assert(r.tenants >= 0, "tenant count went negative");
    assert(r.billable <= r.tenants, "billable exceeds total tenants");
    assert(Math.abs(r.revenue - (r.subscription + r.marketingRev + r.aiRev + r.bookingRev)) < 1e-6, "revenue components do not sum");
    assert(Math.abs(r.ebitda - (r.revenue - r.cogs - r.opex)) < 1e-6, "EBITDA does not reconcile");
    assert(Math.abs(r.payroll - Object.values(r.payrollByFn).reduce((a, b) => a + b, 0)) < 1e-6, "payroll split does not sum");
  }
  assert(Math.abs(months.at(-1).cash - sum(months, "ebitda")) < 1e-6, "cash is not cumulative EBITDA");
  assert(Math.abs(sum(months.slice(0, 12), "grossAdds") - GROSS_ADDS_PER_YEAR[0]) < 0.01, "seasonality distorted annual adds");
  assert(resendCost(2_000) === 0 && resendCost(60_000) === 35 && resendCost(300_000) === 350, "resend tier lookup wrong");
  // Headcount must be monotonic: hires are gated on tenants, which only fall slowly.
  for (let i = 1; i < months.length; i++) assert(months[i].headcount >= months[i - 1].headcount, "headcount went backwards");
  // A tenant must cost far less to serve than it pays, or the plan is broken.
  const late = months.at(-1);
  assert(late.cogs / late.revenue < 0.15, "gross margin fell below 85% at scale");
  // The booking-fee lever must actually add revenue and never reduce it.
  const withFee = run({ bookingFee: 7 });
  assert(sum(withFee.months, "revenue") > sum(months, "revenue") * 1.2, "booking fee lever had no material effect");
  assert(minCash <= 0, "no funding trough at all, check the ramp");
  console.log("self-checks passed");
}

/* ─────────────────────────── OUTPUT ─────────────────────────── */

function annual(months) {
  return [0, 1, 2, 3, 4].map((y) => {
    const rows = months.slice(y * 12, y * 12 + 12);
    const end = rows.at(-1);
    const revenue = sum(rows, "revenue"), cogs = sum(rows, "cogs");
    const payroll = sum(rows, "payroll") + sum(rows, "commission"), other = sum(rows, "opexOther");
    return {
      y: y + 1, span: `${rows[0].label} - ${end.label}`, endTenants: end.tenants, avgTenants: sum(rows, "tenants") / 12,
      endMrr: end.revenue, arr: end.revenue * 12, revenue, cogs, gross: revenue - cogs, gm: (revenue - cogs) / revenue,
      payroll, other, ebitda: revenue - cogs - payroll - other, headcount: end.headcount, cash: end.cash, rows,
    };
  });
}

function pnl(title, months) {
  const a = annual(months);
  console.log(`### ${title}\n`);
  console.log(`| | Y1 | Y2 | Y3 | Y4 | Y5 |`);
  console.log(`|---|---|---|---|---|---|`);
  const row = (name, f) => console.log(`| ${name} | ${a.map(f).join(" | ")} |`);
  row("Period", (x) => x.span);
  row("Tenants (end)", (x) => Math.round(x.endTenants));
  row("Exit ARR", (x) => zar(x.arr));
  row("**Revenue**", (x) => `**${zar(x.revenue)}**`);
  row("Cost of goods", (x) => zar(-x.cogs));
  row("Gross margin", (x) => pct(x.gm));
  row("Payroll + commission", (x) => zar(-x.payroll));
  row("Other opex", (x) => zar(-x.other));
  row("**EBITDA**", (x) => `**${zar(x.ebitda)}**`);
  row("EBITDA margin", (x) => pct(x.ebitda / x.revenue));
  row("Headcount (end)", (x) => x.headcount);
  row("Cumulative cash", (x) => zar(x.cash));
  console.log();
}

function milestones(name, res) {
  const { months } = res;
  const sustained = months.find((r) => r.ebitda > 0 && months.slice(r.m, r.m + 4).every((x) => x.ebitda > 0));
  const cashPos = months.find((r) => r.m > 6 && r.cash > 0);
  return { name, minCash: res.minCash, minCashMonth: res.minCashMonth, sustained, cashPos, months };
}

function main() {
  const base = run();
  const fee = run({ bookingFee: 7 });
  const { months } = base;

  console.log(`## 1. Base case: current pricing exactly as coded\n`);
  pnl("R2 000/mo + R500/seat + usage overage, no booking fee", months);

  console.log(`## 2. With a R7 platform fee per paid booking\n`);
  pnl("Same tenant curve, same team, one extra invoice line", fee.months);

  console.log(`## 3. Cost of goods sold by line (annual ZAR, base case)\n`);
  console.log(`| Line | Y1 | Y2 | Y3 | Y4 | Y5 | Driver |`);
  console.log(`|---|---|---|---|---|---|---|`);
  const cogsLine = (name, key, driver, isZar = false) => {
    const vals = [0, 1, 2, 3, 4].map((y) => zar(months.slice(y * 12, y * 12 + 12).reduce((a, r) => a + r[key] * (isZar ? 1 : fx(r.m)), 0)));
    console.log(`| ${name} | ${vals.join(" | ")} | ${driver} |`);
  };
  cogsLine("Supabase", "supabaseUsd", "plan + compute + storage/egress/invocations");
  cogsLine("Vercel", "vercelUsd", "seats + bandwidth + function CPU");
  cogsLine("LLM (OpenRouter + Gemini)", "llmUsd", "AI replies x tokens");
  cogsLine("Email (Resend)", "emailUsd", "transactional + marketing volume tier");
  cogsLine("Payment fees, own billing", "psp", "2.95% on card-paid subscriptions", true);
  const totalCogs = [0, 1, 2, 3, 4].map((y) => zar(sum(months.slice(y * 12, y * 12 + 12), "cogs")));
  console.log(`| **Total** | ${totalCogs.join(" | ")} | |`);

  console.log(`\n## 4. Unit economics per tenant per month (base case)\n`);
  const unit = [0, 1, 2, 3, 4].map((y) => {
    const rows = months.slice(y * 12, y * 12 + 12);
    const t = sum(rows, "tenants") / 12;
    const rev = sum(rows, "revenue") / 12 / t, cost = sum(rows, "cogs") / 12 / t;
    const smPayroll = rows.reduce((a, r) => a + r.payrollByFn["S&M"], 0);
    const loadedCac = (sum(rows, "marketing") + smPayroll + sum(rows, "commission")) / sum(rows, "grossAdds");
    const gross = rev - cost;
    return { rev, cost, gross, loadedCac, payback: loadedCac / gross, ltv: gross / CHURN_PER_YEAR[y], months: 1 / CHURN_PER_YEAR[y] };
  });
  console.log(`| | Y1 | Y2 | Y3 | Y4 | Y5 |`);
  console.log(`|---|---|---|---|---|---|`);
  const urow = (name, f) => console.log(`| ${name} | ${unit.map(f).join(" | ")} |`);
  urow("Revenue / tenant", (u) => zar(u.rev));
  urow("Cost to serve / tenant", (u) => zar(u.cost));
  urow("Gross profit / tenant", (u) => zar(u.gross));
  urow("Implied tenant lifetime (months)", (u) => Math.round(u.months));
  urow("Fully-loaded CAC", (u) => zar(u.loadedCac));
  urow("CAC payback (months)", (u) => u.payback.toFixed(1));
  urow("LTV (gross profit)", (u) => zar(u.ltv));
  urow("LTV / CAC", (u) => (u.ltv / u.loadedCac).toFixed(1) + "x");

  console.log(`\n## 5. Cash and milestones\n`);
  console.log(`| | Base | + R7 booking fee |`);
  console.log(`|---|---|---|`);
  const b = milestones("base", base), f = milestones("fee", fee);
  const fmt = (x, k) => (x[k] ? `${x[k].label} (${Math.round(x[k].tenants)} tenants)` : "beyond Y5");
  console.log(`| Deepest cash position | ${zar(b.minCash)} (${months[b.minCashMonth].label}) | ${zar(f.minCash)} (${fee.months[f.minCashMonth].label}) |`);
  console.log(`| Sustained positive EBITDA from | ${fmt(b, "sustained")} | ${fmt(f, "sustained")} |`);
  console.log(`| Cumulative cash back above zero | ${fmt(b, "cashPos")} | ${fmt(f, "cashPos")} |`);
  console.log(`| Y5 exit ARR | ${zar(months.at(-1).revenue * 12)} | ${zar(fee.months.at(-1).revenue * 12)} |`);
  let vatMonth = null;
  months.forEach((r, i) => {
    if (!vatMonth && months.slice(Math.max(0, i - 11), i + 1).reduce((a, x) => a + x.revenue, 0) > VAT_THRESHOLD) vatMonth = r;
  });
  console.log(`\nTrailing-12-month turnover crosses the R1m compulsory VAT registration threshold in **${vatMonth ? vatMonth.label : "-"}** (~${vatMonth ? Math.round(vatMonth.tenants) : "-"} tenants). The platform invoice generator has no VAT line today.`);

  console.log(`\n## 6. Year 1 month by month (base case)\n`);
  console.log(`| Month | Tenants | MRR | COGS | Payroll | Other opex | EBITDA | Cum. cash | Heads |`);
  console.log(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of months.slice(0, 12))
    console.log(`| ${r.label} | ${r.tenants.toFixed(1)} | ${zar(r.revenue)} | ${zar(r.cogs)} | ${zar(r.payroll + r.commission)} | ${zar(r.opexOther)} | ${zar(r.ebitda)} | ${zar(r.cash)} | ${r.headcount} |`);

  console.log(`\n## 7. Scenarios\n`);
  console.log(`| Scenario | Y5 tenants | Y5 revenue | Y5 EBITDA | Deepest cash | Sustained profit from |`);
  console.log(`|---|---|---|---|---|---|`);
  const scenarios = [
    ["Conservative: growth x0.6, ARPA -10%", { growth: 0.6, arpa: 0.9 }],
    ["Conservative + R7 booking fee", { growth: 0.6, arpa: 0.9, bookingFee: 7 }],
    ["Base: current pricing", {}],
    ["Base + R7 booking fee", { bookingFee: 7 }],
    ["Base + R12 booking fee", { bookingFee: 12 }],
    ["Aggressive: growth x1.4 + R7 fee", { growth: 1.4, bookingFee: 7 }],
  ];
  for (const [name, opts] of scenarios) {
    const s = run(opts), y5 = s.months.slice(48);
    const eb = sum(y5, "revenue") - sum(y5, "cogs") - sum(y5, "payroll") - sum(y5, "commission") - sum(y5, "opexOther");
    const be = s.months.find((r) => r.ebitda > 0 && s.months.slice(r.m, r.m + 4).every((x) => x.ebitda > 0));
    console.log(`| ${name} | ${Math.round(s.months.at(-1).tenants)} | ${zar(sum(y5, "revenue"))} | ${zar(eb)} | ${zar(s.minCash)} | ${be ? be.label : "beyond Y5"} |`);
  }

  console.log(`\n## 8. Hiring schedule (gated on tenant count, not the calendar)\n`);
  console.log(`| Trigger | Role | Function | Gross ZAR/yr | Loaded (+${pct(EMPLOYER_LOADING)}) | Base case date | With booking fee |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const h of HIRES) {
    const bm = base.hiredAt.get(h), fm = fee.hiredAt.get(h);
    console.log(`| ${h.at === 0 ? "day one" : `${h.at} tenants`} | ${h.role} | ${h.fn} | ${zar(h.zar)} | ${zar(h.zar * (1 + EMPLOYER_LOADING))} | ${bm === undefined ? "beyond Y5" : label(bm)} | ${fm === undefined ? "beyond Y5" : label(fm)} |`);
  }
  const endHeads = months.at(-1).headcount;
  console.log(`\nEnding headcount ${endHeads} against ${Math.round(months.at(-1).tenants)} tenants = ${Math.round(months.at(-1).tenants / endHeads)} tenants per employee.`);
}

if (process.argv.includes("--check")) selfCheck();
else { selfCheck(); console.log(); main(); }
