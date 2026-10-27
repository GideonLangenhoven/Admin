import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTradingStatus } from "./api-auth";
import { amountOutstanding } from "./report-accounting";
import { rateLimit } from "./rate-limit";
import {
  AGENT_TOOLS, AGENT_RESOURCE, AGENT_MAX_AGE_MS, AGENT_GRANT_LIFETIME_MS, AGENT_MAX_BOOKINGS, AGENT_MAX_PARTICIPANTS_PER_BOOKING,
  AGENT_MAX_PAGE, AGENT_MAX_OFFSET, AGENT_MAX_RANGE_DAYS, EXTERNAL_AGENT_ACCESS_ENABLED,
  type AgentOperation,
} from "./agent-tools";

type Input = {
  business_id: string; departure_id?: string; tour_id?: string;
  start_at?: string; end_at?: string; limit: number; offset: number;
};
type Grant = {
  id: string; user_id: string; business_id: string; client_id: string;
  provider: string; role_at_consent: string; scopes: string[];
  enabled: boolean; created_at: string; expires_at: string; disconnected_at: string | null;
};
type Claims = {
  sub?: string; iss?: string; aud?: string; exp?: number; nbf?: number;
  role?: string; client_id?: string; agent_grant_id?: string;
  agent_resource?: string; scope?: string;
  business_id?: string;
};
export type AgentAudit = {
  event: "agent_read"; operation: AgentOperation | null; outcome: string;
  user_hash?: string; business_hash?: string;
};
type Dependencies = {
  // Finite authenticated read vocabulary. Fixtures use a same-token public-key
  // Supabase client; production uses the separately authenticated RLS gateway.
  db: SupabaseClient;
  issuer: string;
  // Trusted adapter context; never read from an assistant-supplied input.
  provider?: "CHATGPT" | "MUSE";
  // Production adapters use an opaque MCP credential + restricted DB gateway.
  // These values come from trusted server configuration, never request fields.
  resource?: string;
  audience?: string;
  claimRole?: string;
  isEnabled?: () => boolean;
  consumeQuota?: () => Promise<boolean>;
  now?: () => number;
  audit?: (event: AgentAudit) => void;
  // Enables labelled test fixtures only; cannot enable a deployed route.
  fixture?: "labelled-local-fixture";
};
class AgentError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKING_STATUSES = ["DRAFT", "PENDING", "PENDING PAYMENT", "HELD", "PAID", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"];
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
function fail(code: string, status: number): never { throw new AgentError(code, status); }
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isMoney = (value: unknown) => (typeof value === "number" ||
  (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)))
  && Number.isFinite(Number(value)) && Number(value) >= 0;
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse normalises e.g. February 31; reject invalid calendar dates.
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value.slice(0, 10);
}

