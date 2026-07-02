import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
