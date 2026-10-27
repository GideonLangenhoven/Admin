import { test, expect } from "@playwright/test";

// P2: a conversation handed back to the bot still showed "ESCALATE_HUMAN"
// next to "Bot replying", because the handoff reason stays in current_intent.
const FIXTURE = "http://127.0.0.1:3191";
const convo = (id: string, name: string, status: string, current_intent: string) =>
  ({ id, phone: "2782000000" + id, customer_name: name, email: null, status, current_state: "IDLE", updated_at: "2026-10-2" + id + "T08:00:00Z", current_intent });

test("handoff reasons show only while a reply is needed, in words", async ({ page, request }) => {
  await request.post(`${FIXTURE}/__fixture/reset`);
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/rest/v1/conversations") return route.fulfill({ json: [
      convo("3", "Ava", "BOT", "ESCALATE_HUMAN"),
      convo("2", "Ben", "HUMAN", "ESCALATE_HUMAN"),
      convo("1", "Cara", "BOT", "REFUND_REQUEST"),
    ] });
    return route.continue();
  });
  await page.goto("/inbox");
  const row = (name: string) => page.getByRole("button").filter({ hasText: name });
  await expect(row("Ava")).toContainText("Bot replying");
  await expect(row("Ava")).not.toContainText(/escalate/i);
  await expect(row("Ben")).toContainText("Escalate human");
  await expect(row("Ben")).toContainText("Needs reply");
  await expect(row("Cara")).toContainText("Refund requests");
  await expect(page.getByText("ESCALATE_HUMAN")).toHaveCount(0);
});
