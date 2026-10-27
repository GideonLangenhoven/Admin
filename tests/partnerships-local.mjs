// Disposable PostgreSQL only. No production credentials or customer data.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import pg from 'pg';
const directory=mkdtempSync('/private/tmp/capekayak-partnerships-'),port=55442;
const bin='/opt/homebrew/opt/postgresql@17/bin';
const env=Object.fromEntries(['PATH','USER','LANG','TMPDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const run=(name,args)=>{const result=spawnSync(join(bin,name),args,{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);};
const options={host:directory,port,database:'postgres',user:process.env.USER,ssl:false};
const db=new pg.Client(options),other=new pg.Client(options);
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1),B=id(2),C=id(3),P=id(10),legacy=id(20),multiple=id(21),own=id(22),independent=id(23),inferred=id(24);
let started=false;
try{
 run('initdb',['-D',join(directory,'data'),'-A','trust','--no-locale','-E','UTF8']);
 run('pg_ctl',['-D',join(directory,'data'),'-l',join(directory,'postgres.log'),'-o',`-h '' -k ${directory} -p ${port}`,'-w','start']);started=true;
 await db.connect();await other.connect();
 await db.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE businesses(id uuid PRIMARY KEY);
 CREATE TABLE business_partnerships(id uuid PRIMARY KEY,business_a_id uuid,business_b_id uuid,status text,initiated_by uuid,invite_token text,
   CONSTRAINT unique_partnership UNIQUE(business_a_id,business_b_id),CHECK(business_a_id<business_b_id));
 CREATE TABLE combo_offers(id uuid PRIMARY KEY,partnership_id uuid REFERENCES business_partnerships(id),business_a_id uuid,business_b_id uuid,
   created_by_business_id uuid,created_by uuid,active boolean DEFAULT true);
 CREATE TABLE combo_offer_items(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,combo_offer_id uuid REFERENCES combo_offers(id),business_id uuid,position int);
 CREATE TABLE combo_bookings(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,combo_offer_id uuid REFERENCES combo_offers(id));
 INSERT INTO businesses VALUES('${A}'),('${B}'),('${C}');
 INSERT INTO business_partnerships VALUES('${P}','${A}','${B}','ACTIVE','${A}','previously-exposed'),
 ('${id(11)}','${A}','${C}','ACTIVE','${C}',NULL),('${id(12)}','${B}','${C}','ACTIVE','${C}',NULL);
 `);
 await db.query(readFileSync('supabase/migrations/20261019140000_partnership_consent_and_revocation.sql','utf8'));
 assert.equal((await db.query('SELECT invite_token FROM business_partnerships WHERE id=$1',[P])).rows[0].invite_token,null);
 await db.query(`INSERT INTO combo_offers(id,partnership_id,business_a_id,business_b_id,created_by_business_id)
 VALUES('${legacy}','${P}','${A}','${B}','${A}');
 INSERT INTO combo_offers(id,created_by_business_id) VALUES('${multiple}','${A}'),('${own}','${A}'),('${independent}','${C}');
 INSERT INTO combo_offer_items(combo_offer_id,business_id,position) VALUES
 ('${multiple}','${A}',1),('${multiple}','${B}',2),('${multiple}','${B}',3),
 ('${own}','${A}',1),('${own}','${A}',2),
 ('${independent}','${C}',1),('${independent}','${A}',2),('${independent}','${B}',3);
 INSERT INTO combo_bookings(combo_offer_id) VALUES('${multiple}');
 INSERT INTO combo_offers(id,active) VALUES('${inferred}',false);
 INSERT INTO combo_offer_items(combo_offer_id,business_id,position) VALUES('${inferred}','${A}',1),('${inferred}','${B}',2);
 UPDATE combo_offers SET active=true WHERE id='${inferred}';`);
 // Any failure while stopping the offers must roll the partnership back too.
 await db.query(`CREATE FUNCTION fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$;
 CREATE TRIGGER fixture_fail BEFORE UPDATE ON combo_offers FOR EACH ROW EXECUTE FUNCTION fixture_fail();`);
 await assert.rejects(db.query("UPDATE business_partnerships SET status='REVOKED' WHERE id=$1",[P]),/fixture failure/);
 assert.equal((await db.query('SELECT status FROM business_partnerships WHERE id=$1',[P])).rows[0].status,'ACTIVE');
 assert((await db.query('SELECT active FROM combo_offers')).rows.every(r=>r.active));
 await db.query('DROP TRIGGER fixture_fail ON combo_offers; DROP FUNCTION fixture_fail()');
 await db.query("UPDATE business_partnerships SET status='REVOKED' WHERE id=$1",[P]);
 const rows=(await db.query('SELECT id,active FROM combo_offers')).rows;
 for(const offer of [legacy,multiple,inferred])assert.equal(rows.find(r=>r.id===offer).active,false);
 for(const offer of [own,independent])assert.equal(rows.find(r=>r.id===offer).active,true);
 assert.equal(Number((await db.query('SELECT count(*) FROM combo_bookings')).rows[0].count),1);
 await assert.rejects(db.query('UPDATE combo_offers SET active=true WHERE id=$1',[multiple]),{code:'23514'});
 await assert.rejects(db.query('INSERT INTO combo_bookings(combo_offer_id) VALUES($1)',[legacy]),{code:'23514'});
 await assert.rejects(db.query('INSERT INTO combo_offer_items(combo_offer_id,business_id,position) VALUES($1,$2,3)',[own,B]),{code:'23514'});
 console.log('PASS revocation atomically stops two- and three-tour offers; preserves own tours, independent partnerships and historical sales; blocks reactivation, new checkout and item bypass');

 await db.query("UPDATE business_partnerships SET status='PENDING' WHERE id=$1",[P]);
 await assert.rejects(db.query('UPDATE combo_offers SET active=true WHERE id=$1',[multiple]),{code:'23514'});
 await db.query("UPDATE business_partnerships SET status='ACTIVE' WHERE id=$1",[P]);
 assert.equal((await db.query('SELECT active FROM combo_offers WHERE id=$1',[multiple])).rows[0].active,false);
 await db.query('UPDATE combo_offers SET active=true WHERE id=$1',[multiple]);
 await db.query('INSERT INTO combo_bookings(combo_offer_id) VALUES($1)',[multiple]);
 // An activation racing a revocation must recheck the committed partnership.
 await db.query('BEGIN');await db.query("UPDATE business_partnerships SET status='REVOKED' WHERE id=$1",[P]);
 const activating=other.query('UPDATE combo_offers SET active=true WHERE id=$1',[multiple]);
 const denied=assert.rejects(activating,{code:'23514'});
 await db.query('COMMIT');await denied;
 assert.equal((await db.query('SELECT active FROM combo_offers WHERE id=$1',[multiple])).rows[0].active,false);
 for(const role of ['anon','authenticated']){
  await db.query('SET ROLE '+role);
  await assert.rejects(db.query('SELECT assert_combo_offer_partnerships($1)',[own]),{code:'42501'});
  await db.query('RESET ROLE');
 }
 console.log('PASS fresh acceptance does not republish offers; explicit reactivation works only while active; concurrent revocation wins; helper is service-only');
}finally{
 await other.end().catch(()=>{});await db.end().catch(()=>{});
 if(started)run('pg_ctl',['-D',join(directory,'data'),'-m','fast','-w','stop']);
}
