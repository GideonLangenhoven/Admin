import http from "k6/http";
import exec from "k6/execution";
import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { k6Options, mixedConfig, phaseAt } from "./bt500-mixed-config.mjs";

const MARKER = "bt500-20260921";
const PROJECT_HOST = "ukdsrndqhsatjkmxijuj.supabase.co";
const config = mixedConfig(__ENV);
const input = JSON.parse(open(__ENV.BT500_CREDENTIALS_FILE || "/private/tmp/bt500-credentials.json"));
const adminBase = String(__ENV.BT500_ADMIN_BASE || "").replace(/\/$/, "");
const runId = String(__ENV.BT500_RUN_ID || "");

if (__ENV.BT500_ALLOW_LOAD !== "YES") throw new Error("BT500_ALLOW_LOAD=YES is required");
if (__ENV.BT500_ALLOW_SHARED_PROJECT !== "YES") throw new Error("BT500_ALLOW_SHARED_PROJECT=YES is required");
if (!/^https:\/\//.test(adminBase)) throw new Error("BT500_ADMIN_BASE must be an HTTPS URL");
if (/^https:\/\/(admin|booking|onboarding)\.bookingtours\.co\.za(?:\/|$)/.test(adminBase)) throw new Error("production application hosts are forbidden");
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(runId)) throw new Error("BT500_RUN_ID must be 1-48 safe characters");
if (input.marker !== MARKER) throw new Error(`credentials must use marker ${MARKER}`);
if (String(input.url).replace(/\/$/, "") !== `https://${PROJECT_HOST}`) throw new Error("credentials point at an unexpected Supabase project");
if (!input.anon_key) throw new Error("credentials are missing the anon key");
if (input.credentials?.length !== 500) throw new Error("exactly 500 credentials are required");

const users = new Set();
const businesses = new Map();
const bookings = new Set();
for (const credential of input.credentials) {
  for (const field of ["user_id", "business_id", "booking_id", "slot_id", "access_token", "refresh_token", "expires_at"]) {
    if (!credential[field]) throw new Error(`credential is missing ${field}`);
  }
  users.add(credential.user_id);
  bookings.add(credential.booking_id);
  businesses.set(credential.business_id, (businesses.get(credential.business_id) || 0) + 1);
}
if (users.size !== 500 || bookings.size !== 500) throw new Error("users and owned write bookings must both be unique");
const businessSizes = [...businesses.values()].sort((a, b) => a - b);
if (businessSizes.length !== 167 || businessSizes[0] !== 2 || businessSizes.at(-1) !== 3) {
  throw new Error("credentials must span 167 businesses with at most three staff accounts");
}

export const options = k6Options(config);

const readDuration = new Trend("bt500_read_duration", true);
const writeDuration = new Trend("bt500_write_duration", true);
const actionDuration = new Trend("bt500_action_duration", true);
const offeredActions = new Counter("bt500_offered_actions");
const completedActions = new Counter("bt500_completed_actions");
const unexpectedFailure = new Rate("bt500_unexpected_failure");
const invariantViolations = new Counter("bt500_invariant_violations");
const tokenRefreshes = new Counter("bt500_token_refreshes");
let state;

function json(response) {
  try { return response.json(); } catch { return null; }
}

function restHeaders(session) {
  return {
    apikey: input.anon_key,
    Authorization: `Bearer ${session.access_token}`,
    "x-tenant-business-id": session.business_id,
  };
}

function sessionState() {
  if (!state) state = { ...input.credentials[(__VU - 1) % input.credentials.length], jittered: false };
  return state;
}

function refreshIfNeeded(session, tags) {
  if (Number(session.expires_at) > Date.now() / 1000 + 300) return true;
  const response = http.post(
    `${input.url}/auth/v1/token?grant_type=refresh_token`,
    JSON.stringify({ refresh_token: session.refresh_token }),
    { headers: { apikey: input.anon_key, "Content-Type": "application/json" }, tags: { ...tags, request: "token_refresh" } },
  );
  const body = json(response);
  if (response.status !== 200 || !body?.access_token || !body?.refresh_token) return false;
  session.access_token = body.access_token;
  session.refresh_token = body.refresh_token;
  session.expires_at = Number(body.expires_at || Date.now() / 1000 + Number(body.expires_in || 3600));
  tokenRefreshes.add(1, tags);
  return true;
}

function tenantRows(rows, businessId, tags) {
  const valid = Array.isArray(rows) && rows.every(row => !row.business_id || row.business_id === businessId);
  if (!valid) invariantViolations.add(1, { ...tags, invariant: "tenant_rows" });
  return valid;
}

function readAction(session, tags) {
  const base = `${input.url}/rest/v1`;
  const headers = restHeaders(session);
  const responses = http.batch([
    ["GET", `${base}/admin_users?select=id,role,business_id&user_id=eq.${session.user_id}`, null, { headers, tags: { ...tags, request: "identity" } }],
    ["GET", `${base}/businesses?select=id,name,subscription_status&id=eq.${session.business_id}`, null, { headers, tags: { ...tags, request: "business" } }],
    ["GET", `${base}/bookings?select=id,business_id,status,total_amount,created_at&business_id=eq.${session.business_id}&order=created_at.desc&limit=25`, null, { headers, tags: { ...tags, request: "bookings" } }],
    ["GET", `${base}/slots?select=id,business_id,start_time,booked,held,capacity_total,status&business_id=eq.${session.business_id}&order=start_time.asc&limit=25`, null, { headers, tags: { ...tags, request: "slots" } }],
  ]);
  responses.forEach(response => readDuration.add(response.timings.duration, tags));
  const bodies = responses.map(json);
  return responses.every(response => response.status === 200)
    && Array.isArray(bodies[0]) && bodies[0].length === 1 && bodies[0][0].business_id === session.business_id
    && Array.isArray(bodies[1]) && bodies[1].length === 1 && bodies[1][0].id === session.business_id
    && tenantRows(bodies[2], session.business_id, tags)
    && tenantRows(bodies[3], session.business_id, tags);
}

