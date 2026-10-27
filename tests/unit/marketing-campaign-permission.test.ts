import { expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";
it("campaign preflight requests the same tenant and tag-filtered eligibility reasons as dispatch",async()=>{
 const rpc=vi.fn(async()=>({data:{eligible:0,permission_unknown:3},error:null}));
 const count=vi.fn(), reasons=vi.fn();
 const compute=sourceFunction("app/marketing/templates/page.tsx","computeAudienceCount",{
  businessId:"tenant",audienceRequest:{current:0},supabase:{rpc},setAudienceCount:count,setAudienceReasons:reasons,notify:vi.fn(),
 });
 await compute("tagged",["completed-tour"]);
 expect(rpc).toHaveBeenCalledWith("marketing_audience_summary",{p_business_id:"tenant",p_tags:["completed-tour"]});
 expect(count).toHaveBeenLastCalledWith(0);expect(reasons).toHaveBeenLastCalledWith({eligible:0,permission_unknown:3});
});
it("unavailable campaign eligibility stays unknown and blocks the send button",async()=>{
 const count=vi.fn(),notify=vi.fn();
 const compute=sourceFunction("app/marketing/templates/page.tsx","computeAudienceCount",{
  businessId:"tenant",audienceRequest:{current:0},supabase:{rpc:async()=>({error:{message:"offline"}})},setAudienceCount:count,setAudienceReasons:vi.fn(),notify,
 });
 await compute("all",[]);expect(count.mock.calls).toEqual([[null]]);expect(notify).toHaveBeenCalled();
});
