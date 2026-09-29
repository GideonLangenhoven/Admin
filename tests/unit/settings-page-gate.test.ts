import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// Settings access: regular ADMINs granted settings_permissions must reach
// /settings (AppShell shows them the nav link; the page enforces per-section
// access itself). A blanket PRIVILEGED page gate in proxy.ts redirected them
// to /?denied=1 — the proxy cannot see localStorage permissions, so /settings
// must not be page-gated there.
describe("settings page access", () => {
  it("proxy does not blanket-gate /settings by role", () => {
    const proxy = readFileSync("proxy.ts", "utf8");
    expect(proxy).not.toContain('pattern: /^\\/settings(\\/|$)/');
  });

  it("nav still shows /settings for admins with granted section permissions", () => {
    const shell = readFileSync("components/AppShell.tsx", "utf8");
    expect(shell).toContain('if (n.href === "/settings")');
  });

  it("settings page keeps its own in-page permission gate", () => {
    const page = readFileSync("app/settings/page.tsx", "utf8");
    expect(page).toContain("You do not have permission to view or manage admin settings.");
  });

  it("shows a Kayak main admin even when their email was once used by platform staff", async () => {
    const kayakAdmin = { id: "kayak-admin", email: "info@capeweb.co.za", role: "MAIN_ADMIN", suspended: false };
    const platformAdmin = { id: "platform-admin", email: "gidslang89@gmail.com", role: "SUPER_ADMIN", suspended: false };
    const setAdmins = vi.fn();
    const supabase = { from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({ data: table === "admin_users" ? [kayakAdmin, platformAdmin] : [] }),
        maybeSingle: async () => ({ data: { billing_admin_user_id: kayakAdmin.id } }),
      };
      return query;
    } };
    const fetchAdmins = sourceFunction("app/settings/page.tsx", "fetchAdmins", {
      businessId: "kayak", supabase, setAdmins, setBillingAdminId: vi.fn(), setLoading: vi.fn(),
    });
    await fetchAdmins();
    expect(setAdmins).toHaveBeenCalledWith([kayakAdmin]);
  });
});