function writeAction(session, tags) {
  const lookup = http.get(
    `${input.url}/rest/v1/bookings?select=id,business_id,slot_id,qty,arrived_count,status,waiver_status&id=eq.${session.booking_id}&business_id=eq.${session.business_id}`,
    { headers: restHeaders(session), tags: { ...tags, request: "arrival_state" } },
  );
  readDuration.add(lookup.timings.duration, tags);
  const rows = json(lookup);
  if (lookup.status !== 200 || !tenantRows(rows, session.business_id, tags) || rows.length !== 1) return false;
  const booking = rows[0];
  if (booking.slot_id !== session.slot_id || booking.qty < 2 || booking.waiver_status !== "SIGNED" || !["PAID", "CONFIRMED", "COMPLETED"].includes(booking.status)) return false;

  const target = Number(booking.arrived_count) === 0 ? 1 : 0;
  const eventId = `${MARKER}:${runId}:vu-${__VU}:iteration-${__ITER}`;
  const body = JSON.stringify({
    booking_id: booking.id,
    slot_id: booking.slot_id,
    arrived_count: target,
    expected_arrived_count: Number(booking.arrived_count),
    client_event_id: eventId,
    notes: `${MARKER}:${runId}`,
  });
  const params = {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      "x-admin-business-id": session.business_id,
    },
    tags: { ...tags, request: "record_arrival" },
  };
  let response = http.post(`${adminBase}/api/check-ins?source=simple-view`, body, params);
  writeDuration.add(response.timings.duration, tags);
  if (response.status === 0 || response.status >= 500) {
    response = http.post(`${adminBase}/api/check-ins?source=simple-view`, body, params);
    writeDuration.add(response.timings.duration, tags);
  }
  const result = json(response);
  return response.status === 200 && result?.ok === true && Number(result.arrived_count) === target;
}

function otherAction(session, tags, cycle) {
  const base = `${input.url}/rest/v1`;
  if (cycle % 3 === 0) {
    const response = http.get(`${input.url}/auth/v1/user`, {
      headers: { apikey: input.anon_key, Authorization: `Bearer ${session.access_token}` },
      tags: { ...tags, request: "session" },
    });
    return response.status === 200 && json(response)?.id === session.user_id;
  }
  const resource = cycle % 3 === 1
    ? `bookings?select=id,business_id,status,total_amount,created_at&business_id=eq.${session.business_id}&order=created_at.desc&limit=100`
    : `conversations?select=id,business_id,status,last_activity_at&business_id=eq.${session.business_id}&order=last_activity_at.desc&limit=50`;
  const response = http.get(`${base}/${resource}`, { headers: restHeaders(session), tags: { ...tags, request: cycle % 3 === 1 ? "report" : "inbox" } });
  readDuration.add(response.timings.duration, tags);
  const rows = json(response);
  return response.status === 200 && tenantRows(rows, session.business_id, tags);
}

export function setup() {
  invariantViolations.add(0);
  const own = input.credentials[0];
  const foreign = input.credentials.find(item => item.business_id !== own.business_id);
  const foreignRead = http.get(
    `${input.url}/rest/v1/bookings?select=id,business_id&business_id=eq.${foreign.business_id}&limit=1`,
    { headers: restHeaders(own), tags: { phase: "setup", request: "foreign_read_guard" } },
  );
  const readBody = json(foreignRead);
  const deniedRead = foreignRead.status === 200 && Array.isArray(readBody) && readBody.length === 0;
  const deniedWrite = http.post(
    `${adminBase}/api/check-ins?source=simple-view`,
    JSON.stringify({
      booking_id: foreign.booking_id,
      slot_id: foreign.slot_id,
      arrived_count: 0,
      // Even a broken tenant lookup reaches the stale guard before mutation.
      expected_arrived_count: 2147483647,
      client_event_id: `${MARKER}:${runId}:foreign-guard`,
    }),
    {
      headers: { Authorization: `Bearer ${own.access_token}`, "Content-Type": "application/json", "x-admin-business-id": own.business_id },
      tags: { phase: "setup", request: "foreign_write_guard" },
      responseCallback: http.expectedStatuses(404),
    },
  ).status === 404;
  if (!deniedRead || !deniedWrite) {
    invariantViolations.add(1, { phase: "setup", invariant: "tenant_guard" });
    throw new Error("BT500 tenant-isolation guard failed");
  }
}

export default function () {
  const session = sessionState();
  if (!session.jittered) {
    sleep(((__VU - 1) % 100) / 10);
    session.jittered = true;
  }
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  const phase = phaseAt(config, elapsed);
  const bucket = (__ITER + __VU - 1) % 10;
  const kind = bucket < 7 ? "read" : bucket < 9 ? "write" : "other";
  const tags = { phase, kind };
  const started = Date.now();
  offeredActions.add(1, tags);
  invariantViolations.add(0, tags);

  let ok = refreshIfNeeded(session, tags);
  if (ok) {
    if (kind === "read") ok = readAction(session, tags);
    else if (kind === "write") ok = writeAction(session, tags);
    else ok = otherAction(session, tags, Math.floor((__ITER + __VU - 1) / 10));
  }
  unexpectedFailure.add(!ok, tags);
  if (ok) completedActions.add(1, tags);
  actionDuration.add(Date.now() - started, tags);

  const cadence = phase === "spike" ? 5 : 10;
  sleep(Math.max(0, cadence - (Date.now() - started) / 1000));
}
