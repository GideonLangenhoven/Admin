import { test, expect, type Page } from "@playwright/test";

// M5: clearing the chatbot personality saves it blank (the column is NOT NULL
// and blank means the standard assistant), and a failed save shows a plain
// message, never database text.
const NOT_NULL = { code: "23502", message: 'null value in column "ai_system_prompt" of relation "businesses" violates not-null constraint', details: null, hint: null };
type Notice = { title?: string; message: string; tone?: string };

async function openOperations(page: Page, answer?: { status: number; json: unknown }) {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  const writes: Record<string, unknown>[] = [];
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/rest/v1/businesses" && req.method() === "PATCH") {
      const body = req.postDataJSON();
      writes.push(body);
      if (answer) return route.fulfill(answer);
      // Like the live column: ai_system_prompt text NOT NULL DEFAULT ''.
      return route.fulfill(body.ai_system_prompt === null ? { status: 400, json: NOT_NULL } : { status: 204 });
    }
    if (url.pathname === "/rest/v1/businesses" && req.method() === "GET") {
      const res = await route.fetch();
      const rows = await res.json();
      const edit = (row: object) => ({ ...row, ai_system_prompt: "Be cheerful and brief." });
      return route.fulfill({ response: res, json: Array.isArray(rows) ? rows.map(edit) : rows && edit(rows) });
    }
    return route.continue();
  });
  // The preview has no notification layer, so notify() logs its payload to the console.
  const seen: Notice[] = [];
  page.on("console", async msg => {
    if (msg.type() === "warning" && msg.text().startsWith("App notification emitted")) seen.push(await msg.args()[1].jsonValue());
  });
  await page.goto("/settings#operations");
  return { writes, seen, form: page.locator('form[data-demo-submit="operations.save"]') };
}

test("clearing the chatbot personality saves it blank", async ({ page }) => {
  const { writes, seen, form } = await openOperations(page);
  const prompt = form.getByLabel(/AI chatbot personality/);
  await expect(prompt).toHaveValue("Be cheerful and brief.");
  await prompt.fill("");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => seen.find(n => n.message === "Operations & AI settings saved.")).toMatchObject({ tone: "success" });
  expect(writes.map(w => w.ai_system_prompt)).toEqual([""]);
});

test("a failed save shows a plain message, never database text", async ({ page }) => {
  const { seen, form } = await openOperations(page, { status: 403, json: { code: "42501", message: 'new row violates row-level security policy for table "businesses"' } });
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => seen.find(n => n.tone === "error"))
    .toEqual({ title: "Settings not saved", message: "The operations and AI settings could not be saved. Please try again.", tone: "error" });
});
