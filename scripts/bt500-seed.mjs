import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { fetchAllPages } from "./bt500-pages.mjs";
import { cleanupIssues, seedActionIssues } from "./bt500-seed-ownership.mjs";
import { sourceMatchesCandidate } from "./release-evidence-check.mjs";
import { loadBt500Execution } from "./bt500-execution-file.mjs";

const baseMarker = "bt500-20260921";
const output = process.env.BT500_CREDENTIALS_FILE || "/private/tmp/bt500-credentials.json";
const inventoryFile = process.env.BT500_SEED_INVENTORY_FILE || `${output}.inventory.json`;
const runId = process.env.BT500_RUN_ID;
const mode = ["seed", "sessions", "teardown"].find((value) => process.argv.includes(`--${value}`));
if (!mode || ["seed", "sessions", "teardown"].filter((value) => process.argv.includes(`--${value}`)).length !== 1) throw new Error("Use exactly one of --seed, --sessions, --teardown");
const root = new URL("../", import.meta.url).pathname;
const execution = loadBt500Execution(root, true);
const release = JSON.parse(await readFile(new URL("../docs/production-readiness/RELEASE_MANIFEST.json", import.meta.url), "utf8"));
const guardIssues = seedActionIssues(execution, release.current_candidate?.admin_commit, mode, runId);
if (!sourceMatchesCandidate(root, execution.candidate_commit)) guardIssues.push("seed executable source differs from the frozen candidate");
try {
  const tree = execFileSync("git", ["rev-parse", `${execution.candidate_commit}^{tree}`], { cwd: root, encoding: "utf8" }).trim();
  if (tree !== execution.candidate_tree || tree !== release.current_candidate?.admin_tree) guardIssues.push("seed candidate tree differs from the frozen source");
} catch { guardIssues.push("seed candidate tree cannot be resolved"); }
if (guardIssues.length) throw new Error("BT500 seed action blocked:\n- " + guardIssues.join("\n- "));
let inventory;
if (mode !== "seed") {
  inventory = JSON.parse(await readFile(inventoryFile, "utf8"));
  if (inventory?.run_id !== runId || inventory.candidate_commit !== execution.candidate_commit || inventory.project_ref !== execution.environment.supabase_project_ref || inventory.execution_sha256 !== process.env.BT500_EXECUTION_SHA256) throw new Error("seed inventory does not match current run/candidate/project/action packet");
}
const marker = mode === "seed" ? `${baseMarker}-${randomBytes(8).toString("hex")}` : inventory.marker;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Supabase URL, anon key and service key are required");
if (new URL(url).protocol !== "https:" || new URL(url).host !== "ukdsrndqhsatjkmxijuj.supabase.co") throw new Error("unexpected HTTPS target project");
if (process.env.BT500_ALLOW_SHARED_PROJECT !== "YES") throw new Error("set BT500_ALLOW_SHARED_PROJECT=YES for the user-authorized synthetic target");
if (mode === "seed") {
  try { await access(output); throw new Error("credentials output already exists; choose a fresh run path before seeding"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

const guardedFetch = (input, init = {}) => {
  const issues = seedActionIssues(execution, release.current_candidate?.admin_commit, mode, runId);
  if (issues.length) throw new Error("BT500 seed request blocked:\n- " + issues.join("\n- "));
  const remaining = Date.parse(execution.window.ends_at) - Date.now();
  const deadline = AbortSignal.timeout(Math.min(remaining, 2_147_483_647));
  const signals = [deadline, init.signal, input instanceof Request ? input.signal : null].filter(Boolean);
  return fetch(input, { ...init, signal: AbortSignal.any(signals) });
};

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guardedFetch } });
const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guardedFetch } });
const password = process.env.BT500_PASSWORD || `Bt500!${randomBytes(18).toString("base64url")}`;
const fail = (label, error) => { if (error) throw new Error(`${label}: ${error.message}`); };
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
async function saveInventory() {
  const data = JSON.stringify(inventory, null, 2) + "\n";
  await writeFile(inventoryFile, data, { flag: "wx", mode: 0o600 });
  await chmod(inventoryFile, 0o600);
}
async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index], index); }
  }));
  return results;
}
async function issueSessions(identities) {
  let completed = 0;
  return mapLimit(identities, 1, async (identity, i) => {
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email: identity.email });
    if (linkError || !link.properties?.hashed_token) throw linkError || new Error(`missing recovery token hash for session ${i + 1}`);
    if (link.user?.id !== identity.user_id) throw new Error(`recovery link identity mismatch for session ${i + 1}`);
    const { data, error } = await auth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "recovery" });
    if (error || data.user?.id !== identity.user_id || !data.session?.access_token || !data.session.refresh_token || !data.session.expires_at) throw error || new Error("session identity or refreshable token mismatch");
    completed++;
    if (completed % 50 === 0) console.log(JSON.stringify({ status: "SESSION_PROGRESS", completed }));
    await new Promise(resolve => setTimeout(resolve, 1000));
    return {
      staff_index: i,
      user_id: identity.user_id,
      business_id: identity.business.id,
      booking_id: identity.booking.id,
      slot_id: identity.booking.slot_id,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    };
  });
}

