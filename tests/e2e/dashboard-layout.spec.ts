import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { DEFAULT_DASHBOARD_LAYOUT, type DashboardLayout } from "../../app/lib/dashboard-layout";

const A = "10000000-0000-4000-8000-000000000001", B = "10000000-0000-4000-8000-000000000002";
const shots = ".impeccable/review";
function fixture() {
  const records = new Map<string, { layout: DashboardLayout; revision: number }>();
  const state = { failRead: false, failSave: false, conflict: false, writes: 0, delayRead: null as null | { started: () => void; wait: Promise<void> } };
  async function setup(page: Page) {
    await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
    await page.addInitScript(() => {
      localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
      localStorage.setItem("ck_welcome_done", "1"); localStorage.setItem("ck_admin_settings_perms", "{}");
    });
    await page.routeWebSocket(/realtime/, () => {});
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.hostname !== "127.0.0.1" || !["3160", "3161"].includes(url.port)) return route.abort();
      if (url.pathname === "/api/dashboard-layout") {
        const business = req.headers()["x-admin-business-id"] || A;
        const saved = records.get(business) || { layout: structuredClone(DEFAULT_DASHBOARD_LAYOUT), revision: 0 };
        if (req.method() === "GET") {
          if (state.failRead) return route.fulfill({ status: 503, json: { error: "Could not load the saved dashboard layout. Try again." } });
          if (state.delayRead) { const delay = state.delayRead; state.delayRead = null; delay.started(); await delay.wait; }
          return route.fulfill({ json: saved });
        }
        state.writes++;
        if (state.failSave) return route.fulfill({ status: 503, json: { error: "The layout was not saved. Your changes are still here; try saving again." } });
        const body = req.postDataJSON();
        if (state.conflict || body.revision !== saved.revision) return route.fulfill({ status: 409, json: { error: "Another admin changed this layout. Reload the saved layout before editing again." } });
        records.set(business, { layout: body.layout, revision: saved.revision + 1 });
        return route.fulfill({ json: records.get(business) });
      }
      if (url.pathname.endsWith("/rpc/get_operator_dashboard") && req.postDataJSON().p_business_id === B)
        return route.fulfill({ json: { business_id: B, today_manifest: [], tomorrow_manifest: [], refund_count: 0, refund_total: 0, inbox_count: 0, photos_outstanding: 0, revenue: { today: 0, week: 0, month: 0, series: [] }, weather_widget_locations: [] } });
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Other APIs disabled in synthetic preview" } });
      return route.continue();
    });
  }
  return { setup, records, state };
}
const tile = (page: Page, id: string) => page.locator(`[data-dashboard-tile="${id}"]`);
const order = (page: Page) => page.locator("[data-dashboard-tile]").evaluateAll(elements => elements.map(el => el.getAttribute("data-dashboard-tile")));
const editorOrder = (page: Page) => page.locator("[data-layout-id]").evaluateAll(elements => elements.map(el => el.getAttribute("data-layout-id")));
const edit = (page: Page) => page.getByRole("button", { name: "Edit dashboard", exact: true }).click();
async function save(page: Page) {
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arrange dashboard" })).toHaveCount(0);
}
test.beforeEach(async ({ request }) => { mkdirSync(shots, { recursive: true }); await request.post("http://127.0.0.1:3161/__fixture/reset"); });

