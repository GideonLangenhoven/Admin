import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

describe("platform invoice recipient", () => {
  it("emails Kayak's MAIN_ADMIN even when their address was used by platform staff", async () => {
    const send = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const admins = [
      { business_id: "kayak", email: "gidslang89@gmail.com", name: "Platform", role: "SUPER_ADMIN" },
      { business_id: "kayak", email: "info@capeweb.co.za", name: "Kayak", role: "MAIN_ADMIN" },
    ];
    const db = {
      from(table: string) {
        const filters: Array<(row: Record<string, unknown>) => boolean> = [];
        const query = {
          select: () => query,
          update: () => query,
          eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
          neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return query; },
          in: () => Promise.resolve({ error: null }),
          maybeSingle: async () => ({ data: table === "platform_invoices"
            ? { id: "invoice", business_id: "kayak", status: "DRAFT", yoco_payment_link_url: "https://pay.example.invalid/" }
            : { business_name: "Kayak", billing_admin_user_id: null }, error: null }),
          order: async () => ({ data: admins.filter(row => filters.every(matches => matches(row))), error: null }),
        };
        return query;
      },
      functions: { invoke: send },
    };
    const handler = sourceHandler("app/api/platform-invoices/send/route.ts", {
      "@/app/lib/api-auth": { getCallerAdmin: async () => ({ role: "SUPER_ADMIN" }) },
      "@supabase/supabase-js": { createClient: () => db },
    });
    const response = await handler(new Request("https://test.invalid/api/platform-invoices/send", {
      method: "POST", body: JSON.stringify({ platform_invoice_id: "invoice" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent_to: ["info@capeweb.co.za"] });
    expect(send).toHaveBeenCalledWith("send-email", expect.objectContaining({
      body: expect.objectContaining({ data: expect.objectContaining({ email: "info@capeweb.co.za" }) }),
    }));
  });
});
