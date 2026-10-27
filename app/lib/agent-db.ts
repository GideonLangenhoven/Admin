import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AgentHttpError, agentConfig, type AgentConfig } from "./agent-config";
import type { executeAgentRead } from "./agent-read-service";

export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const TOKEN = /^bta_[A-Za-z0-9_-]{43}$/;
let pool: Pool | undefined;
function agentPool() {
  if (!pool) {
    const url = new URL(process.env.AGENT_DATABASE_URL || "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.searchParams.has("sslmode") || url.searchParams.has("ssl")) throw new AgentHttpError("INTEGRATION_DISABLED", 503);
    pool = new Pool({ connectionString: url.href, ssl: { rejectUnauthorized: true,
      ...(process.env.AGENT_DATABASE_CA ? { ca: process.env.AGENT_DATABASE_CA.replace(/\\n/g, "\n") } : {}) }, max: 5,
      connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 5_500,
      idleTimeoutMillis: 10_000, allowExitOnIdle: true });
    pool.on("error", () => { /* Never log raw pg errors/connection strings. */ });
  }
  return pool;
}
export async function withAgentDb<T>(work: (db: PoolClient) => Promise<T>, source: Pool = agentPool()): Promise<T> {
  const db = await source.connect();
  try {
    const role = (await db.query(`select current_user as name,rolsuper,rolbypassrls,rolinherit,
      pg_has_role(current_user,'authenticated','MEMBER') as app_member,
      pg_has_role(current_user,'service_role','MEMBER') as service_member,
      pg_has_role(current_user,'bookingtours_agent_owner','MEMBER') as owner_member,
      exists(select 1 from pg_class t join pg_namespace n on n.oid=t.relnamespace
        where n.nspname in ('public','auth','storage','agent_private') and t.relkind in ('r','p','v','m','f')
          and (has_any_column_privilege(current_user,t.oid,'SELECT,INSERT,UPDATE')
            or has_table_privilege(current_user,t.oid,'DELETE,TRUNCATE'))) as broad,
      exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
          and has_function_privilege(current_user,p.oid,'EXECUTE')
          and not(n.nspname='agent_private' and p.proname in ('store','read'))) as unsafe_functions
      from pg_roles where rolname=current_user`)).rows[0];
    if (role?.name !== "bookingtours_agent_gateway" || role.rolsuper || role.rolbypassrls || role.rolinherit
      || role.app_member || role.service_member || role.owner_member || role.broad || role.unsafe_functions) throw new AgentHttpError("INTEGRATION_DISABLED", 503);
    return await work(db);
  } finally { db.release(); }
}
export async function agentStore(db: PoolClient, action: string, args: Record<string, unknown>): Promise<any> {
  const audit=(outcome:string)=>{
    if (!["disconnect","token_revoke"].includes(action)) return;
    console.info(JSON.stringify({ event:"agent_auth",action,outcome,
      ...(typeof args.user_id==="string" ? { user_hash:tokenHash(args.user_id).slice(0,24) } : {}),
      ...(typeof args.business_id==="string" ? { business_hash:tokenHash(args.business_id).slice(0,24) } : {}) }));
  };
  try {
    const result=(await db.query("select agent_private.store($1,$2::jsonb) as result", [action,JSON.stringify(args)])).rows[0].result;
    audit(result===null ? "DENIED" : "OK");
    return result;
  }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, CONNECTION_INACTIVE: 403,
      INSUFFICIENT_SCOPE: 403, INTEGRATION_DISABLED: 503, NOT_FOUND: 404, QUERY_LIMIT: 400 };
    const safe=Object.hasOwn(status,code) ? code : "UPSTREAM_UNAVAILABLE";
    audit(safe);
    throw new AgentHttpError(safe,status[code] || 503);
  }
}
export function agentAuthAudit(operation:"consent"|"token"|"transport",outcome:"OK"|"DENIED",userId?:string,businessId?:string) {
  console.info(JSON.stringify({ event:"agent_auth",operation,outcome,
    ...(userId ? { user_hash:tokenHash(userId).slice(0,24) } : {}),
    ...(businessId ? { business_hash:tokenHash(businessId).slice(0,24) } : {}) }));
}
export function bearer(request: Request) {
  const token = /^Bearer ([^\s]{1,8192})$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || !TOKEN.test(token)) throw new AgentHttpError("UNAUTHENTICATED", 401);
  return token;
}
export function binding(config: AgentConfig, token: string) {
  return { hash: tokenHash(token), provider: config.provider, resource: config.resource };
}
export function agentBridge(db: PoolClient, config: AgentConfig, token: string): Parameters<typeof executeAgentRead>[3] {
  const bound = binding(config,token);
  let serial:Promise<unknown>=Promise.resolve();
  let permittedBusiness:string|undefined;
  const authorize = async () => {
    const principal=await agentStore(db,"authorize",{ ...bound, scopes: ["departures:read"] });
    if (!agentConfig(config.provider)?.pilotBusinesses.includes(principal.business_id)) throw new AgentHttpError("FORBIDDEN",403);
    permittedBusiness=principal.business_id;
    return principal;
  };
  const query = (action: string, args: Record<string, unknown>) => {
    const work=serial.then(async()=>{
      const current=agentConfig(config.provider);
      if (!current || !permittedBusiness || !current.pilotBusinesses.includes(permittedBusiness)) throw new AgentHttpError("INTEGRATION_DISABLED",503);
      const result = (await db.query("select agent_private.read($1,$2,$3,$4,$5::jsonb) as result",
        [bound.hash,bound.provider,bound.resource,action,JSON.stringify(args)])).rows[0].result;
      return { ...result, error: null };
    });
    serial=work.catch(()=>{});
    return work.catch(()=>({ data:null,error:{ code:"UPSTREAM_UNAVAILABLE" } }));
  };
  // Compatibility with the existing shared service's finite Supabase read
  // vocabulary. This never builds SQL from caller-controlled table/column text.
  class ReadQuery implements PromiseLike<any> {
    values: Record<string, unknown> = {}; single = false;
    constructor(private table: string) {}
    select() { return this; }
    eq(key: string, value: unknown) { this.values[key] = value; return this; }
    gte(key: string, value: string) { if (key !== "start_time") throw new Error("INVALID_INPUT"); this.values.start_at=value; return this; }
    lt(key: string, value: string) { if (key !== "start_time") throw new Error("INVALID_INPUT"); this.values.end_at=value; return this; }
    order() { return this; }
    range(start: number, end: number) { this.values.offset=start; this.values.take=end-start+1; return this; }
    limit(value: number) { if (value !== 501) throw new Error("QUERY_LIMIT"); return this; }
    maybeSingle() { this.single=true; return this; }
    then<TResult1 = any, TResult2 = never>(onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      const action = { admin_users: "member", agent_connection_grants: "grant", businesses: "business", tours: "tour",
        slots: this.single ? "departure" : "departures", bookings: "bookings", pending_reschedules: "pending" }[this.table];
      if (!action) return Promise.reject(new Error("UNSUPPORTED_OPERATION")).then(onfulfilled,onrejected);
      return query(action,{ ...this.values, departure_id: this.table === "slots" ? this.values.id : this.values.slot_id || this.values.old_slot_id || this.values.new_slot_id,
        ...(this.table === "pending_reschedules" ? { direction: this.values.old_slot_id ? "old" : "new" } : {}) }).then(onfulfilled,onrejected);
    }
  }
  const gateway = {
    auth: {
      getClaims: async (supplied: string) => {
        try { if (supplied !== token) throw new Error(); return { data: { claims: await authorize() }, error: null }; }
        catch { return { data: null, error: { code: "UNAUTHENTICATED" } }; }
      },
      getUser: async (supplied: string) => {
        try { if (supplied !== token) throw new Error(); return { data: { user: { id: (await authorize()).sub } }, error: null }; }
        catch { return { data: null, error: { code: "UNAUTHENTICATED" } }; }
      },
    },
    from: (table: string) => new ReadQuery(table),
    rpc: (name: string, params: Record<string, unknown>) => {
      const action = { agent_read_observed_at: "clock", slot_available_capacity: "capacity", agent_departure_waiver_counts: "waivers" }[name];
      if (!action) return Promise.reject(new Error("UNSUPPORTED_OPERATION"));
      return query(action,{ business_id: params.p_business_id, departure_id: params.p_departure_id || params.p_slot_id,
        grant_id: params.p_grant_id, scope: params.p_scope });
    },
  };
  return { db: gateway as unknown as SupabaseClient, issuer: config.issuer, provider: config.provider,
    resource: config.resource, audience: config.resource, claimRole: "agent_read",
    isEnabled: () => agentConfig(config.provider)?.resource === config.resource,
    consumeQuota: () => agentStore(db,"read_quota",bound) };
}
