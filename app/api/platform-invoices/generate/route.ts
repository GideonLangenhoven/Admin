import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { platformInvoicePreview } from "@/app/lib/platform-invoice-preview";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const caller=await getCallerAdmin(req);
  if(caller?.role!=="SUPER_ADMIN") return NextResponse.json({error:"Super Admin required"},{status:403});
  let body;
  try{body=await req.json();}catch{return NextResponse.json({error:"Invalid JSON"},{status:400});}
  if(typeof body.business_id!=="string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period||"")) return NextResponse.json({error:"Business and valid month required"},{status:400});
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  try {
    const preview=await platformInvoicePreview(db,body.business_id,body.period);
    if(!preview) return NextResponse.json({error:"Complete billing setup first"},{status:409});
    const {data,error}=await db.rpc("platform_generate_invoice",{p_actor_id:caller.id,p_snapshot:preview});
    if(error) return NextResponse.json({error:error.code==="23505"?"An invoice already exists for this month. Void the unpaid draft before regenerating.":error.message},{status:409});
    return NextResponse.json({ok:true,invoice:data});
  }catch{return NextResponse.json({error:"Could not calculate the invoice. No invoice was created."},{status:503});}
}
