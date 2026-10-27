import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import OAuth2Server from "@node-oauth/oauth2-server";
import type { PoolClient } from "pg";
import { agentStore,agentAuthAudit, tokenHash, withAgentDb } from "./agent-db";
import { AGENT_SCOPES, AgentHttpError, NO_STORE, UUID, agentConfig, agentReject, boundedBody,
  requireSameOrigin, type AgentConfig } from "./agent-config";

const opaque = (prefix: string) => prefix + randomBytes(32).toString("base64url");
const TICKET = /^[A-Za-z0-9_-]{43}$/;
const SCOPES = (value: string) => {
  const scopes = value.split(" ");
  if (!scopes.includes("departures:read") || scopes.length > 3 || new Set(scopes).size !== scopes.length
    || !scopes.every(scope => AGENT_SCOPES.includes(scope))) throw new AgentHttpError("INVALID_SCOPE", 400);
  return scopes;
};
function uniqueParams(params: URLSearchParams, allowed: string[]) {
  const result: Record<string,string> = {};
  for (const [key,value] of params) {
    if (!allowed.includes(key) || Object.hasOwn(result,key) || value.length > 2048) throw new AgentHttpError("INVALID_INPUT", 400);
    result[key]=value;
  }
  return result;
}
function jsonBody(raw:string) {
  try { return JSON.parse(raw); }
  catch { throw new AgentHttpError("INVALID_INPUT",400); }
}
export function oauthServer(db: PoolClient, config: AgentConfig, clientId?: string) {
  const base = { provider: config.provider, resource: config.resource };
  const call = async (action: string, args: Record<string,unknown>) => {
    try { return await agentStore(db,action,{ ...base,...args }); }
    catch(error) {
      if (error instanceof AgentHttpError && [401,403,404].includes(error.status)) throw new OAuth2Server.InvalidGrantError("Authorization unavailable");
      throw error;
    }
  };
  const model: OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel = {
    getClient: async (id, secret) => secret ? null : call("client",{ id }),
    generateAccessToken: async () => opaque("bta_"),
    generateRefreshToken: async () => opaque("btr_"),
    generateAuthorizationCode: async () => opaque("btc_"),
    validateScope: async (_user,_client,scopes) => scopes?.length && scopes.every(scope => AGENT_SCOPES.includes(scope)) ? scopes : false,
    getAccessToken: async () => null, // No OAuth library token-as-login shortcut.
    saveAuthorizationCode: async (code,client,user) => {
      await call("code_save",{ hash: tokenHash(code.authorizationCode), grant_id: user.grantId,
        redirect_uri: code.redirectUri, challenge: code.codeChallenge, expires_at: code.expiresAt.toISOString() });
      return { ...code,client,user };
    },
    getAuthorizationCode: async raw => {
      if (!/^btc_[A-Za-z0-9_-]{43}$/.test(raw)) return null;
      const code = await call("code_get",{ hash: tokenHash(raw) });
      return code ? { ...code, authorizationCode:raw,expiresAt: new Date(code.expiresAt) } : null;
    },
    revokeAuthorizationCode: code => call("code_revoke",{ hash: tokenHash(code.authorizationCode) }),
    saveToken: async (token,client,user) => {
      const dates = await call("token_save",{ hash: tokenHash(token.accessToken), refresh_hash: tokenHash(token.refreshToken!),
        grant_id: user.grantId, client_id: client.id, scopes: token.scope,
        expires_at: token.accessTokenExpiresAt!.toISOString(), refresh_expires_at: token.refreshTokenExpiresAt!.toISOString() });
      return { ...token,client,user,accessTokenExpiresAt: new Date(dates.accessTokenExpiresAt),
        refreshTokenExpiresAt: new Date(dates.refreshTokenExpiresAt) };
    },
    getRefreshToken: async raw => {
      if (!/^btr_[A-Za-z0-9_-]{43}$/.test(raw)) return null;
      const token = await call("refresh_get",{ hash: tokenHash(raw),client_id: clientId });
      return token ? { ...token,refreshToken:raw,refreshTokenExpiresAt: new Date(token.refreshTokenExpiresAt) } : null;
    },
    revokeToken: token => call("refresh_revoke",{ hash: tokenHash(token.refreshToken), client_id: clientId }),
  };
  return new OAuth2Server({ model,accessTokenLifetime: 600,refreshTokenLifetime: 604800,
    authorizationCodeLifetime: 60,allowEmptyState: false,
    requireClientAuthentication: { authorization_code: false,refresh_token: false },alwaysIssueNewRefreshToken: true });
}
export async function operatorIdentity(request: Request) {
  const token = /^Bearer ([^\s]{1,8192})$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || token.split(".").length !== 3) throw new AgentHttpError("UNAUTHENTICATED", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new AgentHttpError("INTEGRATION_DISABLED", 503);
  const db = createClient(url,key,{ auth: { persistSession: false,autoRefreshToken: false,detectSessionInUrl: false },
    global: { fetch: (input,init) => fetch(input,{ ...init,signal: AbortSignal.timeout(5_000) }) } });
  const { data,error } = await db.auth.getUser(token);
  if (error || !data?.user || !UUID.test(data.user.id)) throw new AgentHttpError("UNAUTHENTICATED", 401);
  return data.user.id;
}
function callback(params: Record<string,string>, config: AgentConfig, result: Record<string,string>) {
  const url = new URL(params.redirect_uri);
  for (const [key,value] of Object.entries({ ...result,state: params.state,iss: config.issuer })) url.searchParams.set(key,value);
  return url.href;
}
export async function oauthAction(request: Request, action: string, db: PoolClient, config: AgentConfig,
  identity: (request: Request) => Promise<string> = operatorIdentity): Promise<Response> {
  // One fixed shared quota bounds anonymous registration/authorize/token abuse.
  // No raw client IP, request URL, code or token is recorded in audit logs.
  const allowed = await agentStore(db,"abuse_quota",{ key: "oauth:"+tokenHash("global") });
  if (!allowed) throw new AgentHttpError("RATE_LIMITED", 429);
  requireSameOrigin(request,config,action === "consent");
  const base = { provider: config.provider,resource: config.resource };
  if (action === "authorize" && request.method === "GET") {
    const params = uniqueParams(new URL(request.url).searchParams,["client_id","redirect_uri","response_type","scope","state","code_challenge","code_challenge_method","resource","ui_locales"]);
    if (params.response_type !== "code" || params.resource !== config.resource || params.code_challenge_method !== "S256"
      || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge || "") || !params.state || params.state.length > 512) throw new AgentHttpError("INVALID_INPUT",400);
    SCOPES(params.scope || "");
    const client = await agentStore(db,"client",{ ...base,id: params.client_id });
    if (!client || !client.redirectUris.includes(params.redirect_uri) || !config.redirects.includes(params.redirect_uri)) throw new AgentHttpError("INVALID_CLIENT",400);
    const ticket = opaque("");
    await agentStore(db,"request_create",{ ...base,hash: tokenHash(ticket),params });
    return new Response(null,{ status: 302,headers: { ...NO_STORE,location: config.origin+"/settings/agent-connections?request="+ticket } });
  }
  if (request.method !== "POST") throw new AgentHttpError("METHOD_NOT_ALLOWED",405);
  const type = request.headers.get("content-type")?.split(";")[0].trim();
  const raw = await boundedBody(request);
  if (action === "revoke") {
    if (type !== "application/x-www-form-urlencoded" || request.headers.has("authorization")) throw new AgentHttpError("INVALID_REQUEST",400);
    const body=uniqueParams(new URLSearchParams(raw),["client_id","token","token_type_hint","resource"]);
    if (!body.client_id || (body.resource!==undefined && body.resource!==config.resource)) throw new AgentHttpError("INVALID_REQUEST",400);
    // RFC 7009: unknown/revoked tokens have the same successful response.
    if (/^bt[ar]_[A-Za-z0-9_-]{43}$/.test(body.token || "")) await agentStore(db,"token_revoke",{ ...base,
      hash:tokenHash(body.token),client_id:body.client_id });
    return new Response(null,{ status:200,headers:NO_STORE });
  }
  if (action === "register") {
    if (type !== "application/json") throw new AgentHttpError("INVALID_INPUT",400);
    const body = jsonBody(raw);
    const redirects: unknown = body?.redirect_uris;
    if (!body || Array.isArray(body) || !Array.isArray(redirects) || !redirects.length || redirects.length > 8
      || !redirects.every(uri => typeof uri === "string" && config.redirects.includes(uri))
      || (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none")
      || (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || body.grant_types.some((value: string) => !["authorization_code","refresh_token"].includes(value))))
      || (body.response_types !== undefined && JSON.stringify(body.response_types) !== '["code"]')) throw new AgentHttpError("INVALID_CLIENT_METADATA",400);
    const id = opaque("btclient_");
    await agentStore(db,"register",{ ...base,id,redirects });
    return Response.json({ client_id: id,client_id_issued_at: Math.floor(Date.now()/1000),redirect_uris: redirects,
      token_endpoint_auth_method: "none",grant_types: ["authorization_code","refresh_token"],response_types: ["code"] },{ status: 201,headers: NO_STORE });
  }
  if (action === "token") {
    if (type !== "application/x-www-form-urlencoded") throw new AgentHttpError("INVALID_INPUT",400);
    const body = uniqueParams(new URLSearchParams(raw),["grant_type","client_id","code","redirect_uri","code_verifier","refresh_token","scope","resource"]);
    if (body.resource !== config.resource || !["authorization_code","refresh_token"].includes(body.grant_type) || !body.client_id
      || request.headers.has("authorization") || (body.grant_type === "authorization_code" && !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier || ""))) throw new AgentHttpError("INVALID_REQUEST",400);
    if (body.scope) SCOPES(body.scope);
    await db.query("BEGIN");
    try {
      const response = new OAuth2Server.Response();
      const issued=await oauthServer(db,config,body.client_id).token(new OAuth2Server.Request({ method: "POST",headers: { "content-type":type,"content-length":String(Buffer.byteLength(raw)) },query: {},body }),response);
      await db.query("COMMIT");
      agentAuthAudit("token","OK",issued.user.id);
      return Response.json(response.body,{ status: response.status || 200,headers: NO_STORE });
    } catch (error) {
      // Library rejection may consume a code, or DB replay detection may revoke
      // the refresh family. Commit these security actions, never roll them back.
      if (error instanceof OAuth2Server.OAuthError && error.code<500) {
        await db.query("COMMIT");
        agentAuthAudit("token","DENIED");
        return Response.json({ error: ["invalid_client","invalid_grant","invalid_scope","invalid_request","unsupported_grant_type"].includes(error.name)
          ? error.name : "invalid_grant",error_description:"Authorization could not be completed" },{ status: 400,headers: NO_STORE });
      }
      await db.query("ROLLBACK");
      if (error instanceof OAuth2Server.OAuthError) throw new AgentHttpError("UPSTREAM_UNAVAILABLE",503);
      throw error;
    }
  }
  if (action === "consent") {
    if (type !== "application/json") throw new AgentHttpError("INVALID_INPUT",400);
    const body = jsonBody(raw);
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !["request","business_id","allow"].includes(key))
      || !TICKET.test(body.request || "") || !UUID.test(body.business_id || "") || typeof body.allow !== "boolean") throw new AgentHttpError("INVALID_INPUT",400);
    const userId = await identity(request);
    const businessId = body.business_id.toLowerCase();
    if (!config.pilotBusinesses.includes(businessId)) throw new AgentHttpError("FORBIDDEN",403);
    await db.query("BEGIN");
    try {
      const params = await agentStore(db,"request_take",{ ...base,hash: tokenHash(body.request) });
      if (!params) throw new AgentHttpError("INVALID_REQUEST",400);
      // Recheck the current configuration before releasing a callback URL.
      if (params.resource !== config.resource || !config.redirects.includes(params.redirect_uri)) throw new AgentHttpError("INVALID_REQUEST",400);
      if (!body.allow) {
        await db.query("COMMIT");
        agentAuthAudit("consent","DENIED",userId,businessId);
        return Response.json({ redirect: callback(params,config,{ error:"access_denied" }) },{ headers: NO_STORE });
      }
      const user = await agentStore(db,"grant_create",{ ...base,client_id: params.client_id,user_id:userId,business_id:businessId,scopes:SCOPES(params.scope) });
      const code = await oauthServer(db,config).authorize(new OAuth2Server.Request({ method:"GET",headers:{},query:params,body:{} }),new OAuth2Server.Response(),
        { authenticateHandler: { handle: async () => user },allowEmptyState:false,authorizationCodeLifetime:60 });
      await db.query("COMMIT");
      agentAuthAudit("consent","OK",userId,businessId);
      return Response.json({ redirect:callback(params,config,{ code:code.authorizationCode }) },{ headers:NO_STORE });
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  }
  throw new AgentHttpError("UNSUPPORTED_OPERATION",404);
}
export async function handleOAuth(request: Request, action: string) {
  const config = agentConfig("CHATGPT",action === "revoke");
  if (!config) return agentReject("INTEGRATION_DISABLED",503);
  try { return await withAgentDb(db => oauthAction(request,action,db,config)); }
  catch (error) { return agentReject(error instanceof AgentHttpError ? error.code : "UPSTREAM_UNAVAILABLE",error instanceof AgentHttpError ? error.status : 503); }
}
export async function connectionAction(request: Request, db: PoolClient, config: Pick<AgentConfig,"origin">,
  identity: (request: Request) => Promise<string> = operatorIdentity) {
  requireSameOrigin(request,config as AgentConfig,request.method === "POST");
  const userId = await identity(request);
  let body: Record<string,unknown>;
  if (request.method === "GET") body=uniqueParams(new URL(request.url).searchParams,["business_id","request"]);
  else if (request.method === "POST") {
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new AgentHttpError("INVALID_INPUT",400);
    body=jsonBody(await boundedBody(request));
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !["business_id","grant_id"].includes(key))) throw new AgentHttpError("INVALID_INPUT",400);
  } else throw new AgentHttpError("METHOD_NOT_ALLOWED",405);
  if (typeof body.business_id !== "string" || !UUID.test(body.business_id)) throw new AgentHttpError("INVALID_INPUT",400);
  const args = { user_id:userId,business_id:body.business_id.toLowerCase() };
  if (!await agentStore(db,"abuse_quota",{ key:"manage:"+tokenHash(userId+":"+args.business_id) })) throw new AgentHttpError("RATE_LIMITED",429);
  if (request.method === "POST") {
    if (typeof body.grant_id !== "string" || !UUID.test(body.grant_id)) throw new AgentHttpError("INVALID_INPUT",400);
    await agentStore(db,"disconnect",{ ...args,grant_id:body.grant_id.toLowerCase() });
    return Response.json({ ok:true },{ headers:NO_STORE });
  }
  const connections = await agentStore(db,"connections",args);
  let consent: Record<string,unknown> | null = null;
  const enabledConfig=agentConfig("CHATGPT");
  if (body.request !== undefined && enabledConfig) {
    if (typeof body.request !== "string" || !TICKET.test(body.request)) throw new AgentHttpError("INVALID_INPUT",400);
    const params=await agentStore(db,"request_get",{ provider:"CHATGPT",resource:enabledConfig.resource,hash:tokenHash(body.request) });
    if (!params) throw new AgentHttpError("INVALID_REQUEST",400);
    consent={ provider:"CHATGPT",scopes:SCOPES(params.scope),expires_in_days:7 };
  }
  return Response.json({ connections,consent,chatgpt_enabled:!!enabledConfig,muse_enabled:false },{ headers:NO_STORE });
}
export async function handleConnections(request: Request) {
  let url:URL;
  try { url=new URL(process.env.AGENT_PUBLIC_ORIGIN || ""); }
  catch { return agentReject("INTEGRATION_DISABLED",503); }
  if (url.protocol!=="https:" || url.pathname!=="/" || url.username || url.password || url.search || url.hash || !process.env.AGENT_DATABASE_URL) return agentReject("INTEGRATION_DISABLED",503);
  try {
    // Disconnect still works after provider switches are off.
    return await withAgentDb(db=>connectionAction(request,db,{ origin:url.origin }));
  } catch (error) { return agentReject(error instanceof AgentHttpError ? error.code : "UPSTREAM_UNAVAILABLE",error instanceof AgentHttpError ? error.status : 503); }
}
