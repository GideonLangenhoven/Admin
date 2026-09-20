// Migration plus real database behaviour, always ROLLBACK; only fixture rows.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
assert(ref==="ukdsrndqhsatjkmxijuj");
const migration=readFileSync("supabase/migrations/20260913100000_platform_admin_controls.sql","utf8").replace(/^BEGIN;\s*/,"").replace(/COMMIT;\s*$/,"");
const checks=readFileSync("tests/tenant-isolation/platform-admin.sql","utf8");
const response=await fetch("https://api.supabase.com/v1/projects/"+ref+"/database/query",{
  method:"POST",headers:{Authorization:"Bearer "+process.env.SUPABASE_ACCESS_TOKEN,"Content-Type":"application/json"},
  body:JSON.stringify({query:"BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='40s'; SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);\n"+migration+"\n"+checks+"\nROLLBACK;"}),
  signal:AbortSignal.timeout(60000),
});
const result=await response.json();
if(!response.ok) throw new Error("Database rehearsal failed: "+JSON.stringify(result));
console.log("PASS: real database onboarding, tenant boundaries, readiness, staff, seats, status, invoice correction and payment assertions; all fixture changes rolled back.");
