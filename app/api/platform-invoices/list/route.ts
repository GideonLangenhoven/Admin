import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { platformInvoicePreview } from "@/app/lib/platform-invoice-preview";
import { monthBounds } from "@/app/lib/platform-billing";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const caller=await getCallerAdmin(req);
  if(caller?.role!=="SUPER_ADMIN") return NextResponse.json({error:"Super Admin required"},{status:403});
  const period=req.nextUrl.searchParams.get("period")||new Date().toISOString().slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({error:"Valid month required"},{status:400});
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {periodStart,periodEnd}=monthBounds(period);
  try {
    const rows=[];
    for(let from=0;;from+=100) {
      const result=await db.from("businesses").select("id,business_name").order("business_name").order("id").range(from,from+99);
      if(result.error) throw result.error;
      // Small batches limit concurrent usage-count queries at launch and scale.
      for(let i=0;i<result.data.length;i+=5) {
        rows.push(...await Promise.all(result.data.slice(i,i+5).map(async business=>{
          const invoices=await db.from("platform_invoices").select("*").eq("business_id",business.id).eq("period_start",periodStart).order("created_at",{ascending:false});
          if(invoices.error) throw invoices.error;
          const existing=invoices.data.find(i=>i.status!=="VOID")||null;
          const preview=existing||await platformInvoicePreview(db,business.id,period);
          return {...preview,business_id:business.id,business_name:business.business_name,has_subscription:!!preview,existing_invoice:existing,voided_invoices:invoices.data.filter(i=>i.status==="VOID")};
        })));
      }
      if(result.data.length<100) break;
    }
    return NextResponse.json({period,period_start:periodStart,period_end:periodEnd,rows},{headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"Could not calculate invoices. Refresh before generating or sending."},{status:503});}
}
