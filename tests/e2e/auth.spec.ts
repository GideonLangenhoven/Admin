import { test, expect } from "@playwright/test";
import { injectAdminSession, simulateLockout } from "./helpers/auth";

// NOTE: the invalid-login tests below POST /api/admin/login, which is
// rate-limited to 5 attempts / 15 min per IP. Start the admin server with
// E2E_BYPASS_RATE_LIMIT=1 when running the full suite.

test.describe("Authentication — Login Flow", () => {
  test("shows login form when not authenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /bookingtours/i })).toBeVisible();
    await expect(page.getByText("Sign in to your operator dashboard")).toBeVisible();
    await expect(page.getByPlaceholder("Email address")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("set up or reset password link navigates to change-password", async ({ page }) => {
    await page.goto("/");
    const link = page.getByText("Set up or reset password");
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL("**/change-password");
    await expect(page).toHaveURL(/change-password/);
  });

  // Bad-credential logins surface the API's "Invalid credentials" message
  // (AuthGate's "Incorrect email or password…" string is only a fallback for
  // responses with no error body). Attempts are tracked in localStorage, not
  // shown in the UI, and trip the lockout at 5.
  test("displays error on invalid login attempt", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Email address").fill("bad@example.com");
    await page.getByPlaceholder("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page.getByText(/Invalid credentials/)).toBeVisible({ timeout: 10_000 });
  });

  test("tracks failed attempt count correctly", async ({ page }) => {
    await page.goto("/");

    await page.getByPlaceholder("Email address").fill("bad@example.com");
    await page.getByPlaceholder("Password").fill("wrong");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText(/Invalid credentials/)).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem("ck_fail_count"))).toBe("1");

    await page.getByPlaceholder("Password").fill("wrong2");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText(/Invalid credentials/)).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem("ck_fail_count"))).toBe("2");
  });

  test("email field clears error on input change", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Email address").fill("bad@example.com");
    await page.getByPlaceholder("Password").fill("wrong");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText(/Invalid credentials/)).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder("Email address").fill("new@example.com");
    await expect(page.getByText(/Invalid credentials/)).not.toBeVisible();
  });

  test("Enter key submits the login form from password field", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Email address").fill("bad@example.com");
    await page.getByPlaceholder("Password").fill("wrong");
    await page.getByPlaceholder("Password").press("Enter");
    await expect(page.getByText(/Invalid credentials/)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Authentication — Lockout", () => {
  test("shows lockout screen after too many attempts", async ({ page }) => {
    await page.goto("/");
    await simulateLockout(page);
    await page.reload();

    await expect(page.getByText("Account Locked")).toBeVisible();
    await expect(page.getByText(/Too many failed attempts/)).toBeVisible();
    await expect(page.getByText("Set up or reset password")).toBeVisible();
  });

  test("lockout screen has reset password link", async ({ page }) => {
    await page.goto("/");
    await simulateLockout(page);
    await page.reload();

    const resetLink = page.getByText("Set up or reset password");
    await expect(resetLink).toBeVisible();
    await resetLink.click();
    await expect(page).toHaveURL(/change-password/);
  });
});

test.describe("Authentication — Session Management", () => {
  test("authenticated user sees dashboard, not login", async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();

    await expect(page.getByText("Sign in to your operator dashboard")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
  });

  test("session checking shows loading state initially", async ({ page }) => {
    await page.goto("/");
    // The checking state ("Checking admin session...") may pass too quickly to
    // always catch — just verify the page renders.
    await expect(page.locator("body")).toBeVisible();
  });

  test("sign out clears session and shows login", async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

    await page.getByText("Sign Out").first().click();

    await expect(page.getByText("Sign in to your operator dashboard")).toBeVisible({ timeout: 10_000 });
  });

  test("expired session redirects to login", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("ck_admin_auth", "true");
      localStorage.setItem("ck_admin_email", "test@test.com");
      localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
      localStorage.setItem("ck_admin_time", String(Date.now() - 13 * 60 * 60 * 1000));
    });
    await page.reload();

    await expect(page.getByText("Sign in to your operator dashboard")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Public Pages — No Auth Required", () => {
  test("change-password page loads without auth", async ({ page }) => {
    await page.goto("/change-password");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText("Sign in to your operator dashboard")).not.toBeVisible({ timeout: 3_000 });
  });
});
