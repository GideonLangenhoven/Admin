import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  marketingEmailValidationError,
  parseResendBatchResponse,
} from "../../supabase/functions/_shared/marketing-batch.ts";

describe("marketing batch dispatch", () => {
  it("keeps reserved test domains out of a provider batch", () => {
    for (const email of [
      "guest@example.com",
      "guest@sub.example.org",
      "guest@example.test",
      "guest@example.invalid",
    ]) {
      expect(marketingEmailValidationError(email)).toContain("Reserved/test recipient domain");
    }
    expect(marketingEmailValidationError("guest@gmail.com")).toBeNull();
  });

  it("maps compact permissive results back to their original queue indexes", () => {
    expect(parseResendBatchResponse({
      data: [{ id: "email-0" }, { id: "email-2" }],
      errors: [{ index: 1, message: "Invalid to field" }],
    }, 3)).toEqual({
      sent: [
        { index: 0, emailId: "email-0" },
        { index: 2, emailId: "email-2" },
      ],
      failed: [{ index: 1, error: "Invalid to field" }],
    });
  });

  it("rejects incomplete provider responses instead of assigning IDs to the wrong recipients", () => {
    expect(parseResendBatchResponse({
      data: [{ id: "only-one-id" }],
      errors: [],
    }, 2)).toBeNull();
  });

  it("enables Resend permissive validation after the local recipient guard", () => {
    const dispatch = readFileSync("supabase/functions/marketing-dispatch/index.ts", "utf8");
    expect(dispatch).toContain('"x-batch-validation": "permissive"');
    expect(dispatch.indexOf("marketingEmailValidationError(item.email)")).toBeLessThan(dispatch.indexOf("tokenRows.push"));
  });
});
