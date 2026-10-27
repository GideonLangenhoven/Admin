import { test, expect } from "@playwright/test";

// P2: clearing Directions (or any rich-text field) saved "<br>", which emails
// and WhatsApp then showed as the meeting point.
const FIXTURE = "http://127.0.0.1:3191";

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

test("a cleared rich-text field saves as empty", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  const saved: { directions?: string }[] = [];
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/rest/v1/businesses" && req.method() === "PATCH") { saved.push(req.postDataJSON()); return route.fulfill({ status: 204 }); }
    return route.continue();
  });
  await page.goto("/settings#site");

  // What the browser leaves in the editor after the operator deletes everything.
  const directions = page.locator(".rich-editor-content").first();
  await directions.evaluate(el => { el.innerHTML = "<br>"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.getByRole("button", { name: "Save Site Settings" }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].directions).toBe("");
});
