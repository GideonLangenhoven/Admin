/**
 * Full-surface route sweep: every operator page, every customer page, plus the
 * server-side auth gates that protect them.
 *
 * Auth is seeded from scripts/e2e-mint-session.mjs (service-role magiclink ->
 * session, no password anywhere). Run with:
 *
 *   node scripts/e2e-mint-session.mjs <admin-email> > /tmp/session.json
 *   E2E_SESSION_FILE=/tmp/session.json ADMIN_URL=http://127.0.0.1:3000 \
 *   BASE_URL=http://127.0.0.1:3001 npx playwright test tests/e2e/route-sweep.spec.ts
 *
 * Emits a machine-readable report to E2E_REPORT_FILE.
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ADMIN_URL = process.env.ADMIN_URL || "http://127.0.0.1:3000";
const SITE_URL = process.env.BASE_URL || "http://127.0.0.1:3001";
const REPORT_FILE = process.env.E2E_REPORT_FILE || "test-results/route-sweep.json";
const SESSION_FILE = process.env.E2E_SESSION_FILE || "";

// Reuse a pre-minted session when given one, otherwise mint a SUPER_ADMIN
// session directly (service-role generate_link — no email is sent).
function loadSession() {
  if (SESSION_FILE) return JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  const script = resolve(__dirname, "../../scripts/e2e-mint-session.mjs");
  return JSON.parse(execFileSync("node", [script, "gidslang89@gmail.com"], { encoding: "utf8" }));
}
const session = loadSession();

// Real rows on the jerrys tenant so dynamic segments render actual data.
const FIX = {
  business: "c8b439f5-c11e-4d46-b347-943df6f172b4",
  booking: "ecba43a1-77ca-4ce3-8daa-f69e7c7da61a",
  slot: "22e6f74e-409a-4c18-af98-5acdc31e8a94",
  tour: "094c6fc8-8d24-421f-9411-c0e6e55cb09e",
  automation: "765d7157-5d39-4a23-9815-0f7a4f5c574c",
  voucherCode: "FRR3HQA6",
  reviewToken: "20ba9e7e-d98b-4821-9770-b7c215def9cd",
};

interface RouteResult {
  app: "admin" | "booking";
  path: string;
  status: number | null;
  finalPath: string;
  redirected: boolean;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  errorBoundary: string | null;
  headingText: string;
  hydrationMismatch: boolean;
  ok: boolean;
}

const results: RouteResult[] = [];

// React #418 = "the server rendered HTML didn't match the client". Tracked
// separately from crashes: the page still renders, it just re-renders client-side.
const HYDRATION = /Minified React error #(418|423|425)|Hydration failed|didn't match the client/i;

// Playwright tears down and replaces the worker process after a failing test,
// which would wipe module state. Flush after every route instead.
function flush() {
  mkdirSync(dirname(REPORT_FILE), { recursive: true });
  const prior = existsSync(REPORT_FILE) ? JSON.parse(readFileSync(REPORT_FILE, "utf8")) : [];
  const merged = [...prior.filter((p: RouteResult) => !results.some((r) => r.app === p.app && r.path === p.path)), ...results];
  writeFileSync(REPORT_FILE, JSON.stringify(merged, null, 2));
}

// Noise that is not a defect: browser extensions, favicon 404s, aborted
// prefetches from client-side navigation, and Sentry's own transport.
const IGNORED = [
  /favicon/i,
  /chrome-extension:/i,
  /ERR_ABORTED/i,
  /net::ERR_FAILED.*sentry/i,
  /ingest\.sentry\.io/i,
  /o\d+\.ingest/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  // The marketing template preview iframe uses sandbox="" on purpose; the
  // SecurityError it throws when embedded content touches localStorage is the
  // sandbox working, not a page defect.
  /sandboxed and lacks the 'allow-same-origin' flag/i,
];

const isNoise = (s: string) => IGNORED.some((r) => r.test(s));

async function sweep(page: Page, app: "admin" | "booking", base: string, path: string) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  const onConsole = (m: { type: () => string; text: () => string }) => {
    if (m.type() === "error" && !isNoise(m.text())) consoleErrors.push(m.text().slice(0, 300));
  };
  const onPageError = (e: Error) => {
    if (!isNoise(e.message)) pageErrors.push(e.message.slice(0, 300));
  };
  const onResponse = (r: { status: () => number; url: () => string; request: () => { method: () => string } }) => {
    const s = r.status();
    if (s >= 400 && !isNoise(r.url())) {
      failedRequests.push(`${s} ${r.request().method()} ${r.url().replace(base, "").slice(0, 160)}`);
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);

  let status: number | null = null;
  try {
    const res = await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 45_000 });
    status = res?.status() ?? null;
    // Let client-side data fetches settle; networkidle is unreliable with
    // Supabase realtime sockets held open, so bound it and move on.
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  } catch (e: any) {
    pageErrors.push(`NAVIGATION: ${e?.message?.slice(0, 200)}`);
  }

  // Next.js error boundary / app-level crash text.
  const boundary = await page
    .locator("text=/Application error|something went wrong|Unhandled Runtime Error|500 - Internal/i")
    .first()
    .textContent({ timeout: 1500 })
    .catch(() => null);

  const headingText =
    (await page.locator("h1, h2").first().textContent({ timeout: 2000 }).catch(() => ""))?.trim().slice(0, 90) || "";

  const finalPath = new URL(page.url()).pathname + new URL(page.url()).search;

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("response", onResponse);

  const hydrationMismatch = [...pageErrors, ...consoleErrors].some((m) => HYDRATION.test(m));
  const fatal = pageErrors.filter((m) => !HYDRATION.test(m));

  const r: RouteResult = {
    app,
    path,
    status,
    finalPath,
    redirected: finalPath.split("?")[0] !== path.split("?")[0],
    consoleErrors,
    pageErrors,
    failedRequests,
    errorBoundary: boundary?.trim().slice(0, 160) ?? null,
    headingText,
    hydrationMismatch,
    ok: !boundary && fatal.length === 0 && (status === null || status < 500),
  };
  results.push(r);
  flush();
  return r;
}

async function seedAdminAuth(context: BrowserContext) {
  const { storage, admin, timezone } = session;
  await context.addCookies([
    { name: "ck_session_hint", value: "1", url: ADMIN_URL },
    { name: "ck_admin_role", value: admin.role, url: ADMIN_URL },
  ]);
  await context.addInitScript(
    ({ storage, admin, timezone }: any) => {
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v as string);
      localStorage.setItem("ck_admin_auth", "true");
      localStorage.setItem("ck_admin_email", admin.email);
      localStorage.setItem("ck_admin_role", admin.role);
      localStorage.setItem("ck_admin_business_id", admin.business_id);
      localStorage.setItem("ck_admin_timezone", timezone);
      localStorage.setItem("ck_admin_time", String(Date.now()));
      localStorage.setItem("ck_admin_name", admin.name || "");
      localStorage.setItem("ck_admin_settings_perms", JSON.stringify(admin.settings_permissions || {}));
    },
    { storage, admin, timezone },
  );
}

// ---------------------------------------------------------------- admin pages

const ADMIN_ROUTES = [
  "/",
  "/bookings",
  `/bookings/${FIX.booking}`,
  "/new-booking",
  "/slots",
  "/customers",
  "/inbox",
  "/photos",
  "/guide",
  `/guide/slot/${FIX.slot}`,
  `/guide/photos/${FIX.slot}`,
  "/marketing",
  "/marketing/contacts",
  "/marketing/templates",
  "/marketing/automations",
  `/marketing/automations/${FIX.automation}`,
  "/marketing/promotions",
  "/broadcasts",
  "/reports",
  "/refunds",
  "/invoices",
  "/vouchers",
  "/reviews",
  "/notifications",
  "/partnerships",
  "/operators",
  "/billing",
  "/ai-usage",
  "/settings",
  "/settings/chat-faq",
  "/settings/ota",
  "/ota-drift",
  "/super-admin",
  "/privacy/data-requests",
  "/pricing",
  "/change-password",
  "/whatsapp-privacy",
  "/popia/confirm",
  "/google-callback",
  "/case-study/cape-kayak",
  "/compare/manual-vs-disconnected-tools",
  "/embed/embed/availability",
];

test.describe("Operator app — every route", () => {
  test.describe.configure({ mode: "serial" });

  test("sweep all admin routes as SUPER_ADMIN", async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const context = await browser.newContext();
    await seedAdminAuth(context);
    const page = await context.newPage();

    for (const path of ADMIN_ROUTES) {
      const r = await sweep(page, "admin", ADMIN_URL, path);
      console.log(
        `${r.ok ? "PASS" : "FAIL"}  ${path.padEnd(46)} ${String(r.status).padEnd(4)} ` +
          `-> ${r.finalPath.slice(0, 40).padEnd(40)} ` +
          `err:${r.pageErrors.length} con:${r.consoleErrors.length} net:${r.failedRequests.length}` +
          (r.hydrationMismatch ? " HYDRATION" : "") +
          (r.errorBoundary ? `  BOUNDARY: ${r.errorBoundary}` : ""),
      );
    }
    await context.close();

    const crashed = results.filter((r) => r.app === "admin" && !r.ok);
    expect(crashed.map((c) => `${c.path}: ${c.errorBoundary || c.pageErrors[0]}`), "admin routes that crashed").toEqual([]);

    // Pins the AuthGate fix: SSR and first client render must match (React #418).
    const hydration = results.filter((r) => r.app === "admin" && r.hydrationMismatch);
    expect(hydration.map((r) => r.path), "admin routes with hydration mismatches").toEqual([]);
  });
});

// -------------------------------------------------------------- booking pages

const BOOKING_ROUTES = [
  "/",
  "/book",
  `/book?tour=${FIX.tour}`,
  "/my-bookings",
  "/voucher",
  "/voucher-confirmed",
  "/voucher-success",
  "/waiver",
  `/waiver?booking=${FIX.booking}`,
  "/success",
  `/success?booking=${FIX.booking}`,
  "/cancelled",
  `/review/${FIX.reviewToken}`,
  "/directory",
  "/embed",
  "/popia",
  "/popia/confirm",
  "/privacy",
  "/terms",
  "/cookies",
  "/auth/callback",
  `/combo/${FIX.booking}`,
];

test.describe("Customer app — every route", () => {
  test.describe.configure({ mode: "serial" });

  test("sweep all booking routes as anonymous visitor", async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const context = await browser.newContext();
    const page = await context.newPage();

    for (const path of BOOKING_ROUTES) {
      const r = await sweep(page, "booking", SITE_URL, path);
      console.log(
        `${r.ok ? "PASS" : "FAIL"}  ${path.padEnd(46)} ${String(r.status).padEnd(4)} ` +
          `-> ${r.finalPath.slice(0, 40).padEnd(40)} ` +
          `err:${r.pageErrors.length} con:${r.consoleErrors.length} net:${r.failedRequests.length}` +
          (r.hydrationMismatch ? " HYDRATION" : "") +
          (r.errorBoundary ? `  BOUNDARY: ${r.errorBoundary}` : ""),
      );
    }
    await context.close();

    const crashed = results.filter((r) => r.app === "booking" && !r.ok);
    expect(crashed.map((c) => `${c.path}: ${c.errorBoundary || c.pageErrors[0]}`), "booking routes that crashed").toEqual([]);
  });
});

// ------------------------------------------------------------- API auth gates

// Every route whose handler calls getCallerAdmin. Unauthenticated callers must
// never receive 2xx. POST bodies are empty on purpose: a guarded route rejects
// on the missing bearer token before it ever looks at the body.
const GUARDED_API: Array<[string, "GET" | "POST" | "PUT" | "PATCH" | "DELETE"]> = [
  ["/api/admin/add", "POST"],
  ["/api/admin/remove", "POST"],
  ["/api/admin/update", "POST"],
  ["/api/admin/setup-link", "POST"],
  ["/api/admin/chat-faq", "GET"],
  ["/api/admin/chat-faq", "POST"],
  ["/api/admin/data-requests", "GET"],
  ["/api/admin/notifications", "GET"],
  ["/api/admin/wa-failures", "GET"],
  ["/api/admin/whatsapp/bot-mode", "GET"],
  ["/api/admin/whatsapp/bot-mode", "PUT"],
  ["/api/billing/history", "GET"],
  ["/api/billing/subscription", "GET"],
  ["/api/billing/pause", "POST"],
  ["/api/billing/plan", "POST"],
  ["/api/billing/resume", "POST"],
  ["/api/billing/seats", "POST"],
  ["/api/credentials", "GET"],
  ["/api/credentials", "POST"],
  ["/api/combo-offers", "GET"],
  ["/api/combo-offers", "POST"],
  ["/api/combo-settlements", "GET"],
  ["/api/combo-cancel", "POST"],
  ["/api/ota", "GET"],
  ["/api/ota", "POST"],
  ["/api/partner-tours", "GET"],
  ["/api/partnerships", "GET"],
  ["/api/partnerships", "POST"],
  ["/api/platform-invoices/list", "GET"],
  ["/api/platform-invoices/generate", "POST"],
  ["/api/platform-invoices/send", "POST"],
  ["/api/platform-invoices/mark-paid", "POST"],
  ["/api/platform-invoices/create-payment-link", "POST"],
  ["/api/platform-settings", "GET"],
  ["/api/platform-settings", "POST"],
  ["/api/guide/check-in", "POST"],
  ["/api/guide/send-thank-you", "POST"],
];

test("privileged APIs reject unauthenticated callers", async ({ request }) => {
  test.setTimeout(5 * 60_000);
  const leaks: string[] = [];
  for (const [path, method] of GUARDED_API) {
    const res = await request.fetch(ADMIN_URL + path, {
      method,
      headers: { "Content-Type": "application/json" },
      data: method === "GET" ? undefined : {},
      failOnStatusCode: false,
    });
    const s = res.status();
    const verdict = s === 401 || s === 403 ? "PASS" : s < 300 ? "LEAK" : `other(${s})`;
    console.log(`${verdict.padEnd(9)} ${method.padEnd(5)} ${path} -> ${s}`);
    if (s < 300) leaks.push(`${method} ${path} -> ${s}`);
  }
  expect(leaks, "privileged endpoints reachable without auth").toEqual([]);
});

// ------------------------------------------------------------ page role gates

test("page role gates redirect under-privileged roles", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const cases: Array<{ role: string; path: string; expect: "denied" | "home" | "allowed" }> = [
    { role: "ADMIN", path: "/super-admin", expect: "denied" },
    { role: "ADMIN", path: "/billing", expect: "denied" },
    { role: "ADMIN", path: "/partnerships", expect: "denied" },
    { role: "ADMIN", path: "/privacy/data-requests", expect: "denied" },
    { role: "MAIN_ADMIN", path: "/super-admin", expect: "denied" },
    { role: "MAIN_ADMIN", path: "/billing", expect: "allowed" },
    // MVP-hidden regardless of role
    { role: "SUPER_ADMIN", path: "/settings/ota", expect: "home" },
    { role: "SUPER_ADMIN", path: "/ota-drift", expect: "home" },
  ];

  const failures: string[] = [];
  for (const c of cases) {
    const context = await browser.newContext();
    await context.addCookies([{ name: "ck_admin_role", value: c.role, url: ADMIN_URL }]);
    const page = await context.newPage();
    await page.goto(ADMIN_URL + c.path, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const u = new URL(page.url());
    const got =
      u.pathname === "/" && u.search === "?denied=1"
        ? "denied"
        : u.pathname === "/" && !u.search
          ? "home"
          : u.pathname === c.path
            ? "allowed"
            : `other(${u.pathname}${u.search})`;
    console.log(`${got === c.expect ? "PASS" : "FAIL"}  ${c.role.padEnd(12)} ${c.path.padEnd(26)} expect:${c.expect.padEnd(8)} got:${got}`);
    if (got !== c.expect) failures.push(`${c.role} ${c.path}: expected ${c.expect}, got ${got}`);
    await context.close();
  }
  expect(failures, "page role gate mismatches").toEqual([]);
});

test.afterAll(() => {
  flush();
  console.log(`\n[route-sweep] wrote ${results.length} results to ${REPORT_FILE}`);
});
