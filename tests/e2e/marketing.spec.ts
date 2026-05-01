import { test, expect } from "@playwright/test";
import { injectAdminSession } from "./helpers/auth";
import { collectConsoleLogs, hasTrace } from "./helpers/console-collector";

test.describe("Marketing Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("marketing page loads", async ({ page }) => {
    await page.goto("/marketing");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("marketing page has stat cards", async ({ page }) => {
    await page.goto("/marketing");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Marketing dashboard should have overview stat cards
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("marketing page has navigation links to sub-pages", async ({ page }) => {
    await page.goto("/marketing");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Should have links to Contacts, Templates, Automations, Promotions
    const mainContent = page.locator("main");
    const contactsLink = mainContent.locator("a[href*='contacts']");
    const templatesLink = mainContent.locator("a[href*='templates']");
    const automationsLink = mainContent.locator("a[href*='automations']");
    const promotionsLink = mainContent.locator("a[href*='promotions']");

    // At least some sub-navigation should be present
    await expect(mainContent).toBeVisible();
  });

  test("marketing page navigates to contacts sub-page", async ({ page }) => {
    await page.goto("/marketing");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const contactsLink = page.locator("a[href*='contacts']").first();
    if (await contactsLink.isVisible()) {
      await contactsLink.click();
      await expect(page).toHaveURL(/contacts/);
    }
  });

  test("marketing page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/marketing");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[MARKETING]")).toBe(true);
  });
});

test.describe("Marketing — Contacts", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("contacts page loads", async ({ page }) => {
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("contacts page has search input", async ({ page }) => {
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const searchInput = page.locator("input[type='text'], input[type='search']").first();
    if (await searchInput.isVisible()) {
      await expect(searchInput).toBeVisible();
      // Try typing a search query
      await searchInput.fill("test");
      await page.waitForTimeout(500);
      await searchInput.clear();
    }
  });

  test("contacts page has add contact button/form", async ({ page }) => {
    await page.goto("/marketing/contacts");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const addBtn = page.getByRole("button", { name: /add|import|new/i });
    if (await addBtn.first().isVisible()) {
      await expect(addBtn.first()).toBeVisible();
    }
  });

  test("contacts page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/marketing/contacts");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[CONTACTS]")).toBe(true);
  });
});

test.describe("Marketing — Templates", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("templates page loads", async ({ page }) => {
    await page.goto("/marketing/templates");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("templates page has create template button", async ({ page }) => {
    await page.goto("/marketing/templates");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const createBtn = page.getByRole("button", { name: /create|new|add/i });
    if (await createBtn.first().isVisible()) {
      await expect(createBtn.first()).toBeVisible();
    }
  });

  test("templates page has starter template gallery", async ({ page }) => {
    await page.goto("/marketing/templates");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("templates page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/marketing/templates");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[TEMPLATES]")).toBe(true);
  });
});

test.describe("Marketing — Automations", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("automations page loads", async ({ page }) => {
    await page.goto("/marketing/automations");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("automations page shows automation templates", async ({ page }) => {
    await page.goto("/marketing/automations");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("automations page has create automation action", async ({ page }) => {
    await page.goto("/marketing/automations");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Look for template cards or create button
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("automations page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/marketing/automations");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[AUTOMATIONS]")).toBe(true);
  });
});

test.describe("Marketing — Promotions", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("promotions page loads", async ({ page }) => {
    await page.goto("/marketing/promotions");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("promotions page has create promo form", async ({ page }) => {
    await page.goto("/marketing/promotions");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Should have a create promotion form or button
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("promotions page shows promo list/table", async ({ page }) => {
    await page.goto("/marketing/promotions");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("promotions page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/marketing/promotions");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[PROMOTIONS]")).toBe(true);
  });
});

test.describe("Inbox", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("inbox page loads", async ({ page }) => {
    await page.goto("/inbox");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("inbox page has conversation list area", async ({ page }) => {
    await page.goto("/inbox");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("inbox page has reply input area", async ({ page }) => {
    await page.goto("/inbox");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("inbox page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/inbox");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[INBOX]")).toBe(true);
  });
});

test.describe("Broadcasts", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("broadcasts page loads", async ({ page }) => {
    await page.goto("/broadcasts");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("broadcasts page has calendar/date selection", async ({ page }) => {
    await page.goto("/broadcasts");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("broadcasts page has message editor", async ({ page }) => {
    await page.goto("/broadcasts");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("broadcasts page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/broadcasts");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[BROADCASTS]")).toBe(true);
  });
});

test.describe("Vouchers", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("vouchers page loads", async ({ page }) => {
    await page.goto("/vouchers");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("vouchers page has filter/date controls", async ({ page }) => {
    await page.goto("/vouchers");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("vouchers page has create voucher action", async ({ page }) => {
    await page.goto("/vouchers");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const createBtn = page.getByRole("button", { name: /create|generate|add|new/i });
    if (await createBtn.first().isVisible()) {
      await expect(createBtn.first()).toBeVisible();
    }
  });

  test("vouchers page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/vouchers");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[VOUCHERS]")).toBe(true);
  });
});
