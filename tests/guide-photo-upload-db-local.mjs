import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

// An isolated Unix-socket cluster. Never connect to a hosted or existing DB.
const bin = "/opt/homebrew/opt/postgresql@17/bin";
const root = mkdtempSync("/private/tmp/c04-photo-pg-");
const data = join(root, "data");
let started = false;
const clients = [];
function run(name, args) {
  const result = spawnSync(join(bin, name), args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(name + " failed: " + result.stderr.slice(0, 800));
}
async function client() {
  const connection = new pg.Client({ host: root, port: 5432, database: "postgres", user: process.env.USER });
  await connection.connect();
  clients.push(connection);
  return connection;
}

try {
  mkdirSync(data);
  run("initdb", ["-D", data, "--no-sync", "--auth=trust"]);
  run("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"), "-o", "-c listen_addresses='' -c unix_socket_directories='" + root + "'", "start"]);
  started = true;
  const admin = await client();
  await admin.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.businesses(id uuid PRIMARY KEY);
    CREATE TABLE public.slots(id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES public.businesses(id));
    CREATE TABLE public.admin_users(id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES public.businesses(id));
    INSERT INTO public.businesses VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    INSERT INTO public.slots VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    INSERT INTO public.admin_users VALUES ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  `);
  await admin.query(readFileSync("supabase/migrations/20260923100000_guide_photo_upload_recovery.sql", "utf8"));

  const privileges = await admin.query(`SELECT
    has_table_privilege('anon', 'public.guide_photo_uploads', 'SELECT') AS anon_read,
    has_table_privilege('authenticated', 'public.guide_photo_uploads', 'INSERT') AS auth_write,
    has_table_privilege('service_role', 'public.guide_photo_uploads', 'INSERT') AS service_write`);
  assert.deepEqual(privileges.rows[0], { anon_read: false, auth_write: false, service_write: true });

  const low = await client();
  await low.query("SET ROLE anon");
  await assert.rejects(low.query("SELECT * FROM public.guide_photo_uploads"), { code: "42501" });

  const claim = `INSERT INTO public.guide_photo_uploads
    (operation_id,business_id,slot_id,actor_admin_id,content_sha256,state)
    VALUES ($1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',
    repeat('a',64),'uploading')`;
  const first = await client();
  const second = await client();
  await Promise.all([first.query("SET ROLE service_role"), second.query("SET ROLE service_role")]);
  const original = "22222222-2222-4222-8222-222222222222";
  const outcomes = await Promise.allSettled([first.query(claim, [original]), second.query(claim, [original])]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  const denied = outcomes.find(result => result.status === "rejected");
  assert.equal(denied?.reason?.code, "23505");
  const rows = await admin.query("SELECT operation_id,state FROM public.guide_photo_uploads");
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].state, "uploading");
  await admin.query("UPDATE public.guide_photo_uploads SET state='released' WHERE operation_id=$1", [original]);

  const alternateA = "44444444-4444-4444-8444-444444444444";
  const alternateB = "55555555-5555-4555-8555-555555555555";
  const differentIds = await Promise.allSettled([first.query(claim, [alternateA]), second.query(claim, [alternateB])]);
  assert.equal(differentIds.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(differentIds.find(result => result.status === "rejected")?.reason?.code, "23505");
  const active = await admin.query("SELECT operation_id FROM public.guide_photo_uploads WHERE state='uploading'");
  assert.equal(active.rowCount, 1);
  const winner = active.rows[0].operation_id;
  await admin.query("UPDATE public.guide_photo_uploads SET state='completed' WHERE operation_id=$1", [winner]);
  await assert.rejects(admin.query(claim, ["66666666-6666-4666-8666-666666666666"]), { code: "23505" });
  const released = await admin.query("UPDATE public.guide_photo_uploads SET state='released' WHERE operation_id=$1 AND state='completed' RETURNING operation_id", [winner]);
  assert.equal(released.rowCount, 1);
  await admin.query(claim, ["66666666-6666-4666-8666-666666666666"]);
  console.log("guide photo ledger: PG17 low-role denial, concurrent same/different ID uniqueness, and confirmed release passed");
} finally {
  await Promise.all(clients.map(connection => connection.end().catch(() => {})));
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "stop"]);
  rmSync(root, { recursive: true, force: true });
}
