import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

type AdminRole = "ADMIN" | "MAIN_ADMIN" | "SUPER_ADMIN";

interface InjectAdminSessionOptions {
  role?: AdminRole;
  email?: string;
  businessId?: string;
  name?: string;
  settingsPermissions?: Record<string, boolean>;
}

// AuthGate requires a REAL Supabase Auth session (validateSession calls
// supabase.auth.getSession()), so localStorage flags alone no longer log a
// test in. Sessions are minted server-side via scripts/e2e-mint-session.mjs
// (service-role generate_link — returns the token, sends no email) for real
// seats in the target project:
const ROLE_EMAILS: Partial<Record<AdminRole, string>> = {
  SUPER_ADMIN: "gidslang89@gmail.com", // platform seat
  MAIN_ADMIN: "smideonlang89@gmail.com", // Atlas (ACTIVE tenant)
  // ADMIN: no plain-ADMIN seat exists in the target project — tests that need
  // one must skip (see mintableRole).
};

export function mintableRole(role: AdminRole): boolean {
  return Boolean(ROLE_EMAILS[role]);
}

interface MintedSession {
  storage: Record<string, string>;
  admin: { email: string; name: string | null; role: string; business_id: string; settings_permissions: Record<string, boolean> | null };
  timezone: string;
}

const minted = new Map<string, MintedSession>();

function mintSession(email: string): MintedSession {
  const cached = minted.get(email);
  if (cached) return cached;
  const script = resolve(__dirname, "../../../scripts/e2e-mint-session.mjs");
  const out = execFileSync("node", [script, email], { encoding: "utf8" });
  const session = JSON.parse(out) as MintedSession;
  minted.set(email, session);
  return session;
}

export async function injectAdminSession(page: Page, options: InjectAdminSessionOptions = {}) {
  const role = options.role || "MAIN_ADMIN";
  const email = options.email || ROLE_EMAILS[role];
  if (!email) {
    throw new Error(
      `No real ${role} seat exists in the target project — gate the test with test.skip(!mintableRole("${role}"), ...)`,
    );
  }
  const session = mintSession(email);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ storage, admin, timezone }) => {
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v as string);
      localStorage.setItem("ck_admin_auth", "true");
      localStorage.setItem("ck_admin_email", admin.email);
      localStorage.setItem("ck_admin_role", admin.role);
      localStorage.setItem("ck_admin_business_id", admin.business_id);
      localStorage.setItem("ck_admin_timezone", timezone);
      localStorage.setItem("ck_admin_time", String(Date.now()));
      localStorage.setItem("ck_admin_name", admin.name || "");
      localStorage.setItem("ck_admin_settings_perms", JSON.stringify(admin.settings_permissions || {}));
      // Suppress the first-login Welcome tour modal — its overlay intercepts
      // every click, and real seats minted for tests may not have completed it.
      localStorage.setItem("ck_welcome_done", "1");
      document.cookie = "ck_session_hint=1;path=/;max-age=86400;SameSite=Lax";
      document.cookie = "ck_admin_role=" + encodeURIComponent(admin.role) + ";path=/;max-age=43200;SameSite=Lax";
    },
    { storage: session.storage, admin: session.admin, timezone: session.timezone },
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
    // Supabase Auth session token (sb-<ref>-auth-token)
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-")) localStorage.removeItem(key);
    }
    document.cookie = "ck_session_hint=;path=/;max-age=0";
    document.cookie = "ck_admin_role=;path=/;max-age=0";
  });
}

export async function simulateLockout(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("ck_fail_count", "5");
    localStorage.setItem("ck_lock_until", String(Date.now() + 30 * 60 * 1000));
  });
}