function parseInput(operation: AgentOperation, raw: unknown): Input {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("INVALID_INPUT", 400);
  const input = raw as Record<string, unknown>;
  const allowed = Object.keys(AGENT_TOOLS[operation].inputSchema.properties);
  if (Object.keys(input).some(key => !allowed.includes(key)) || !isUuid(input.business_id)) fail("INVALID_INPUT", 400);
  const result: Input = { business_id: (input.business_id as string).toLowerCase(), limit: 25, offset: 0 };
  if (operation !== "list_departures") {
    if (!isUuid(input.departure_id)) fail("INVALID_INPUT", 400);
    result.departure_id = (input.departure_id as string).toLowerCase();
    return result;
  }
  if (!timestamp(input.start_at) || !timestamp(input.end_at)) fail("INVALID_INPUT", 400);
  const range = Date.parse(input.end_at as string) - Date.parse(input.start_at as string);
  if (range <= 0 || range > AGENT_MAX_RANGE_DAYS * 86_400_000) fail("QUERY_LIMIT", 400);
  if (input.tour_id !== undefined && !isUuid(input.tour_id)) fail("INVALID_INPUT", 400);
  for (const [key, max, min] of [["limit", AGENT_MAX_PAGE, 1], ["offset", AGENT_MAX_OFFSET, 0]] as const) {
    const value = input[key] ?? result[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail("QUERY_LIMIT", 400);
    result[key] = value as number;
  }
  result.start_at = new Date(input.start_at as string).toISOString();
  result.end_at = new Date(input.end_at as string).toISOString();
  if (input.tour_id) result.tour_id = (input.tour_id as string).toLowerCase();
  return result;
}

// Validate before SDK schema handling so invalid input is returned as a safe
// code instead of echoing private argument keys/values in a validator error.
export function agentInputFailure(name: unknown, raw: unknown) {
  try {
    if (typeof name !== "string" || !Object.hasOwn(AGENT_TOOLS,name)) fail("UNSUPPORTED_OPERATION",400);
    parseInput(name as AgentOperation,raw);
    return null;
  } catch(error) { return error instanceof AgentError ? error.code : "INVALID_INPUT"; }
}

// Auth and reads are bounded even if the upstream does not respond. Never log
// upstream error text, which may contain private rows or credentials.
async function bounded<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AgentError("UPSTREAM_UNAVAILABLE", 503)), 5_000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function executeAgentRead(
  request: Request, operationName: string, rawInput: unknown, deps: Dependencies,
) {
  const now = deps.now || Date.now;
  const audit = deps.audit || ((event: AgentAudit) => console.info(JSON.stringify(event)));
  let operation: AgentOperation | null = null;
  let userId: string | undefined;
  let businessId: string | undefined;
  const log = (outcome: string) => audit({
    event: "agent_read", operation, outcome,
    ...(userId ? { user_hash: hash(userId) } : {}),
    ...(businessId ? { business_hash: hash(businessId) } : {}),
  });
  try {
    const fixture = process.env.NODE_ENV === "test" && deps.fixture === "labelled-local-fixture";
    if (!EXTERNAL_AGENT_ACCESS_ENABLED && !fixture && deps.isEnabled?.() !== true) fail("INTEGRATION_DISABLED", 503);
    if (!Object.hasOwn(AGENT_TOOLS, operationName)) fail("UNSUPPORTED_OPERATION", 400);
    operation = operationName as AgentOperation;
    const input = parseInput(operation, rawInput);
    const token = /^Bearer ([^\s]{1,8192})$/i.exec(request.headers.get("authorization") || "")?.[1];
    if (!token) fail("UNAUTHENTICATED", 401);
    if (request.headers.has("x-admin-business-id")) fail("FORBIDDEN", 403);
    const { db } = deps;
    const verified = await bounded(db.auth.getClaims(token));
    if (verified.error || !verified.data?.claims) fail("UNAUTHENTICATED", 401);
    const claims = verified.data!.claims as Claims;
    if (!isUuid(claims.sub) || claims.iss !== deps.issuer || claims.aud !== (deps.audience || "authenticated")
      || claims.role !== (deps.claimRole || "authenticated") || !Number.isFinite(claims.exp) || claims.exp! * 1000 <= now()
      || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf * 1000 > now()))
      || !isUuid(claims.agent_grant_id) || !claims.client_id || claims.agent_resource !== (deps.resource || AGENT_RESOURCE)) fail("UNAUTHENTICATED", 401);
    // Remote validation also rejects deleted/banned identities. JWT claims alone
    // cannot establish current membership or a still-active connection grant.
    const identity = await bounded(db.auth.getUser(token));
    if (identity.error || identity.data?.user?.id !== claims.sub) fail("UNAUTHENTICATED", 401);
    userId = claims.sub;
    businessId = input.business_id;
    if (claims.business_id !== undefined && claims.business_id !== businessId) fail("FORBIDDEN", 403);
    const scopes = AGENT_TOOLS[operation].scopes;
    const tokenScopes = typeof claims.scope === "string" ? claims.scope.split(" ") : [];
    if (!scopes.every(scope => tokenScopes.includes(scope))) fail("INSUFFICIENT_SCOPE", 403);

    const authorise = async () => {
      const [membership, grantResult, business] = await Promise.all([
        bounded(db.from("admin_users").select("id,business_id,role,suspended").eq("user_id", userId!).eq("business_id", businessId!).maybeSingle()),
        bounded(db.from("agent_connection_grants").select("id,user_id,business_id,client_id,provider,role_at_consent,scopes,enabled,created_at,expires_at,disconnected_at")
          .eq("id", claims.agent_grant_id!).eq("user_id", userId!).eq("business_id", businessId!).maybeSingle()),
        bounded(db.from("businesses").select("id,timezone,subscription_status").eq("id", businessId!).maybeSingle()),
      ]);
      if (membership.error || grantResult.error || business.error) fail("UPSTREAM_UNAVAILABLE", 503);
      const member = membership.data;
      const grant = grantResult.data as Grant | null;
      // Owner-only pilot: a matching staff grant cannot widen membership permissions.
      if (!member || member.business_id !== businessId || member.suspended !== false || member.role !== "MAIN_ADMIN"
        || !business.data || business.data.id !== businessId || !isTradingStatus(business.data.subscription_status)) fail("FORBIDDEN", 403);
      if (!grant || grant.id !== claims.agent_grant_id || grant.user_id !== userId || grant.business_id !== businessId
        || grant.client_id !== claims.client_id || !["CHATGPT", "MUSE"].includes(grant.provider)
        || (deps.provider !== undefined && grant.provider !== deps.provider)
        || grant.enabled !== true || grant.disconnected_at !== null
        || !timestamp(grant.created_at) || Date.parse(grant.created_at) > now()
        || !timestamp(grant.expires_at) || Date.parse(grant.expires_at) <= now()
        || Date.parse(grant.expires_at) - Date.parse(grant.created_at) > AGENT_GRANT_LIFETIME_MS
        || grant.role_at_consent !== member.role) fail("CONNECTION_INACTIVE", 403);
      if (!Array.isArray(grant.scopes) || !scopes.every(scope => grant.scopes.includes(scope))) fail("INSUFFICIENT_SCOPE", 403);
      let timezone: string | null = typeof business.data.timezone === "string" ? business.data.timezone : null;
      try { if (!timezone) throw new Error(); new Intl.DateTimeFormat("en", { timeZone: timezone }); }
      catch { timezone = null; }
      return { grant, timezone };
    };
    const access = await authorise();
    // The production gateway supplies an atomic shared DB quota. The in-memory
    // bucket remains only for the externally disabled/labelled fixture path.
    if (!fixture && !deps.consumeQuota) fail("UPSTREAM_UNAVAILABLE", 503);
    const allowed = deps.consumeQuota ? await bounded(deps.consumeQuota())
      : rateLimit({ name: "agent-read", limit: 30, windowMs: 60_000 }, `${userId}:${businessId}`).allowed;
    if (!allowed) fail("RATE_LIMITED", 429);
    const clock = await bounded(db.rpc("agent_read_observed_at", {
      p_business_id: businessId, p_grant_id: access.grant.id,
      p_scope: scopes[scopes.length - 1],
    }));
    if (clock.error || !timestamp(clock.data)) fail("UPSTREAM_UNAVAILABLE", 503);
    const observedAt = clock.data as string;
    const freshness = () => {
      const age = now() - Date.parse(observedAt);
      return age < 0 || age > AGENT_MAX_AGE_MS ? "stale" : "fresh";
    };
    const metadata = () => ({
      timezone: access.timezone, observed_at: observedAt, retrieved_at: new Date(now()).toISOString(),
      freshness: freshness(), max_age_seconds: AGENT_MAX_AGE_MS / 1000,
    });
    let result: Record<string, unknown>;
    if (operation === "list_departures") {
      if (input.tour_id) {
        const tour = await bounded(db.from("tours").select("id,business_id").eq("id", input.tour_id).eq("business_id", businessId).maybeSingle());
        if (tour.error) fail("UPSTREAM_UNAVAILABLE", 503);
        if (!tour.data || tour.data.business_id !== businessId) fail("NOT_FOUND", 404);
      }
      let query = db.from("slots").select("id,business_id,tour_id,start_time,status").eq("business_id", businessId)
        .gte("start_time", input.start_at!).lt("start_time", input.end_at!)
        .order("start_time").order("id").range(input.offset, input.offset + input.limit);
      if (input.tour_id) query = query.eq("tour_id", input.tour_id);
      const rows = await bounded(query);
      if (rows.error || !Array.isArray(rows.data)) fail("UPSTREAM_UNAVAILABLE", 503);
      if (rows.data.length > input.limit + 1) fail("UPSTREAM_UNAVAILABLE", 503);
      const valid = rows.data.every(row => row.business_id === businessId && isUuid(row.id) && isUuid(row.tour_id)
        && timestamp(row.start_time) && ["OPEN", "CLOSED", "CANCELLED"].includes(row.status));
      result = {
        ...metadata(), data_status: valid ? freshness() : "unknown",
        departures: valid ? rows.data.slice(0, input.limit).map(row => ({
          departure_id: row.id, tour_id: row.tour_id, start_at: row.start_time, status: row.status,
        })) : [],
        next_offset: valid && rows.data.length > input.limit && input.offset + input.limit <= AGENT_MAX_OFFSET ? input.offset + input.limit : null,
        query_limit_reached: rows.data.length > input.limit && input.offset + input.limit > AGENT_MAX_OFFSET,
        availability_confirmed: false,
      };
    } else {
      const departure = await bounded(db.from("slots").select("id,business_id,start_time,status")
        .eq("id", input.departure_id!).eq("business_id", businessId).maybeSingle());
      if (departure.error) fail("UPSTREAM_UNAVAILABLE", 503);
      if (!departure.data || departure.data.business_id !== businessId || departure.data.id !== input.departure_id) fail("NOT_FOUND", 404);
      if (operation === "get_departure_availability") {
        // Authoritative read-only RPC includes booked AND held seats. No holds
        // are created, expired, released or extended by this service.
        const capacity = await bounded(db.rpc("slot_available_capacity", { p_slot_id: input.departure_id }));
        if (capacity.error) fail("UPSTREAM_UNAVAILABLE", 503);
        const value = capacity.data;
        const known = typeof value === "number" && Number.isSafeInteger(value) && value >= 0
          && timestamp(departure.data.start_time) && ["OPEN", "CLOSED", "CANCELLED"].includes(departure.data.status);
        result = {
          ...metadata(), departure_id: input.departure_id,
          data_status: known ? freshness() : "unknown",
          available_seats: known && freshness() === "fresh" ? (departure.data.status === "OPEN" ? value : 0) : null,
          booking_eligibility: "not_evaluated", seat_hold_created: false,
        };
      } else {
        const bookings = await bounded(db.from("bookings").select("status,waiver_status,total_amount,total_captured", { count: "exact" })
          .eq("business_id", businessId).eq("slot_id", input.departure_id!).limit(AGENT_MAX_BOOKINGS + 1));
        if (bookings.error) fail("UPSTREAM_UNAVAILABLE", 503);
        const rows = bookings.data;
        const complete = Array.isArray(rows) && Number.isInteger(bookings.count) && bookings.count === rows.length && rows.length <= AGENT_MAX_BOOKINGS;
        const active = complete ? rows.filter(row => !["CANCELLED", "EXPIRED"].includes(row.status)) : [];
        // A pending move can carry an unpaid upgrade while the original booking
        // is PAID. Check both departures; do not infer its balance from bookings
        // or duplicate the reschedule pricing/expiry rules in this integration.
        const pending = await Promise.all([
          bounded(db.from("pending_reschedules").select("id", { count: "exact", head: true })
            .eq("business_id", businessId).eq("status", "PENDING").eq("new_slot_id", input.departure_id!).limit(AGENT_MAX_BOOKINGS + 1)),
          bounded(db.from("pending_reschedules").select("id", { count: "exact", head: true })
            .eq("business_id", businessId).eq("status", "PENDING").eq("old_slot_id", input.departure_id!).limit(AGENT_MAX_BOOKINGS + 1)),
        ]);
        if (pending.some(row => row.error)) fail("UPSTREAM_UNAVAILABLE", 503);
        const pendingComplete = pending.every(row => Number.isSafeInteger(row.count) && row.count! >= 0 && row.count! <= AGENT_MAX_BOOKINGS);
        const pendingUnassessed = pendingComplete && pending.some(row => row.count! > 0);
        // Only a database-side aggregate may inspect private waiver payloads.
        // This local candidate is not deployed; never infer people from SIGNED.
        const waivers = await bounded(db.rpc("agent_departure_waiver_counts", {
          p_business_id: businessId, p_departure_id: input.departure_id, p_grant_id: access.grant.id,
        }));
        if (waivers.error) fail("UPSTREAM_UNAVAILABLE", 503);
        const waiverData = waivers.data;
        const waiverObject = waiverData && typeof waiverData === "object" && !Array.isArray(waiverData);
        const waiverCount = waiverObject ? waiverData.outstanding_waiver_participants : null;
        const waiverKnown = waiverObject && Number.isSafeInteger(waiverCount) && waiverCount >= 0
          && waiverCount <= AGENT_MAX_BOOKINGS * AGENT_MAX_PARTICIPANTS_PER_BOOKING && waiverData.reason === null;
        const waiverReason = waiverObject && waiverCount === null
          && ["missing_or_unknown_data", "incomplete_or_query_limit"].includes(waiverData.reason)
          ? waiverData.reason : "missing_or_unknown_data";
        const known = complete && pendingComplete && !pendingUnassessed && waiverKnown && rows.every(row => BOOKING_STATUSES.includes(row.status)) && active.every(row =>
          ["SIGNED", "PENDING"].includes(row.waiver_status)
          && isMoney(row.total_amount) && isMoney(row.total_captured));
        result = {
          ...metadata(), departure_id: input.departure_id, payment_count_unit: "bookings", waiver_count_unit: "participants",
          data_status: known ? freshness() : "unknown",
          outstanding_payment_bookings: known && freshness() === "fresh" ? active.filter(row => amountOutstanding(row) > 0).length : null,
          outstanding_waiver_participants: known && freshness() === "fresh" ? waiverCount : null,
          reason: !complete || !pendingComplete ? "incomplete_or_query_limit" : pendingUnassessed ? "pending_reschedule_payments_not_evaluated"
            : !waiverKnown ? waiverReason : !known ? "missing_or_unknown_data" : freshness() === "stale" ? "stale" : null,
        };
      }
    }
    // Recheck after reads so disconnect, expiry and role changes during the
    // operation do not return a result authorised only by an old snapshot.
    const finalAccess = await authorise();
    if (claims.exp! * 1000 <= now()) fail("UNAUTHENTICATED", 401);
    result.timezone = finalAccess.timezone;
    result.retrieved_at = new Date(now()).toISOString();
    result.freshness = freshness();
    if (freshness() === "stale") {
      if (result.data_status !== "unknown") result.data_status = "stale";
      if (operation === "get_departure_availability") result.available_seats = null;
      if (operation === "get_departure_attention_summary") {
        result.outstanding_payment_bookings = null;
        result.outstanding_waiver_participants = null;
        result.reason = "stale";
      }
    }
    log("OK");
    return { status: 200, body: { ok: true, operation, result } };
  } catch (error) {
    const safeError = error instanceof AgentError ? error : new AgentError("UPSTREAM_UNAVAILABLE", 503);
    log(safeError.code);
    return { status: safeError.status, body: { ok: false, code: safeError.code } };
  }
}
