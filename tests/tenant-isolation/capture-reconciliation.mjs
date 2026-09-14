import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

// Seed BEFORE applying R13. Empty fixtures cannot exercise a data migration.
// No environment file or production URL is read.
const host = process.argv[2] || '127.0.0.1';
assert(['127.0.0.1', 'localhost', '::1'].includes(host) || /^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host));
const connection = { host, port: 5432, user: process.env.USER };
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const migration = readFileSync('supabase/migrations/20260911100000_r13_capture_reconciliation.sql', 'utf8');

for (const comboTable of ['absent', 'empty', 'linked']) {
  const database = 'capture_review_' + randomBytes(8).toString('hex');
  const admin = new pg.Client({ ...connection, database: 'postgres' });
  const db = new pg.Client({ ...connection, database });
  let created = false, connected = false;
  try {
    await admin.connect();
    await admin.query('create database ' + database); created = true;
    await db.connect(); connected = true;
    await db.query(readFileSync('tests/fixtures/rollout-schema.sql', 'utf8'));
    await db.query('create table logs(business_id uuid, booking_id uuid, event text, payload jsonb)');
    if (comboTable !== 'absent') await db.query('create table combo_booking_items(booking_id uuid)');
    await db.query("insert into businesses(id,name,operator_email) values($1,'Local operator','operator@example.invalid')", [id(1)]);
    await db.query("insert into tours(id,business_id,name,base_price_per_person,default_capacity) values($1,$2,'Fixture tour',1000,10)", [id(2),id(1)]);
    for (const n of [11,12,13,14,15,16]) {
      await db.query("insert into bookings(id,business_id,tour_id,customer_name,email,qty,unit_price,status,total_amount,total_captured,voucher_amount_paid,original_total,total_refunded,is_combo,combo_booking_id) values($1,$2,$3,'Fixture','guest@example.invalid',1,1000,'PAID',600,$4,400,1000,$5,$6,$7)",
        [id(n),id(1),id(2),n === 16 ? 400 : 1000,n === 13 ? 100 : 0,n === 14,n === 15 ? id(99) : null]);
    }
    if (comboTable === 'linked') await db.query('insert into combo_booking_items values($1)', [id(11)]);
    await db.query(migration);
    const captures = (await db.query('select total_captured from bookings order by id')).rows.map(row => Number(row.total_captured));
    assert.deepEqual(captures, [comboTable === 'linked' ? 1000 : 600,600,1000,1000,1000,400]);
    const logged = Number((await db.query('select count(*) from logs')).rows[0].count);
    assert.equal(logged, comboTable === 'linked' ? 1 : 2);
    // Reapplying must not double-log or change already-corrected bookings.
    await db.query(migration);
    assert.equal(Number((await db.query('select count(*) from logs')).rows[0].count), logged);
    console.log('PASS capture reconciliation: combo table ' + comboTable + ', prior refunds/combos/low captures preserved, repeat is a no-op');
  } finally {
    if (connected) await db.end();
    if (created) await admin.query('drop database ' + database);
    await admin.end();
  }
}
