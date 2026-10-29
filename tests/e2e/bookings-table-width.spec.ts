import { test, expect } from "@playwright/test";

// Round 2, item 4: at 1024px the Bookings table split words mid-word
// ("Servi ce", "R2 400, 00", "Cance l Slot"). Headers, amounts and buttons
// stay on one line, and no word breaks (e-mail addresses may).
const FIXTURE = "http://127.0.0.1:3191";

test.beforeEach(async ({ page, request }) => {
  await request.post(`${FIXTURE}/__fixture/reset`);
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
});

for (const width of [1024, 1100, 1199, 1280, 1440]) {
  test(`at ${width}px the bookings table breaks no words`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/bookings");
    await expect(page.locator("main thead th").filter({ hasText: "Service" }).first()).toBeVisible();
    for (const box of await page.getByLabel("Expand All").all()) await box.check();
    await expect(page.getByText("Group Example").filter({ visible: true }).first()).toBeVisible();

    const found = await page.evaluate(() => {
      const lineCount = (range: Range) => new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size;
      const split: string[] = [], wrapped: string[] = [], overflowing: string[] = [];
      for (const table of document.querySelectorAll("main table")) {
        const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent || "";
          const cell = node.parentElement?.closest("th, td, button");
          if (!text.trim() || !cell || !node.parentElement!.checkVisibility()) continue;
          const whole = document.createRange();
          whole.selectNodeContents(node);
          const strict = cell.tagName !== "TD" || /^\s*(↩\s*)?R[\d\s .,-]+$/.test(text);
          if (strict && lineCount(whole) > 1) wrapped.push(text.trim());
          if (strict && cell.scrollWidth > cell.clientWidth + 1) overflowing.push(text.trim());
          for (const word of text.matchAll(/[^ \n\t]+/g)) {
            if (word[0].includes("@")) continue;
            const range = document.createRange();
            range.setStart(node, word.index!);
            range.setEnd(node, word.index! + word[0].length);
            if (lineCount(range) > 1) split.push(word[0]);
          }
        }
      }
      const main = document.querySelector("main")!;
      return { split: [...new Set(split)], wrapped: [...new Set(wrapped)], overflowing: [...new Set(overflowing)], sideways: main.scrollWidth - main.clientWidth };
    });
    expect(found.split, "words split across lines").toEqual([]);
    expect(found.wrapped, "headers, amounts and buttons on more than one line").toEqual([]);
    expect(found.overflowing, "headers, amounts and buttons spilling out of their cell").toEqual([]);
    expect(found.sideways).toBeLessThanOrEqual(1);
  });
}

// Round 2, 13c: on the bottom rows the Actions menu opened below the screen.
test("the Actions menu opens upwards only when there is no room below", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/bookings");
  await expect(page.locator("main thead th").filter({ hasText: "Service" }).first()).toBeVisible();
  for (const box of await page.getByLabel("Expand All").all()) await box.check();
  const actions = page.getByRole("button", { name: "Actions ▾", exact: true });
  await expect(actions.first()).toBeVisible();
  const open = async (index: number) => {
    const button = actions.nth(index);
    await button.evaluate((el, end) => el.scrollIntoView({ block: end ? "end" : "start" }), index > 0);
    await button.click();
    const menu = button.locator("xpath=following-sibling::div[1]");
    await expect(menu).toBeVisible();
    return { button: (await button.boundingBox())!, menu: (await menu.boundingBox())! };
  };

  const top = await open(0);
  expect(top.menu.y).toBeGreaterThanOrEqual(top.button.y + top.button.height);
  await actions.nth(0).click();

  const last = await open(await actions.count() - 1);
  expect(last.button.y + last.button.height + last.menu.height).toBeGreaterThan(720); // no room below
  expect(last.menu.y + last.menu.height).toBeLessThanOrEqual(last.button.y);
});
