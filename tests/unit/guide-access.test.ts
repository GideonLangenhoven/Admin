import { describe, it, expect, vi } from "vitest";
import { setAdminAuthPassword } from "../../app/lib/admin-password";
import { guideAuthEmail, isGuidePath } from "../../app/lib/guide-access";
import { sourceHandler, sourceFunction } from "../helpers/source-handler";

describe("shared guide login", () => {
  it("maps the operator alias to a stable reserved Auth identity", () => {
    expect(guideAuthEmail(" Guide@Cape-Kayak ")).toBe("guide+cape-kayak@guides.bookingtours.co.za");
    for (const value of ["staff@example.com", "guide@", "guide@../owner", "guide@two words", "guide@-bad", "guide@bad-", "guide@a".repeat(40)]) expect(guideAuthEmail(value)).toBeNull();
  });
  it("limits guides to their separate Simple View and existing photo pages", () => {
    for (const path of ["/simpleguide", "/simpleguide/check-ins", "/guide/photos/11111111-1111-4111-8111-111111111111"]) expect(isGuidePath(path)).toBe(true);
    for (const path of ["/simple", "/simple/photos", "/simpleguide/new-booking", "/simpleguide/photos", "/", "/guide", "/bookings", "/settings", "/simple/new-booking", "/simple/photos/../settings", "/simple/check-ins", "/simple/photos-more"]) expect(isGuidePath(path)).toBe(false);
  });
  it("requires verified guide ownership and active subscription for photo upload", async () => {
    const filters: Record<string, unknown> = {};
    const query: any = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; }, maybeSingle: async () => ({ data: { id: "guide-a", business_id: "tenant-a" } }) };
    const getUser = vi.fn(async () => ({ data: { user: { id: "auth-guide" } }, error: null }));
    const getCaller = sourceFunction("app/lib/guide-api-auth.ts", "getCallerGuide", {
      createClient: () => ({ auth: { getUser }, from: () => query }),
      requireActiveSubscription: async () => ({ active: true }), process: { env: {} },
    });
    const req = (target: string) => new Request("https://fixture.invalid", { headers: { Authorization: "Bearer signed-guide", "x-admin-business-id": target } });
    expect(await getCaller(req("tenant-a"))).toEqual({ id: "guide-a", business_id: "tenant-a", role: "GUIDE" });
    expect(filters).toMatchObject({ user_id: "auth-guide", suspended: false, must_set_password: false });
    expect(await getCaller(req("tenant-b"))).toBeNull();
    expect(await getCaller(new Request("https://fixture.invalid"))).toBeNull();
  });
});

