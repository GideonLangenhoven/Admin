import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sourceHandler } from "../helpers/source-handler";

for (const name of ["super-admin-onboard", "generate-invite-token"]) {
  describe(name + " session boundary", () => {
    function fixture(role: string, expectedUser = "platform") {
      const filters: Record<string, unknown> = {};
      const from = vi.fn(() => query);
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        maybeSingle: async () => ({ data: filters.user_id === expectedUser ? {
          id: "admin", role: "SUPER_ADMIN", suspended: false,
          password_hash: createHash("sha256").update("fixture-password").digest("hex"),
        } : null, error: null }),
      };
      const handler = sourceHandler("supabase/functions/" + name + "/index.ts", {
        "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({ from }) },
        "../_shared/auth.ts": { requireAuth: async () => {
          if (role === "anonymous") throw new Error("Unauthorized");
          return { role, userId: "platform", businessId: "a", isServiceRole: role === "service_role" };
        } },
      });
      return { from, filters, invoke: (body: unknown) => handler(new Request("https://fixture.invalid", { method: "POST", body: JSON.stringify(body) })) };
    }

    it.each(["anonymous", "MAIN_ADMIN", "ADMIN", "service_role"])("rejects %s before any database access", async role => {
      const f = fixture(role);
      expect((await f.invoke({})).status).toBe(role === "anonymous" ? 401 : 403);
      expect(f.from).not.toHaveBeenCalled();
    });

    it("allows a signed-in platform owner to reach input validation", async () => {
      const f = fixture("SUPER_ADMIN");
      expect((await f.invoke({})).status).toBe(400);
      expect(f.from).not.toHaveBeenCalled();
    });

    it("binds password reconfirmation to the signed-in administrator", async () => {
      const f = fixture("SUPER_ADMIN", "different-platform-admin");
      const response = await f.invoke({ requester_email: "owner@fixture.invalid", requester_password: "fixture-password", business_name: "Fixture", admin_name: "Owner", admin_email: "new@fixture.invalid" });
      expect(response.status).toBe(403);
      expect(f.filters).toMatchObject({ user_id: "platform", email: "owner@fixture.invalid" });
      expect(f.from).toHaveBeenCalledTimes(1);
    });

    it("uses internal authentication instead of the gateway's legacy JWT validator", () => {
      const config = readFileSync("supabase/config.toml", "utf8");
      expect(config).toContain("[functions." + name + "]\nverify_jwt = false");
    });
  });
}
