import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const marker = "bt500-20260921";
const output = process.env.BT500_CREDENTIALS_FILE || "/private/tmp/bt500-credentials.json";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Supabase URL, anon key and service key are required");
if (new URL(url).host !== "ukdsrndqhsatjkmxijuj.supabase.co") throw new Error("unexpected target project");
if (process.env.BT500_ALLOW_SHARED_PROJECT !== "YES") throw new Error("set BT500_ALLOW_SHARED_PROJECT=YES for the user-authorized synthetic target");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const password = process.env.BT500_PASSWORD || `Bt500!${randomBytes(18).toString("base64url")}`;
const fail = (label, error) => { if (error) throw new Error(`${label}: ${error.message}`); };
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
async function mapLimit(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index], index); }
  }));
  return results;
}
async function retry(label, work) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return await work(); } catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt)); }
  }
  throw new Error(`${label}: ${last?.message || last}`);
}

async function issueSessions(identities) {
  let completed = 0;
  return mapLimit(identities, 1, async (identity, i) => retry(`issue session ${i + 1}`, async () => {
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: identity.email });
    if (linkError || !link.properties?.hashed_token) throw linkError || new Error("missing token hash");
    const { data, error } = await auth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    if (error || !data.session?.access_token) throw error || new Error("missing access token");
    completed++;
    if (completed % 50 === 0) console.log(JSON.stringify({ status: "SESSION_PROGRESS", completed }));
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { user_id: identity.user_id, business_id: identity.business.id, access_token: data.session.access_token };
  }));
}

async function saveCredentials(credentials) {
  await writeFile(output, JSON.stringify({ marker, url, anon_key: anonKey, credentials }), { mode: 0o600 });
  await chmod(output, 0o600);
}

async function teardown() {
  const { data: users, error: usersError } = await admin.from("admin_users").select("user_id").like("email", `${marker}-%@example.invalid`);
  fail("find marker users", usersError);
  fail("delete marker admin users", (await admin.from("admin_users").delete().like("email", `${marker}-%@example.invalid`)).error);
  const authIds = new Set((users || []).map(row => row.user_id).filter(Boolean));
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    fail("list auth users", error);
    for (const user of data.users) if (user.email?.startsWith(`${marker}-`) || user.user_metadata?.bt500_marker === marker) authIds.add(user.id);
    if (data.users.length < 1000) break;
  }
  await mapLimit([...authIds], 5, async userId => {
    const { error } = await admin.auth.admin.deleteUser(userId); if (error && !/not found/i.test(error.message)) throw error;
  });
  fail("delete marker bookings", (await admin.from("bookings").delete().like("email", `${marker}-%@example.invalid`)).error);
  const { data: businesses, error: businessError } = await admin.from("businesses").select("id").like("subdomain", `${marker}-%`);
  fail("find marker businesses", businessError);
  const ids = (businesses || []).map(row => row.id);
  for (const group of chunks(ids, 50)) {
    if (!group.length) continue;
    fail("delete marker slots", (await admin.from("slots").delete().in("business_id", group)).error);
    fail("delete marker tours", (await admin.from("tours").delete().in("business_id", group)).error);
    fail("delete marker businesses", (await admin.from("businesses").delete().in("id", group)).error);
  }
  console.log(JSON.stringify({ status: "TEARDOWN_COMPLETE", marker, auth_users_deleted: authIds.size, businesses_deleted: ids.length }));
}

if (process.argv.includes("--teardown")) {
  await teardown();
  process.exit(0);
}
if (process.argv.includes("--sessions")) {
  const { data: rows, error } = await admin.from("admin_users").select("email,user_id,business_id").like("email", `${marker}-%@example.invalid`).order("email");
  fail("load marker users", error);
  if (rows.length !== 500) throw new Error(`expected 500 marker users, found ${rows.length}`);
  const credentials = await issueSessions(rows.map(row => ({ email: row.email, user_id: row.user_id, business: { id: row.business_id } })));
  await saveCredentials(credentials);
  console.log(JSON.stringify({ status: "SESSIONS_COMPLETE", marker, users: credentials.length, credentials_file: output }));
  process.exit(0);
}
if (!process.argv.includes("--seed")) throw new Error("Use --seed or --teardown");

