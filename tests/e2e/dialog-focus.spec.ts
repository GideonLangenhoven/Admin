import { test, expect, type Locator, type Page } from "@playwright/test";
import { build } from "esbuild";

// Round 2, A2: the Rebook modal and the confirm panel (Cancel booking and every
// other confirmAction) were not dialogs: no role, no aria-modal, and Tab walked
// out of them into the page behind.
const BOOKING = "10000000-0000-4000-8000-000000000020"; // PAID, 3 guests
const FIXTURE = "http://127.0.0.1:3191";

async function focusStaysIn(page: Page, dialog: Locator, keys: string[]) {
  for (const key of keys) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate(el => el.contains(document.activeElement)), key).toBe(true);
  }
}

test("Rebook is a modal dialog that keeps focus until it closes", async ({ page, request }) => {
  await request.post(`${FIXTURE}/__fixture/reset`);
  await page.setViewportSize({ width: 662, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    return route.continue();
  });

  await page.goto("/bookings");
  await page.getByRole("button", { name: /view guests/i }).first().click();
  const opener = page.locator(`[data-booking-id="${BOOKING}"]`).filter({ visible: true }).first().getByRole("button", { name: "Guest actions", exact: true });
  await opener.click();
  await page.locator("[data-mobile-action-sheet]").getByRole("button", { name: /^Rebook/ }).click();

  const dialog = page.getByRole("dialog", { name: "Rebook Booking" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  // Focus moves in, even though the closing action sheet hands focus back to its trigger.
  await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await focusStaysIn(page, dialog, ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]);

  // An open date calendar takes Escape first; the next Escape closes the dialog.
  await dialog.locator("[aria-expanded]").first().click();
  await page.keyboard.press("Escape");
  await expect(dialog.locator('[aria-expanded="true"]')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("the confirm panel is a modal dialog: the safe choice has focus, Tab stays in, Escape keeps the booking", async ({ page }) => {
  // The operator preview has no notification layer, so mount the real one on a blank page.
  const bundle = await build({
    stdin: {
      contents: `
        import { createRoot } from "react-dom/client";
        import AppNotifications from "./components/AppNotifications";
        import { confirmAction } from "./app/lib/app-notify";
        createRoot(document.getElementById("root")).render(<AppNotifications />);
        document.getElementById("opener").onclick = async () => {
          const result = await confirmAction({ title: "Cancel booking", message: "Cancel booking ABC123?", tone: "warning", confirmLabel: "Cancel booking", altLabel: "Cancel & notify only", cancelLabel: "Keep booking" });
          document.body.dataset.result = String(result);
        };`,
      loader: "tsx", resolveDir: process.cwd(),
    },
    bundle: true, write: false, format: "iife", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await page.setContent('<button id="opener">Cancel booking</button><div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const opener = page.locator("#opener");
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Cancel booking" });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAccessibleDescription("Cancel booking ABC123?");
  await expect(dialog.getByRole("button", { name: "Keep booking" })).toBeFocused();
  await focusStaysIn(page, dialog, ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("body")).toHaveAttribute("data-result", "false");
  await expect(opener).toBeFocused();
});