function accessFixture(caller: any = null, claimed = true, authFailure = false, officeConflict = false) {
  const writes: any[] = [];
  const query: any = {
    select: () => query, eq: () => query, gt: () => query,
    upsert: (row: unknown) => { writes.push(row); return query; },
    update: (row: unknown) => { writes.push(row); return query; },
    maybeSingle: async () => ({ data: { subdomain: "cape-kayak", login_name: "guide@cape-kayak" }, error: null }),
    single: async () => ({ data: { login_name: "guide@cape-kayak", must_set_password: true }, error: null }),
    then: (resolve: any) => Promise.resolve({ error: null }).then(resolve),
  };
  const rpc = vi.fn(async (name: string) => ({ data: name === "claim_guide_setup" ? claimed ? { id: "guide-a", email: "guide+cape-kayak@guides.bookingtours.co.za", business_id: "tenant-a" } : null : true, error: null }));
  const password = vi.fn(async () => { if (authFailure) throw new Error("Auth unavailable"); return "auth-guide"; });
  const handler = sourceHandler("app/api/guide/access/route.ts", {
    "@supabase/supabase-js": { createClient: () => ({ from: (table: string) => table === "admin_users" ? { ...query, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: officeConflict ? { id: "office" } : null, error: null }) }) }) } : query, rpc }) },
    "node:crypto": requireCrypto(),
    "@/app/lib/api-auth": { getCallerAdmin: async () => caller, isPrivilegedRole: (role: string) => ["MAIN_ADMIN", "SUPER_ADMIN"].includes(role) },
    "@/app/lib/admin-password": { setAdminAuthPassword: password },
    "@/app/lib/guide-access": { guideAuthEmail },
  });
  return { writes, rpc, password, invoke: (body: unknown) => handler(Object.assign(new Request("https://fixture.invalid/api/guide/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { nextUrl: new URL("https://fixture.invalid/api/guide/access") })) };
}
import * as crypto from "node:crypto";
function requireCrypto() { return crypto; }
const setup = { action: "complete", login: "guide@cape-kayak", token: "a".repeat(48), password: "chosen-password" };
describe("private guide password setup", () => {
  it.each([null, { role: "ADMIN" }, { role: "GUIDE" }])("rejects account creation without owner permission: %j", async caller => {
    const f = accessFixture(caller); expect((await f.invoke({ action: "issue" })).status).toBe(403); expect(f.writes).toEqual([]);
  });
  it("uses the authenticated owner's tenant and returns a private link without sending email", async () => {
    const f = accessFixture({ role: "MAIN_ADMIN", business_id: "tenant-a" });
    const response = await f.invoke({ action: "issue", business_id: "other-tenant" });
    expect(response.status).toBe(200); const data = await response.json();
    expect(data.setup_url).toContain("/guide-setup?login=guide%40cape-kayak&token=");
    expect(f.writes[0]).toMatchObject({ business_id: "tenant-a", login_name: "guide@cape-kayak", must_set_password: true });
    expect(f.writes[0].setup_token_hash).toHaveLength(64); expect(data.setup_url).not.toContain(f.writes[0].setup_token_hash);
  });
  it("refuses an existing office identity before issuing a setup link", async () => {
    const f = accessFixture({ role: "MAIN_ADMIN", business_id: "tenant-a" }, true, false, true);
    expect((await f.invoke({ action: "issue" })).status).toBe(409); expect(f.writes).toEqual([]);
  });
  it("claims a valid token before touching Auth and consumes it only after password creation", async () => {
    const f = accessFixture(); const response = await f.invoke(setup); expect(response.status).toBe(200);
    expect(f.rpc.mock.calls.map(c => c[0])).toEqual(["claim_guide_setup", "complete_guide_setup"]);
    expect(f.password).toHaveBeenCalledOnce(); expect(f.writes).toEqual([]);
  });
  it("does not set a password for expired, used or concurrently claimed links", async () => {
    const f = accessFixture(null, false); expect((await f.invoke(setup)).status).toBe(409); expect(f.password).not.toHaveBeenCalled();
  });
  it("releases its own claim on Auth failure without completing setup", async () => {
    const f = accessFixture(null, true, true); expect((await f.invoke(setup)).status).toBe(502);
    expect(f.rpc.mock.calls.map(c => c[0])).toEqual(["claim_guide_setup"]); expect(f.writes).toEqual([{ setup_claim_id: null }]);
  });
  it("rejects malformed tokens and short passwords without claiming anything", async () => {
    const f = accessFixture(); expect((await f.invoke({ ...setup, token: "x" })).status).toBe(401);
    expect((await f.invoke({ ...setup, password: "short" })).status).toBe(400); expect(f.rpc).not.toHaveBeenCalled();
  });
});

describe("guide login has no office identity", () => {
  function login(guide: any, token?: string) {
    const adminQuery: any = { select: () => adminQuery, eq: () => adminQuery, maybeSingle: async () => ({ data: null, error: null }) };
    const guideQuery: any = { select: () => guideQuery, eq: () => guideQuery, maybeSingle: async () => ({ data: guide, error: null }) };
    const db = { from: (table: string) => table === "admin_users" ? adminQuery : guideQuery, auth: { getUser: async () => ({ data: { user: { id: "guide-user" } }, error: null }) } };
    const invoke = sourceHandler("app/api/admin/login/route.ts", {
      "@supabase/supabase-js": { createClient: () => db },
      "../../../lib/admin-password": { setAdminAuthPassword: () => { throw new Error("Legacy office provisioning must never run"); } },
      "../../../lib/guide-access": { guideAuthEmail },
    });
    return invoke(new Request("https://fixture.invalid/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ email: "guide@cape-kayak", password: "chosen-password" }) }));
  }
  const guide = { id: "guide-a", email: "guide+cape-kayak@guides.bookingtours.co.za", business_id: "tenant-a", user_id: "guide-user", must_set_password: false, suspended: false };
  it("requires Auth for a username/password request and resolves GUIDE only after a verified session", async () => {
    expect(await (await login(guide)).json()).toMatchObject({ code: "AUTH_REQUIRED" });
    const response = await login(guide, "signed-guide"); expect(response.status).toBe(200);
    expect((await response.json()).admin).toMatchObject({ role: "GUIDE", business_id: "tenant-a", read_only: false });
  });
  it("denies suspended guides and directs first-use guides to the operator's private link", async () => {
    expect((await login({ ...guide, suspended: true }, "signed-guide")).status).toBe(403);
    expect(await (await login({ ...guide, must_set_password: true })).json()).toMatchObject({ code: "GUIDE_SETUP_REQUIRED" });
  });
  it("general admin APIs reject a valid Auth session with no admin_users row", async () => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }) };
    const getCaller = sourceFunction("app/lib/api-auth.ts", "getCallerAdmin", {
      createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "guide-user", user_metadata: { role: "SUPER_ADMIN" } } } }) }, from: () => query }),
      process: { env: { SUPABASE_SERVICE_ROLE_KEY: "test-".repeat(10), NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid" } },
    });
    expect(await getCaller(new Request("https://fixture.invalid", { headers: { Authorization: "Bearer signed-guide" } }))).toBeNull();
  });
});