function assignWriteBookings(identities, bookings) {
  const byBusiness = new Map();
  for (const booking of bookings) byBusiness.set(booking.business_id, [...(byBusiness.get(booking.business_id) || []), booking]);
  for (const rows of byBusiness.values()) rows.sort((a, b) => a.email.localeCompare(b.email));
  const next = new Map();
  return identities.map(identity => {
    const index = next.get(identity.business.id) || 0;
    const booking = byBusiness.get(identity.business.id)?.[index];
    if (!booking) throw new Error(`missing owned write booking for ${identity.email}`);
    if (booking.qty < 2 || booking.waiver_status !== "SIGNED" || !["PAID", "CONFIRMED", "COMPLETED"].includes(booking.status)) {
      throw new Error(`write booking for ${identity.email} is not arrival-eligible; run the guarded BT500 reseed first`);
    }
    next.set(identity.business.id, index + 1);
    return { ...identity, booking };
  });
}

async function saveCredentials(credentials) {
  await writeFile(output, JSON.stringify({ marker: baseMarker, seed_marker: marker, run_id: runId, execution_sha256: process.env.BT500_EXECUTION_SHA256, url, anon_key: anonKey, credentials }), { flag: "wx", mode: 0o600 });
  await chmod(output, 0o600);
}

async function relatedRows(table, columns, column, ids) {
  const rows = [];
  for (const group of chunks(ids, 20)) {
    if (!group.length) continue;
    rows.push(...await fetchAllPages(async (from, to) => {
      const { data, error } = await admin.from(table).select(columns).in(column, group).range(from, to);
      fail(`inspect ${table}`, error);
      return data;
    }));
  }
  return rows;
}

async function markerAuthUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    fail("list auth users", error);
    const planned = new Set(inventory.owned.auth_users.map(row => row.id));
    for (const user of data.users) if (planned.has(user.id) || user.email?.startsWith(`${marker}-`) || user.user_metadata?.bt500_marker === marker) users.push({ id: user.id, email: user.email, marker: user.user_metadata?.bt500_marker });
    if (data.users.length < 1000) break;
  }
  return users;
}

async function markerRows(table, columns, column) {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await admin.from(table).select(columns).like(column, `${marker}-%`).range(from, to);
    fail(`inspect marker ${table}`, error);
    return data;
  });
}

function uniqueRows(...groups) {
  return [...new Map(groups.flat().map((row) => [row.id, row])).values()];
}

async function liveSnapshot() {
  const businesses = inventory.owned.businesses.map(row => row.id);
  const bookings = inventory.owned.bookings.map(row => row.id);
  return {
    businesses: uniqueRows(await relatedRows("businesses", "id,subdomain", "id", businesses), await markerRows("businesses", "id,subdomain", "subdomain")),
    tours: await relatedRows("tours", "id,business_id", "business_id", businesses),
    slots: await relatedRows("slots", "id,business_id,tour_id", "business_id", businesses),
    bookings: uniqueRows(await relatedRows("bookings", "id,business_id,slot_id,email,qty,status,waiver_status", "business_id", businesses), await markerRows("bookings", "id,business_id,slot_id,email,qty,status,waiver_status", "email")),
    admin_users: uniqueRows(await relatedRows("admin_users", "id,email,user_id,business_id", "business_id", businesses), await markerRows("admin_users", "id,email,user_id,business_id", "email")),
    auth_users: await markerAuthUsers(),
    check_ins: await relatedRows("slot_check_ins", "id,booking_id,client_event_id,notes", "booking_id", bookings),
  };
}

async function verifiedSnapshot() {
  const live = await liveSnapshot();
  const issues = cleanupIssues(inventory, live);
  if (issues.length) throw new Error("BT500 ownership verification blocked:\n- " + issues.join("\n- "));
  return live;
}

