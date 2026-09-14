#!/usr/bin/env node
/**
 * Admin-app mobile audit. For every operator nav route, at real phone
 * viewports, flag page-level horizontal overflow + the elements causing it,
 * and save a viewport screenshot (plus full-page when overflowing).
 *
 * Usage: node scripts/demo-capture/mobile-review.mjs
 * Needs: .demo-capture-tmp/admin-state.json (run capture-features.mjs --admin-login)
 * Output: .demo-capture-tmp/mobile-review/{shots,report.json,report.txt}
 */
import { chromium, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const ADMIN_URL = "https://jerrys.admin.bookingtours.co.za";
const TMP = resolve(process.cwd(), ".demo-capture-tmp");
const OUT = join(TMP, "mobile-review");
const STATE = join(TMP, "admin-state.json");

const ROUTES = [
  "/", "/bookings", "/new-booking", "/slots", "/inbox", "/refunds",
  "/vouchers", "/reviews", "/invoices", "/pricing", "/reports", "/billing",
  "/marketing", "/marketing/contacts", "/marketing/templates",
  "/marketing/automations", "/marketing/promotions",
  "/broadcasts", "/partnerships", "/settings/chat-faq", "/settings",
  "/privacy/data-requests",
];

const VIEWPORTS = [
  { name: "w360", width: 360, height: 800 }, // small Android — worst case
  { name: "w390", width: 390, height: 844 }, // iPhone 14/15
];

async function audit(page, route, vp) {
  await page.goto(ADMIN_URL + route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const data = await page.evaluate(() => {
    const iw = window.innerWidth;
    const doc = document.documentElement;
    const pageHScroll = Math.max(doc.scrollWidth, document.body.scrollWidth) - iw;
    // Elements poking past the right edge (or off the left) of the viewport.
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.position === "fixed" && el.closest("nav")) continue; // bottom tab strip scrolls by design
      const over = Math.round(r.right - iw);
      if ((over > 2 || r.left < -2) && !el.closest(".no-scrollbar")) {
        // Skip children inside an intentional overflow-x container.
        let p = el.parentElement, contained = false;
        while (p && p !== document.body) {
          const ps = getComputedStyle(p);
          if ((ps.overflowX === "auto" || ps.overflowX === "scroll") && p.clientWidth <= iw) { contained = true; break; }
          p = p.parentElement;
        }
        if (!contained) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className).slice(0, 90),
            text: (el.textContent || "").trim().slice(0, 40),
            right: Math.round(r.right), left: Math.round(r.left), width: Math.round(r.width),
          });
        }
      }
    }
    offenders.sort((a, b) => b.right - a.right);
    // Nested vertical scrollers other than the main content area.
    const vScrollers = [];
    for (const el of document.querySelectorAll("body *")) {
      const s = getComputedStyle(el);
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4 && el.tagName !== "MAIN") {
        vScrollers.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 70), h: el.clientHeight });
      }
    }
    return { pageHScroll, offenders: offenders.slice(0, 6), vScrollers: vScrollers.slice(0, 4), title: document.title };
  });

  const slug = (route === "/" ? "dashboard" : route.slice(1).replace(/\//g, "-"));
  const shot = `${slug}-${vp.name}.jpg`;
  await page.screenshot({ path: join(OUT, "shots", shot), type: "jpeg", quality: 70 });
  if (data.pageHScroll > 2) {
    await page.screenshot({ path: join(OUT, "shots", `${slug}-${vp.name}-full.jpg`), type: "jpeg", quality: 60, fullPage: true });
  }
  return { route, viewport: vp.name, ...data, shot };
}

const browser = await chromium.launch();
await mkdir(join(OUT, "shots"), { recursive: true });
const results = [];
for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    ...devices["iPhone 12"], // touch + mobile UA
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    storageState: STATE,
  });
  const page = await context.newPage();
  for (const route of ROUTES) {
    try {
      const r = await audit(page, route, vp);
      results.push(r);
      console.log(`${r.pageHScroll > 2 ? "✘" : "✔"} ${vp.name} ${route} ${r.pageHScroll > 2 ? `— ${r.pageHScroll}px horizontal overflow` : ""}`);
    } catch (e) {
      results.push({ route, viewport: vp.name, error: e.message.slice(0, 200) });
      console.log(`⚠ ${vp.name} ${route} — ${e.message.slice(0, 120)}`);
    }
  }
  await context.close();
}
await browser.close();

await writeFile(join(OUT, "report.json"), JSON.stringify(results, null, 2));
const bad = results.filter((r) => (r.pageHScroll ?? 0) > 2);
console.log(`\n${results.length} checks, ${bad.length} pages with horizontal overflow → ${join(OUT, "report.json")}`);
