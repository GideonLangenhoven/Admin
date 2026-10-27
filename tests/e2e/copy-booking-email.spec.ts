import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("email copy works from the Details column and customer details", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install({ time: new Date("2026-10-15T09:00:00Z") });
  await page.addInitScript(() => { localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg"); });
  const path = "docs/production-readiness/evidence/booking-account-surfaces-20261019";
  mkdirSync(path, { recursive: true });
  await page.goto("/bookings");
  await page.getByRole("checkbox", { name: "Expand All", exact: true }).first().check();
  const copy = page.getByRole("button", { name: "Copy email address", exact: true }).first();
  await expect(copy).toBeVisible();
  const email = (await copy.locator("..").innerText()).replace(/Copy\s*$/, "").trim();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(email);
  await expect(page).toHaveURL(/\/bookings$/);
  await page.screenshot({ path: path + "/copy-email-table.png", fullPage: true });
  await page.goto("/bookings/10000000-0000-4000-8000-000000000021");
  await page.setViewportSize({ width: 390, height: 1000 });
  const details = page.getByRole("button", { name: "Copy email address", exact: true });
  await expect(details).toBeVisible();
  const address = (await details.locator("..").innerText()).replace(/Copy\s*$/, "").trim();
  await details.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  await page.getByRole("heading", { name: "Customer Details", exact: true }).locator("../..").screenshot({ path: path + "/copy-email-details.png" });
});
