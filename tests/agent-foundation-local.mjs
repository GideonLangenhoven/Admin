import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

// LABELLED LOCAL BACKEND FIXTURE: PostgreSQL/RLS, not real Supabase Auth or
// provider approval. Never loads .env or accepts a remote database URL.
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''), 'Use a disposable local Unix socket');
const port = Number(process.argv[3]);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
const database = 'agent_fixture_' + randomBytes(8).toString('hex');
const connection = { host, port, user: process.env.USER, connectionTimeoutMillis: 5000 };
const admin = new pg.Client({ ...connection, database: 'postgres' });
const db = new pg.Client({ ...connection, database });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let created = false;
let passed = 0;
const claims = { role: 'authenticated', sub: id(2), exp: Math.floor(Date.now()/1000)+3600,
  client_id: 'fixture-client', agent_resource: 'urn:bookingtours:agent-read', agent_grant_id: id(3),
  scope: 'departures:read availability:read attention:read' };
async function check(name, work) { await work(); passed++; console.log('PASS ' + name); }
async function as(role, tokenClaims, work) {
  assert(['anon', 'authenticated', 'service_role'].includes(role));
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL ROLE ' + role);
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify(tokenClaims)]);
    return await work();
  } finally { await db.query('ROLLBACK'); }
}
const clock = (business = id(1), grant = id(3), scope = 'availability:read') =>
  db.query('SELECT public.agent_read_observed_at($1,$2,$3) AS at', [business,grant,scope]);
const denied = (role = 'authenticated', tokenClaims = claims, business = id(1), grant = id(3), scope = 'availability:read') =>
  as(role, tokenClaims, () => assert.rejects(clock(business,grant,scope), error => error.code === '42501'));
const waiverCounts = (business = id(1), departure = id(4), grant = id(3)) =>
  db.query('SELECT public.agent_departure_waiver_counts($1,$2,$3) AS result', [business,departure,grant]);
const participant = {name:'Synthetic guest',dob:'1990-01-01',accepts_liability:true};
const signedPayload = {accept_risk:true,participants:[participant]};
async function seedWaivers(rows) {
  await db.query('DELETE FROM bookings');
  for (const [index,row] of rows.entries()) {
    await db.query(`INSERT INTO bookings(id,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,status,
      waiver_status,waiver_signed_at,waiver_signed_name,waiver_payload)
      VALUES($1,$2,$3,$4,'Synthetic fixture','fixture@example.invalid',$5,100,100,$6,$7,$8,$9,$10::jsonb)`,
      [id(60+index),row.business ?? id(1),row.tour ?? id(5),row.slot ?? id(4),row.qty ?? 1,row.status ?? 'CONFIRMED',
        row.waiver ?? 'SIGNED',row.signedAt === undefined ? '2026-10-02T10:00:00Z' : row.signedAt,
        row.signedName === undefined ? 'Synthetic signer' : row.signedName,JSON.stringify(row.payload ?? signedPayload)]);
  }
}

