#!/usr/bin/env node
/**
 * Feature-video capture — Playwright. Companion to capture.mjs (booking flow);
 * this one records the four feature stories on the jerrys tenant:
 *   weather cancel · refund queue · customer my-bookings · marketing.
 *
 * Same philosophy as capture.mjs: honest footage of the real product, real
 * clicks, synthetic cursor, no mocks. Output feeds the Remotion compositor.
 *
 * Auth:
 *   --admin-login   opens a HEADED window; a human signs in (script never
 *                   touches credentials), then session state is saved to
 *                   .demo-capture-tmp/admin-state.json for headless beats.
 *   customer login  is itself a recorded beat (mb-01-login). The 6-digit
 *                   code is relayed through a file: the beat writes
 *                   otp-request.json and polls otp-code.txt (an operator
 *                   fetches the code from the test inbox and writes it).
 *
 * Usage:
 *   node scripts/demo-capture/capture-features.mjs --admin-login
 *   node scripts/demo-capture/capture-features.mjs --check
 *   node scripts/demo-capture/capture-features.mjs --only=wx-01-slots,mk-01-overview
 *   node scripts/demo-capture/capture-features.mjs --ben-choice      # off-camera helper
 *   node scripts/demo-capture/capture-features.mjs --email-stills    # render .demo-capture-tmp/emails/*.html → PNGs
 *
 * Output: ~/bookingtours-promo/public/feature-shots/*.mp4|png + feature-shots.json
 */
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile, readFile, readdir, access } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { homedir } from "node:os";
import { CURSOR_INIT_SCRIPT, hideCursor } from "./cursor.mjs";

const execFileAsync = promisify(execFile);

const ADMIN_URL = "https://jerrys.admin.bookingtours.co.za";
const BOOKING_URL = "https://jerrys.booking.bookingtours.co.za";
const FPS = 25;
const SIZE = { width: 1920, height: 1080 };
const OUT_DIR = resolve(homedir(), "bookingtours-promo/public/feature-shots");
const TMP_DIR = resolve(process.cwd(), ".demo-capture-tmp");
const ADMIN_STATE = join(TMP_DIR, "admin-state.json");
const CUSTOMER_STATE = join(TMP_DIR, "customer-state.json");
const SARAH_STATE = join(TMP_DIR, "sarah-state.json");

const CUSTOMER = { email: "justpassingpodcast@gmail.com", phone: "825550102" };
const SARAH = { email: "justpassingpodcast+sarah@gmail.com", phone: "825550101" };
const BEN = { email: "justpassingpodcast+ben@gmail.com", phone: "825550103" };

// ── small helpers (same shapes as beats.mjs; module-local there) ──────────
async function waitForFonts(page) {
  await page.evaluate(() => document.fonts.ready);
}
async function measureFocal(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("focal element has no bounding box");
  const vp = page.viewportSize();
  return {
    x: Math.round(((box.x + box.width / 2) / vp.width) * 1000) / 1000,
    y: Math.round(((box.y + box.height / 2) / vp.height) * 1000) / 1000,
    width: Math.round((box.width / vp.width) * 1000) / 1000,
    height: Math.round((box.height / vp.height) * 1000) / 1000,
  };
}
async function moveTo(page, x, y, steps = 30) {
  await page.mouse.move(x, y, { steps });
}
async function hoverEl(page, locator, steps = 30) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("cannot hover an element with no bounding box");
  await moveTo(page, box.x + box.width / 2, box.y + box.height / 2, steps);
}
async function clickEl(page, locator, steps = 30) {
  await hoverEl(page, locator, steps);
  await locator.click();
}
/** Human typing: per-char delay so footage reads as typed, not pasted. */
async function typeInto(page, locator, text, delay = 55) {
  await clickEl(page, locator, 20);
  await locator.pressSequentially(text, { delay });
}
/** Sat 01 Aug 09:00 slot card: first card in the Saturday column (Mon-start
 * week grid → column index 5). Cards carry title={tour name}. */