describe("guide photo uploads", () => {
  it.each(["tenant-a", "tenant-b"])("uploads only to the guide's own operator: %s", async target => {
    const writes: any[] = [];
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: "slot-a", business_id: target } }) };
    const fetchImpl = vi.fn(async (url: string) => Response.json(url.includes("functions/v1") ? { access_token: "synthetic", folder_id: "fixture-folder" } : { id: "fixture-file" }));
    const upload = sourceFunction("app/api/guide/photo-upload/route.ts", "POST", {
      getCallerAdmin: async () => null, getCallerGuide: async () => ({ id: "guide-a", role: "GUIDE", business_id: "tenant-a" }),
      adminClient: () => ({ from: () => ({ ...query, insert: async (row: unknown) => { writes.push(row); return { error: null }; } }) }),
      supabaseUrl: "https://fixture.invalid", serviceKey: "synthetic-key", fetch: fetchImpl,
      NextResponse: { json: (body: unknown, options: any) => Response.json(body, options) }, File, crypto: crypto.webcrypto, TextEncoder, Uint8Array,
    });
    const form = new FormData(); form.set("slot_id", "slot-a"); form.set("file", new File(["synthetic"], "photo.jpg", { type: "image/jpeg" }));
    const response = await upload(new Request("https://fixture.invalid", { method: "POST", body: form }));
    expect(response.status).toBe(target === "tenant-a" ? 200 : 403);
    if (target === "tenant-a") expect(writes[0]).toMatchObject({ business_id: "tenant-a", uploaded_by_guide_id: "guide-a" });
    else { expect(writes).toEqual([]); expect(fetchImpl).not.toHaveBeenCalled(); }
    expect(writes[0]?.uploaded_by_admin_id).toBeUndefined();
  });
});

 describe("guide password authority",()=>{
 it.each([true,false])("checks a pre-existing Auth identity before changing its password: office=%s",async office=>{
   const updateUserById=vi.fn(async()=>({error:null}));
   const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:office?{id:"office-a"}:null,error:null})};
   const db:any={from:()=>query,auth:{admin:{updateUserById}}};
   const work=setAdminAuthPassword(db,{id:"guide-a",email:"guide+a@guides.bookingtours.co.za",user_id:"existing-auth",role:"GUIDE"},"chosen-password");
   if(office){await expect(work).rejects.toThrow(/office account/);expect(updateUserById).not.toHaveBeenCalled();}
   else {await expect(work).resolves.toBe("existing-auth");expect(updateUserById).toHaveBeenCalledOnce();}
 });
 });
