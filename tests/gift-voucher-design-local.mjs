// Isolated local PostgreSQL only. No project environment or hosted database is read.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
const dir = mkdtempSync('/private/tmp/gift-voucher-db-');
const bin = '/opt/homebrew/opt/postgresql@17/bin';
const env = Object.fromEntries(['PATH', 'USER', 'LANG', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
function run(name, args) {
  const result = spawnSync(`${bin}/${name}`, args, { env, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
}
let started = false;
const db = new pg.Client({ host: dir, port: 55448, user: process.env.USER, database: 'postgres' });
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
try {
  run('initdb', ['-D', `${dir}/data`, '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  run('pg_ctl', ['-D', `${dir}/data`, '-l', `${dir}/postgres.log`, '-o', `-h '' -k ${dir} -p 55448`, '-w', 'start']); started = true;
  await db.connect();
  await db.query(`create role anon; create role authenticated;
    create table businesses(id uuid primary key, email_img_gift text);
    create table tours(id uuid primary key, business_id uuid, name text, image_url text, active boolean);
    create table vouchers(id uuid primary key, business_id uuid, type text, tour_name text, status text);
    insert into businesses values ('${id(1)}','https://example.com/default.jpg'),('${id(2)}',null);
    insert into tours values ('${id(3)}','${id(1)}','Sunset paddle','https://example.com/tour.jpg',true),
      ('${id(4)}','${id(2)}','Other operator','https://example.com/other.jpg',true),
      ('${id(5)}','${id(1)}','Inactive tour',null,false);
    grant usage on schema public to anon,authenticated;
    grant insert,select,update on vouchers to anon;
    alter table vouchers enable row level security;
    create policy fixture_tenant on vouchers to anon using (business_id = '${id(1)}') with check (business_id = '${id(1)}');`);
  const migration = readFileSync('supabase/migrations/20261018160000_gift_voucher_photographs.sql', 'utf8');
  await db.query(migration);
  await db.query(migration); // Migration is replay-safe.
  await db.query("update tours set voucher_image_url='https://example.com/gift.jpg' where id=$1", [id(3)]);
  await db.query('set role anon');
  let result = await db.query('insert into vouchers(id,business_id,type,gift_tour_id,gift_image_url,gift_tour_name) values($1,$2,$3,$4,$5,$6) returning *', [id(10),id(1),'MONETARY',id(3),'https://attacker.example/track.jpg','Fake experience']);
  assert.equal(result.rows[0].gift_image_url,'https://example.com/gift.jpg');
  assert.equal(result.rows[0].gift_tour_name,'Sunset paddle');
  assert.equal(result.rows[0].tour_name,null);
  assert.equal(result.rows[0].type,'MONETARY');
  for (const tour of [id(4),id(5),id(99)]) await assert.rejects(db.query('insert into vouchers(id,business_id,gift_tour_id) values($1,$2,$3)',[id(11),id(1),tour]),{code:'23514'});
  await assert.rejects(db.query('insert into vouchers(id,business_id,gift_tour_id) values($1,$2,$3)',[id(11),id(2),id(4)]),{code:'42501'});
  await assert.rejects(db.query('update vouchers set gift_image_url=$1 where id=$2',['https://attacker.example/a.jpg',id(10)]),{code:'23514'});
  await assert.rejects(db.query('update vouchers set gift_tour_id=$1 where id=$2',[id(4),id(10)]),{code:'23514'});
  await db.query("update vouchers set status='ACTIVE' where id=$1",[id(10)]);
  await db.query('reset role');
  await db.query("update tours set voucher_image_url=null, name='Renamed tour' where id=$1",[id(3)]);
  result=await db.query('select * from vouchers where id=$1',[id(10)]);
  assert.equal(result.rows[0].gift_image_url,'https://example.com/gift.jpg');
  assert.equal(result.rows[0].gift_tour_name,'Sunset paddle');
  result=await db.query('insert into vouchers(id,business_id,gift_tour_id) values($1,$2,$3) returning *',[id(12),id(1),id(3)]);
  assert.equal(result.rows[0].gift_image_url,'https://example.com/tour.jpg');
  result=await db.query('insert into vouchers(id,business_id) values($1,$2) returning *',[id(13),id(1)]);
  assert.equal(result.rows[0].gift_image_url,'https://example.com/default.jpg');
  result=await db.query('insert into vouchers(id,business_id) values($1,$2) returning *',[id(14),id(2)]);
  assert.equal(result.rows[0].gift_image_url,null);
  await db.query('delete from tours where id=$1',[id(3)]);
  assert.equal((await db.query('select gift_image_url from vouchers where id=$1',[id(10)])).rows[0].gift_image_url,'https://example.com/gift.jpg');
  console.log('PASS: tenant-scoped artwork, forged snapshot rejection, immutable issued designs, monetary semantics, activation, photo/default/empty fallbacks, deleted experience and migration replay.');
} finally {
  await db.end().catch(()=>{});
  if(started) run('pg_ctl',['-D',`${dir}/data`,'-m','fast','-w','stop']);
}
