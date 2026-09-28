import { describe, expect, it } from "vitest";
import { driveCallbackUrl, isAllowedDriveReturnOrigin } from "../../supabase/functions/_shared/google-drive-oauth";

describe("Google Drive operator callback", () => {
  it("relays the authorization code to the operator's admin origin", () => {
    const url = new URL(driveCallbackUrl("https://ocean.admin.bookingtours.co.za", "opaque-state", "auth-code", null));
    expect(url.origin).toBe("https://ocean.admin.bookingtours.co.za");
    expect(url.pathname).toBe("/google-callback");
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("code")).toBe("auth-code");
  });

  it.each([
    "https://evil.example",
    "https://ocean.admin.bookingtours.co.za.evil.example",
    "http://ocean.admin.bookingtours.co.za",
    "https://ocean.admin.bookingtours.co.za/extra",
    "https://ocean.admin.bookingtours.co.za@evil.example",
  ])("rejects an untrusted return address: %s", (origin) => {
    expect(isAllowedDriveReturnOrigin(origin)).toBe(false);
    expect(() => driveCallbackUrl(origin, "state", "code", null)).toThrow("Invalid operator return address");
  });
});
