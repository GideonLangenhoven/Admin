import { test, expect } from "@playwright/test";

const TOUR = "10000000-0000-4000-8000-000000000003";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname === "/rest/v1/tours") return route.fulfill({ json: [{ id: TOUR, name: "Harbour paddle", base_price_per_person: 600, duration_minutes: 150, default_capacity: 10, active: true, hidden: false }] });
    if (url.pathname === "/rest/v1/admin_users") return route.fulfill({ json: request.headers().accept?.includes("vnd.pgrst.object") ? { settings_permissions: { tours: true } } : [] });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    return route.continue();
  });
});

for (const width of [320, 390, 768, 1440]) test(`duration values and admin invitation entry remain clear at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/settings#tours");
  await expect(page.getByText("Duration: 2 hours 30 min", { exact: true })).toBeVisible();
  await page.locator('[data-demo-drag="tour.reorder"]').filter({ hasText: "Harbour paddle" }).click();
  const form = page.getByRole("form", { name: "Tour details" });
  const hours = form.getByRole("spinbutton", { name: "Duration hours", exact: true });
  const minutes = form.getByRole("spinbutton", { name: "Duration minutes", exact: true });
  await expect(hours).toHaveValue("2"); await expect(minutes).toHaveValue("30");
  for (const input of [hours, minutes]) expect(await input.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(100);
  await form.getByRole("group", { name: "Tour duration", exact: true }).screenshot({ path: testInfo.outputPath(`duration-${width}.png`), animations: "disabled" });
  const scheduleLink = form.getByRole("link", { name: "Slots → Bulk Edit → Close weekday slots", exact: true });
  await expect(scheduleLink).toHaveAttribute("href", `/slots?panel=bulk-edit&tour=${TOUR}`);
  expect(await page.locator("main").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("link", { name: "Add admin", exact: true }).click();
  await expect(page.locator("#add-admin")).toBeFocused();
  await expect(page.getByPlaceholder("admin@example.com", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add admin", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`add-admin-${width}.png`), animations: "disabled" });
});

test("regular admins cannot access the new invitation shortcut", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ck_admin_role", "ADMIN"));
  await page.goto("/settings?role=ADMIN#tours");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add admin", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add admin", exact: true })).toHaveCount(0);
});

test("weekend closure is reachable for the selected tour and fits a phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/slots?panel=bulk-edit&tour=${TOUR}`);
  const dialog = page.getByRole("dialog", { name: "Bulk Edit Slots", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Tour", exact: true })).toHaveValue(TOUR);
  const close = dialog.getByRole("button", { name: "Close weekday slots", exact: true });
  await close.scrollIntoViewIfNeeded(); await expect(close).toBeDisabled();
  await expect(dialog.getByText("Saturday and Sunday slots, existing bookings and holds stay unchanged.", { exact: false })).toBeVisible();
  expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator("main").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("weekends-320.png"), animations: "disabled" });
});
