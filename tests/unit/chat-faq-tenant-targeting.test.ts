import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reported live: "the operator can't edit any of the chat FAQs". The Chat FAQ
// API pinned every read/write to the CALLER's home business, so a SUPER_ADMIN
// pivoted to another operator saw and edited their own tenant's entries while
// that operator's bot answered from its own (untouched) list. The routes now
// accept a target business_id, allowed only for SUPER_ADMIN; everyone else is
// locked to their own tenant. The bot side needs no change — intent.ts already
// loads entries per business_id.
const COLLECTION = readFileSync("app/api/admin/chat-faq/route.ts", "utf8");
const ITEM = readFileSync("app/api/admin/chat-faq/[id]/route.ts", "utf8");
const PAGE = readFileSync("app/settings/chat-faq/page.tsx", "utf8");

describe("chat-faq API operates on an explicit, authorized business", () => {
  for (const [name, src] of [["collection", COLLECTION], ["item", ITEM]] as const) {
    it(`${name} route gates cross-tenant targeting to SUPER_ADMIN`, () => {
      expect(src).toContain('caller.role !== "SUPER_ADMIN"');
      expect(src).toContain("resolveTargetBusiness");
      // The old pinning — every query scoped to the caller's home tenant.
      expect(src).not.toContain('.eq("business_id", caller.business_id)');
      expect(src).toContain('.eq("business_id", target)');
    });
  }

  it("collection route inserts into the target business, not the caller's", () => {
    expect(COLLECTION).toContain("business_id: target,");
  });
});

describe("the page names the active operator on every call", () => {
  it("sends business_id on load, save, toggle and delete", () => {
    expect(PAGE.match(/business_id: businessId/g)?.length).toBeGreaterThanOrEqual(3); // PATCH, POST, toggle
    expect(PAGE.match(/\?business_id=\$\{encodeURIComponent\(businessId\)\}/g)?.length).toBe(2); // GET, DELETE
  });

  it("failures surface instead of silently doing nothing", () => {
    expect(PAGE).toContain("Couldn't update");
    expect(PAGE).toContain("Couldn't load quick answers");
  });
});
