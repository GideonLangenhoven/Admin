import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceFunction } from "../helpers/source-handler";

// STOP and DELETE must not claim a change the database didn't make.
const tenant = { business: { id: "tenant-a" } };
const phone = "27825550100";

function bot(rpcError: any) {
  const sent: string[] = []; const inserts: [string, any][] = [];
  const chain = (table: string): any => {
    const q: any = { then: (resolve: any) => resolve({ data: [], error: null }), maybeSingle: async () => ({ data: null }), single: async () => ({ data: { id: "m" } }) };
    for (const name of ["select", "update", "eq", "gte", "order", "limit"]) q[name] = () => q;
    q.insert = (row: any) => { inserts.push([table, row]); return q; };
    return q;
  };
  const handle = sourceFunction("supabase/functions/wa-webhook/index.ts", "handleMsg", {
    startTyping: () => () => undefined,
    getConvo: async () => ({ id: "conversation-a", current_state: "IDLE", state_data: {} }),
    supabase: { from: chain, rpc: async () => ({ data: null, error: rpcError }) },
    sendText: async (_t: any, _p: any, message: string) => { sent.push(message); },
    logE: async () => undefined,
  });
  return { handle: (text: string) => handle(tenant, phone, text, "text"), sent, inserts };
}

describe("WhatsApp STOP and DELETE failures", () => {
  it("a STOP the database rejected asks the guest to send it again", async () => {
    const b = bot({ message: "timeout" });
    await b.handle("stop");
    expect(b.sent).toEqual(["Sorry, we couldn't update your preferences just now. Please send STOP again in a minute."]);
  });

  it("a deletion that failed lands in the team's Data Requests queue", async () => {
    const b = bot({ message: "lock timeout" });
    await b.handle("delete my data");
    expect(b.sent[0]).toContain("deletion request is confirmed");
    expect(b.inserts.filter(([table]) => table === "data_subject_requests")).toEqual([["data_subject_requests", expect.objectContaining({
      business_id: "tenant-a", email: "wa:" + phone, request_type: "DELETION", status: "IN_REVIEW", metadata: { source: "whatsapp_delete_keyword", phone },
    })]]);
  });

  it("a deletion that worked queues nothing", async () => {
    const b = bot(null);
    await b.handle("delete");
    expect(b.inserts.filter(([table]) => table === "data_subject_requests")).toEqual([]);
  });

  it("Fulfil erases a WhatsApp request by its phone number", async () => {
    const rpc = vi.fn(async () => ({ data: { bookings: 1 }, error: null }));
    const request = { id: "request-a", status: "IN_REVIEW", customer_id: null, business_id: "operator-a", email: "wa:" + phone, request_type: "DELETION", metadata: { phone } };
    const query: any = { select: () => query, eq: () => query, update: () => query, maybeSingle: async () => ({ data: table === "customers" ? null : request }), then: (resolve: any) => resolve({ error: null }) };
    let table = "";
    const { POST } = sourceExports("app/api/admin/data-requests/[id]/fulfill/route.ts", {
      "@/app/lib/api-auth": { getCallerAdmin: async () => ({ id: "admin-a", business_id: "operator-a", role: "MAIN_ADMIN" }), isPrivilegedRole: () => true },
      "@supabase/supabase-js": { createClient: () => ({ from: (name: string) => { table = name; return query; }, rpc }) },
    }, {}, async () => Response.json({ ok: false, error: "invalid_email" })) as any;
    const response = await POST(new Request("https://fixture.invalid"), { params: Promise.resolve({ id: "request-a" }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("anonymize_customer", expect.objectContaining({ p_business_id: "operator-a", p_phone: phone }));
  });
});