await teardown();
const businessRows = Array.from({ length: 167 }, (_, i) => ({
  name: `BT500 Stress ${String(i + 1).padStart(2, "0")}`,
  business_name: `BT500 Stress ${String(i + 1).padStart(2, "0")}`,
  subdomain: `${marker}-${String(i + 1).padStart(2, "0")}`,
  operator_email: `${marker}-owner-${i + 1}@example.invalid`,
  subscription_status: "ACTIVE",
  max_admin_seats: 3,
  directory_visible: false,
  yoco_test_mode: true
}));
const { data: businesses, error: businessesError } = await admin.from("businesses").insert(businessRows).select("id,subdomain");
fail("insert businesses", businessesError);

const tourRows = businesses.map((business, i) => ({ business_id: business.id, name: `BT500 Tour ${i + 1}`, duration_minutes: 90, default_capacity: 1000, base_price_per_person: 500, active: true, hidden: true }));
const { data: tours, error: toursError } = await admin.from("tours").insert(tourRows).select("id,business_id");
fail("insert tours", toursError);
const tourByBusiness = new Map(tours.map(tour => [tour.business_id, tour]));

const slotRows = businesses.flatMap((business, businessIndex) => Array.from({ length: 4 }, (_, slotIndex) => ({
  business_id: business.id,
  tour_id: tourByBusiness.get(business.id).id,
  start_time: new Date(Date.now() + (businessIndex * 10 + slotIndex + 1) * 3600000).toISOString(),
  capacity_total: 1000,
  booked: 100,
  held: 0,
  status: "OPEN"
})));
const insertedSlots = [];
for (const group of chunks(slotRows, 500)) {
  const { data, error } = await admin.from("slots").insert(group).select("id,business_id");
  fail("insert slots", error); insertedSlots.push(...data);
}
const slotsByBusiness = new Map();
for (const slot of insertedSlots) slotsByBusiness.set(slot.business_id, [...(slotsByBusiness.get(slot.business_id) || []), slot]);

const bookingRows = businesses.flatMap((business, businessIndex) => Array.from({ length: 30 }, (_, bookingIndex) => ({
  business_id: business.id,
  tour_id: tourByBusiness.get(business.id).id,
  slot_id: slotsByBusiness.get(business.id)[bookingIndex % 4].id,
  customer_name: `BT500 Guest ${businessIndex + 1}-${bookingIndex + 1}`,
  email: `${marker}-${businessIndex + 1}-${bookingIndex + 1}@example.invalid`,
  qty: 1,
  unit_price: 500,
  total_amount: 500,
  status: "PENDING",
  source: "ADMIN",
  waiver_status: "PENDING",
  created_at: new Date(Date.now() - bookingIndex * 60000).toISOString()
})));
for (const group of chunks(bookingRows, 500)) fail("insert bookings", (await admin.from("bookings").insert(group)).error);

const specs = Array.from({ length: 500 }, (_, i) => ({
  email: `${marker}-${String(i + 1).padStart(3, "0")}@example.invalid`,
  business: businesses[Math.floor(i / 3)]
}));
const identities = await mapLimit(specs, 5, async (spec, i) => retry(`create user ${i + 1}`, async () => {
  const { data, error } = await admin.auth.admin.createUser({ email: spec.email, password, email_confirm: true, user_metadata: { bt500_marker: marker } });
  if (error) throw error;
  return { ...spec, user_id: data.user.id };
}));
for (const group of chunks(identities.map((identity, i) => ({
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
})), 100)) fail("upsert admin users", (await admin.from("admin_users").upsert(group, { onConflict: "email" })).error);

const credentials = await issueSessions(identities);
await saveCredentials(credentials);
console.log(JSON.stringify({ status: "SEED_COMPLETE", marker, businesses: businesses.length, users: credentials.length, slots: insertedSlots.length, bookings: bookingRows.length, credentials_file: output }));
