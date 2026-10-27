import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { agentStore, agentBridge, tokenHash, withAgentDb } from "../../app/lib/agent-db";
import { agentConfig, boundedBody, type AgentConfig } from "../../app/lib/agent-config";
import { connectionAction, oauthAction, operatorIdentity } from "../../app/lib/agent-oauth";
import { mcpRequest, handleMcp, handleAgentMetadata } from "../../app/lib/agent-mcp";
import { executeAgentRead } from "../../app/lib/agent-read-service";
import { POST as muse } from "../../app/api/mcp/muse/route";

// Real disposable PostgreSQL + real OAuth library/PKCE, SYNTHETIC tenant data.
// Operator consent identity is injected; this does not test live Supabase Auth,
// live PostgREST/Edge/Admin routes or real ChatGPT/Muse account linking.
const host=process.env.AGENT_TEST_SOCKET || "";
const port=Number(process.env.AGENT_TEST_PORT);
const local=/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host) && Number.isInteger(port) && port>1024 && port<65536;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const config:AgentConfig={ provider:"CHATGPT",origin:"https://agent.fixture.invalid",issuer:"https://agent.fixture.invalid",
  resource:"https://agent.fixture.invalid/api/mcp/chatgpt",metadata:"https://agent.fixture.invalid/.well-known/oauth-protected-resource/api/mcp/chatgpt",
  redirects:["https://chatgpt.com/connector_platform_oauth_redirect"],pilotBusinesses:[id(1)] };
let admin:pg.Client, db:pg.Client, gateway:pg.Pool, database:string;
const identity=async()=>id(2);
const request=(path:string,body?:unknown,headers:Record<string,string>={})=>new Request(config.origin+path,{ method:body===undefined ? "GET" : "POST",
  headers:{ ...(body===undefined ? {} : { "content-type":"application/json",origin:config.origin }),...headers },
  ...(body===undefined ? {} : { body:typeof body==="string" ? body : JSON.stringify(body) }) });
