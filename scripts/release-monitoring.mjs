// Scoped release monitoring operations. Secrets are read from env, never logged.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const mode=process.argv[2]||"inspect";
const org=process.env.SENTRY_ORG?.trim(),project=process.env.SENTRY_PROJECT?.trim(),token=process.env.SENTRY_AUTH_TOKEN?.trim();
assert(org==="bookingtours" && project==="javascript-nextjs" && token,"Expected release Sentry configuration");
const projects=["prj_2ygdVhnjvqRXiGCOPptESKXccEkB","prj_PnnDc2zlpy5LZh0bjWvmPy6wF3I9"];
const scope="jerrys-projects-f4e4eaf9";
async function sentry(path,method="GET",body) {
  const response=await fetch("https://sentry.io/api/0/"+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const result=await response.json().catch(()=>null);
  if(!response.ok) throw new Error("Sentry "+path+" HTTP "+response.status);
  return result;
}
function vercel(path,method="GET",body) {
  const args=["api",path,"--method",method,"--scope",scope,"--raw"];
  if(body) args.push("--input","-","--header","Content-Type: application/json");
  try { return JSON.parse(execFileSync("vercel",args,{input:body?JSON.stringify(body):undefined,encoding:"utf8",stdio:["pipe","pipe","pipe"]})); }
  catch { throw new Error("Vercel "+method+" "+path+" failed (output suppressed to protect secrets)"); }
}
if(mode==="inspect-alert-options") {
  const config=await sentry("projects/"+org+"/"+project+"/rules/configuration/");
  console.log(JSON.stringify(config.actions?.filter(a=>a.id.includes("NotifyEmail"))));
  try { const customer=await sentry("customers/"+org+"/"); console.log(JSON.stringify({plan:customer.plan,monitorUsage:customer.categories?.monitorSeats,quotas:customer.quotas?.monitorSeats})); } catch(error){console.log(error.message);}
} else if(mode==="configure-alerts") {
  const rules=await sentry("projects/"+org+"/"+project+"/rules/");
  const owner=rules.find(r=>r.createdBy?.email==="gidslang89@gmail.com")?.createdBy;
  assert(owner?.id,"Cannot verify the release alert recipient");
  const actions=[{id:"sentry.mail.actions.NotifyEmailAction",targetType:"Member",targetIdentifier:String(owner.id),fallthroughType:"AllMembers"}];
  const updates=[
    {id:"17000672",name:"Production: new or regressed error",actionMatch:"any",frequency:30,conditions:[{id:"sentry.rules.conditions.first_seen_event.FirstSeenEventCondition"},{id:"sentry.rules.conditions.regression_event.RegressionEventCondition"}]},
    {id:"17000671",name:"Production: error spike (more than 5 in 5 minutes)",actionMatch:"all",frequency:15,conditions:[{id:"sentry.rules.conditions.event_frequency.EventFrequencyCondition",comparisonType:"count",interval:"5m",value:5}]},
  ];
  for(const update of updates) {
    const result=await sentry("projects/"+org+"/"+project+"/rules/"+update.id+"/","PUT",{...update,environment:"production",filterMatch:"all",filters:[{id:"sentry.rules.filters.level.LevelFilter",match:"gte",level:"40"}],actions});
    console.log(JSON.stringify({rule:result.id,name:result.name,environment:result.environment,recipient:owner.email}));
  }
  const monitors=await sentry("organizations/"+org+"/monitors/");
  if(!monitors.some(m=>m.slug==="cron-tasks")) {
    assert(monitors.filter(m=>m.status!=="disabled").length===0,"Included monitor already in use");
    const result=await sentry("organizations/"+org+"/monitors/","POST",{project,slug:"cron-tasks",name:"Booking cleanup and reminders",status:"disabled",owner:"user:"+owner.id,config:{schedule_type:"crontab",schedule:"*/5 * * * *",timezone:"UTC",checkin_margin:2,max_runtime:2,failure_issue_threshold:1,recovery_threshold:1}});
    console.log(JSON.stringify({monitor:result.slug,status:result.status}));
  }
} else if(mode==="enable-monitor") {
  const result=await sentry("organizations/"+org+"/monitors/cron-tasks/","PUT",{project,status:"active"});
  console.log(JSON.stringify({monitor:result.slug,status:result.status}));
} else if(mode==="checkins") {
  const result=await sentry("organizations/"+org+"/monitors/cron-tasks/checkins/?environment=production");
  console.log(JSON.stringify(result.slice(0,8).map(c=>({id:c.id,status:c.status,dateCreated:c.dateCreated,duration:c.duration,environment:c.environment}))));
} else if(mode==="configure-edge") {
  const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  assert(ref==="ukdsrndqhsatjkmxijuj");
  const response=await fetch("https://api.supabase.com/v1/projects/"+ref+"/secrets",{method:"POST",headers:{Authorization:"Bearer "+process.env.SUPABASE_ACCESS_TOKEN,"Content-Type":"application/json"},body:JSON.stringify([{name:"SENTRY_DSN",value:process.env.SENTRY_DSN.trim()}])});
  assert(response.ok,"Could not configure edge Sentry DSN");
  console.log("Edge Sentry destination updated; no other secret changed.");
} else if(mode==="inspect") {
  try {
    const members=await sentry("organizations/"+org+"/members/");
    console.log(JSON.stringify({members:members.map(m=>({id:m.id,userId:m.user?.id,email:m.email,role:m.role,pending:m.pending}))}));
  } catch(error) { console.log(String(error.message)); }
  for(const path of ["organizations/"+org+"/monitors/","projects/"+org+"/"+project+"/rules/"]) {
    console.log(JSON.stringify({path,result:await sentry(path)}));
  }
  for(const id of projects) {
    const env=vercel("/v10/projects/"+id+"/env");
    console.log(JSON.stringify({project:id,monitoringVariables:env.envs.filter(e=>e.key.includes("SENTRY")).map(e=>({id:e.id,key:e.key,target:e.target,type:e.type}))}));
  }
} else if(mode==="configure-env") {
  const keys=["SENTRY_ORG","SENTRY_PROJECT","SENTRY_AUTH_TOKEN","SENTRY_DSN","NEXT_PUBLIC_SENTRY_DSN"];
  for(const id of projects) for(const key of keys) {
    const value=process.env[key]?.trim(); assert(value,key+" missing");
    const env=vercel("/v10/projects/"+id+"/env");
    const existing=env.envs.find(e=>e.key===key && e.target.includes("production"));
    if(existing) vercel("/v9/projects/"+id+"/env/"+existing.id,"PATCH",{value});
    else vercel("/v10/projects/"+id+"/env","POST",{key,value,type:"sensitive",target:["production"]});
    console.log(JSON.stringify({project:id,key,updated:true}));
  }
} else throw new Error("Unknown mode");