if (mode === "teardown") {
  const live = await verifiedSnapshot();
  console.error(JSON.stringify({ status: "MANUAL_RECONCILIATION_REQUIRED", reason: "booking triggers and related jobs/contacts make automatic parent deletion unsafe", marker, inventory_file: inventoryFile, observed_counts: Object.fromEntries(Object.entries(live).map(([table, rows]) => [table, rows.length])) }));
  process.exit(2);
}
if (mode === "sessions") {
  const live = await verifiedSnapshot();
  if (live.auth_users.length !== inventory.owned.auth_users.length || live.auth_users.length !== 500) throw new Error("all 500 owned Auth identities must exist before issuing sessions");
  const rows = live.admin_users.sort((a, b) => a.email.localeCompare(b.email));
  if (rows.length !== 500) throw new Error(`expected 500 marker users, found ${rows.length}`);
  const businessSizes = [...rows.reduce((counts, row) => counts.set(row.business_id, (counts.get(row.business_id) || 0) + 1), new Map()).values()];
  if (businessSizes.length !== 167 || businessSizes.some(size => size < 2 || size > 3)) throw new Error("expected 500 users across 167 businesses with two or three staff each");
  const bookings = live.bookings;
  const identities = assignWriteBookings(rows.map(row => ({ email: row.email, user_id: row.user_id, business: { id: row.business_id } })), bookings);
  const credentials = await issueSessions(identities);
  await saveCredentials(credentials);
  console.log(JSON.stringify({ status: "SESSIONS_COMPLETE", marker, users: credentials.length, credentials_file: output }));
  process.exit(0);
}
if (mode !== "seed") throw new Error("unexpected BT500 seed mode");
const businessRows = Array.from({ length: 167 }, (_, i) => ({
  id: randomUUID(),
  name: `BT500 Stress ${String(i + 1).padStart(2, "0")}`,
  business_name: `BT500 Stress ${String(i + 1).padStart(2, "0")}`,
  subdomain: `${marker}-${String(i + 1).padStart(2, "0")}`,
  operator_email: `${marker}-owner-${i + 1}@example.invalid`,
  subscription_status: "ACTIVE",
  max_admin_seats: 3,
  directory_visible: false,
  yoco_test_mode: true
}));
const tourRows = businessRows.map((business, i) => ({ id: randomUUID(), business_id: business.id, name: `BT500 Tour ${i + 1}`, duration_minutes: 90, default_capacity: 1000, base_price_per_person: 500, active: true, hidden: true }));
const tourByBusiness = new Map(tourRows.map(tour => [tour.business_id, tour]));
const slotRows = businessRows.flatMap((business, businessIndex) => Array.from({ length: 4 }, (_, slotIndex) => ({
  id: randomUUID(),
  business_id: business.id,
  tour_id: tourByBusiness.get(business.id).id,
  start_time: new Date(Date.now() + (businessIndex * 10 + slotIndex + 1) * 3600000).toISOString(),
  capacity_total: 1000,
  booked: 100,
  held: 0,
  status: "OPEN"
})));
const slotsByBusiness = new Map();
for (const slot of slotRows) slotsByBusiness.set(slot.business_id, [...(slotsByBusiness.get(slot.business_id) || []), slot]);
const bookingRows = businessRows.flatMap((business, businessIndex) => Array.from({ length: 30 }, (_, bookingIndex) => ({
  id: randomUUID(),
  business_id: business.id,
  tour_id: tourByBusiness.get(business.id).id,
  slot_id: slotsByBusiness.get(business.id)[bookingIndex % 4].id,
  customer_name: `BT500 Guest ${businessIndex + 1}-${bookingIndex + 1}`,
  email: `${marker}-${businessIndex + 1}-${bookingIndex + 1}@example.invalid`,
  qty: 2,
  unit_price: 500,
  total_amount: 1000,
  status: "CONFIRMED",
  source: "ADMIN",
  waiver_status: "SIGNED",
  waiver_signed_at: new Date().toISOString(),
  waiver_signed_name: "BT500 Synthetic Guest",
  created_at: new Date(Date.now() - bookingIndex * 60000).toISOString()
})));
const specs = Array.from({ length: 500 }, (_, i) => ({
  id: randomUUID(),
  auth_id: randomUUID(),
  email: `${marker}-${String(i + 1).padStart(3, "0")}@example.invalid`,
  business: businessRows[Math.floor(i / 3)]
}));
inventory = {
  schema_version: 1, run_id: runId, marker, project_ref: execution.environment.supabase_project_ref,
  candidate_commit: execution.candidate_commit, execution_sha256: process.env.BT500_EXECUTION_SHA256, window: execution.window, created_at_utc: new Date().toISOString(),
  owned: {
    businesses: businessRows.map(row => ({ id: row.id, subdomain: row.subdomain })),
    tours: tourRows.map(row => ({ id: row.id, business_id: row.business_id })),
    slots: slotRows.map(row => ({ id: row.id, business_id: row.business_id, tour_id: row.tour_id })),
    bookings: bookingRows.map(row => ({ id: row.id, business_id: row.business_id, slot_id: row.slot_id, email: row.email })),
    admin_users: specs.map(row => ({ id: row.id, business_id: row.business.id, email: row.email, user_id: row.auth_id })),
    auth_users: specs.map(row => ({ id: row.auth_id, email: row.email }))
  }
};
for (const [table, column] of [["businesses", "subdomain"], ["admin_users", "email"], ["bookings", "email"]]) {
  const { data, error } = await admin.from(table).select("id").like(column, `${marker}-%`).limit(1);
  fail(`pre-run ${table} inventory`, error);
  if (data?.length) throw new Error(`pre-existing ${table} row shares the new seed marker`);
}
if ((await markerAuthUsers()).length) throw new Error("pre-existing Auth user shares the new seed marker");
await saveInventory(); // Exclusive, durable ownership list before the first hosted write.

