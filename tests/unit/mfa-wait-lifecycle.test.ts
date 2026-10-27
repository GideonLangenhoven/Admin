import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MFA removal", () => {
  it.each(["app/settings/page.tsx", "app/super-admin/page.tsx", "app/super-admin/sensitive-actions/page.tsx"])("removes authenticator prompts and enrollment from %s", file => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/useSensitiveActionMfa|MfaStatus|requireMfa|auth\.mfa|authenticator|api\/mfa/);
  });
  it("removes the QR and authenticator components", () => {
    expect(existsSync("components/MfaSensitiveAction.tsx")).toBe(false);
    expect(existsSync("components/MfaSensitiveActionPanel.tsx")).toBe(false);
  });
});