test("desktop drag, keyboard movement, hide, shared reload and restore", async ({ page, browser }) => {
  const f = fixture(); await f.setup(page); await page.goto("/");
  await expect(tile(page, "manifest")).toBeVisible();
  expect(await order(page)).toEqual(DEFAULT_DASHBOARD_LAYOUT.order);
  await page.screenshot({ path: `${shots}/dashboard-layout-default-desktop.png`, fullPage: true, animations: "disabled" });
  await edit(page);
  const first = page.getByRole("button", { name: "Move Next departure", exact: true });
  await first.focus(); await page.keyboard.press("ArrowDown");
  expect((await editorOrder(page)).slice(0, 2)).toEqual(["guests", "next_departure"]);
  const from = await first.boundingBox(), to = await page.locator('[data-layout-id="manifest"]').boundingBox();
  await page.mouse.move(from!.x + 15, from!.y + 20); await page.mouse.down();
  await page.mouse.move(to!.x + 25, to!.y + 25, { steps: 6 }); await page.mouse.up();
  expect((await editorOrder(page)).slice(0, 4)).toEqual(["guests", "booking_value", "manifest", "next_departure"]);
  await page.getByRole("button", { name: "Hide Inbox action", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show Inbox action", exact: true })).toBeVisible();
  await page.screenshot({ path: `${shots}/dashboard-layout-desktop.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Show Inbox action", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/dashboard-layout-hidden-desktop.png`, animations: "disabled" });
  await save(page); await page.reload();
  await expect(tile(page, "inbox")).toHaveCount(0); await expect(tile(page, "manifest")).toBeVisible();
  expect((await order(page)).slice(0, 4)).toEqual(["guests", "booking_value", "manifest", "next_departure"]);
  const staffContext = await browser.newContext(), staff = await staffContext.newPage();
  await f.setup(staff); await staff.goto("http://127.0.0.1:3160/?role=ADMIN");
  await expect(tile(staff, "manifest")).toBeVisible(); await expect(tile(staff, "inbox")).toHaveCount(0);
  await expect(staff.getByRole("button", { name: "Edit dashboard", exact: true })).toHaveCount(0);
  expect(await order(staff)).toEqual(await order(page)); await staffContext.close();
  await edit(page); await page.getByRole("button", { name: "Show Inbox action", exact: true }).click(); await save(page);
  await expect(tile(page, "inbox")).toBeVisible(); expect(f.state.writes).toBe(2);
});

test("touch dragging and 320px controls fit, persist and remain keyboard accessible", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(), f = fixture(); await f.setup(page); await page.goto("http://127.0.0.1:3160/");
  await edit(page);
  const handle = page.getByRole("button", { name: "Move Next departure", exact: true });
  const from = await handle.boundingBox(), to = await page.locator('[data-layout-id="booking_value"]').boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from!.x + 15, y: from!.y + 20 }] });
  for (let step = 1; step <= 5; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from!.x + 15, y: from!.y + 20 + (to!.y - from!.y) * step / 5 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect((await editorOrder(page)).slice(0, 3)).toEqual(["guests", "booking_value", "next_departure"]);
  await page.getByRole("button", { name: "Move Next departure up", exact: true }).click();
  expect((await editorOrder(page))[1]).toBe("next_departure");
  const guestHandle = await page.getByRole("button", { name: "Move Today's guests", exact: true }).boundingBox();
  const beforeScroll = await page.locator("main").evaluate(el => el.scrollTop);
  const mainBounds = await page.locator("main").boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: guestHandle!.x + 15, y: guestHandle!.y + 20 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: guestHandle!.x + 15, y: mainBounds!.y + mainBounds!.height - 30 }] });
  await expect.poll(() => page.locator("main").evaluate(el => el.scrollTop)).toBeGreaterThan(beforeScroll + 100);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect((await editorOrder(page)).indexOf("guests")).toBeGreaterThan(2);
  await page.getByRole("button", { name: "Hide Weather", exact: true }).click();
  await page.getByRole("heading", { name: "Arrange dashboard" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/dashboard-layout-mobile.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Show Weather", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/dashboard-layout-hidden-mobile.png`, animations: "disabled" });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("heading", { name: "Arrange dashboard" }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await handle.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })).toBe(true);
  await page.screenshot({ path: `${shots}/dashboard-layout-user-320.png`, fullPage: true, animations: "disabled" });
  await save(page); await page.reload(); await expect(tile(page, "guests")).toBeVisible(); await expect(tile(page, "weather")).toHaveCount(0);
  await context.close();
});

test("cancel, failed save, conflict and failed reads preserve saved choices", async ({ page }) => {
  const f = fixture(); await f.setup(page); await page.goto("/"); await edit(page);
  await page.getByRole("button", { name: "Hide Weather", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(tile(page, "weather")).toBeAttached(); expect(f.state.writes).toBe(0);
  await edit(page); await page.getByRole("button", { name: "Hide Weather", exact: true }).click();
  f.state.failSave = true; await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not saved" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Weather", exact: true })).toBeVisible();
  f.state.failSave = false; f.state.conflict = true;
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save layout", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Restore default layout", exact: true })).toBeDisabled();
  f.records.set(A, { layout: { ...structuredClone(DEFAULT_DASHBOARD_LAYOUT), hidden: ["inbox"] }, revision: 1 });
  await page.getByRole("button", { name: "Discard & reload" }).click();
  await expect(tile(page, "weather")).toBeAttached(); await expect(tile(page, "inbox")).toHaveCount(0);
  f.state.failRead = true; await page.reload(); await expect(page.getByRole("alert").filter({ hasText: "Could not load" })).toBeVisible();
  await expect(page.locator("[data-dashboard-tile]")).toHaveCount(0);
  f.state.failRead = false; await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(tile(page, "manifest")).toBeVisible(); await expect(tile(page, "inbox")).toHaveCount(0);
});

test("all hidden remains recoverable after reload", async ({ page }) => {
  const f = fixture(); await f.setup(page); await page.goto("/"); await edit(page);
  for (const label of ["Next departure", "Today's guests", "Booking value", "Manifest", "Roll Call", "Pending refunds", "Inbox action", "Photo upload backlog", "Payment recovery", "Weather"])
    await page.getByRole("button", { name: `Hide ${label}`, exact: true }).click();
  await expect(page.getByText("All tiles are hidden.", { exact: false })).toBeVisible();
  await save(page); await page.reload(); await expect(page.getByRole("heading", { name: "No dashboard tiles are showing" })).toBeVisible();
  await edit(page); await page.getByRole("button", { name: "Show Manifest", exact: true }).click(); await save(page);
  expect(await order(page)).toEqual(["manifest"]);
});

