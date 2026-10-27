import { describe, expect, it, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";
import { isPrivilegedRole } from "../../app/lib/role-utils";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture(role: string | null = "MAIN_ADMIN", failure?: string) {
  const rpc = vi.fn(async () => ({ data: "eligible", error: failure ? { code: failure, message: "private data" } : null }));
  const handler = sourceHandler("app/api/marketing/permission/route.ts", {
    "@supabase/supabase-js": { createClient: () => ({ rpc }) },
    "@/app/lib/api-auth": { isPrivilegedRole, getCallerAdmin: async () => role ? { id: id(1), business_id: id(2), role } : null },
  });
  const body = { contact_id: id(3), expected_email: "synthetic@example.invalid", decision: "granted", evidence_at: "2026-01-01T12:00:00Z", notice_text: "I agree to marketing emails from Synthetic Tours.", evidence_ref: "Synthetic signed form" };
  return { rpc, handler, send: (patch = {}) => handler(new Request("https://test.invalid", { method: "POST", body: JSON.stringify({ ...body, ...patch }) })) };
}
describe("recorded email permission", () => {
  it.each(["MAIN_ADMIN","SUPER_ADMIN"])("binds %s permission evidence to the verified actor and operator", async role => {
    const f = fixture(role); expect((await f.send({ business_id: id(9), admin_id: id(9) })).status).toBe(200);
    expect(f.rpc).toHaveBeenCalledWith("record_marketing_permission", expect.objectContaining({ p_business_id: id(2), p_admin_id: id(1), p_contact_id: id(3), p_expected_email: "synthetic@example.invalid" }));
  });
  it.each([null,"ADMIN","GUIDE"])("rejects %s before a database call", async role => {
    const f = fixture(role); expect((await f.send()).status).toBe(403); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([{ contact_id: "bad" },{ decision: "approved" },{ expected_email: null },{ evidence_at: "bad" },{ evidence_at: "2099-01-01" },{ notice_text: "" },{ evidence_ref: "" },{ notice_text: "n".repeat(2001) }])("rejects invalid evidence %j", async patch => {
    const f = fixture(); expect((await f.send(patch)).status).toBe(400); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("records withdrawals without fabricating grant evidence", async () => {
    const f = fixture(); expect((await f.send({ decision: "withdrawn", evidence_at: null })).status).toBe(200);
    expect(f.rpc.mock.calls[0][1]).toMatchObject({ p_decision: "withdrawn", p_evidence_at: null, p_notice_text: null, p_evidence_ref: null });
  });
  it.each(["42501","P0001"])("reports failure safely when the database rejects %s", async code => {
    const f = fixture("MAIN_ADMIN",code), response = await f.send();
    expect(response.status).toBe(code === "42501" ? 403 : 409); expect(await response.text()).not.toContain("private data");
  });
});
