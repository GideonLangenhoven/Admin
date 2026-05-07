import type { Page } from "@playwright/test";

type AdminRole = "ADMIN" | "MAIN_ADMIN" | "SUPER_ADMIN";

interface InjectAdminSessionOptions {
  role?: AdminRole;
  email?: string;
  businessId?: string;
  name?: string;
  settingsPermissions?: Record<string, boolean>;
}

const DEFAULT_BUSINESS_ID = "00000000-0000-0000-0000-000000000001";

export async function injectAdminSession(page: Page, options: InjectAdminSessionOptions = {}) {
  const role = options.role || "MAIN_ADMIN";
  const email = options.email || "e2e-admin@bookingtours.test";
  const businessId = options.businessId || DEFAULT_BUSINESS_ID;
  const name = options.name || "E2E Admin";
  const settingsPermissions = options.settingsPermissions || {
    business: true,
    tours: true,
    policies: true,
    credentials: true,
    users: true,
  };

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ businessId, email, name, role, settingsPermissions }) => {
      localStorage.setItem("ck_admin_auth", "true");
      localStorage.setItem("ck_admin_email", email);
      localStorage.setItem("ck_admin_role", role);
      localStorage.setItem("ck_admin_business_id", businessId);
      localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
      localStorage.setItem("ck_admin_time", String(Date.now()));
      localStorage.setItem("ck_admin_name", name);
      localStorage.setItem("ck_admin_settings_perms", JSON.stringify(settingsPermissions));
      document.cookie = "ck_session_hint=1;path=/;max-age=86400;SameSite=Lax";
    },
    { businessId, email, name, role, settingsPermissions },
  );
}

export async function clearAdminSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    [
      "ck_admin_auth",
      "ck_admin_email",
      "ck_admin_role",
      "ck_admin_business_id",
      "ck_admin_timezone",
      "ck_admin_time",
      "ck_admin_name",
      "ck_admin_settings_perms",
      "ck_operator_override_business_id",
      "ck_sidebar_collapsed",
      "ck_fail_count",
      "ck_lock_until",
    ].forEach((key) => localStorage.removeItem(key));
    document.cookie = "ck_session_hint=;path=/;max-age=0";
  });
}

export async function simulateLockout(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("ck_fail_count", "5");
    localStorage.setItem("ck_lock_until", String(Date.now() + 30 * 60 * 1000));
  });
}
