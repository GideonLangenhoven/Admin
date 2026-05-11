import { describe, expect, it } from "vitest";
import {
  createLegacyOtpToken,
  createOpaqueOtpToken,
  hashOtpCode,
  normalizeOtpCode,
  sha256Hex,
  verifyLegacyOtpToken,
} from "../../supabase/functions/_shared/otp-attempts";

const secret = "test-secret";

describe("OTP attempt helpers", () => {
  it("issues opaque tokens that do not contain the 6-digit code", () => {
    const token = createOpaqueOtpToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("123456");
    expect(atob(token.replace(/-/g, "+").replace(/_/g, "/")).split("|")).not.toHaveLength(5);
  });

  it("binds code hashes to the token", async () => {
    const tokenA = createOpaqueOtpToken();
    const tokenB = createOpaqueOtpToken();
    await expect(hashOtpCode(secret, tokenA, "123456")).resolves.toBe(await hashOtpCode(secret, tokenA, "123456"));
    await expect(hashOtpCode(secret, tokenA, "123456")).resolves.not.toBe(await hashOtpCode(secret, tokenB, "123456"));
  });

  it("keeps legacy HMAC token verification backward compatible", async () => {
    const token = await createLegacyOtpToken(secret, "g@example.com", "123456789", "654321", Date.now() + 60_000);
    await expect(verifyLegacyOtpToken(secret, token, "654321")).resolves.toMatchObject({
      valid: true,
      email: "g@example.com",
      phoneTail: "123456789",
    });
    await expect(verifyLegacyOtpToken(secret, token, "000000")).resolves.toMatchObject({
      valid: false,
      status: 401,
    });
  });

  it("normalizes OTP input to six digits", () => {
    expect(normalizeOtpCode(" 12 34 56 ")).toBe("123456");
    expect(normalizeOtpCode("123456789")).toBe("123456");
  });

  it("hashes tokens deterministically", async () => {
    await expect(sha256Hex("token")).resolves.toBe(await sha256Hex("token"));
  });
});