function satCard(page) {
  return page.locator("div.grid-cols-7 > div").nth(5).locator('div[title="Morning Kayak"]').first();
}
/** Admin AuthGate shows "Checking admin session…" before content. */
async function waitAdminReady(page) {
  await page.waitForSelector("text=POWERED BY", { timeout: 30000 });
  await waitForFonts(page);
}
async function transcode(webmPath, mp4Path) {
  await execFileAsync("ffmpeg", [
    "-y", "-i", webmPath,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow",
    mp4Path,
  ]);
}
async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/** OTP relay: ask the operator (main agent) for the emailed 6-digit code. */
async function waitForOtpCode(email, timeoutMs = 240000) {
  const codePath = join(TMP_DIR, "otp-code.txt");
  await rm(codePath, { force: true });
  await writeFile(join(TMP_DIR, "otp-request.json"), JSON.stringify({ email, at: new Date().toISOString() }));
  const start = Date.now();
  for (;;) {
    if (await exists(codePath)) {
      const code = (await readFile(codePath, "utf8")).trim();
      if (code.length >= 4) { // 6-digit code or a full magic-link URL
        await rm(codePath, { force: true });
        await rm(join(TMP_DIR, "otp-request.json"), { force: true });
        return code;
      }
    }
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for otp-code.txt relay");
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** Recorded OTP login on the booking site. Returns when trips list renders. */
async function otpLogin(page, who) {
  await page.goto(`${BOOKING_URL}/my-bookings`, { waitUntil: "domcontentloaded" });
  await waitForFonts(page);
  const emailInput = page.locator('input[placeholder="your@email.com"]');
  await emailInput.waitFor({ timeout: 15000 });
  await typeInto(page, emailInput, who.email);
  await page.waitForTimeout(400);
  await clickEl(page, page.getByText("Use phone verification instead"));
  const phoneInput = page.locator('input[placeholder="81 234 5678"]');
  await phoneInput.waitFor({ timeout: 10000 });
  await typeInto(page, phoneInput, who.phone);
  await page.waitForTimeout(300);
  await clickEl(page, page.getByRole("button", { name: "Find my bookings" }));
  await page.waitForSelector('input[aria-label="6-digit verification code"]', { timeout: 20000 });
  const code = await waitForOtpCode(who.email);
  const otpInput = page.locator('input[aria-label="6-digit verification code"]');
  await otpInput.click();
  await otpInput.pressSequentially(code, { delay: 140 });
  await page.waitForTimeout(500);
  await clickEl(page, page.getByRole("button", { name: "Verify" }));
  // Trips list = success. BookingCard renders tour names.
  await page.waitForSelector("text=Morning Kayak", { timeout: 25000 });
  await page.waitForTimeout(1200);
}

// ── beats ─────────────────────────────────────────────────────────────────
// {id, state: 'admin'|'customer'|'sarah'|null, durationMs, hero, caption, run}
const BEATS = [
  // — marketing (non-destructive) —
  {
    id: "mk-01-overview", state: "admin", durationMs: 12000, hero: false,
    caption: "One marketing hub: contacts, campaigns, automations",
    async run(page) {
      await page.goto(`${ADMIN_URL}/marketing`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Email Usage This Month", { timeout: 20000 });
      await page.waitForTimeout(1200);
      await moveTo(page, 700, 400, 25);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(1400);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(1400);
      const focal = await measureFocal(page, page.getByText("Email Usage This Month"));
      await page.mouse.wheel(0, -1000);
      await page.waitForTimeout(1200);
      return focal;
    },
  },
  {
    id: "mk-02-gallery", state: "admin", durationMs: 12000, hero: false,
    caption: "Industry-proven automation templates",
    async run(page) {
      await page.goto(`${ADMIN_URL}/marketing/automations`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      const browse = page.getByRole("button", { name: "Browse Templates" });
      await browse.waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      await clickEl(page, browse);
      await page.waitForSelector("text=Automation Templates", { timeout: 15000 });
      await page.waitForTimeout(1200);
      const focal = await measureFocal(page, page.getByText("Welcome Series").first());
      await hoverEl(page, page.getByText("Post-Tour Review Request").first());
      await page.waitForTimeout(900);
      await page.mouse.wheel(0, 450);
      await page.waitForTimeout(1300);
      await page.mouse.wheel(0, 450);
      await page.waitForTimeout(1300);
      return focal;
    },
  },
  {
    id: "mk-03-builder", state: "admin", durationMs: 12000, hero: true,
    caption: "A real multi-step builder, in plain sentences",
    async run(page) {
      await page.goto(`${ADMIN_URL}/marketing/automations`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      const row = page.getByText("Birthday Special").first();
      await row.waitFor({ timeout: 20000 });
      await page.waitForTimeout(900);
      await clickEl(page, row);
      // Editor: plain-sentence step list. Wait for any step copy to render.
      await page.waitForSelector("text=/Immediately|Wait|send/i", { timeout: 20000 });
      await page.waitForTimeout(1500);
      const focal = await measureFocal(page, page.locator("text=/Immediately|Wait/i").first());
      await page.mouse.wheel(0, 350);
      await page.waitForTimeout(1500);
      await page.mouse.wheel(0, 350);
      await page.waitForTimeout(1500);
      return focal;
    },
  },

  // — my-bookings (customer) —
  {
    id: "mb-01-login", state: null, durationMs: 16000, hero: true,
    caption: "No passwords: email + phone, one code",
    saveStateTo: CUSTOMER_STATE,
    async run(page) {
      await otpLogin(page, CUSTOMER);
      return await measureFocal(page, page.getByText("Morning Kayak").first());
    },
  },
  {
    id: "mb-02-trips", state: "customer", durationMs: 10000, hero: false,
    caption: "Every trip, every action, self-service",
    async run(page) {
      await page.goto(`${BOOKING_URL}/my-bookings`, { waitUntil: "domcontentloaded" });
      await waitForFonts(page);
      await page.waitForSelector("text=Morning Kayak", { timeout: 25000 });
      await page.waitForTimeout(1200);
      const card = page.getByText("Morning Kayak").first();
      await hoverEl(page, card);
      await page.waitForTimeout(1200);
      const focal = await measureFocal(page, page.getByRole("button", { name: "Reschedule" }).first());
      await hoverEl(page, page.getByRole("button", { name: "Reschedule" }).first());
      await page.waitForTimeout(900);
      await hoverEl(page, page.getByRole("button", { name: "Edit guests" }).first());
      await page.waitForTimeout(900);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(1400);
      return focal;
    },
  },
  {
    id: "mb-03-reschedule", state: "customer", durationMs: 18000, hero: true,
    caption: "Reschedule on a live calendar — no phone call",
    destructive: true, // performs a real slot move; never blind-retry
    async run(page) {
      await page.goto(`${BOOKING_URL}/my-bookings`, { waitUntil: "domcontentloaded" });
      await waitForFonts(page);
      await page.waitForSelector("text=Morning Kayak", { timeout: 25000 });
      await page.waitForTimeout(1200);
      await clickEl(page, page.getByRole("button", { name: "Reschedule" }).first());
      // MiniCalendar opens on the current month (July) — page to August,
      // then day 5 (Wed 05 Aug), then the 09:00 slot, then confirm.
      await page.waitForTimeout(1600);
      await clickEl(page, page.getByRole("button", { name: "Next month" }));
      await page.waitForTimeout(1200);
      await clickEl(page, page.getByRole("button", { name: "5", exact: true }).first());
      await page.waitForTimeout(1400);
      await clickEl(page, page.getByRole("button").filter({ hasText: "09:00" }).first());
      await page.waitForSelector("text=Confirm Reschedule", { timeout: 10000 });
      await page.waitForTimeout(1600);
      const confirm = page.getByRole("button", { name: "Confirm Reschedule" });
      const focal = await measureFocal(page, confirm);
      await clickEl(page, confirm);
      await page.waitForSelector("text=/rescheduled successfully/i", { timeout: 30000 });
      await page.waitForTimeout(2200);
      return focal;
    },
  },
  {
    id: "mb-04-cancel-quote", state: "customer", durationMs: 12000, hero: false,
    caption: "Cancel shows a live refund quote — computed, not guessed",
    async run(page) {
      await page.goto(`${BOOKING_URL}/my-bookings`, { waitUntil: "domcontentloaded" });
      await waitForFonts(page);
      await page.waitForSelector("text=Morning Kayak", { timeout: 25000 });
      await page.waitForTimeout(1000);
      await clickEl(page, page.getByRole("button", { name: "Cancel", exact: true }).first());
      await page.waitForSelector("text=/refund/i", { timeout: 15000 });
      await page.waitForTimeout(1800);
      const focal = await measureFocal(page, page.locator("text=/R\\s?\\d/").first());
      await page.waitForTimeout(1500);
      // dismiss without confirming — this beat only shows the quote
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
      return focal;
    },
  },

  // — weather cancel (admin; wx-02 is DESTRUCTIVE, one take) —
  {
    id: "wx-01-slots", state: "admin", durationMs: 10000, hero: false,
    caption: "Saturday looks rough",
    async run(page) {
      await page.goto(`${ADMIN_URL}/slots`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Slot Management", { timeout: 20000 });
      await page.waitForSelector('div[title="Morning Kayak"]', { timeout: 20000 });
      await page.waitForTimeout(1500);
      const card = satCard(page); // Sat 01 Aug 09:00
      await hoverEl(page, card);
      await page.waitForTimeout(1000);
      const focal = await measureFocal(page, card);
      await page.waitForTimeout(1200);
      return focal;
    },
  },
  {
    id: "wx-02-cancel", state: "admin", durationMs: 16000, hero: true,
    caption: "One click: slot closed, every guest notified",
    destructive: true,
    async run(page) {
      await page.goto(`${ADMIN_URL}/slots`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Slot Management", { timeout: 20000 });
      await page.waitForSelector('div[title="Morning Kayak"]', { timeout: 20000 });
      await page.waitForTimeout(1200);
      // Sat 01 Aug 09:00 = first card in the Saturday column (grid col 6).
      // Modal header is verified below before anything destructive fires.
      await clickEl(page, satCard(page));
      await page.waitForSelector("text=Edit Slot", { timeout: 10000 });
      const header = await page.locator("text=/Sat, 01 Aug/").count();
      if (header === 0) throw new Error("SAFETY STOP: slot modal is not Sat 01 Aug — refusing to weather-cancel");
      await page.waitForTimeout(1200);
      const wxBtn = page.getByText("Weather cancel", { exact: true }).first();
      const focal = await measureFocal(page, wxBtn);
      await clickEl(page, wxBtn);
      // Confirm is a bottom banner (AppNotifications) whose confirm button has
      // the same label as the modal's — scope to the banner container.
      await page.waitForSelector("text=Weather-cancel this trip?", { timeout: 10000 });
      await page.waitForTimeout(1000);
      const confirmBtn = page
        .locator("div.pointer-events-auto", { hasText: "Weather-cancel this trip?" })
        .getByRole("button", { name: "Weather cancel" });
      await clickEl(page, confirmBtn);
      await page.waitForSelector("text=Weather cancellation complete", { timeout: 45000 });
      await page.waitForTimeout(2500);
      return focal;
    },
  },

  // — refund choice (sarah, customer side; creates the queue entry) —
  {
    id: "wx-04-choice", state: null, durationMs: 18000, hero: true,
    caption: "Guests choose: refund, voucher, or a new date",
    saveStateTo: SARAH_STATE,
    async run(page) {
      await otpLogin(page, SARAH);
      await page.waitForTimeout(1000);
      await clickEl(page, page.getByText("Morning Kayak").first());
      await page.waitForTimeout(1800);
      const refundBtn = page.getByText(/refund/i).first();
      const focal = await measureFocal(page, refundBtn);
      await clickEl(page, refundBtn);
      await page.waitForTimeout(1500);
      const confirm = page.getByRole("button", { name: /request refund|confirm/i }).last();
      if (await confirm.count()) await clickEl(page, confirm);
      await page.waitForTimeout(2500);
      return focal;
    },
  },

  // — refunds admin —
  {
    id: "rf-01-queue", state: "admin", durationMs: 10000, hero: false,
    caption: "Every request in one queue",
    async run(page) {
      await page.goto(`${ADMIN_URL}/refunds`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Refund Queue", { timeout: 20000 });
      await page.waitForTimeout(1500);
      const row = page.getByText(/Sarah|Ben/).first();
      await row.waitFor({ timeout: 15000 });
      await hoverEl(page, row);
      await page.waitForTimeout(1200);
      const focal = await measureFocal(page, row);
      await page.waitForTimeout(1200);
      return focal;
    },
  },
  {
    id: "rf-02-process", state: "admin", durationMs: 14000, hero: true,
    caption: "Approve, adjust, or decline — done",
    destructive: true,
    async run(page) {
      await page.goto(`${ADMIN_URL}/refunds`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Refund Queue", { timeout: 20000 });
      await page.waitForTimeout(1500);
      const manual = page.getByRole("button", { name: "Manual" }).first();
      await manual.waitFor({ timeout: 15000 });
      const focal = await measureFocal(page, manual);
      await clickEl(page, manual);
      await page.waitForTimeout(1200);
      const confirm = page.getByRole("button", { name: /mark|confirm|process/i }).last();
      if (await confirm.count()) await clickEl(page, confirm);
      await page.waitForTimeout(3000);
      return focal;
    },
  },
  {
    id: "rf-03-done", state: "admin", durationMs: 8000, hero: false,
    caption: "Queue cleared",
    async run(page) {
      await page.goto(`${ADMIN_URL}/refunds`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Refund Queue", { timeout: 20000 });
      await page.waitForTimeout(1500);
      const empty = page.getByText(/No pending refunds/i).first();
      await empty.waitFor({ timeout: 15000 });
      const focal = await measureFocal(page, empty);
      await hoverEl(page, page.getByText(/Processed Refunds/).first());
      await page.waitForTimeout(1500);
      return focal;
    },
  },

  // — dashboard tour: start on the dashboard, click into each feature —
  // Read-only navigation, safe to retry. dt-00 lingers on the dashboard;
  // every later beat re-enters from the dashboard so each clip shows the
  // real sidebar click that opens the page.
  {
    id: "dt-00-dashboard", state: "admin", durationMs: 22000, hero: true,
    caption: "The whole day on one screen",
    async run(page) {
      await page.goto(`${ADMIN_URL}/`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Revenue", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1800);
      await moveTo(page, 960, 480, 30);
      // Full ride: hero + revenue → refunds/inbox/photos tiles → today's
      // trips → Roll Call → Weather, then glide back to the top.
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 480);
        await page.waitForTimeout(1400);
      }
      await hoverEl(page, page.getByText("Weather", { exact: true }).first()).catch(() => {});
      await page.waitForTimeout(1200);
      await page.mouse.wheel(0, -2400);
      await page.waitForTimeout(1600);
      // Fixed content-area focal: text locators here latch onto the sidebar.
      const focal = { x: 0.5, y: 0.4, width: 0.34, height: 0.22 };
      await page.waitForTimeout(800);
      return focal;
    },
  },
  // Everything the dashboard itself links to, clicked from the dashboard:
  // hero tile → Bookings, Revenue card → Reports, the three count tiles,
  // and the New Booking button. Read-only navigation, safe to retry.
  ...[
    { id: "dt-10-today-bookings", sel: 'a.ui-card-hover[href="/bookings"]', ready: '[title^="Export CSV"]', focal: "text=Bookings", caption: "The hero tile opens Bookings" },
    { id: "dt-11-revenue-reports", sel: 'a.ui-card-hover[href="/reports"]', ready: "text=Financials", focal: "text=Financials", caption: "Revenue opens Reports" },
    { id: "dt-12-tile-refunds", sel: 'a.ui-card-hover[href="/refunds"]', ready: "text=Refund Queue", focal: "text=Refund Queue", caption: "The refunds tile opens the queue" },
    { id: "dt-13-tile-inbox", sel: 'a.ui-card-hover[href="/inbox"]', ready: 'h1:has-text("Inbox")', focal: 'h1:has-text("Inbox")', caption: "The chats tile opens the Inbox" },
    { id: "dt-14-tile-photos", sel: 'a.ui-card-hover[href="/photos"]', ready: 'h1:has-text("Trip Photos")', focal: 'h1:has-text("Trip Photos")', caption: "The photos tile opens Trip Photos" },
    { id: "dt-15-new-booking", sel: 'a.ui-btn-primary[href="/new-booking"]', ready: 'h2:has-text("New Booking")', focal: 'h2:has-text("New Booking")', caption: "New Booking, one click from the top" },
  ].map((p) => ({
    id: p.id, state: "admin", durationMs: 11000, hero: false, caption: p.caption,
    async run(page) {
      await page.goto(`${ADMIN_URL}/`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Revenue", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const link = page.locator(p.sel).first();
      await link.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await hoverEl(page, link, 40);
      await page.waitForTimeout(700); // let the card's hover lift read on camera
      await link.click();
      await page.waitForSelector(p.ready, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1600);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(1200);
      let focal;
      try { focal = await measureFocal(page, page.locator(p.focal).first()); }
      catch { focal = { x: 0.5, y: 0.42, width: 0.3, height: 0.2 }; }
      await page.waitForTimeout(700);
      return focal;
    },
  })),
  ...[
    { id: "dt-01-bookings", href: "/bookings", ready: '[title^="Export CSV"]', focal: "text=Bookings", caption: "Every booking, searchable" },
    { id: "dt-02-slots", href: "/slots", ready: "text=Slot Management", focal: "text=Slot Management", caption: "Capacity on a live calendar" },
    { id: "dt-03-refunds", href: "/refunds", ready: "text=Refund Queue", focal: "text=Refund Queue", caption: "Every refund in one queue" },
    { id: "dt-04-inbox", href: "/inbox", ready: 'h1:has-text("Inbox")', focal: 'h1:has-text("Inbox")', caption: "WhatsApp and web chat, one inbox" },
    { id: "dt-05-marketing", href: "/marketing", ready: "text=Email Usage This Month", focal: "text=Email Usage This Month", caption: "Campaigns and automations" },
    { id: "dt-06-reports", href: "/reports", ready: "text=Financials", focal: "text=Financials", caption: "Reports on money-truth numbers" },
    { id: "dt-07-reviews", href: "/reviews", ready: 'h1:has-text("Reviews")', focal: 'h1:has-text("Reviews")', caption: "Reviews in one place" },
    { id: "dt-08-settings", href: "/settings", ready: 'h1:has-text("Settings")', focal: 'h1:has-text("Settings")', caption: "Tours, policies, integrations" },
  ].map((p) => ({
    id: p.id, state: "admin", durationMs: 11000, hero: false, caption: p.caption,
    async run(page) {
      await page.goto(`${ADMIN_URL}/`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Revenue", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const link = page.locator(`a[href="${p.href}"]`).first();
      await clickEl(page, link, 40);
      await page.waitForSelector(p.ready, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1600);
      await page.mouse.wheel(0, 350);
      await page.waitForTimeout(1400);
      let focal;
      try { focal = await measureFocal(page, page.locator(p.focal).first()); }
      catch { focal = { x: 0.5, y: 0.42, width: 0.3, height: 0.2 }; }
      await page.waitForTimeout(800);
      return focal;
    },
  })),
];

// ── auth bootstrap / helpers ──────────────────────────────────────────────
async function adminLogin() {
  await mkdir(TMP_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: SIZE });
  const page = await context.newPage();
  await page.goto(ADMIN_URL, { waitUntil: "domcontentloaded" });
  console.log("\n▶ A browser window is open. Sign in to the admin (justpassingpodcast@gmail.com).");
  console.log("  Waiting for the dashboard …");
  await page.waitForSelector("text=POWERED BY", { timeout: 1800000 });
  await page.waitForTimeout(2000);
  await context.storageState({ path: ADMIN_STATE });
  await browser.close();
  console.log(`✔ Admin session saved → ${ADMIN_STATE}`);
}

/** Ben requests his refund off-camera (keeps the story, saves a login beat).
 * Magic-link variant: OTP sends for Ben are rate-limited right now, so ask
 * for a sign-in link and have the operator relay the URL instead. */
async function benChoice() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: SIZE });
  const page = await context.newPage();
  await page.goto(`${BOOKING_URL}/my-bookings`, { waitUntil: "domcontentloaded" });
  const emailInput = page.locator('input[placeholder="your@email.com"]');
  await emailInput.waitFor({ timeout: 15000 });
  await emailInput.fill(BEN.email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.waitForSelector("text=/sign-in link is on its way|Check your email/i", { timeout: 15000 });
  const link = await waitForOtpCode(BEN.email);
  await page.goto(link, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Morning Kayak", { timeout: 30000 });
  await page.waitForTimeout(1000);
  await benChoiceActions(page, browser);
}

/** Sarah's on-camera beat showed the choice UI; complete her actual request
 * off-camera using the customer session saved by wx-04-choice. */
async function sarahChoice() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: SIZE, storageState: SARAH_STATE });
  const page = await context.newPage();
  await page.goto(`${BOOKING_URL}/my-bookings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Morning Kayak", { timeout: 30000 });
  await benChoiceActions(page, browser);
}

async function benChoiceActions(page, browser) {
  await page.waitForTimeout(800);
  await clickEl(page, page.getByRole("button", { name: /Refund · R/ }).first());
  await page.waitForTimeout(1500);
  const confirm = page.getByRole("button", { name: /request refund|confirm/i }).last();
  if (await confirm.count()) await clickEl(page, confirm);
  await page.waitForTimeout(2500);
  await browser.close();
  console.log("✔ Ben's refund requested");
}

async function emailStills() {
  const srcDir = join(TMP_DIR, "emails");
  const files = (await readdir(srcDir)).filter((f) => f.endsWith(".html"));
  if (!files.length) throw new Error(`no .html files in ${srcDir}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 760, height: 1100 }, deviceScaleFactor: 2 });
  const out = [];
  for (const f of files) {
    await page.goto("file://" + join(srcDir, f), { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const png = join(OUT_DIR, f.replace(/\.html$/, ".png"));
    await page.screenshot({ path: png, fullPage: true });
    out.push(basename(png));
    console.log(`✔ ${png}`);
  }
  await browser.close();
  return out;
}

// ── stage check ───────────────────────────────────────────────────────────
async function checkStage() {
  const checks = [];
  const ok = (label, pass, detail = "") => checks.push({ label, pass, detail });
  ok("admin session state saved", await exists(ADMIN_STATE), ADMIN_STATE);
  const browser = await chromium.launch();
  if (await exists(ADMIN_STATE)) {
    const ctx = await browser.newContext({ viewport: SIZE, storageState: ADMIN_STATE });
    const page = await ctx.newPage();
    try {
      await page.goto(`${ADMIN_URL}/slots`, { waitUntil: "domcontentloaded" });
      await waitAdminReady(page);
      await page.waitForSelector("text=Slot Management", { timeout: 20000 });
      ok("admin /slots reachable with saved session", true);
      await page.waitForSelector('div[title="Morning Kayak"]', { timeout: 20000 });
      const cardCount = await page.locator('div[title="Morning Kayak"]').count();
      ok("slot cards render", cardCount >= 4, `${cardCount} cards visible`);
      const satVisible = await satCard(page).count();
      ok("Saturday 09:00 card locatable", satVisible >= 1);
    } catch (e) {
      ok("admin /slots reachable with saved session", false, e.message);
    }
    await ctx.close();
  }
  const page2 = await browser.newPage({ viewport: SIZE });
  try {
    await page2.goto(`${BOOKING_URL}/my-bookings`, { waitUntil: "domcontentloaded" });
    await page2.waitForSelector('input[placeholder="your@email.com"]', { timeout: 15000 });
    ok("booking /my-bookings login renders", true);
  } catch (e) {
    ok("booking /my-bookings login renders", false, e.message);
  }
  await browser.close();
  const allOk = checks.every((c) => c.pass);
  console.log("\n── Feature-stage readiness ──");
  for (const c of checks) console.log(`  ${c.pass ? "✔" : "✘"} ${c.label}${c.detail ? " — " + c.detail : ""}`);
  return allOk;
}

// ── runner ────────────────────────────────────────────────────────────────
async function runBeat(browser, beat) {
  const opts = { viewport: SIZE, recordVideo: { dir: TMP_DIR, size: SIZE } };
  if (beat.state === "admin") opts.storageState = ADMIN_STATE;
  if (beat.state === "customer") opts.storageState = CUSTOMER_STATE;
  if (beat.state === "sarah") opts.storageState = SARAH_STATE;
  const context = await browser.newContext(opts);
  await context.addInitScript(CURSOR_INIT_SCRIPT);
  const page = await context.newPage();
  await page.addStyleTag({ content: "::-webkit-scrollbar { display: none }" }).catch(() => {});

  let focal = null, lastErr = null;
  const maxAttempts = beat.destructive ? 1 : 3; // destructive beats never blind-retry
  for (let attempt = 1; attempt <= maxAttempts && !focal; attempt++) {
    try {
      focal = await beat.run(page);
    } catch (e) {
      lastErr = e;
      console.warn(`  ⚠ ${beat.id} attempt ${attempt}/${maxAttempts} failed: ${e.message}`);
    }
  }
  if (focal && beat.saveStateTo) await context.storageState({ path: beat.saveStateTo });
  // Supabase rotates refresh tokens: persist the rotated session after every
  // beat, or the next run replays a revoked token and dies on the login screen.
  const stateFiles = { admin: ADMIN_STATE, customer: CUSTOMER_STATE, sarah: SARAH_STATE };
  if (focal && beat.state && stateFiles[beat.state]) await context.storageState({ path: stateFiles[beat.state] });
  const video = page.video();
  await context.close();
  if (!focal) throw new Error(`beat ${beat.id} failed: ${lastErr?.message}`);
  const webm = join(TMP_DIR, `${beat.id}.webm`);
  await video.saveAs(webm);
  return { focal, webm };
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const only = argv.find((a) => a.startsWith("--only="))?.slice(7)?.split(",").map((s) => s.trim());

  await mkdir(TMP_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  if (has("--admin-login")) return adminLogin();
  if (has("--ben-choice")) return benChoice();
  if (has("--sarah-choice")) return sarahChoice();
  if (has("--email-stills")) return emailStills();
  if (has("--check")) {
    const okAll = await checkStage();
    process.exit(okAll ? 0 : 1);
  }

  const beatsToRun = only ? BEATS.filter((b) => only.includes(b.id)) : BEATS;
  if (!beatsToRun.length) throw new Error("no beats matched --only");
  for (const b of beatsToRun) {
    if ((b.state === "admin") && !(await exists(ADMIN_STATE)))
      throw new Error("admin-state.json missing — run --admin-login first");
    if ((b.state === "customer") && !(await exists(CUSTOMER_STATE)))
      throw new Error("customer-state.json missing — run mb-01-login first");
  }

  const browser = await chromium.launch();
  // Manifest is additive across invocations: captures happen in phases.
  const manifestPath = join(OUT_DIR, "feature-shots.json");
  let manifest = { capturedAt: null, tenant: "jerrys", fps: FPS, size: SIZE, shots: [] };
  if (await exists(manifestPath)) manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  for (const beat of beatsToRun) {
    console.log(`\n▶ ${beat.id}${beat.destructive ? "  [DESTRUCTIVE — one take]" : ""}`);
    const { focal, webm } = await runBeat(browser, beat);
    const mp4 = join(OUT_DIR, `${beat.id}.mp4`);
    await transcode(webm, mp4);
    await rm(webm, { force: true });
    manifest.shots = manifest.shots.filter((s) => s.id !== beat.id);
    manifest.shots.push({
      id: beat.id, file: `${beat.id}.mp4`, durationMs: beat.durationMs,
      focal, hero: !!beat.hero, caption: beat.caption,
    });
    manifest.capturedAt = new Date().toISOString();
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`  ✔ → ${mp4}`);
  }
  await browser.close();
  console.log(`\n✔ Manifest → ${manifestPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