test("role changes discard drafts, read-only users cannot edit, super-admin layouts stay operator-specific", async ({ page }) => {
  const f = fixture(); await f.setup(page); await page.goto("/?role=SUPER_ADMIN"); await edit(page);
  await page.getByRole("button", { name: "Hide Weather", exact: true }).click(); await save(page);
  await edit(page); await page.getByRole("button", { name: "Hide Inbox action", exact: true }).click();
  await page.evaluate(() => { history.replaceState(null, "", "/?role=ADMIN"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page.getByRole("heading", { name: "Arrange dashboard" })).toHaveCount(0);
  await expect(tile(page, "inbox")).toBeAttached(); await expect(tile(page, "weather")).toHaveCount(0);
  for (const role of ["MAIN_ADMIN", "SUPER_ADMIN"]) {
    await page.goto(`/?role=${role}&readonly=1`); await expect(tile(page, "manifest")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit dashboard", exact: true })).toHaveCount(0);
  }
  await page.goto("/?role=SUPER_ADMIN"); await expect(tile(page, "manifest")).toBeVisible();
  await page.evaluate(business => { history.replaceState(null, "", `/?role=SUPER_ADMIN&business=${business}`); window.dispatchEvent(new PopStateEvent("popstate")); }, B);
  await expect(tile(page, "weather")).toBeAttached(); await edit(page);
  await page.getByRole("button", { name: "Hide Manifest", exact: true }).click(); await save(page);
  expect(f.records.get(A)?.layout.hidden).toEqual(["weather"]); expect(f.records.get(B)?.layout.hidden).toEqual(["manifest"]);
});

test("an older in-flight refresh cannot replace a newly saved layout", async ({ page }) => {
  const f = fixture(); await f.setup(page); await page.goto("/"); await expect(tile(page, "manifest")).toBeVisible();
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  f.state.delayRead = { started, wait: new Promise<void>(resolve => { release = resolve; }) };
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await pending;
  await edit(page); await page.getByRole("button", { name: "Hide Inbox action", exact: true }).click(); await save(page);
  const read = page.waitForResponse(response => response.url().includes("/api/dashboard-layout") && response.request().method() === "GET");
  release(); await read; await expect(tile(page, "inbox")).toHaveCount(0);
  await expect(tile(page, "manifest")).toBeVisible();
});

for (const [role, width] of [["MAIN_ADMIN", 1440], ["SUPER_ADMIN", 390]] as const) test(`${role} restores the default layout at ${width}px without losing changes on cancel or save failure`, async ({ page }) => {
  const f = fixture(), custom = { order: [...DEFAULT_DASHBOARD_LAYOUT.order].reverse(), hidden: [...DEFAULT_DASHBOARD_LAYOUT.order] };
  f.records.set(A, { layout: custom, revision: 7 });
  await f.setup(page); await page.setViewportSize({ width, height: 1000 }); await page.goto(`/?role=${role}`); await edit(page);
  const restore = page.getByRole("button", { name: "Restore default layout", exact: true });
  await restore.focus(); await page.keyboard.press("Enter");
  expect(await editorOrder(page)).toEqual(DEFAULT_DASHBOARD_LAYOUT.order);
  await expect(page.getByRole("heading", { name: "Hidden tiles (0)", exact: true })).toBeVisible();
  expect(f.state.writes).toBe(0); expect(f.records.get(A)).toEqual({ layout: custom, revision: 7 });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No dashboard tiles are showing", exact: true })).toBeVisible();
  await edit(page); await restore.click();
  f.state.failSave = true; await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not saved" })).toBeVisible();
  expect(f.records.get(A)).toEqual({ layout: custom, revision: 7 });
  expect(await editorOrder(page)).toEqual(DEFAULT_DASHBOARD_LAYOUT.order);
  f.state.failSave = false; await restore.click();
  await page.getByRole("heading", { name: "Arrange dashboard", exact: true }).scrollIntoViewIfNeeded();
  expect(await restore.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `${shots}/dashboard-reset-${width === 1440 ? "desktop" : "mobile"}.png`, animations: "disabled" });
  if (width === 390) {
    await page.setViewportSize({ width: 320, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${shots}/dashboard-reset-user-320.png`, animations: "disabled" });
  }
  await save(page); await page.reload(); await expect(tile(page, "next_departure")).toBeVisible();
  expect(await order(page)).toEqual(DEFAULT_DASHBOARD_LAYOUT.order);
  expect(f.records.get(A)).toEqual({ layout: DEFAULT_DASHBOARD_LAYOUT, revision: 8 });
});
