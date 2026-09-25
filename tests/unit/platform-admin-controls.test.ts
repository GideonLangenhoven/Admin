import { describe, expect, it, vi } from "vitest";
import { sourceExports, sourceFunction, sourceHandler } from "../helpers/source-handler";
import { seatPriceForDay } from "../../app/lib/platform-invoice-preview";

const A="11111111-1111-1111-1111-111111111111",B="22222222-2222-2222-2222-222222222222";
describe("support business targeting",()=>{
  for(const role of ["SUPER_ADMIN","MAIN_ADMIN","ADMIN"]) for(const target of [A,B,"bad-id"]) it(role+" targeting "+target,async()=>{
    const row={id:"actor",role,business_id:A,suspended:false};
    const client={auth:{getUser:async()=>({data:{user:{id:"user"}}})},from(table:string){const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==="admin_users"?row:{id:B,subscription_status:"ACTIVE"},error:null})};return q;}};
    const exports=sourceExports("app/lib/api-auth.ts",{"@supabase/supabase-js":{createClient:()=>client},"./role-utils":{}});
    const response=await (exports.getCallerAdmin as any)(new Request("https://test.invalid",{headers:{authorization:"Bearer fixture","x-admin-business-id":target}}),{skipSubscriptionCheck:true});
    expect(response?.business_id??null).toBe(target===A?A:role==="SUPER_ADMIN"&&target===B?B:null);
  });
  it("rejects a suspended platform admin",async()=>{
    const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:"actor",role:"SUPER_ADMIN",business_id:A,suspended:true}})};
    const exports=sourceExports("app/lib/api-auth.ts",{"@supabase/supabase-js":{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:"user"}}})},from:()=>q})},"./role-utils":{}});
    expect(await (exports.getCallerAdmin as any)(new Request("https://test.invalid",{headers:{authorization:"Bearer fixture","x-admin-business-id":B}}))).toBeNull();
  });
  it("captures a browser target before asynchronous session refresh",async()=>{
    let target=A; let resolve:(value:any)=>void=()=>{};
    const fn=sourceFunction("app/lib/admin-auth.ts","getAuthHeaders",{window:{},localStorage:{getItem:()=>target},supabase:{auth:{getSession:()=>new Promise(r=>resolve=r)}}});
    const pending=fn();target=B;resolve({data:{session:{access_token:"fixture"}}});
    expect(await pending).toMatchObject({"x-admin-business-id":A});
  });
});
describe("business detail response race",()=>{
  it("calculates an existing customer's cost from its referenced plan",()=>{
    const monthlyCost=sourceFunction("app/super-admin/page.tsx","monthlyCostZar",{});
    expect(monthlyCost(3,{monthly_price_zar:1400,seat_limit:2,extra_seat_price_zar:250})).toBe(1650);
  });
  it("discards a slower response for the previous client",async()=>{
    const pending: Record<string,()=>void>={};
    const q=(table:string)=>{let id="";const obj:any={select:()=>obj,eq:(_:string,value:string)=>{id=value;return obj;},order:()=>obj,single:()=>obj,maybeSingle:()=>obj,
      then:(resolve:any)=>{pending[table+id]=()=>resolve({data:table==="businesses"?{id,business_name:id,faq_json:{}}:table==="subscriptions"?null:[],error:null});}};
      return obj;};
    const setBizDetail=vi.fn(),setBizDetailLoading=vi.fn();
    const load=sourceFunction("app/super-admin/page.tsx","loadBizDetail",{
      detailRequest:{current:0},expandedBiz:null,setExpandedBiz:vi.fn(),setBizDetail,setBizDetailLoading,setBizTours:vi.fn(),setBizAdmins:vi.fn(),setBizFaqs:vi.fn(),notify:vi.fn(),HIDDEN_SUPERADMIN_EMAILS:[],supabase:{from:q},
    });
    const first=load(A),second=load(B);await Promise.resolve();
    for(const table of ["businesses","tours","admin_users","subscriptions"]) pending[table+B]();
    await second;
    for(const table of ["businesses","tours","admin_users","subscriptions"]) pending[table+A]();
    await first;
    expect(setBizDetail.mock.calls.filter(c=>c[0]!==null)).toEqual([[{id:B,business_name:B,faq_json:{},billing_plan:null}]]);
    expect(setBizDetailLoading.mock.calls.filter(c=>c[0]===false)).toHaveLength(1);
  });
  it("refuses to save a mismatched detail record",async()=>{
    const from=vi.fn(),notify=vi.fn();
    const save=sourceFunction("app/super-admin/page.tsx","saveBizDetail",{bizDetail:{id:A},expandedBiz:B,bizDetailLoading:false,supabase:{from},notify});
    await save();expect(from).not.toHaveBeenCalled();
  });
});
describe("platform edge access",()=>{
  for(const fn of ["platform-bank-details","platform-invoice-checkout"]) for(const role of ["anon","MAIN_ADMIN","SUPER_ADMIN"]) it(fn+" rejects "+role,async()=>{
    const rpc=vi.fn();
    const handler=sourceHandler("supabase/functions/"+fn+"/index.ts",{
      "https://esm.sh/@supabase/supabase-js@2":{createClient:()=>({rpc})},
      "../_shared/auth.ts":{requireAuth:async()=>{if(role==="anon")throw Error("Unauthenticated");return {role,isServiceRole:false};}},
    },{SUPABASE_URL:"https://test.invalid",SUPABASE_SERVICE_ROLE_KEY:"fixture",PLATFORM_YOCO_SECRET_KEY:"fixture",SETTINGS_ENCRYPTION_KEY:"fixture"});
    const response=await handler(new Request("https://test.invalid",{method:"POST",body:JSON.stringify({action:"get",platform_invoice_id:A})}));
    expect(response.status).toBe(role==="anon"?401:403);expect(rpc).not.toHaveBeenCalled();
  });
});
describe("seat billing history",()=>{
  const events=[{created_at:"2026-09-16T10:00:00Z",after_state:{delta:1}},{created_at:"2026-10-02T10:00:00Z",after_state:{delta:1}}];
  it("does not back-charge September for seats added in October",()=>{
    expect(seatPriceForDay("2026-09-01",3,events,1,500)).toBe(0);
    expect(seatPriceForDay("2026-09-16",3,events,1,500)).toBe(500);
    expect(seatPriceForDay("2026-10-02",3,events,1,500)).toBe(1000);
  });
});
describe("edge Sentry capture",()=>{
  function fixture(){const fetch=vi.fn(async()=>new Response("OK"));const exports=sourceExports("supabase/functions/_shared/sentry.ts",{},{
    SENTRY_DSN:"https://public-fixture@monitor.example.invalid/123",
  },fetch);return {fetch,...exports} as any;}
  it("captures returned 503s without request secrets or customer bodies",async()=>{
    const f=fixture();const response=await f.withSentry("checkout",async()=>new Response("sensitive provider response",{status:503}))(new Request("https://test.invalid/pay?token=secret",{headers:{authorization:"secret","x-booking-waiver-token":"proof"}}));
    expect(response.status).toBe(503);expect(f.fetch).toHaveBeenCalledOnce();
    const envelope=f.fetch.mock.calls[0][1].body;
    expect(envelope).toContain('"app":"edge"');expect(envelope).not.toContain("secret");expect(envelope).not.toContain("proof");expect(envelope).not.toContain("sensitive provider response");
  });
  it("captures HTTP-200 operation failure without consuming its response",async()=>{
    const f=fixture();const response=await f.withSentry("messages",async()=>Response.json({ok:false,error:"sensitive-response-fixture"}))(new Request("https://test.invalid"));
    expect((await response.json()).ok).toBe(false);expect(f.fetch).toHaveBeenCalledOnce();expect(f.fetch.mock.calls[0][1].body).not.toContain("sensitive-response-fixture");
  });
  it("does not alert on expected access denials",async()=>{
    const f=fixture();await f.withSentry("checkout",async()=>Response.json({ok:false},{status:403}))(new Request("https://test.invalid"));
    expect(f.fetch).not.toHaveBeenCalled();
  });
  for(const body of [{ok:true,errors:1},{ok:true,failed:2},{errors:["sensitive-response-fixture"]}]) it("reports partial batch failures",async()=>{
    const f=fixture();await f.withSentry("batch",async()=>Response.json(body))(new Request("https://test.invalid"));
    expect(f.fetch).toHaveBeenCalledOnce();expect(f.fetch.mock.calls[0][1].body).not.toContain("sensitive-response-fixture");
  });
  it("uses the same check-in ID for cron start and completion",async()=>{
    const f=fixture();const id=await f.captureCheckIn("cron-tasks","in_progress");await f.captureCheckIn("cron-tasks","ok",id);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    for(const [,init] of f.fetch.mock.calls){const payload=JSON.parse(init.body.trim().split("\n")[2]);expect(payload.check_in_id).toBe(id);expect(payload.monitor_slug).toBe("cron-tasks");}
  });
});
