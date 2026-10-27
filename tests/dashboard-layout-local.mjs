// Disposable PostgreSQL only; exercises the migration with actual database roles.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import pg from 'pg';
const directory=mkdtempSync('/private/tmp/capekayak-dashboard-layout-'),port=55443;
const bin='/opt/homebrew/opt/postgresql@17/bin';
const env=Object.fromEntries(['PATH','USER','LANG','TMPDIR'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
const run=(name,args)=>{const result=spawnSync(join(bin,name),args,{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);};
const db=new pg.Client({host:directory,port,database:'postgres',user:process.env.USER,ssl:false});
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
let started=false;
try{
  run('initdb',['-D',join(directory,'data'),'-A','trust','--no-locale','-E','UTF8']);
  run('pg_ctl',['-D',join(directory,'data'),'-l',join(directory,'postgres.log'),'-o',`-h '' -k ${directory} -p ${port}`,'-w','start']);started=true;
  await db.connect();
  await db.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE businesses(id uuid PRIMARY KEY); INSERT INTO businesses VALUES('${A}'),('${B}');`);
  await db.query(readFileSync('supabase/migrations/20261020090000_operator_dashboard_layouts.sql','utf8'));
  await db.query('SET ROLE service_role');
  await db.query("INSERT INTO operator_dashboard_layouts(business_id,tile_order,hidden_tiles) VALUES($1,ARRAY['weather','manifest'],ARRAY['weather'])",[A]);
  await assert.rejects(db.query("INSERT INTO operator_dashboard_layouts(business_id,tile_order) VALUES($1,ARRAY['manifest'])",[A]),{code:'23505'});
  await db.query('RESET ROLE');
  for(const role of ['anon','authenticated']){
    await db.query('SET ROLE '+role);
    for(const sql of [
      'SELECT * FROM operator_dashboard_layouts',
      `INSERT INTO operator_dashboard_layouts(business_id,tile_order) VALUES('${B}',ARRAY['weather'])`,
      `UPDATE operator_dashboard_layouts SET hidden_tiles='{}'`,
      'DELETE FROM operator_dashboard_layouts',
    ])await assert.rejects(db.query(sql),{code:'42501'});
    await db.query('RESET ROLE');
  }
  await db.query('SET ROLE service_role');
  assert.equal((await db.query('UPDATE operator_dashboard_layouts SET revision=2 WHERE business_id=$1 AND revision=1 RETURNING revision',[A])).rowCount,1);
  assert.equal((await db.query('UPDATE operator_dashboard_layouts SET hidden_tiles=$1,revision=2 WHERE business_id=$2 AND revision=1 RETURNING revision',[[],A])).rowCount,0);
  const saved=(await db.query('SELECT * FROM operator_dashboard_layouts WHERE business_id=$1',[A])).rows[0];
  assert.deepEqual(saved.hidden_tiles,['weather']);assert.equal(saved.revision,2);
  assert.equal((await db.query('SELECT * FROM operator_dashboard_layouts WHERE business_id=$1',[B])).rowCount,0);
  await db.query('RESET ROLE');
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='operator_dashboard_layouts'::regclass")).rows[0].relrowsecurity,true);
  console.log('PASS migration, service-only storage, direct REST role bypass denial, unique operator records, tenant scope, stale revision protection and persisted hidden tiles');
}finally{
  await db.end().catch(()=>{});
  if(started)run('pg_ctl',['-D',join(directory,'data'),'-m','fast','-w','stop']);
}
