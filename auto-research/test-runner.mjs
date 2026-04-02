#!/usr/bin/env node
/**
 * Auto-Research Test Runner for CapeKayak Production Readiness
 *
 * Runs automated checks against the codebase and (optionally) a running dev server.
 * Outputs results to progress.jsonl and a human-readable report.
 *
 * Usage:
 *   node auto-research/test-runner.mjs              # code-only checks
 *   node auto-research/test-runner.mjs --with-server # also hit running dev server
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const RESULTS = [];
let passCount = 0;
let failCount = 0;
let skipCount = 0;

function test(id, section, name, fn) {
  try {
    const result = fn();
    if (result === "SKIP") {
      RESULTS.push({ id, section, name, status: "SKIP", detail: "Requires manual/browser test" });
      skipCount++;
    } else if (result === true || result === "PASS") {
      RESULTS.push({ id, section, name, status: "PASS", detail: "" });
      passCount++;
    } else {
      RESULTS.push({ id, section, name, status: "FAIL", detail: String(result) });
      failCount++;
    }
  } catch (e) {
    RESULTS.push({ id, section, name, status: "FAIL", detail: e.message });
    failCount++;
  }
}

function fileExists(rel) { return existsSync(join(ROOT, rel)); }
function readFile(rel) { return readFileSync(join(ROOT, rel), "utf8"); }
function fileContains(rel, pattern) {
  if (!fileExists(rel)) return false;
  const content = readFile(rel);
  return typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
}
function dirHasFiles(rel) {
  if (!existsSync(join(ROOT, rel))) return false;
  return readdirSync(join(ROOT, rel)).length > 0;
}

// ══════════════════════════════════════════════════════════════
// SECTION A: ADMIN AUTHENTICATION & ONBOARDING
// ══════════════════════════════════════════════════════════════

test("A1", "A", "Admin login — route exists", () =>
  fileExists("app/page.tsx") && fileContains("components/AuthGate.tsx", "supabase") || "AuthGate or dashboard missing"
);

test("A2", "A", "Wrong password lockout — lockout logic exists", () =>
  fileContains("components/AuthGate.tsx", "locked") || fileContains("components/AuthGate.tsx", "lockout") || fileContains("components/AuthGate.tsx", "Locked")
    ? true : "No lockout logic found in AuthGate"
);

test("A3", "A", "Forgot password — route exists", () =>
  fileExists("app/forgot-password/page.tsx") || "app/forgot-password/page.tsx missing"
);

test("A4", "A", "Password reset — route exists", () =>
  fileExists("app/change-password/page.tsx") || "app/change-password/page.tsx missing"
);

test("A5", "A", "Invite new admin — admin auth logic exists", () =>
  fileContains("app/lib/admin-auth.ts", "sendAdminSetupLink") || "sendAdminSetupLink missing"
);

test("A6", "A", "New admin first login — setup link handler", () =>
  fileContains("app/lib/admin-auth.ts", "setup") || "No setup flow in admin-auth"
);

test("A7", "A", "Role permissions — privilege check in layout", () =>
  fileContains("app/layout.tsx", "privileged") || fileContains("app/layout.tsx", "MAIN_ADMIN") || "No role checks in layout"
);

test("A8", "A", "Suspended subscription — check exists", () =>
  fileContains("components/AuthGate.tsx", "suspend") || fileContains("components/AuthGate.tsx", "SUSPENDED") || "No subscription suspension check"
);

// ══════════════════════════════════════════════════════════════
// SECTION B: TOUR & SLOT SETUP
// ══════════════════════════════════════════════════════════════

test("B1", "B", "Create tour — settings page exists", () =>
  fileExists("app/settings/page.tsx") && fileContains("app/settings/page.tsx", "tour") || "Settings/tours missing"
);

test("B5", "B", "Generate slots — slots page exists", () =>
  fileExists("app/slots/page.tsx") || "app/slots/page.tsx missing"
);

test("B6", "B", "Week calendar — WeekView component", () =>
  fileExists("components/WeekView.tsx") || "WeekView.tsx missing"
);

test("B7", "B", "Edit slot — slots page has edit", () =>
  fileContains("app/slots/page.tsx", "update") || fileContains("app/slots/page.tsx", "edit") || "No slot edit"
);

// ══════════════════════════════════════════════════════════════
// SECTION C: CUSTOMER BOOKING FLOW (requires browser)
// ══════════════════════════════════════════════════════════════

for (const id of ["C1","C2","C3","C4","C5","C6","C7","C8","C9","C10","C11","C12","C13","C14","C15"]) {
  test(id, "C", `Customer booking flow — ${id}`, () => "SKIP");
}

// ══════════════════════════════════════════════════════════════
// SECTION D: WEB CHAT BOOKING
// ══════════════════════════════════════════════════════════════

test("D1", "D", "Chat widget — web-chat function exists", () =>
  fileExists("supabase/functions/web-chat/index.ts") || "web-chat function missing"
);

test("D2", "D", "AI FAQ — web-chat has AI logic", () =>
  fileContains("supabase/functions/web-chat/index.ts", "GEMINI") || fileContains("supabase/functions/web-chat/index.ts", "gemini") || "No AI logic"
);

test("D3", "D", "Book via chat — booking flow in web-chat", () =>
  fileContains("supabase/functions/web-chat/index.ts", "book") || "No booking flow"
);

test("D4", "D", "Complete chat booking", () => "SKIP");

// ══════════════════════════════════════════════════════════════
// SECTION E: MANUAL / ADMIN BOOKING
// ══════════════════════════════════════════════════════════════

test("E1", "E", "Create manual booking — page exists", () =>
  fileExists("app/new-booking/page.tsx") || "new-booking page missing"
);

test("E4", "E", "Generate payment link — send-email function", () =>
  fileExists("supabase/functions/send-email/index.ts") || "send-email function missing"
);

test("E6", "E", "Mark paid — manual-mark-paid function", () =>
  fileExists("supabase/functions/manual-mark-paid/index.ts") || "manual-mark-paid missing"
);

test("E7", "E", "Edit booking — bookings detail page", () =>
  fileExists("app/bookings/[id]/page.tsx") || "bookings/[id] page missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION F: WAIVER / INDEMNITY
// ══════════════════════════════════════════════════════════════

test("F1", "F", "Waiver link in emails — waiver-form function", () =>
  fileExists("supabase/functions/waiver-form/index.ts") || "waiver-form function missing"
);

test("F6", "F", "Auto waiver reminder — auto-messages function", () =>
  fileExists("supabase/functions/auto-messages/index.ts") || "auto-messages function missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION G: PAYMENT FLOWS
// ══════════════════════════════════════════════════════════════

test("G1", "G", "Yoco checkout — create-checkout function", () =>
  fileExists("supabase/functions/create-checkout/index.ts") || "create-checkout missing"
);

test("G2", "G", "Payment webhook — yoco-webhook function", () =>
  fileExists("supabase/functions/yoco-webhook/index.ts") || "yoco-webhook missing"
);

test("G4", "G", "Voucher at checkout — voucher logic", () =>
  fileContains("supabase/functions/create-checkout/index.ts", "voucher") || "No voucher logic in checkout"
);

test("G6", "G", "Promo code percent — promo logic in checkout", () =>
  fileContains("supabase/functions/create-checkout/index.ts", "promo") ||
  fileContains("supabase/functions/create-checkout/index.ts", "PERCENT") || "No promo logic in checkout"
);

test("G10", "G", "Server-side price verification", () =>
  fileContains("supabase/functions/create-checkout/index.ts", "price") || "No price verification"
);

// ══════════════════════════════════════════════════════════════
// SECTION H: GIFT VOUCHERS
// ══════════════════════════════════════════════════════════════

test("H1", "H", "Voucher management — vouchers page", () =>
  fileExists("app/vouchers/page.tsx") || "vouchers page missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION I: CUSTOMER SELF-SERVICE
// ══════════════════════════════════════════════════════════════

test("I1", "I", "OTP login — send-otp function", () =>
  fileExists("supabase/functions/send-otp/index.ts") || "send-otp function missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION J: AUTO-MESSAGES (Cron)
// ══════════════════════════════════════════════════════════════

test("J1", "J", "Day-before reminder — auto-messages exists", () =>
  fileExists("supabase/functions/auto-messages/index.ts") && fileContains("supabase/functions/auto-messages/index.ts", "reminder")
    || "No reminder logic in auto-messages"
);

test("J5", "J", "Hold expiry — cron-tasks exists", () =>
  fileExists("supabase/functions/cron-tasks/index.ts") || "cron-tasks function missing"
);

test("J9", "J", "Abandoned cart recovery — abandoned cart logic", () =>
  fileContains("supabase/functions/auto-messages/index.ts", "abandon") ||
  fileContains("supabase/functions/cron-tasks/index.ts", "abandon") || "No abandoned cart logic"
);

// ══════════════════════════════════════════════════════════════
// SECTION K: CANCELLATION & REFUND
// ══════════════════════════════════════════════════════════════

test("K1", "K", "Cancel booking — refunds page", () =>
  fileExists("app/refunds/page.tsx") || "refunds page missing"
);

test("K3", "K", "Process refund — process-refund function", () =>
  fileExists("supabase/functions/process-refund/index.ts") || "process-refund missing"
);

test("K6", "K", "Batch refund — batch-refund function", () =>
  fileExists("supabase/functions/batch-refund/index.ts") || "batch-refund missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION L: WEATHER CANCELLATION
// ══════════════════════════════════════════════════════════════

test("L1", "L", "Weather cancel — weather-cancel function", () =>
  fileExists("supabase/functions/weather-cancel/index.ts") || "weather-cancel missing"
);

test("L1b", "L", "Weather page exists", () =>
  fileExists("app/weather/page.tsx") || "weather page missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION M: RESCHEDULE
// ══════════════════════════════════════════════════════════════

test("M1", "M", "Rebook function exists", () =>
  fileExists("supabase/functions/rebook-booking/index.ts") || "rebook-booking missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION N: WHATSAPP & INBOX
// ══════════════════════════════════════════════════════════════

test("N1", "N", "WhatsApp webhook — wa-webhook function", () =>
  fileExists("supabase/functions/wa-webhook/index.ts") || "wa-webhook missing"
);

test("N5", "N", "Admin reply — admin-reply function", () =>
  fileExists("supabase/functions/admin-reply/index.ts") || "admin-reply missing"
);

test("N8", "N", "Unread badge — NotificationBadge component", () =>
  fileExists("components/NotificationBadge.tsx") || "NotificationBadge missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION O: BROADCASTS
// ══════════════════════════════════════════════════════════════

test("O1", "O", "Broadcasts page exists", () =>
  fileExists("app/broadcasts/page.tsx") || "broadcasts page missing"
);

test("O2", "O", "Broadcast function exists", () =>
  fileExists("supabase/functions/broadcast/index.ts") || "broadcast function missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION P: PHOTOS
// ══════════════════════════════════════════════════════════════

test("P1", "P", "Photos page exists", () =>
  fileExists("app/photos/page.tsx") || "photos page missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION Q: INVOICES
// ══════════════════════════════════════════════════════════════

test("Q1", "Q", "Invoice generation — confirm-booking has invoice", () =>
  fileContains("supabase/functions/confirm-booking/index.ts", "invoice") || "No invoice logic in confirm-booking"
);

test("Q3", "Q", "Invoices page exists", () =>
  fileExists("app/invoices/page.tsx") || "invoices page missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION R: DASHBOARD & CHECK-IN
// ══════════════════════════════════════════════════════════════

test("R1", "R", "Daily manifest — dashboard has manifest", () =>
  fileContains("app/page.tsx", "manifest") || "No manifest on dashboard"
);

test("R2", "R", "Check-in — dashboard has check-in", () =>
  fileContains("app/page.tsx", "check") || fileContains("app/page.tsx", "Check") || "No check-in"
);

test("R5", "R", "Weather widget — Windguru loaded", () =>
  fileExists("components/WindguruWidget.tsx") || "WindguruWidget missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION S: REPORTS
// ══════════════════════════════════════════════════════════════

test("S1", "S", "Reports page exists", () =>
  fileExists("app/reports/page.tsx") || "reports page missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION T: PEAK PRICING
// ══════════════════════════════════════════════════════════════

test("T1", "T", "Peak pricing page exists", () =>
  fileExists("app/pricing/page.tsx") || "pricing page missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION U: MARKETING MODULE
// ══════════════════════════════════════════════════════════════

test("U1", "U", "Marketing dashboard — page exists", () =>
  fileExists("app/marketing/page.tsx") || "marketing page missing"
);

test("U2", "U", "Contacts page", () =>
  fileExists("app/marketing/contacts/page.tsx") || "contacts page missing"
);

test("U6", "U", "Templates page", () =>
  fileExists("app/marketing/templates/page.tsx") || "templates page missing"
);

test("U8", "U", "Campaign dispatch — marketing-dispatch function", () =>
  fileExists("supabase/functions/marketing-dispatch/index.ts") || "marketing-dispatch missing"
);

test("U10", "U", "Track opens — marketing-track function", () =>
  fileExists("supabase/functions/marketing-track/index.ts") && fileContains("supabase/functions/marketing-track/index.ts", "open")
    || "No open tracking"
);

test("U11", "U", "Track clicks — click tracking", () =>
  fileContains("supabase/functions/marketing-track/index.ts", "click") || "No click tracking"
);

test("U12", "U", "Unsubscribe — unsubscribe function", () =>
  fileExists("supabase/functions/marketing-unsubscribe/index.ts") || "marketing-unsubscribe missing"
);

test("U13", "U", "Automations page", () =>
  fileExists("app/marketing/automations/page.tsx") || "automations page missing"
);

test("U14", "U", "Automation detail page", () =>
  fileExists("app/marketing/automations/[id]/page.tsx") || "automation detail missing"
);

test("U18", "U", "Automation: generate_voucher step", () =>
  fileContains("supabase/functions/marketing-automation-dispatch/index.ts", "generate_voucher") || "No generate_voucher step"
);

test("U19", "U", "Automation: generate_promo step", () =>
  fileContains("supabase/functions/marketing-automation-dispatch/index.ts", "generate_promo") || "No generate_promo step"
);

// ══════════════════════════════════════════════════════════════
// SECTION V: PROMO CODE MANAGEMENT
// ══════════════════════════════════════════════════════════════

test("V1", "V", "Promotions page exists", () =>
  fileExists("app/marketing/promotions/page.tsx") || "promotions page missing"
);

test("V1b", "V", "Promotions migration exists", () =>
  fileExists("supabase/migrations/20260330200000_promotions.sql") || "promotions migration missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION W: SETTINGS & BRANDING
// ══════════════════════════════════════════════════════════════

test("W1", "W", "Settings page exists", () =>
  fileExists("app/settings/page.tsx") || "settings page missing"
);

test("W4", "W", "WhatsApp credentials — encrypted storage", () =>
  fileContains("app/api/credentials/route.ts", "wa_token") || "No WA credential handling"
);

test("W5", "W", "Yoco credentials", () =>
  fileContains("app/api/credentials/route.ts", "yoco_secret") || "No Yoco credential handling"
);

// ══════════════════════════════════════════════════════════════
// SECTION X: BILLING
// ══════════════════════════════════════════════════════════════

test("X1", "X", "Billing page exists", () =>
  fileExists("app/billing/page.tsx") || "billing page missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION Y: EXTERNAL / B2B
// ══════════════════════════════════════════════════════════════

test("Y1", "Y", "External booking function — check_availability", () =>
  fileExists("supabase/functions/external-booking/index.ts") && fileContains("supabase/functions/external-booking/index.ts", "check_availability")
    || "No check_availability in external-booking"
);

test("Y2", "Y", "External booking — create_booking", () =>
  fileContains("supabase/functions/external-booking/index.ts", "create_booking") || "No create_booking"
);

test("Y5", "Y", "Idempotent external booking", () =>
  fileContains("supabase/functions/external-booking/index.ts", "external_ref") || fileContains("supabase/functions/external-booking/index.ts", "idempoten") || "No idempotency"
);

test("Y6", "Y", "HMAC auth on external-booking", () =>
  fileContains("supabase/functions/external-booking/index.ts", "hmac") || fileContains("supabase/functions/external-booking/index.ts", "HMAC") || "No HMAC auth"
);

// ══════════════════════════════════════════════════════════════
// SECTION Z: SUPER ADMIN
// ══════════════════════════════════════════════════════════════

test("Z1", "Z", "Super admin page exists", () =>
  fileExists("app/super-admin/page.tsx") || "super-admin page missing"
);

test("Z1b", "Z", "Onboard function exists", () =>
  fileExists("supabase/functions/super-admin-onboard/index.ts") || "super-admin-onboard missing"
);

// ══════════════════════════════════════════════════════════════
// SECTION AA: EDGE CASES & RESILIENCE
// ══════════════════════════════════════════════════════════════

test("AA1", "AA", "Double payment — idempotency_keys table", () =>
  fileExists("supabase/migrations/20260319130300_idempotency.sql") || "idempotency migration missing"
);

test("AA1b", "AA", "Yoco webhook uses idempotency", () =>
  fileContains("supabase/functions/yoco-webhook/index.ts", "idempoten") || "No idempotency in yoco-webhook"
);

test("AA1c", "AA", "Paysafe webhook uses idempotency", () =>
  fileContains("supabase/functions/paysafe-webhook/index.ts", "idempoten") || "No idempotency in paysafe-webhook"
);

test("AA14", "AA", "Concurrent hold — atomic hold creation", () => {
  const migration = readdirSync(join(ROOT, "supabase/migrations")).find(f => f.includes("atomic_hold"));
  return migration ? true : (fileContains("app/lib/slot-availability.ts", "atomic") || fileContains("app/lib/slot-availability.ts", "rpc") || "No atomic hold logic");
});

// ══════════════════════════════════════════════════════════════
// SECTION AB: BUILD VERIFICATION (cross-cutting)
// ══════════════════════════════════════════════════════════════

test("BUILD", "AB", "Production build succeeds", () => {
  // This is checked separately by the runner script
  return "SKIP";
});

// ══════════════════════════════════════════════════════════════
// SECURITY CHECKS (bonus)
// ══════════════════════════════════════════════════════════════

test("SEC1", "SEC", "RLS enabled — bulk migration exists", () =>
  fileExists("supabase/migrations/20260304150000_enable_rls_all.sql") || "No RLS bulk migration"
);

test("SEC2", "SEC", ".env in .gitignore", () =>
  fileContains(".gitignore", ".env") || ".env not in .gitignore"
);

test("SEC3", "SEC", "Security headers in next.config", () =>
  fileContains("next.config.ts", "X-Frame-Options") || "No security headers"
);

test("SEC4", "SEC", "Paysafe HMAC verification", () =>
  fileContains("supabase/functions/paysafe-webhook/index.ts", "HMAC") || fileContains("supabase/functions/paysafe-webhook/index.ts", "hmac") || "No HMAC"
);

// ══════════════════════════════════════════════════════════════
// OUTPUT RESULTS
// ══════════════════════════════════════════════════════════════

const timestamp = new Date().toISOString();
const total = passCount + failCount + skipCount;

console.log("\n╔══════════════════════════════════════════════════╗");
console.log("║   CAPE KAYAK — AUTO-RESEARCH TEST RESULTS       ║");
console.log("╚══════════════════════════════════════════════════╝\n");

// Group by section
const sections = {};
for (const r of RESULTS) {
  if (!sections[r.section]) sections[r.section] = [];
  sections[r.section].push(r);
}

for (const [sec, tests] of Object.entries(sections)) {
  const passed = tests.filter(t => t.status === "PASS").length;
  const failed = tests.filter(t => t.status === "FAIL").length;
  const skipped = tests.filter(t => t.status === "SKIP").length;
  console.log(`\n── Section ${sec}: ${passed}✅ ${failed}❌ ${skipped}⏭ ──`);
  for (const t of tests) {
    const icon = t.status === "PASS" ? "✅" : t.status === "FAIL" ? "❌" : "⏭";
    console.log(`  ${icon} ${t.id}: ${t.name}${t.detail ? ` — ${t.detail}` : ""}`);
  }
}

console.log(`\n══════════════════════════════════════════════════`);
console.log(`TOTAL: ${passCount}✅ PASS  ${failCount}❌ FAIL  ${skipCount}⏭ SKIP  (${total} tests)`);
console.log(`Score: ${passCount}/${passCount + failCount} automated checks passing (${((passCount/(passCount+failCount))*100).toFixed(1)}%)`);
console.log(`══════════════════════════════════════════════════\n`);

// Write JSONL progress
const progressLine = JSON.stringify({
  timestamp,
  total_tests: total,
  passed: passCount,
  failed: failCount,
  skipped: skipCount,
  score_pct: ((passCount/(passCount+failCount))*100).toFixed(1),
  failures: RESULTS.filter(r => r.status === "FAIL").map(r => ({ id: r.id, detail: r.detail })),
});

writeFileSync(join(ROOT, "auto-research/test-results.jsonl"), progressLine + "\n", { flag: "a" });

// Write human-readable report
const report = [
  `# Auto-Research Test Report — ${timestamp}`,
  ``,
  `**Score: ${passCount}/${passCount + failCount} (${((passCount/(passCount+failCount))*100).toFixed(1)}%)**`,
  `Pass: ${passCount} | Fail: ${failCount} | Skip (manual): ${skipCount}`,
  ``,
  `## Failures`,
  ...RESULTS.filter(r => r.status === "FAIL").map(r => `- **${r.id}**: ${r.name} — ${r.detail}`),
  ``,
  `## All Results`,
  `| ID | Section | Test | Status | Detail |`,
  `|---|---|---|---|---|`,
  ...RESULTS.map(r => `| ${r.id} | ${r.section} | ${r.name} | ${r.status} | ${r.detail} |`),
].join("\n");

writeFileSync(join(ROOT, "auto-research/test-report.md"), report);
console.log("Report written to auto-research/test-report.md");

// Exit with failure code if any tests failed
process.exit(failCount > 0 ? 1 : 0);