try {
  await admin.connect();
  await admin.query('CREATE DATABASE ' + database); created = true;
  await db.connect();
  await db.query(readFileSync('tests/fixtures/rollout-schema.sql','utf8'));
  await db.query('CREATE TABLE auth.users(id uuid PRIMARY KEY)');
  await db.query(readFileSync('tests/fixtures/rollout-policies.sql','utf8'));
  // Use the existing pending-reschedule policies, schema only. The new service
  // checks these rows through the caller's RLS client without reading amounts.
  const pendingPolicies = readFileSync('supabase/migrations/20260502080638_rls_tighten_remaining_medium.sql','utf8');
  await db.query('ALTER TABLE public.pending_reschedules ENABLE ROW LEVEL SECURITY');
  await db.query(pendingPolicies.slice(pendingPolicies.indexOf('CREATE POLICY "pending_reschedules_service"'),
    pendingPolicies.indexOf('-- 6. businesses')));
  // Reuse the current canonical capacity function without changing booking math.
  await db.query(readFileSync('supabase/migrations/20260706130000_remove_shared_resources.sql','utf8'));
  await db.query(readFileSync('supabase/agent-foundation.local.sql','utf8'));
  await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [id(2),id(82)]);
  await db.query("INSERT INTO businesses(id,name,operator_email,subscription_status) VALUES($1,'Agent A fixture','a@example.invalid','ACTIVE'),($2,'Agent B fixture','b@example.invalid','ACTIVE')", [id(1),id(81)]);
  await db.query("INSERT INTO admin_users(id,user_id,business_id,email,password_hash,role) VALUES($1,$2,$3,'a@example.invalid','fixture','MAIN_ADMIN'),($4,$5,$6,'b@example.invalid','fixture','MAIN_ADMIN')", [id(10),id(2),id(1),id(80),id(82),id(81)]);
  await db.query("INSERT INTO agent_connection_grants(id,business_id,user_id,client_id,provider,role_at_consent,scopes,enabled) VALUES($1,$2,$3,'fixture-client','CHATGPT','MAIN_ADMIN',ARRAY['departures:read','availability:read','attention:read'],true),($4,$5,$6,'other-fixture','MUSE','MAIN_ADMIN',ARRAY['departures:read'],false)", [id(3),id(1),id(2),id(83),id(81),id(82)]);
  await db.query("INSERT INTO tours(id,business_id,name,base_price_per_person,default_capacity) VALUES($1,$2,'A fixture',100,10),($3,$4,'B fixture',100,10)", [id(5),id(1),id(85),id(81)]);
  await db.query("INSERT INTO slots(id,business_id,tour_id,start_time,capacity_total,booked,held) VALUES($1,$2,$3,now()+interval '1 day',10,4,3),($4,$5,$6,now()+interval '1 day',10,1,0)", [id(4),id(1),id(5),id(84),id(81),id(85)]);

  await check('local schema fixture matches the executed SQL candidate', async () => {
    const expected = JSON.parse(readFileSync('tests/fixtures/agent-columns.local.json','utf8')).agent_connection_grants;
    const actual = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_connection_grants'")).rows.map(row=>row.column_name);
    assert.deepEqual(actual.sort(),expected.sort());
    const fn = (await db.query("SELECT prosecdef FROM pg_proc WHERE oid='public.agent_read_observed_at(uuid,uuid,text)'::regprocedure")).rows[0];
    assert.equal(fn.prosecdef,false);
    const aggregate = (await db.query("SELECT prosecdef,provolatile FROM pg_proc WHERE oid='public.agent_departure_waiver_counts(uuid,uuid,uuid)'::regprocedure")).rows[0];
    assert.equal(aggregate.prosecdef,false); assert.equal(aggregate.provolatile,'s');
  });
  await check('valid same-business MAIN_ADMIN grant returns a database observation timestamp', () => as('authenticated',claims,async () => {
    const at = (await clock()).rows[0].at;
    assert(at instanceof Date && Math.abs(Date.now()-at.valueOf()) < 5000);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agent_connection_grants')).rows[0].n,1);
  }));
  await check('new grants default to disabled with exactly 168 hours of authorisation', async () => {
    const result = await db.query("INSERT INTO agent_connection_grants(business_id,user_id,client_id,provider,role_at_consent,scopes) VALUES($1,$2,'default-fixture','CHATGPT','MAIN_ADMIN',ARRAY['departures:read']) RETURNING id,enabled,extract(epoch from (expires_at-created_at)) AS seconds", [id(1),id(2)]);
    try {
      assert.equal(result.rows[0].enabled,false);
      assert.equal(Number(result.rows[0].seconds),604800);
    } finally { await db.query('DELETE FROM agent_connection_grants WHERE id=$1', [result.rows[0].id]); }
  });
  for (const [name, created, expires] of [
    ['over seven days by one microsecond','now()',"now()+interval '168 hours 1 microsecond'"],
    ['zero lifetime','now()','now()'],
    ['negative lifetime','now()',"now()-interval '1 second'"],
    ['non-finite lifetime',"'infinity'::timestamptz","'infinity'::timestamptz"],
  ]) await check('grant constraint rejects ' + name, () => assert.rejects(db.query(
    'INSERT INTO agent_connection_grants(business_id,user_id,client_id,provider,role_at_consent,scopes,created_at,expires_at) SELECT business_id,user_id,client_id,provider,role_at_consent,scopes,' + created + ',' + expires + ' FROM agent_connection_grants WHERE id=$1', [id(3)]), (error) => error.code === '23514'));
  for (const changes of [
    "expires_at=expires_at-interval '1 hour'",
    "created_at=created_at+interval '1 second'",
    "created_at=created_at+interval '1 day',expires_at=expires_at+interval '1 day'",
  ]) await check('existing grant lifetime cannot change: ' + changes, () => assert.rejects(
    db.query('UPDATE agent_connection_grants SET ' + changes + ' WHERE id=$1', [id(3)]), (error) => error.code === '23514'));
  for (const [name, created, expires] of [
    ['expiry boundary',"now()-interval '168 hours'",'now()'],
    ['future consent',"now()+interval '1 hour'","now()+interval '169 hours'"],
  ]) await check('rejects ' + name + ' despite a valid fixture token', async () => {
    await db.query('INSERT INTO agent_connection_grants(id,business_id,user_id,client_id,provider,role_at_consent,scopes,enabled,created_at,expires_at) SELECT $1,business_id,user_id,client_id,provider,role_at_consent,scopes,true,' + created + ',' + expires + ' FROM agent_connection_grants WHERE id=$2', [id(30),id(3)]);
    try { await denied('authenticated',{...claims,agent_grant_id:id(30)},id(1),id(30)); }
    finally { await db.query('DELETE FROM agent_connection_grants WHERE id=$1', [id(30)]); }
  });
  for (const role of ['OPERATOR','ADMIN','SUPER_ADMIN','GUIDE']) {
    await check('grant constraint rejects non-owner consent role ' + role, () =>
      assert.rejects(db.query('UPDATE agent_connection_grants SET role_at_consent=$1 WHERE id=$2', [role,id(3)]), (error) => error.code === '23514'));
    await check('non-owner ' + role + ' loses grant visibility and observation access', async () => {
      await db.query('UPDATE admin_users SET role=$1 WHERE id=$2', [role,id(10)]);
      try {
        await as('authenticated',claims,async () => {
          assert.equal((await db.query('SELECT count(*)::int AS n FROM agent_connection_grants')).rows[0].n,0);
        });
        await denied();
      } finally { await db.query("UPDATE admin_users SET role='MAIN_ADMIN' WHERE id=$1", [id(10)]); }
    });
  }
  for (const [name, tokenClaims] of [
    ['ordinary session',{ role:'authenticated',sub:id(2) }],
    ['expired token',{ ...claims,exp:1 }],
    ['wrong client',{ ...claims,client_id:'wrong' }],
    ['wrong resource',{ ...claims,agent_resource:'wrong' }],
    ['missing scope',{ ...claims,scope:'departures:read' }],
    ['different user',{ ...claims,sub:id(82) }],
  ]) await check('rejects ' + name, () => denied('authenticated',tokenClaims));
  await check('anonymous and service-role calls cannot invoke the clock', async () => {
    await denied('anon',{ role:'anon' }); await denied('service_role',{ ...claims,role:'service_role' });
  });
  await check('foreign business, grant and unsupported scope are rejected', async () => {
    await denied('authenticated',claims,id(81));
    await denied('authenticated',claims,id(1),id(83));
    await denied('authenticated',claims,id(1),id(3),'refunds:write');
  });
  for (const [name, sql, reset] of [
    ['disabled grant',"UPDATE agent_connection_grants SET enabled=false WHERE id=$1","UPDATE agent_connection_grants SET enabled=true WHERE id=$1"],
    ['disconnected grant',"UPDATE agent_connection_grants SET disconnected_at=now() WHERE id=$1","UPDATE agent_connection_grants SET disconnected_at=null WHERE id=$1"],
    ['revoked scope',"UPDATE agent_connection_grants SET scopes=ARRAY['departures:read'] WHERE id=$1","UPDATE agent_connection_grants SET scopes=ARRAY['departures:read','availability:read','attention:read'] WHERE id=$1"],
  ]) await check('rejects ' + name, async () => { await db.query(sql,[id(3)]); try { await denied(); } finally { await db.query(reset,[id(3)]); } });
  for (const [name, sql, reset] of [
    ['suspended member',"UPDATE admin_users SET suspended=true WHERE id=$1","UPDATE admin_users SET suspended=false WHERE id=$1"],
    ['removed membership',"UPDATE admin_users SET user_id=null WHERE id=$1","UPDATE admin_users SET user_id='"+id(2)+"' WHERE id=$1"],
  ]) await check('rejects ' + name, async () => { await db.query(sql,[id(10)]); try { await denied(); } finally { await db.query(reset,[id(10)]); } });
  await check('paused business cannot read', async () => {
    await db.query("UPDATE businesses SET subscription_status='PAUSED' WHERE id=$1",[id(1)]);
    try { await denied(); } finally { await db.query("UPDATE businesses SET subscription_status='ACTIVE' WHERE id=$1",[id(1)]); }
  });
  for (const sql of [
    "INSERT INTO agent_connection_grants(business_id,user_id,client_id,provider,role_at_consent,scopes,expires_at) VALUES('"+id(1)+"','"+id(2)+"','forged','CHATGPT','MAIN_ADMIN',ARRAY['departures:read'],now())",
    'UPDATE agent_connection_grants SET enabled=true', 'DELETE FROM agent_connection_grants',
  ]) await check('authenticated grant mutation denied: ' + sql.split(' ')[0], () => as('authenticated',claims,() => assert.rejects(db.query(sql),error=>error.code==='42501')));
  await check('canonical capacity includes held seats, respects RLS and creates no hold', () => as('authenticated',claims,async () => {
    const before = (await db.query('SELECT count(*)::int AS n FROM holds')).rows[0].n;
    assert.equal((await db.query('SELECT slot_available_capacity($1) AS n',[id(4)])).rows[0].n,3);
    assert.equal((await db.query('SELECT slot_available_capacity($1) AS n',[id(84)])).rows[0].n,null);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM holds')).rows[0].n,before);
  }));
  for (const [name,rows,count,reason] of [
    ['three pending people',[{qty:3,waiver:'PENDING',payload:{},signedAt:null,signedName:null}],3,null],
    ['three recorded acceptances',[{qty:3,payload:{...signedPayload,participants:[participant,participant,participant]}}],0,null],
    ['one of three explicitly unaccepted',[{qty:3,payload:{...signedPayload,participants:[participant,{...participant,accepts_liability:false},participant]}}],1,null],
    ['legacy group signature',[{qty:3,payload:{accept_risk:true,date_of_birth:'1990-01-01',guardian_consent:true}}],null,'missing_or_unknown_data'],
    ['legacy single-person signature',[{payload:{accept_risk:true}}],null,'missing_or_unknown_data'],
    ['participant array shorter than quantity',[{qty:2}],null,'missing_or_unknown_data'],
    ['participant array longer than quantity',[{payload:{...signedPayload,participants:[participant,participant]}}],null,'missing_or_unknown_data'],
    ['missing acceptance flag',[{payload:{...signedPayload,participants:[{name:'Synthetic guest',dob:'1990-01-01'}]}}],null,'missing_or_unknown_data'],
    ['string acceptance flag',[{payload:{...signedPayload,participants:[{...participant,accepts_liability:'true'}]}}],null,'missing_or_unknown_data'],
    ['missing guest name',[{payload:{...signedPayload,participants:[{...participant,name:' '}]}}],null,'missing_or_unknown_data'],
    ['invalid calendar birthday',[{payload:{...signedPayload,participants:[{...participant,dob:'2001-02-29'}]}}],null,'missing_or_unknown_data'],
    ['future birthday',[{payload:{...signedPayload,participants:[{...participant,dob:'2027-01-01'}]}}],null,'missing_or_unknown_data'],
    ['non-ISO birthday',[{payload:{...signedPayload,participants:[{...participant,dob:'01/01/1990'}]}}],null,'missing_or_unknown_data'],
    ['missing risk acceptance',[{payload:{participants:[participant]}}],null,'missing_or_unknown_data'],
    ['missing signing timestamp',[{signedAt:null}],null,'missing_or_unknown_data'],
    ['future signing timestamp',[{signedAt:'2999-01-01T00:00:00Z'}],null,'missing_or_unknown_data'],
    ['infinite signing timestamp',[{signedAt:'infinity'}],null,'missing_or_unknown_data'],
    ['missing signer name',[{signedName:' '}],null,'missing_or_unknown_data'],
    ['minor without guardian evidence',[{payload:{...signedPayload,participants:[{...participant,dob:'2014-04-15'}]}}],null,'missing_or_unknown_data'],
    ['minor with recorded countersignature',[{payload:{accept_risk:true,participants:[{...participant,dob:'2014-04-15'}],guardian_consent:true,
      guardian_name:'Synthetic guardian',guardian_id_number:'fixture-not-real-id',guardian_signature:'Synthetic guardian'}}],0,null],
    ['minor with missing guardian signature',[{payload:{accept_risk:true,participants:[{...participant,dob:'2014-04-15'}],guardian_consent:true,
      guardian_name:'Synthetic guardian',guardian_id_number:'fixture-not-real-id'}}],null,'missing_or_unknown_data'],
    ['birthday turning eighteen at signing',[{payload:{...signedPayload,participants:[{...participant,dob:'2008-10-02'}]}}],0,null],
    ['still a minor when signing, even if now adult',[{payload:{...signedPayload,participants:[{...participant,dob:'2008-10-03'}]}}],null,'missing_or_unknown_data'],
    ['leap birthday still under eighteen on February 28',[{signedAt:'2026-02-28T12:00:00Z',payload:{...signedPayload,participants:[{...participant,dob:'2008-02-29'}]}}],null,'missing_or_unknown_data'],
    ['leap birthday eighteen on March 1',[{signedAt:'2026-03-01T12:00:00Z',payload:{...signedPayload,participants:[{...participant,dob:'2008-02-29'}]}}],0,null],
    ['invalid quantity',[{qty:0}],null,'missing_or_unknown_data'],
    ['per-booking read ceiling',[{qty:1001,waiver:'PENDING'}],null,'incomplete_or_query_limit'],
    ['oversized payload',[{payload:{...signedPayload,notes:'x'.repeat(65536)}}],null,'missing_or_unknown_data'],
    ['cancelled and expired bookings excluded',[{qty:3,waiver:'PENDING'},{status:'CANCELLED',payload:{}},{status:'EXPIRED',payload:{}}],3,null],
    ['foreign business and other departure excluded',[{qty:2,waiver:'PENDING'},{business:id(81),tour:id(85),slot:id(84),payload:{}}],2,null],
    ['empty complete set',[],0,null],
    ['501-row ceiling',Array.from({length:501},()=>({waiver:'PENDING'})),null,'incomplete_or_query_limit'],
  ]) await check('per-person aggregate: '+name, async () => {
    await seedWaivers(rows);
    await as('authenticated',claims,async () => {
      assert.deepEqual((await waiverCounts()).rows[0].result,{outstanding_waiver_participants:count,reason});
    });
  });
  await seedWaivers([{qty:2,waiver:'PENDING'}]);
  await check('aggregate enforces grant, tenant and scope checks independently of the service', async () => {
    for (const tokenClaims of [{role:'authenticated',sub:id(2)}, {...claims,exp:1}, {...claims,client_id:'wrong'},
      {...claims,agent_resource:'wrong'}, {...claims,scope:'departures:read'}, {...claims,sub:id(82)}]) {
      await as('authenticated',tokenClaims,()=>assert.rejects(waiverCounts(),(error)=>error.code==='42501'));
    }
    for (const args of [[id(81),id(84),id(3)],[id(1),id(84),id(3)],[id(1),null,id(3)],[id(1),id(4),id(83)]]) {
      await as('authenticated',claims,()=>assert.rejects(waiverCounts(...args),(error)=>error.code==='42501'));
    }
    for (const role of ['anon','service_role']) await as(role,{...claims,role},()=>assert.rejects(waiverCounts(),(error)=>error.code==='42501'));
  });
  await check('aggregate denies owner demotion, suspension and disconnected consent', async () => {
    for (const [table,changes,reset,key] of [
      ['admin_users',"role='ADMIN'","role='MAIN_ADMIN'",id(10)],
      ['admin_users','suspended=true','suspended=false',id(10)],
      ['agent_connection_grants','disconnected_at=now()','disconnected_at=null',id(3)],
    ]) {
      await db.query('UPDATE '+table+' SET '+changes+' WHERE id=$1',[key]);
      try { await as('authenticated',claims,()=>assert.rejects(waiverCounts(),(error)=>error.code==='42501')); }
      finally { await db.query('UPDATE '+table+' SET '+reset+' WHERE id=$1',[key]); }
    }
  });
  await check('aggregate cannot confirm signed people with an invalid business zone', async () => {
    await seedWaivers([{}]);
    await db.query("UPDATE businesses SET timezone='Invalid/Fixture' WHERE id=$1",[id(1)]);
    try {
      await as('authenticated',claims,async () => assert.deepEqual((await waiverCounts()).rows[0].result,
        {outstanding_waiver_participants:null,reason:'missing_or_unknown_data'}));
    } finally { await db.query("UPDATE businesses SET timezone='Africa/Johannesburg' WHERE id=$1",[id(1)]); }
  });
  await check('aggregate works in a read-only transaction and returns no private fields', async () => {
    const snapshot = async () => (await db.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM bookings b) AS bookings,
      (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM agent_connection_grants g) AS grants,
      (SELECT count(*) FROM holds) AS holds`)).rows[0];
    const before = await snapshot();
    await as('authenticated',claims,async () => {
      await db.query('SET TRANSACTION READ ONLY');
      const result = (await waiverCounts()).rows[0].result;
      assert.deepEqual(Object.keys(result).sort(),['outstanding_waiver_participants','reason']);
      assert.equal(result.outstanding_waiver_participants,0);
    });
    assert.deepEqual(await snapshot(),before);
  });
  await db.query(`INSERT INTO pending_reschedules(id,booking_id,business_id,old_slot_id,new_slot_id,diff,new_unit_price,new_total_amount,status)
    VALUES($1,$2,$3,$4,$5,200,100,1000,'PENDING'),($6,$2,$3,$5,$4,200,100,1000,'PENDING'),
      ($7,$2,$8,$4,$4,200,100,1000,'PENDING'),($9,$2,$3,$4,$4,200,100,1000,'COMPLETED')`,
    [id(61),id(60),id(1),id(4),id(6),id(62),id(63),id(81),id(64)]);
  await check('pending upgrade coverage checks both departures under existing RLS', () => as('authenticated',claims,async () => {
    for (const column of ['old_slot_id','new_slot_id']) {
      const count = await db.query(`SELECT count(*)::int AS n FROM pending_reschedules
        WHERE business_id=$1 AND status='PENDING' AND ${column}=$2`,[id(1),id(4)]);
      assert.equal(count.rows[0].n,1);
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM pending_reschedules WHERE business_id=$1',[id(81)])).rows[0].n,0);
  }));
  await check('pending upgrade coverage reads have no booking or payment side effects', async () => {
    const snapshot = async () => (await db.query(`SELECT
      (SELECT count(*) FROM bookings) AS bookings,(SELECT count(*) FROM holds) AS holds,
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM pending_reschedules p) AS pending`)).rows[0];
    const before = await snapshot();
    await as('authenticated',claims,() => db.query("SELECT count(*) FROM pending_reschedules WHERE business_id=$1 AND status='PENDING' AND old_slot_id=$2",[id(1),id(4)]));
    assert.deepEqual(await snapshot(),before);
  });
  console.log(`${passed} labelled local PostgreSQL checks passed; no provider/platform tests performed.`);
} finally {
  await db.end();
  if (created) await admin.query('DROP DATABASE ' + database + ' WITH (FORCE)');
  await admin.end();
}
