import { describe, it, expect, vi } from "vitest";
import { sourceHandler } from "../helpers/source-handler";
import * as deliveries from "../../supabase/functions/_shared/marketing-delivery";
import { marketingCalendarDate } from "../../supabase/functions/_shared/marketing-calendar";

function automationFixture(eligibility = "eligible") {
 let status: string | null = null;
 const writes: any[] = [];
 const rpc = vi.fn(async(name:string) => {
   if(name === "enroll_welcome_back_sequences") return {data:0};
   if(name === "claim_marketing_automation_enrollments") return {data:[{id:"enrollment",business_id:"tenant",automation_id:"journey",contact_id:"contact",current_step:0,created_at:"2026-01-01T00:00:00Z",metadata:{}}]};
   if(name === "confirm_marketing_delivery") return {data:"eligible"};
   if(name === "marketing_step_eligibility") return {data:eligibility};
   if(name === "reserve_marketing_delivery") {if(status) return {data:{reason:"delivery_"+status,id:"intent"}};status="sending";return {data:{reason:"reserved",id:"intent"}};}
   return {data:0};
 });
 const from=(table:string) => {
   let write:any=null;
   const q:any={select:()=>q,eq:()=>q,order:()=>q,single:()=>q,maybeSingle:()=>q,
     insert:(value:any)=>{write=value;return q;},update:(value:any)=>{write=value;return q;},
     then:(resolve:any)=>{
       if(write){writes.push({table,value:write});if(table==="marketing_deliveries")status=write.status;return Promise.resolve(resolve({error:null}));}
       const data:any={marketing_automations:{id:"journey",business_id:"tenant",status:"active",trigger_type:"manual"},
         businesses:{business_name:"Fixture",subdomain:"fixture"},marketing_automation_steps:[{id:"step",position:0,step_type:"send_email",config:{template_id:"template"}}],
         marketing_contacts:{id:"contact",email:"synthetic@guests.bookingtours.co.za",status:"active",tags:[]},marketing_templates:{html_content:"<body>{{unsubscribe_url}}</body>",subject_line:"Fixture"}};
       return Promise.resolve(resolve({data:data[table]||null,error:null}));
     }};return q;
 };
 const provider=vi.fn(async()=>{throw new Error("Synthetic timeout, outcome unknown");});
 const handler=sourceHandler("supabase/functions/marketing-automation-dispatch/index.ts",{
   "../_shared/tenant.ts":{createServiceClient:()=>({rpc,from}),fetchAllRows:async()=>[],getAdminAppOrigins:()=>["https://fixture.invalid"],isAllowedOrigin:()=>true},
   "../_shared/auth.ts":{requireAuth:async()=>({businessId:"tenant",role:"MAIN_ADMIN"})},
   "../_shared/subscription.ts":{nonTradingBusinessIds:async()=>new Set()},
   "../_shared/marketing-tokens.ts":{fillMarketingTokens:(s:string)=>s},
   "../_shared/marketing-email-html.ts":{replaceLegacyMarketingSocialIcons:(s:string)=>s},
   "../_shared/marketing-delivery.ts":deliveries,"../_shared/marketing-calendar.ts":{marketingCalendarDate},
 },{RESEND_API_KEY:"synthetic-only",SUPABASE_URL:"https://fixture.invalid"},provider);
 return {handler,provider,writes,rpc};
}
const request=()=>new Request("https://fixture.invalid",{method:"POST"});
describe("actual automation dispatcher with in-memory provider",()=>{
 it.each(["permission_unknown","suppressed","already_booked"])("blocks %s before a provider call",async reason=>{
   const fixture=automationFixture(reason);const response=await fixture.handler(request());
   expect(response.status).toBe(200);expect(fixture.provider).not.toHaveBeenCalled();
   expect(fixture.writes.some(w=>w.table==="marketing_automation_enrollments"&&w.value.status==="exited")).toBe(true);
 });
 it("does not resend an uncertain provider result on a repeated dispatch",async()=>{
   const fixture=automationFixture();await fixture.handler(request());await fixture.handler(request());
   expect(fixture.provider).toHaveBeenCalledTimes(1);
   expect(fixture.writes.some(w=>w.table==="marketing_deliveries"&&w.value.status==="reconcile")).toBe(true);
   expect(fixture.provider.mock.calls[0][1].headers["Idempotency-Key"]).toBe("marketing/intent");
 });
});

it("rejects unverified provider callbacks before creating a service client",async()=>{
 const createServiceClient=vi.fn();
 const handler=sourceHandler("supabase/functions/resend-webhook/index.ts",{
  "npm:standardwebhooks":{Webhook:class {verify(){throw new Error("Invalid signature");}}},
  "../_shared/tenant.ts":{createServiceClient},
 },{RESEND_WEBHOOK_SECRET:"fixture-only"});
 const response=await handler(new Request("https://fixture.invalid",{method:"POST",body:'{"type":"email.complained","data":{"email_id":"forged"}}'}));
 expect(response.status).toBe(401);expect(createServiceClient).not.toHaveBeenCalled();
});