const oauth=(action:string,req:Request)=>withAgentDb(client=>oauthAction(req,action,client,config,identity),gateway);
async function newCode(scopes="departures:read availability:read attention:read",business=id(1),allow=true,extraQuery="") {
  const client=await (await oauth("register",request("/api/agent/oauth/register",{ redirect_uris:config.redirects }))).json();
  const verifier=randomBytes(32).toString("base64url");
  const query=new URLSearchParams({ client_id:client.client_id,redirect_uri:config.redirects[0],response_type:"code",resource:config.resource,
    scope:scopes,state:"synthetic-state",code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256" });
  const response=await oauth("authorize",request("/api/agent/oauth/authorize?"+query+extraQuery));
  const ticket=new URL(response.headers.get("location")!).searchParams.get("request")!;
  const consent=await oauth("consent",request("/api/agent/oauth/consent",{ request:ticket,business_id:business,allow }));
  const callback=new URL((await consent.json()).redirect);
  return { clientId:client.client_id,verifier,code:callback.searchParams.get("code"),callback,ticket };
}
async function exchange(code:Awaited<ReturnType<typeof newCode>>,change:Record<string,string>={}) {
  const body=new URLSearchParams({ grant_type:"authorization_code",client_id:code.clientId,code:code.code || "",
    redirect_uri:config.redirects[0],code_verifier:code.verifier,resource:config.resource,...change });
  return oauth("token",request("/api/agent/oauth/token",body.toString(),{ "content-type":"application/x-www-form-urlencoded" }));
}
async function connected(scopes?:string) {
  const code=await newCode(scopes);
  const response=await exchange(code);
  expect(response.status).toBe(200);
  return { ...await response.json(),clientId:code.clientId };
}
async function refresh(token:any,change:Record<string,string>={}) {
  return oauth("token",request("/api/agent/oauth/token",new URLSearchParams({ grant_type:"refresh_token",client_id:token.clientId,
    refresh_token:token.refresh_token,resource:config.resource,...change }).toString(),{ "content-type":"application/x-www-form-urlencoded" }));
}
async function read(token:any,op="get_departure_availability",input:unknown={ business_id:id(1),departure_id:id(4) }) {
  return withAgentDb(client=>executeAgentRead(request("/api/mcp/chatgpt",{}, { authorization:"Bearer "+token.access_token }),op,input,
    { ...agentBridge(client,config,token.access_token),audit:()=>{} }),gateway);
}
async function wire(token:any,message:unknown) {
  const version=(message as any)?.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
  const response=await withAgentDb(client=>mcpRequest(request("/api/mcp/chatgpt",message,{ authorization:"Bearer "+token.access_token,accept:"application/json, text/event-stream",
    ...(version ? { "mcp-protocol-version":version,"mcp-method":(message as any).method,
      ...((message as any).method==="tools/call" ? { "mcp-name":(message as any).params.name } : {}) } : {}) }),client,config),gateway);
  const raw=await response.text();
  const line=raw.split("\n").find(value=>value.startsWith("data: "));
  return { response,raw,message:JSON.parse(line ? line.slice(6) : raw || "null") };
}
async function sqlAs(role:string,sql:string,claims:unknown={}) {
  if (!["anon","authenticated","service_role","bookingtours_agent_gateway","bookingtours_agent_owner"].includes(role)) throw new Error();
  await db.query("BEGIN");
  try { await db.query("SET LOCAL ROLE "+role);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);return await db.query(sql); }
  finally { await db.query("ROLLBACK"); }
}
describe.skipIf(!local)("local PostgreSQL / OAuth backend (synthetic tenants, no platform claims)",()=>{
  beforeAll(async()=>{
    database="mcp_fixture_"+randomBytes(8).toString("hex");
    const options={ host,port,user:process.env.USER,connectionTimeoutMillis:5000 };
    admin=new pg.Client({ ...options,database:"postgres" });await admin.connect();await admin.query("CREATE DATABASE "+database);
    db=new pg.Client({ ...options,database });await db.connect();
    await db.query(readFileSync("tests/fixtures/rollout-schema.sql","utf8"));
    await db.query("create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);alter table admin_users add column read_only boolean not null default false");
    await db.query(readFileSync("tests/fixtures/rollout-policies.sql","utf8"));
    const pending=readFileSync("supabase/migrations/20260502080638_rls_tighten_remaining_medium.sql","utf8");
    await db.query("alter table pending_reschedules enable row level security;alter table businesses enable row level security");
    await db.query(pending.slice(pending.indexOf('CREATE POLICY "pending_reschedules_service"'),pending.indexOf("-- 6. businesses")));
    await db.query(readFileSync("supabase/migrations/20260706130000_remove_shared_resources.sql","utf8"));
    await db.query(readFileSync("supabase/migrations/20261003160000_agent_read_foundation.sql","utf8"));
    // Fixture prerequisite: keep existing native callers' function permissions,
    // while denying the new gateway legacy SECURITY DEFINER RPCs granted PUBLIC.
    // No production ACL changes are performed by this test or the candidate SQL.
    const legacy=(await db.query("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE')")).rows;
    for (const fn of legacy) {
      await db.query("grant execute on function "+fn.signature+" to anon,authenticated,service_role");
      await db.query("revoke execute on function "+fn.signature+" from public");
    }
    await db.query(readFileSync("supabase/agent-mcp.local.sql","utf8"));
    await db.query("alter role bookingtours_agent_gateway login"); // Local trust socket only, no credential emitted.
    gateway=new pg.Pool({ ...options,user:"bookingtours_agent_gateway",database,max:5 });
    await db.query("insert into auth.users(id) values($1),($2)",[id(2),id(82)]);
    await db.query("insert into businesses(id,name,operator_email,subscription_status) values($1,'MCP A fixture','a@example.invalid','ACTIVE'),($2,'MCP B fixture','b@example.invalid','ACTIVE')",[id(1),id(81)]);
    await db.query("insert into admin_users(id,user_id,business_id,email,password_hash,role) values($1,$2,$3,'a@example.invalid','fixture','MAIN_ADMIN'),($4,$5,$6,'b@example.invalid','fixture','MAIN_ADMIN')",[id(10),id(2),id(1),id(80),id(82),id(81)]);
    await db.query("insert into tours(id,business_id,name,base_price_per_person,default_capacity) values($1,$2,'A fixture',100,10),($3,$4,'B fixture',100,10)",[id(5),id(1),id(85),id(81)]);
    await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total,booked,held) values($1,$2,$3,now()+interval '1 day',10,4,3),($4,$5,$6,now()+interval '1 day',10,1,0)",[id(4),id(1),id(5),id(84),id(81),id(85)]);
    await db.query("insert into bookings(id,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,total_captured,status,waiver_status) values($1,$2,$3,$4,'PRIVATE synthetic guest','private@example.invalid',2,100,200,0,'CONFIRMED','PENDING')",[id(60),id(1),id(5),id(4)]);
  },20_000);
  beforeEach(async()=>{
    vi.stubEnv("AGENT_CHATGPT_ENABLED","true");vi.stubEnv("AGENT_PUBLIC_ORIGIN",config.origin);
    vi.stubEnv("AGENT_CHATGPT_REDIRECT_URIS",JSON.stringify(config.redirects));vi.stubEnv("AGENT_PILOT_BUSINESS_IDS",JSON.stringify(config.pilotBusinesses));
    vi.stubEnv("AGENT_DATABASE_URL","postgres://unused@fixture.invalid/unused");vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://supabase.fixture.invalid");vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY","synthetic-public-key");
    await db.query("truncate agent_private.requests,agent_private.codes,agent_private.tokens,agent_private.clients,agent_private.quotas;delete from agent_connection_grants");
    await db.query("update agent_private.providers set enabled=true,issuer=$1,resource=$2,pilot_businesses=$3 where provider='CHATGPT'",[config.issuer,config.resource,config.pilotBusinesses]);
    await db.query("update admin_users set role='MAIN_ADMIN',suspended=false,read_only=false,user_id=$1 where id=$2",[id(2),id(10)]);
    await db.query("update auth.users set deleted_at=null,banned_until=null;update businesses set subscription_status='ACTIVE';update slots set status='OPEN',booked=4,held=3 where id='"+id(4)+"'");
  });
  afterAll(async()=>{ vi.unstubAllEnvs();await gateway?.end();await db?.end();if(database) await admin.query("DROP DATABASE "+database+" WITH (FORCE)");await admin?.end(); });
  it("real OAuth PKCE code exchange returns opaque MCP-only credentials",async()=>{
    const code=await newCode();expect(code.callback.searchParams.get("iss")).toBe(config.issuer);expect(code.callback.searchParams.get("state")).toBe("synthetic-state");
    const response=await exchange(code);const token=await response.json();expect(response.status).toBe(200);expect(token.access_token).toMatch(/^bta_[A-Za-z0-9_-]{43}$/);
    expect(token.refresh_token).toMatch(/^btr_[A-Za-z0-9_-]{43}$/);expect(token.expires_in).toBeLessThanOrEqual(600);
    const stored=(await db.query("select * from agent_private.tokens")).rows[0];expect(stored.hash).toBe(tokenHash(token.access_token));expect(JSON.stringify(stored)).not.toContain(token.access_token);
  });
  it("single-use authorization code cannot be exchanged twice",async()=>{ const code=await newCode();expect((await exchange(code)).status).toBe(200);expect((await exchange(code)).status).toBe(400); });
  it("ChatGPT's optional locale hint preserves the PKCE exchange, issuer and requested scopes",async()=>{
    const code=await newCode(undefined,undefined,true,"&ui_locales=en-US");
    expect(code.callback.origin+code.callback.pathname).toBe(config.redirects[0]);
    expect(code.callback.searchParams.get("iss")).toBe(config.issuer);
    expect(code.callback.searchParams.get("state")).toBe("synthetic-state");
    const response=await exchange(code);expect(response.status).toBe(200);
    expect((await response.json()).scope.split(" ")).toEqual(["departures:read","availability:read","attention:read"]);
  });
  it("locale hints retain duplicate, excessive-value and unknown-parameter rejection",async()=>{
    for(const query of ["ui_locales=en-US&ui_locales=en-US","ui_locales="+"x".repeat(2049),"unexpected=en-US"]) {
      await expect(oauth("authorize",request("/api/agent/oauth/authorize?"+query))).rejects.toMatchObject({ code:"INVALID_INPUT" });
    }
  });
  it("wrong PKCE consumes the code and cannot be retried",async()=>{ const code=await newCode();expect((await exchange(code,{ code_verifier:"x".repeat(43) })).status).toBe(400);expect((await exchange(code)).status).toBe(400); });
  it("expired code fails",async()=>{ const code=await newCode();await db.query("update agent_private.codes set expires_at=now()-interval '1 second'");expect((await exchange(code)).status).toBe(400); });
  it("OAuth storage failure is unavailable rather than a fabricated token or bad-credential result",async()=>{
    const code=await newCode();await db.query("alter table agent_private.codes rename to unavailable_codes");
    try { await expect(exchange(code)).rejects.toMatchObject({ code:"UPSTREAM_UNAVAILABLE",status:503 }); }
    finally { await db.query("alter table agent_private.unavailable_codes rename to codes"); }
    expect((await db.query("select count(*)::int n from agent_private.tokens")).rows[0].n).toBe(0);
  });
  it("expired private requests/codes are cleaned without touching live state",async()=>{
    const old=await newCode();
    await db.query("update agent_private.requests set expires_at=now()-interval '1 second';update agent_private.codes set expires_at=now()-interval '1 second'");
    const next=await newCode();
    expect((await db.query("select count(*)::int n from agent_private.codes where hash=$1",[tokenHash(old.code!)])).rows[0].n).toBe(0);
    expect((await exchange(next)).status).toBe(200);expect((await db.query("select count(*)::int n from agent_connection_grants")).rows[0].n).toBe(2);
  });
  it("wrong resource or redirect cannot exchange a code",async()=>{ const code=await newCode();await expect(exchange(code,{ resource:config.origin+"/api/mcp/muse" })).rejects.toMatchObject({ code:"INVALID_REQUEST" });expect((await exchange(code,{ redirect_uri:"https://attacker.invalid" })).status).toBe(400); });
  it("denial creates neither grant nor credentials",async()=>{ const code=await newCode(undefined,undefined,false);expect(code.callback.searchParams.get("error")).toBe("access_denied");expect((await db.query("select count(*)::int n from agent_connection_grants")).rows[0].n).toBe(0); });
  it("consent ticket is single use",async()=>{ const code=await newCode();await expect(oauth("consent",request("/api/agent/oauth/consent",{ request:code.ticket,business_id:id(1),allow:true }))).rejects.toMatchObject({ code:"INVALID_REQUEST" }); });
  it("forged redirects, plain PKCE, duplicate and excessive query parameters fail",async()=>{
    await expect(oauth("register",request("/api/agent/oauth/register",{ redirect_uris:["https://attacker.invalid"] }))).rejects.toMatchObject({ code:"INVALID_CLIENT_METADATA" });
    await expect(oauth("authorize",request("/api/agent/oauth/authorize?client_id=x&client_id=y"))).rejects.toMatchObject({ code:"INVALID_INPUT" });
    await expect(oauth("authorize",request("/api/agent/oauth/authorize?response_type=code&resource="+encodeURIComponent(config.resource)+"&code_challenge_method=plain"))).rejects.toMatchObject({ code:"INVALID_INPUT" });
  });
  it("cross-origin consent and malformed JSON cannot issue a grant",async()=>{
    await expect(oauth("consent",request("/api/agent/oauth/consent",{}, { origin:"https://attacker.invalid" }))).rejects.toMatchObject({ code:"FORBIDDEN" });
    await expect(oauth("consent",request("/api/agent/oauth/consent","{"))).rejects.toMatchObject({ code:"INVALID_INPUT",status:400 });
  });
  it("refresh rotates and replay revokes the whole grant",async()=>{
    const token=await connected();const response=await refresh(token);expect(response.status).toBe(200);const next={ ...await response.json(),clientId:token.clientId };
    expect(next.refresh_token).not.toBe(token.refresh_token);expect((await read(next)).status).toBe(200);expect((await read(token)).status).toBe(401);
    expect((await refresh(token)).status).toBe(400);expect((await read(next)).status).toBe(401);
  });
  it("wrong refresh client cannot rotate or revoke another client's grant",async()=>{ const token=await connected();expect((await refresh(token,{ client_id:"wrong-client" })).status).toBe(400);expect((await read(token)).status).toBe(200); });
  it("expired access fails while valid refresh remains usable",async()=>{ const token=await connected();await db.query("update agent_private.tokens set expires_at=issued_at+interval '1 microsecond'");expect((await read(token)).status).toBe(401);expect((await refresh(token)).status).toBe(200); });
  it("insufficient scope cannot read capacity or attention",async()=>{ const token=await connected("departures:read");expect((await read(token)).body).toMatchObject({ code:"INSUFFICIENT_SCOPE" });expect((await read(token,"get_departure_attention_summary")).body).toMatchObject({ code:"INSUFFICIENT_SCOPE" }); });
  it("business A cannot request B's data, departure or tour",async()=>{
    const token=await connected();expect((await read(token,undefined,{ business_id:id(81),departure_id:id(84) })).status).toBe(403);
    expect((await read(token,undefined,{ business_id:id(1),departure_id:id(84) })).body).toMatchObject({ code:"NOT_FOUND" });
    expect((await read(token,"list_departures",{ business_id:id(1),tour_id:id(85),start_at:new Date().toISOString(),end_at:new Date(Date.now()+86400000).toISOString() })).body).toMatchObject({ code:"NOT_FOUND" });
  });
  for (const [name,sql] of [
    ["demoted owner","update admin_users set role='ADMIN' where id='"+id(10)+"'"],
    ["suspended owner","update admin_users set suspended=true where id='"+id(10)+"'"],
    ["removed membership","update admin_users set user_id=null where id='"+id(10)+"'"],
    ["read-only demo owner","update admin_users set read_only=true where id='"+id(10)+"'"],
    ["deleted identity","update auth.users set deleted_at=now() where id='"+id(2)+"'"],
    ["banned identity","update auth.users set banned_until=now()+interval '1 hour' where id='"+id(2)+"'"],
    ["inactive business","update businesses set subscription_status='PAUSED'"],
    ["disabled provider","update agent_private.providers set enabled=false where provider='CHATGPT'"],
    ["disconnected grant","update agent_connection_grants set disconnected_at=now(),enabled=false"],
  ]) it("rejects current "+name,async()=>{ const token=await connected();await db.query(sql);expect((await read(token)).status).not.toBe(200); });
  it("disconnect denies calls and refresh; ordinary app authorization is retained",async()=>{
    const token=await connected();const grant=(await db.query("select id from agent_connection_grants")).rows[0].id;
    await withAgentDb(client=>connectionAction(request("/api/agent/connections",{ business_id:id(1),grant_id:grant }),client,config,identity),gateway);
    expect((await read(token)).status).toBe(401);expect((await refresh(token)).status).toBe(400);
    const ordinary=await sqlAs("authenticated","select id from slots where business_id='"+id(1)+"'",{ sub:id(2),role:"authenticated" });expect(ordinary.rows).toHaveLength(1);
  });
  it("restoring an owner role requires fresh consent rather than reviving a grant",async()=>{
    const token=await connected();
    await db.query("update admin_users set role='ADMIN' where id=$1",[id(10)]);
    await db.query("update admin_users set role='MAIN_ADMIN' where id=$1",[id(10)]);
    expect((await read(token)).status).toBe(401);expect((await refresh(token)).status).toBe(400);
    expect((await read(await connected())).status).toBe(200);
  });
  it("current env pilot removal denies a previously issued token",async()=>{ const token=await connected();vi.stubEnv("AGENT_PILOT_BUSINESS_IDS",JSON.stringify([id(81)]));expect((await read(token)).status).toBe(401); });
  it("cross-provider resource binding rejects a ChatGPT credential",async()=>{
    const token=await connected();await withAgentDb(client=>expect(agentStore(client,"authorize",{ hash:tokenHash(token.access_token),provider:"MUSE",resource:config.origin+"/api/mcp/muse",scopes:["departures:read"] })).rejects.toMatchObject({ code:"CONNECTION_INACTIVE" }),gateway);
  });
  it("atomic quota is shared across connections and is fail-closed",async()=>{
    const token=await connected();const consume=()=>withAgentDb(client=>agentStore(client,"read_quota",{ hash:tokenHash(token.access_token),provider:"CHATGPT",resource:config.resource }),gateway);
    const results=await Promise.all(Array.from({ length:32 },consume));expect(results.filter(Boolean)).toHaveLength(30);expect((await read(token)).status).toBe(429);
    await db.query("alter table agent_private.quotas rename to unavailable_quotas");
    try { expect((await read(token)).body).toMatchObject({ code:"UPSTREAM_UNAVAILABLE" }); }
    finally { await db.query("alter table agent_private.unavailable_quotas rename to quotas"); }
  });
  it("canonical capacity includes booked/held seats; attention returns aggregates only",async()=>{
    const token=await connected();const capacity=await read(token);expect(capacity.body.result).toMatchObject({ available_seats:3,seat_hold_created:false,booking_eligibility:"not_evaluated",data_status:"fresh" });
    const attention=await read(token,"get_departure_attention_summary");expect(attention.body.result).toMatchObject({ outstanding_payment_bookings:1,outstanding_waiver_participants:2 });
    expect(JSON.stringify(attention)).not.toMatch(/PRIVATE|private@example|waiver_payload|customer_name|password|btr_/);
  });
  it("closed/full capacity and stale evidence are explicit",async()=>{
    const token=await connected();await db.query("update slots set status='CLOSED' where id=$1",[id(4)]);expect((await read(token)).body.result?.available_seats).toBe(0);
    await withAgentDb(async client=>{
      const deps=agentBridge(client,config,token.access_token);deps.now=()=>Date.now()+16_000;deps.audit=()=>{};
      const result=await executeAgentRead(request("/api/mcp/chatgpt",{}, { authorization:"Bearer "+token.access_token }),"get_departure_availability",{ business_id:id(1),departure_id:id(4) },deps);
      expect(result.body.result).toMatchObject({ data_status:"stale",available_seats:null });
    },gateway);
  });
  it("no read changes bookings, held capacity, payments or pending reschedules",async()=>{
    const token=await connected();const snapshot=async()=>(await db.query("select (select jsonb_agg(to_jsonb(b)) from bookings b) bookings,(select jsonb_agg(to_jsonb(s)) from slots s) slots,(select count(*) from holds) holds,(select count(*) from pending_reschedules) pending")).rows[0];
    const before=await snapshot();expect((await read(token)).status).toBe(200);expect((await read(token,"get_departure_attention_summary")).status).toBe(200);expect(await snapshot()).toEqual(before);
    for (const op of ["create_booking","hold_seats","issue_refund","send_message"]) expect((await read(token,op)).body).toMatchObject({ code:"UNSUPPORTED_OPERATION" });
  });
  it("actual SDK wire initialize/list/call expose only three scoped reads",async()=>{
    const token=await connected();const initialized=await wire(token,{ jsonrpc:"2.0",id:1,method:"initialize",params:{ protocolVersion:"2025-11-25",capabilities:{},clientInfo:{ name:"local-backend-test",version:"1" } } });
    expect(initialized.message.result.instructions).toContain(id(1));
    const listed=await wire(token,{ jsonrpc:"2.0",id:2,method:"tools/list",params:{} });expect(listed.message.result.tools).toHaveLength(3);
    expect(listed.message.result.tools.every((tool:any)=>tool.securitySchemes[0].type==="oauth2" && tool.annotations.readOnlyHint===true)).toBe(true);
    const called=await wire(token,{ jsonrpc:"2.0",id:3,method:"tools/call",params:{ name:"get_departure_availability",arguments:{ business_id:id(1),departure_id:id(4) } } });
    expect(called.message.result.structuredContent.available_seats).toBe(3);expect(called.response.headers.get("cache-control")).toBe("no-store");
  });
  it("SDK tool error includes the OAuth reauthorization challenge for missing scope",async()=>{
    const token=await connected("departures:read");const response=await wire(token,{ jsonrpc:"2.0",id:3,method:"tools/call",params:{ name:"get_departure_availability",arguments:{ business_id:id(1),departure_id:id(4) } } });
    expect(response.message.result.isError).toBe(true);expect(response.message.result._meta["mcp/www_authenticate"][0]).toContain("insufficient_scope");
  });
  it("current 2026-07-28 protocol discovery/list/call uses the same scoped contract",async()=>{
    const token=await connected();
    const _meta={ "io.modelcontextprotocol/protocolVersion":"2026-07-28",
      "io.modelcontextprotocol/clientInfo":{ name:"local-backend-test",version:"1" },"io.modelcontextprotocol/clientCapabilities":{} };
    const discovered=await wire(token,{ jsonrpc:"2.0",id:1,method:"server/discover",params:{ _meta } });
    expect(discovered.message.result,discovered.raw).toBeDefined();
    expect(discovered.message.result.supportedVersions).toContain("2026-07-28");
    const listed=await wire(token,{ jsonrpc:"2.0",id:2,method:"tools/list",params:{ _meta } });
    expect(listed.message.result.tools).toHaveLength(3);expect(listed.message.result.tools[0].securitySchemes[0].type).toBe("oauth2");
    const called=await wire(token,{ jsonrpc:"2.0",id:3,method:"tools/call",params:{ name:"get_departure_availability",arguments:{ business_id:id(1),departure_id:id(4) },_meta } });
    expect(called.message.result.structuredContent.available_seats).toBe(3);
  });
  it("RFC 7009 revocation works while external reads are disabled",async()=>{
    const token=await connected();vi.stubEnv("AGENT_CHATGPT_ENABLED","false");
    expect(agentConfig("CHATGPT")).toBeNull();expect(agentConfig("CHATGPT",true)).not.toBeNull();
    const body=new URLSearchParams({ client_id:token.clientId,token:token.refresh_token,resource:config.resource }).toString();
    expect((await oauth("revoke",request("/api/agent/oauth/revoke",body,{ "content-type":"application/x-www-form-urlencoded" }))).status).toBe(200);
    vi.stubEnv("AGENT_CHATGPT_ENABLED","true");expect((await read(token)).status).toBe(401);expect((await refresh(token)).status).toBe(400);
  });
  it("direct gateway queries cannot access private rows, writes or privileged functions",async()=>{
    for (const sql of ["select customer_name,email from bookings","update slots set held=9","select * from agent_private.tokens","select agent_private.context('"+id(2)+"','"+id(1)+"')"])
      await expect(sqlAs("bookingtours_agent_gateway",sql)).rejects.toMatchObject({ code:"42501" });
    for (const role of ["anon","authenticated","service_role"])
      await expect(sqlAs(role,"select agent_private.store('connections','{}'::jsonb)")).rejects.toMatchObject({ code:"42501" });
  });
  it("restricted owner RLS confines reads even under an overbroad PUBLIC policy",async()=>{
    await db.query("create policy fixture_public_permissive on slots for select to public using(true)");
    await db.query("BEGIN");
    try { await db.query("SET LOCAL ROLE bookingtours_agent_owner");await db.query("select agent_private.context($1,$2)",[id(2),id(1)]);expect((await db.query("select id from slots")).rows).toHaveLength(1); }
    finally { await db.query("ROLLBACK");await db.query("drop policy fixture_public_permissive on slots"); }
  });
  it("unexpected executable definer RPC fails the gateway configuration gate",async()=>{
    await db.query("create function public.fixture_unsafe_rpc() returns integer language sql security definer as 'select 1'");
    try { await expect(withAgentDb(async()=>true,gateway)).rejects.toMatchObject({ code:"INTEGRATION_DISABLED" }); }
    finally { await db.query("drop function public.fixture_unsafe_rpc()"); }
  });
  it("unexpected direct table privileges fail the gateway configuration gate",async()=>{
    await db.query("grant select(email) on public.bookings to bookingtours_agent_gateway");
    try { await expect(withAgentDb(async()=>true,gateway)).rejects.toMatchObject({ code:"INTEGRATION_DISABLED" }); }
    finally { await db.query("revoke select(email) on public.bookings from bookingtours_agent_gateway"); }
  });
  it("canonical host and cross-origin requests cannot use the transport",async()=>{
    const token=await connected();
    const attempts:Record<string,string>[]=[{ host:"attacker.invalid" },{ origin:"https://attacker.invalid" }];
    for (const headers of attempts)
      await expect(withAgentDb(client=>mcpRequest(request("/api/mcp/chatgpt",{ jsonrpc:"2.0",id:1,method:"tools/list" },{ ...headers,authorization:"Bearer "+token.access_token }),client,config),gateway)).rejects.toMatchObject({ code:"FORBIDDEN" });
  });
  it("expired absolute grant rejects otherwise valid access and refresh",async()=>{
    const token=await connected();
    await db.query("insert into agent_connection_grants(id,user_id,business_id,client_id,provider,role_at_consent,scopes,enabled,resource,created_at,expires_at) select $1,user_id,business_id,client_id,provider,role_at_consent,scopes,enabled,resource,now()-interval '168 hours 1 minute',now()-interval '1 minute' from agent_connection_grants limit 1",[id(99)]);
    await db.query("update agent_private.tokens set grant_id=$1",[id(99)]);
    expect((await read(token)).status).toBe(401);expect((await refresh(token)).status).toBe(400);
  });
  it("invalid private arguments are excluded from SDK results and application logs",async()=>{
    const logs:string[]=[];
    const info=vi.spyOn(console,"info").mockImplementation((...args)=>{ logs.push(JSON.stringify(args)); });
    const error=vi.spyOn(console,"error").mockImplementation((...args)=>{ logs.push(JSON.stringify(args)); });
    try {
      const token=await connected();
      const response=await wire(token,{ jsonrpc:"2.0",id:1,method:"tools/call",params:{ name:"get_departure_attention_summary",arguments:{ business_id:id(1),departure_id:id(4),"PRIVATE guest@example.invalid":"PRIVATE note" } } });
      expect(response.message.result.isError).toBe(true);expect(response.raw+logs.join("\n")).not.toMatch(/PRIVATE|guest@example|bta_|btr_|btc_|00000000/);
    } finally { info.mockRestore();error.mockRestore(); }
  });
  it("SDK protocol errors never echo private client metadata",async()=>{
    const token=await connected();
    const _meta={ "io.modelcontextprotocol/protocolVersion":"PRIVATE_guest@example.invalid",
      "io.modelcontextprotocol/clientInfo":{ name:"PRIVATE",version:"1" },"io.modelcontextprotocol/clientCapabilities":{} };
    const response=await wire(token,{ jsonrpc:"2.0",id:1,method:"server/discover",params:{ _meta } });
    expect(response.message.error).toMatchObject({ message:"Invalid MCP request" });
    expect(response.message.error.data).toBeUndefined();expect(response.raw).not.toMatch(/PRIVATE|guest@example/);
  });
  it("external opaque token is not a Supabase JWT or an operator app session",async()=>{
    const token=await connected();const auth=createClient("https://no-network.fixture.invalid","synthetic-public-key",{ auth:{ persistSession:false } });
    expect((await auth.auth.getClaims(token.access_token)).error).not.toBeNull();
    await expect(operatorIdentity(request("/api/agent/connections",undefined,{ authorization:"Bearer "+token.access_token }))).rejects.toMatchObject({ code:"UNAUTHENTICATED" });
    const unsafePool=new pg.Pool({ host,port,user:process.env.USER,database,max:1,allowExitOnIdle:true });
    try { await expect(withAgentDb(async()=>true,unsafePool)).rejects.toMatchObject({ code:"INTEGRATION_DISABLED" }); }
    finally { await unsafePool.end(); }
  });
  it("disabled defaults/missing config and Muse cannot be bypassed by env flags",async()=>{
    vi.stubEnv("AGENT_CHATGPT_ENABLED","false");expect((await handleMcp(request("/api/mcp/chatgpt"),"CHATGPT")).status).toBe(503);expect((await handleAgentMetadata("resource")).status).toBe(503);
    vi.stubEnv("AGENT_MUSE_ENABLED","true");expect(agentConfig("MUSE")).toBeNull();expect((await muse()).status).toBe(503);
    vi.stubEnv("AGENT_CHATGPT_ENABLED","true");vi.stubEnv("AGENT_PILOT_BUSINESS_IDS","[]");expect(agentConfig("CHATGPT")).toBeNull();
  });
  it("oversized, invalid, excessive and unsupported requests fail safely",async()=>{
    await expect(boundedBody(request("/x","x".repeat(16385)))).rejects.toMatchObject({ status:413 });
    const token=await connected();await expect(wire(token,[{ method:"tools/list" }])).rejects.toMatchObject({ code:"UNSUPPORTED_OPERATION" });
    expect((await read(token,"list_departures",{ business_id:id(1),start_at:"2026-01-01T00:00:00Z",end_at:"2027-01-01T00:00:00Z" })).body).toMatchObject({ code:"QUERY_LIMIT" });
    const response=await read(token,undefined,{ business_id:id(1),departure_id:"not-an-id",notes:"PRIVATE synthetic note" });expect(response.body).toMatchObject({ code:"INVALID_INPUT" });expect(JSON.stringify(response)).not.toContain("PRIVATE");
  });
});
