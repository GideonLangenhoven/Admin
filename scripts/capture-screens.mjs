#!/usr/bin/env node
/**
 * capture-screens.mjs
 * Logs in once and screenshots each module of the BookingTours admin
 * for use as footage in the Remotion promo.
 *
 * Setup:
 *   1. cp .env.video.example .env.video
 *   2. fill in VIDEO_EMAIL, VIDEO_PASSWORD, VIDEO_BASE_URL
 *   3. npm run dev   (in another terminal)
 *   4. node scripts/capture-screens.mjs
 *
 * Output: ~/Desktop/bookingtours-promo/public/screens/<route>.png
 */
import { chromium } from "playwright";
import { mkdir, readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { constants } from "node:fs";

const ENV_PATH = resolve(process.cwd(), ".env.video");
const OUT_DIR = resolve(homedir(), "Desktop/bookingtours-promo/public/screens");

async function loadEnv() {
  try {
    await access(ENV_PATH, constants.R_OK);
  } catch {
    console.error(`✖ Missing ${ENV_PATH}. Copy .env.video.example and fill it in.`);
    process.exit(1);
  }
  const text = await readFile(ENV_PATH, "utf8");
  const env = Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const idx = l.indexOf("=");
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1")];
      })
  );
  return env;
}

const ROUTES = [
  { path: "/", name: "dashboard" },
  { path: "/bookings", name: "bookings" },
  { path: "/new-booking", name: "new-booking" },
  { path: "/slots", name: "slots" },
  { path: "/refunds", name: "refunds" },
  { path: "/inbox", name: "inbox" },
  { path: "/vouchers", name: "vouchers" },
  { path: "/invoices", name: "invoices" },
  { path: "/weather", name: "weather" },
  { path: "/photos", name: "photos" },
  { path: "/broadcasts", name: "broadcasts" },
  { path: "/pricing", name: "pricing" },
  { path: "/reports", name: "reports" },
  { path: "/marketing", name: "marketing" },
];

// Replace customer PII with safe demo strings before screenshot
const MASK_SCRIPT = `
  (() => {
    const map = [
      [/[A-Z][a-z]+ [A-Z]\\.[A-Z]?[a-z]*/g, 'Sarah B.'],
      [/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/g, 'guest@example.com'],
      [/\\+?27\\s?\\d{2}\\s?\\d{3}\\s?\\d{4}/g, '+27 82 555 0000'],
      [/0[6-8]\\d \\d{3} ?\\d{4}/g, '082 555 0000'],
    ];
    const walk = (node) => {
      if (node.nodeType === 3) {
        let v = node.nodeValue;
        for (const [re, rep] of map) v = v.replace(re, rep);
        node.nodeValue = v;
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'TEXTAREA') return;
      for (const c of node.childNodes) walk(c);
    };
    walk(document.body);
  })();
`;

async function login(page, env) {
  await page.goto(env.VIDEO_BASE_URL || "http://localhost:3000", { waitUntil: "domcontentloaded" });
  // Already logged in?
  const signedIn = await page.locator('text=/Dashboard|Bookings|Inbox/').first().isVisible().catch(() => false);
  if (signedIn) return;
  await page.getByPlaceholder("Email address").fill(env.VIDEO_EMAIL);
  await page.getByPlaceholder("Password").fill(env.VIDEO_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForLoadState("networkidle", { timeout: 30000 });
}

async function capture() {
  const env = await loadEnv();
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });
  const page = await context.newPage();

  console.log("→ logging in…");
  await login(page, env);

  for (const r of ROUTES) {
    const dest = join(OUT_DIR, `${r.name}.png`);
    process.stdout.write(`→ ${r.path.padEnd(18)} `);
    try {
      await page.goto(`${env.VIDEO_BASE_URL || "http://localhost:3000"}${r.path}`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      // Settle UI
      await page.waitForTimeout(900);
      // Mask PII
      await page.evaluate(MASK_SCRIPT);
      await page.screenshot({ path: dest, fullPage: false, animations: "disabled" });
      console.log("✓");
    } catch (e) {
      console.log(`✖  ${e.message.split("\n")[0]}`);
    }
  }

  await browser.close();
  console.log(`\nDone. Screenshots → ${OUT_DIR}`);
}

capture().catch((e) => {
  console.error(e);
  process.exit(1);
});