const { data: businesses, error: businessesError } = await admin.from("businesses").insert(businessRows).select("id,subdomain");
fail("insert businesses", businessesError);
if (businesses.length !== businessRows.length || businesses.some((row) => !businessRows.some((planned) => planned.id === row.id))) throw new Error("business IDs differ from persisted inventory");
const { data: tours, error: toursError } = await admin.from("tours").insert(tourRows).select("id,business_id");
fail("insert tours", toursError);
if (tours.length !== tourRows.length || tours.some((row) => !tourRows.some((planned) => planned.id === row.id))) throw new Error("tour IDs differ from persisted inventory");
const insertedSlots = [];
for (const group of chunks(slotRows, 500)) {
  const { data, error } = await admin.from("slots").insert(group).select("id,business_id");
  fail("insert slots", error); insertedSlots.push(...data);
}
if (insertedSlots.length !== slotRows.length) throw new Error("slot count differs from persisted inventory");
const insertedBookings = [];
for (const group of chunks(bookingRows, 500)) {
  const { data, error } = await admin.from("bookings").insert(group).select("id,business_id,slot_id,email,qty,status,waiver_status");
  fail("insert bookings", error);
  insertedBookings.push(...data);
}
if (insertedBookings.length !== bookingRows.length) throw new Error("booking count differs from persisted inventory");

const identities = await mapLimit(specs, 1, async (spec) => {
  const { data, error } = await admin.auth.admin.createUser({ id: spec.auth_id, email: spec.email, password, email_confirm: true, user_metadata: { bt500_marker: marker, bt500_run_id: runId } });
  fail(`create user ${spec.email}`, error);
  if (data.user?.id !== spec.auth_id || data.user.email !== spec.email) throw new Error("created Auth identity differs from persisted inventory; reconcile manually");
  return { ...spec, user_id: spec.auth_id };
});
for (const group of chunks(identities.map((identity, i) => ({
  id: identity.id,
  email: identity.email,
  password_hash: "SUPABASE_AUTH",
  role: "OPERATOR",
  business_id: identity.business.id,
  name: `BT500 Operator ${i + 1}`,
  user_id: identity.user_id,
  must_set_password: false,
  suspended: false,
  read_only: false,
  onboarding_completed_at: new Date().toISOString()
})), 100)) fail("insert admin users", (await admin.from("admin_users").insert(group)).error);

const seeded = await verifiedSnapshot();
for (const table of ["businesses", "tours", "slots", "bookings", "admin_users", "auth_users"]) {
  if (seeded[table].length !== inventory.owned[table].length) throw new Error(`${table} count differs from persisted inventory`);
}
const credentials = await issueSessions(assignWriteBookings(identities, insertedBookings));
await saveCredentials(credentials);
console.log(JSON.stringify({ status: "SEED_COMPLETE", marker, businesses: businesses.length, users: credentials.length, slots: insertedSlots.length, bookings: bookingRows.length, credentials_file: output, inventory_file: inventoryFile }));
