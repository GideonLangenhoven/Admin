import assert from 'node:assert/strict';
import pg from 'pg';

// Called only by the disposable local database runner. All data is synthetic.
export async function checkPaymentFlows({ db, connection, database, check, id }) {
  const tour = id(900000);
  await db.query("insert into tours(id,business_id,name,base_price_per_person,default_capacity) values($1,$2,'Payment fixture',100,10)", [tour,id(1)]);
  let serial = 0;
  async function seed({ cash = 60, voucher = 40, balance = 40, capacity = 1, booked = 0, held = false, ledger = true, slot: existingSlot } = {}) {
    const n = ++serial, booking = id(910000+n), slot = existingSlot || id(920000+n), credit = id(930000+n);
    if (!existingSlot) await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total,booked,held) values($1,$2,$3,now()+interval '3 days'+$4*interval '1 hour',$5,$6,$7)", [slot,id(1),tour,n,capacity,booked,held?1:0]);
    await db.query("insert into bookings(id,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,status,total_amount,voucher_amount_paid,expected_amount_cents) values($1,$2,$3,$4,'Fixture','fixture@example.invalid',1,100,'PENDING',$5,$6,$7)", [booking,id(1),tour,slot,cash,voucher,Math.round(cash*100)]);
    await db.query("insert into vouchers(id,business_id,code,current_balance,value) values($1,$2,$3,$4,$4)", [credit,id(1),'PAYTEST-'+n,balance]);
    if (ledger && voucher) await db.query('insert into voucher_reservations(voucher_id,booking_id,business_id,amount) values($1,$2,$3,$4)', [credit,booking,id(1),voucher]);
    if (held) await db.query("insert into holds(booking_id,slot_id,qty,status,expires_at) values($1,$2,1,'ACTIVE',now()+interval '15 minutes')",[booking,slot]);
    return { booking, slot, credit, cash };
  }
  async function confirm(client, f, currency = 'ZAR') {
    await client.query('begin');
    try {
      await client.query("set local role service_role");
      await client.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true),set_config('request.jwt.claim.role','',true)");
      const result = (await client.query('select confirm_booking_payment($1,$2,$3,$4) as result',[f.booking,'payment-'+f.booking,Math.round(f.cash*100),currency])).rows[0].result;
      await client.query('commit');
      return result;
    } catch (error) { await client.query('rollback'); throw error; }
  }
  async function state(f) {
    const row = (await db.query(`select b.status,b.total_captured,v.current_balance,
      s.booked,s.held,r.status as reservation_status,r.amount as reserved
      from bookings b join vouchers v on v.id=$2 join slots s on s.id=b.slot_id
      left join voucher_reservations r on r.booking_id=b.id and r.voucher_id=v.id where b.id=$1`,[f.booking,f.credit])).rows[0];
    return { ...row, total_captured: Number(row.total_captured), current_balance: Number(row.current_balance), reserved: row.reserved === null ? null : Number(row.reserved) };
  }
  const quote = async (f, promo = null, vouchers = null, extras = null) => (await db.query(
    'select prepare_booking_checkout($1,$2,$3,null,$4) as result', [f.booking,promo,vouchers,extras],
  )).rows[0].result;
  await check('immediate guest reduction saves capacity and refund request together', async () => {
    const f=await seed({cash:200,voucher:0,capacity:5,ledger:false});
    await db.query('update bookings set qty=2 where id=$1',[f.booking]);
    await confirm(db,f);
    const change=async ()=>(await db.query("select apply_booking_change($1,$2,2,200,$2,1,100,100,'REFUND') as r",[f.booking,f.slot])).rows[0].r;
    const r=await change(); assert.equal(r.ok,true); assert.equal(r.refund_status,'REQUESTED'); assert.ok(r.refund_amount>0);
    const b=(await db.query('select qty,total_amount,total_refunded,status from bookings where id=$1',[f.booking])).rows[0];
    assert.equal(b.qty,1); assert.equal(Number(b.total_amount),100); assert.equal(Number(b.total_refunded),0); assert.equal(b.status,'PAID');
    assert.equal((await state(f)).booked,1); assert.equal((await change()).ok,false);
  });
  await check('immediate voucher reduction preserves credit and never calls a cash refund', async () => {
    const f=await seed({cash:0,voucher:200,balance:200,capacity:5});
    await db.query('update bookings set qty=2,total_amount=0,checkout_priced_at=now() where id=$1',[f.booking]);
    await confirm(db,f);
    const r=(await db.query("select apply_booking_change($1,$2,2,200,$2,1,100,100,'REFUND') as r",[f.booking,f.slot])).rows[0].r;
    assert.equal(r.ok,true); assert.equal(r.voucher_amount,100); assert.equal(r.refund_amount,0);
    assert.equal(Number((await db.query('select voucher_amount_paid from bookings where id=$1',[f.booking])).rows[0].voucher_amount_paid),100);
  });
  await check('checkout retries preserve the exact request and block stale unpaid edits', async () => {
    const f=await seed({cash:100,voucher:0,ledger:false,capacity:5}); await quote(f);
    const save=async body=>(await db.query('select save_checkout_request($1,null,null,$2) as r',[f.booking,JSON.stringify({mode:'test',body})])).rows[0].r;
    const first=await save({amount:10000,successUrl:'https://fixture.invalid/first'});
    const retry=await save({amount:10000,successUrl:'https://fixture.invalid/different'});
    assert.equal(first.ok,true); assert.deepEqual(retry,first);
    const change=(await db.query('select prepare_booking_amendment($1,$2,2,100,200,100) as r',[f.booking,f.slot])).rows[0].r;
    assert.equal(change.ok,false); assert.equal((await state(f)).held,1);
  });
  await check('manual payment retry accounts seats once and leaves unpaid extra seats held', async () => {
    const f=await seed({cash:100,voucher:0,ledger:false,capacity:5});
    const pay=async ()=>(await db.query("select account_manual_booking($1,$2,true,'Cash') as r",[f.booking,id(1)])).rows[0].r;
    assert.equal((await pay()).ok,true); assert.equal((await pay()).already_paid,true); assert.equal((await state(f)).booked,1);
    assert.equal((await db.query('select prepare_booking_amendment($1,$2,2,100,200,100) as r',[f.booking,f.slot])).rows[0].r.ok,true);
    assert.equal((await pay()).ok,true); assert.equal((await state(f)).held,1); assert.equal((await state(f)).booked,1);
  });
  await check('payment for a cancelled reservation is recorded once for refund', async () => {
    const f=await seed({cash:100,voucher:0,ledger:false,held:true});
    await db.query("update bookings set yoco_checkout_id='late-checkout' where id=$1",[f.booking]);
    const record=async ()=>(await db.query("select record_unfulfilled_payment($1,'late-payment','late-checkout',10000,null) as r",[f.booking])).rows[0].r;
    assert.equal((await record()).ok,true); assert.equal((await record()).ok,true);
    const b=(await db.query('select status,total_captured,refund_status from bookings where id=$1',[f.booking])).rows[0];
    assert.equal(b.status,'CANCELLED'); assert.equal(Number(b.total_captured),100); assert.equal(b.refund_status,'REQUESTED'); assert.equal((await state(f)).held,0);
  });
  await check('refund reservation never invents cash for a legacy zero capture', async () => {
    const f=await seed({cash:100,voucher:0,ledger:false,capacity:5});
    await db.query("update bookings set status='PAID',total_captured=0 where id=$1",[f.booking]);
    const sources=JSON.stringify([{checkout_id:'fixture-checkout',captured:100,business_id:id(1)}]);
    const r=(await db.query('select reserve_refund_request($1,$2,100,$3,false) as r',[f.booking,id(1),sources])).rows[0].r;
    assert.equal(r.ok,false);
    assert.equal(Number((await db.query('select count(*) from refund_operations where booking_id=$1',[f.booking])).rows[0].count),0);
    assert.equal((await state(f)).total_captured,0);
  });
  for (const voucher of [0,40,100]) await check('zeroed storefront prices are restored with voucher credit '+voucher, async () => {
    const f=await seed({cash:0,voucher:0,balance:200,ledger:false});
    await db.query('update bookings set unit_price=0 where id=$1',[f.booking]);
    const result=await quote(f,null,voucher?[f.credit]:null);
    // The selected voucher contributes up to the full price, not a browser-written amount.
    assert.equal(result.ok,true); assert.equal(result.amount,voucher?0:100);
    const stored=(await db.query('select unit_price,original_total,total_amount,voucher_amount_paid from bookings where id=$1',[f.booking])).rows[0];
    assert.equal(Number(stored.unit_price),100); assert.equal(Number(stored.original_total),100);
    assert.equal(Number(stored.total_amount),result.amount);
    assert.equal(Number(stored.voucher_amount_paid),voucher?100:0);
    await quote(f,null,voucher?[f.credit]:null);
    assert.equal(Number((await state(f)).held),1);
  });
  await check('partial voucher checkout captures only cash and settles credit exactly once', async () => {
    const f=await seed({cash:0,voucher:0,balance:40,ledger:false});
    assert.equal((await quote(f,null,[f.credit])).amount,60);
    f.cash=60;
    assert.equal((await confirm(db,f)).ok,true);
    assert.equal((await state(f)).total_captured,60);
    assert.equal((await state(f)).current_balance,0);
  });
  for (const percent of [20,100]) await check('promotion '+percent+' percent is priced once and survives checkout retries', async () => {
    const f=await seed({cash:0,voucher:0,ledger:false});
    const promo=id(950000+percent),code='QUOTE-'+percent;
    await db.query("insert into promotions(id,business_id,code,discount_type,discount_value,max_uses) values($1,$2,$3,'PERCENT',$4,1)",[promo,id(1),code,percent]);
    assert.equal((await quote(f,code)).amount,100-percent);
    assert.equal((await quote(f,code)).amount,100-percent);
    assert.equal((await db.query('select used_count from promotions where id=$1',[promo])).rows[0].used_count,1);
    f.cash=100-percent;
    assert.equal((await confirm(db,f)).ok,true);
    assert.equal((await state(f)).status,'PAID');
    assert.equal((await state(f)).booked,1);
  });
  await check('extras use operator prices and retries replace line items', async () => {
    const f=await seed({cash:0,voucher:0,ledger:false});
    const extra=id(960001);
    await db.query("insert into add_ons(id,business_id,name,price) values($1,$2,'Photo',25)",[extra,id(1)]);
    const extras=JSON.stringify([{id:extra,qty:2,unit_price:1}]);
    assert.equal((await quote(f,null,null,extras)).amount,150);
    assert.equal((await quote(f,null,null,extras)).amount,150);
    assert.equal((await db.query('select count(*)::int as n from booking_add_ons where booking_id=$1',[f.booking])).rows[0].n,1);
  });
  await check('foreign vouchers roll back the quote and its seat reservation', async () => {
    const f=await seed({cash:0,voucher:0,ledger:false});
    await db.query('update vouchers set business_id=$1 where id=$2',[id(2),f.credit]);
    const before=await state(f);
    assert.equal((await quote(f,null,[f.credit])).ok,false);
    assert.deepEqual(await state(f),before);
  });
  await check('unpriced zero-value bookings cannot bypass payment', async () => {
    const f=await seed({cash:0,voucher:0,ledger:false});
    assert.equal((await confirm(db,f)).error,'invalid_amount');
    assert.equal((await state(f)).status,'PENDING');
  });
  for (const reschedule of [false,true]) await check((reschedule?'paid reschedule':'paid guest increase')+' commits once, preserves credit and keeps the original checkout', async () => {
    const f=await seed({capacity:5});
    await confirm(db,f);
    await db.query("update bookings set yoco_checkout_id='original-checkout',waiver_status='SIGNED' where id=$1",[f.booking]);
    let target=f.slot;
    if (reschedule) {
      target=id(970001);
      await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total,booked,held) values($1,$2,$3,now()+interval '4 days',5,0,0)",[target,id(1),tour]);
    }
    const qty=reschedule?1:2, diff=reschedule?50:100, total=reschedule?150:200;
    const prepare=async ()=>(await db.query('select prepare_booking_amendment($1,$2,$3,$4,$5,$6) as r',[f.booking,target,qty,reschedule?150:100,total,diff])).rows[0].r;
    const change=await prepare(); assert.equal(change.ok,true);
    assert.equal((await prepare()).hold_id,change.hold_id);
    const stamp=JSON.stringify({yoco_checkout_id:'uplift-checkout',expected_amount_cents:diff*100,expected_currency:'ZAR'});
    await db.query("update holds set metadata=metadata || $2::jsonb where id=$1",[change.hold_id,stamp]);
    if(reschedule) await db.query("update pending_reschedules set yoco_checkout_id='uplift-checkout' where id=$1",[change.pending_reschedule_id]);
    const settle=async currency=>(await db.query('select confirm_booking_uplift($1,$2,$3,$4,$5,$6,$7,$8) as r',[
      f.booking,'uplift-payment','uplift-checkout',diff*100,currency,change.hold_id,change.pending_reschedule_id,reschedule?null:qty,
    ])).rows[0].r;
    assert.equal((await settle('USD')).error,'amount_mismatch');
    assert.equal((await settle('ZAR')).ok,true);
    assert.equal((await settle('ZAR')).already_paid,true);
    const b=(await db.query('select * from bookings where id=$1',[f.booking])).rows[0];
    assert.equal(b.qty,qty); assert.equal(b.slot_id,target);
    assert.equal(Number(b.voucher_amount_paid),40); assert.equal(Number(b.total_amount),total-40);
    assert.equal(Number(b.total_captured),60+diff); assert.equal(b.yoco_checkout_id,'original-checkout');
    if(!reschedule) assert.equal(b.waiver_status,'PENDING');
    const slots=(await db.query('select id,booked,held from slots where id=any($1)',[[f.slot,target]])).rows;
    for(const slot of slots) { assert.equal(slot.held,0); assert.equal(slot.booked,slot.id===target?qty:0); }
  });
  for (const paid of [false,true]) await check('cancelling '+(paid?'paid':'pending')+' bookings preserves unrelated capacity and is repeatable', async () => {
    const f=await seed({capacity:5,booked:1,held:true});
    if(paid) await confirm(db,f);
    const cancel=async ()=>(await db.query("select cancel_booking_transaction($1,$2,'Fixture cancellation',true,false) as r",[f.booking,id(1)])).rows[0].r;
    const result=await cancel(); assert.equal(result.ok,true);
    assert.equal(result.refund_action_required,paid);
    assert.equal((await state(f)).booked,1); assert.equal((await state(f)).held,0);
    assert.equal((await cancel()).already_cancelled,true);
    assert.equal((await state(f)).booked,1);
  });
  await check('weather cancellation preserves full voucher-funded compensation', async () => {
    const f=await seed({cash:0,voucher:0,balance:100,ledger:false});
    assert.equal((await quote(f,null,[f.credit])).amount,0);
    assert.equal((await confirm(db,f)).ok,true);
    const cancelled=(await db.query("select cancel_booking_transaction($1,$2,'Weather',true,true) as r",[f.booking,id(1)])).rows[0].r;
    assert.equal(cancelled.refund_action_required,true); assert.equal(cancelled.refund_amount,100);
  });
  for (const reschedule of [false,true]) await check('unpaid '+(reschedule?'reschedule':'guest increase')+' expires despite the original payment', async () => {
    const f=await seed({capacity:5}); await confirm(db,f);
    let target=f.slot;
    if(reschedule) {
      target=id(970002);
      await db.query("insert into slots(id,business_id,tour_id,start_time,capacity_total,booked,held) values($1,$2,$3,now()+interval '5 days',5,0,0)",[target,id(1),tour]);
    }
    const prepared=(await db.query('select prepare_booking_amendment($1,$2,$3,$4,$5,$6) as r',[f.booking,target,reschedule?1:2,reschedule?150:100,reschedule?150:200,reschedule?50:100])).rows[0].r;
    assert.equal(prepared.ok,true);
    await db.query("update holds set expires_at=now()-interval '6 minutes' where id=$1",[prepared.hold_id]);
    const expire=async ()=>(await db.query('select expire_single_hold($1) as r',[prepared.hold_id])).rows[0].r;
    assert.equal((await expire()).expired,true); assert.equal((await expire()).already,'EXPIRED');
    const slot=(await db.query('select booked,held from slots where id=$1',[target])).rows[0];
    assert.equal(slot.held,0); assert.equal(slot.booked,reschedule?0:1);
    assert.equal((await state(f)).status,'PAID');
    if(reschedule) assert.equal((await db.query('select status from pending_reschedules where id=$1',[prepared.pending_reschedule_id])).rows[0].status,'EXPIRED');
  });
  await check('refund requests split across original and upgrade payments and retain pending funds', async () => {
    const f=await seed({cash:100,voucher:0}); await confirm(db,f);
    const sources=JSON.stringify([{checkout_id:'initial-refund',captured:40,mode:'test'},{checkout_id:'upgrade-refund',captured:60,mode:'test'}]);
    const reserve=async amount=>(await db.query('select reserve_refund_request($1,$2,$3,$4,false) as r',[f.booking,id(1),amount,sources])).rows[0].r;
    const first=await reserve(70); assert.equal(first.ok,true);
    assert.deepEqual(first.operations.map(op=>Number(op.amount)),[40,30]);
    assert.equal((await reserve(70)).request_id,first.request_id);
    const refunded=async ()=>(await db.query('select total_refunded,refund_status,status from bookings where id=$1',[f.booking])).rows[0];
    assert.equal(Number((await refunded()).total_refunded),70);
    await db.query("select finish_refund_operation($1,'PENDING','provider-pending',null)",[first.operations[1].id]);
    assert.equal(Number((await refunded()).total_refunded),70);
    await db.query("select finish_refund_operation($1,'SUCCEEDED','provider-ok',null)",[first.operations[0].id]);
    await db.query("select finish_refund_operation($1,'FAILED','provider-pending','Declined')",[first.operations[1].id]);
    assert.equal(Number((await refunded()).total_refunded),40);
    await db.query("select finish_refund_operation($1,'FAILED','provider-pending','Repeated')",[first.operations[1].id]);
    assert.equal(Number((await refunded()).total_refunded),40);
    const retry=await reserve(60); assert.equal(retry.ok,true);
    assert.equal(retry.operations.length,1); assert.equal(retry.operations[0].checkout_id,'upgrade-refund');
    await db.query("select finish_refund_operation($1,'SUCCEEDED','provider-retry',null)",[retry.operations[0].id]);
    assert.equal(Number((await refunded()).total_refunded),100); assert.equal((await refunded()).refund_status,'REFUNDED');
    assert.equal((await reserve(60)).reused,true);
  });
  await check('partial refund preserves the active booking and its seats', async () => {
    const f=await seed({cash:100,voucher:0}); await confirm(db,f);
    const sources=JSON.stringify([{checkout_id:'partial-refund',captured:100}]);
    const result=(await db.query('select reserve_refund_request($1,$2,30,$3,true) as r',[f.booking,id(1),sources])).rows[0].r;
    assert.equal(result.ok,true);
    await db.query("select finish_refund_operation($1,'SUCCEEDED','partial-ok',null)",[result.operations[0].id]);
    assert.equal((await state(f)).status,'PAID'); assert.equal((await state(f)).booked,1);
  });
  for (const status of ['HELD','CANCELLED']) await check('storefront booking proof saves '+status+' and returns the changed row', async () => {
    const f=await seed();
    const token=(await db.query('select waiver_token from bookings where id=$1',[f.booking])).rows[0].waiver_token;
    await db.query('begin');
    try {
      await db.query('set local role anon');
      await db.query("select set_config('request.jwt.claim.role','',true),set_config('request.jwt.claims','{\"role\":\"anon\"}',true),set_config('request.method','PATCH',true),set_config('request.headers',$1,true)",
        [JSON.stringify({'x-tenant-business-id':id(1),'x-booking-id':f.booking,'x-booking-waiver-token':token})]);
      assert.equal((await db.query('update bookings set status=$1 where id=$2 returning id',[status,f.booking])).rowCount,1);
    } finally { await db.query('rollback'); }
  });
  for (const held of [false,true]) await check('payment converts ' + (held?'held':'available') + ' capacity and settles voucher once', async () => {
    const f=await seed({held});
    assert.equal((await confirm(db,f)).ok,true);
    assert.deepEqual(await state(f), {status:'PAID',total_captured:60,current_balance:0,booked:1,held:0,reservation_status:'settled',reserved:40});
    assert.equal((await confirm(db,f)).already_paid,true);
    assert.equal((await state(f)).booked,1);
  });
  for (const [label,options,error] of [
    ['insufficient voucher balance',{balance:15},'voucher_shortfall'],
    ['sold-out slot',{booked:1},'no_capacity'],
    ['missing voucher reservation',{ledger:false},'voucher_shortfall'],
  ]) await check('payment leaves every balance unchanged on '+label, async () => {
    const f=await seed(options), before=await state(f);
    assert.equal((await confirm(db,f)).error,error);
    assert.deepEqual(await state(f),before);
  });
  await check('payment rolls back earlier voucher deductions if a later voucher fails', async () => {
    const f=await seed({voucher:40,balance:20});
    await db.query('update voucher_reservations set amount=20 where booking_id=$1',[f.booking]);
    const second=id(940001);
    await db.query("insert into vouchers(id,business_id,code,current_balance,value) values($1,$2,'PAYTEST-SECOND',15,20)",[second,id(1)]);
    await db.query('insert into voucher_reservations(voucher_id,booking_id,business_id,amount) values($1,$2,$3,20)',[second,f.booking,id(1)]);
    const before=await state(f);
    assert.equal((await confirm(db,f)).error,'voucher_shortfall');
    assert.deepEqual(await state(f),before);
    assert.equal(Number((await db.query('select current_balance from vouchers where id=$1',[second])).rows[0].current_balance),15);
  });
  await check('cash-only confirmation still works and rejects the wrong currency', async () => {
    const f=await seed({cash:100,voucher:0});
    const before=await state(f);
    assert.equal((await confirm(db,f,'USD')).error,'amount_mismatch');
    assert.deepEqual(await state(f),before);
    assert.equal((await confirm(db,f)).ok,true);
  });
  await check('voucher reservation retries replace the amount and reopen released reservations', async () => {
    const f=await seed({ledger:false,balance:100});
    const reserve=async amount=>(await db.query('select reserve_voucher_amount($1,$2,$3,$4) as result',[f.credit,f.booking,id(1),amount])).rows[0].result;
    assert.equal((await reserve(30)).reserved,30);
    assert.equal((await reserve(30)).reserved,30);
    assert.equal(Number((await state(f)).reserved),30);
    assert.equal((await reserve(40)).reserved,40);
    await db.query('select release_voucher_reservations($1)',[f.booking]);
    assert.equal((await reserve(40)).reserved,40);
    assert.equal((await state(f)).reservation_status,'reserved');
    assert.equal(Number((await state(f)).reserved),40);
  });
  async function concurrent(work) {
    const clients=[new pg.Client({...connection,database}),new pg.Client({...connection,database})];
    try { await Promise.all(clients.map(c=>c.connect())); return await work(clients); }
    finally { await Promise.all(clients.map(c=>c.end())); }
  }
  await check('concurrent payment replays consume capacity and vouchers once', async () => {
    const f=await seed();
    const results=await concurrent(clients=>Promise.all(clients.map(c=>confirm(c,f))));
    assert(results.every(r=>r.ok));
    assert.equal(results.filter(r=>r.already_paid).length,1);
    assert.equal((await state(f)).booked,1);
    assert.equal(Number((await state(f)).current_balance),0);
  });
  await check('last-seat race preserves the losing booking and its voucher', async () => {
    const a=await seed(),b=await seed({slot:a.slot});
    const results=await concurrent(clients=>Promise.all([confirm(clients[0],a),confirm(clients[1],b)]));
    assert.equal(results.filter(r=>r.ok).length,1);
    assert.equal(results.filter(r=>r.error==='no_capacity').length,1);
    const loser=results[0].ok?b:a;
    assert.equal((await state(loser)).status,'PENDING');
    assert.equal(Number((await state(loser)).current_balance),40);
    assert.equal((await state(loser)).reservation_status,'reserved');
  });
  await check('concurrent checkout reservations cannot exceed available voucher credit', async () => {
    const a=await seed({balance:100,ledger:false}),b=await seed({ledger:false});
    const results=await concurrent(clients=>Promise.all([a,b].map((f,i)=>clients[i].query('select reserve_voucher_amount($1,$2,$3,80) as result',[a.credit,f.booking,id(1)]))));
    assert.equal(results.reduce((sum,r)=>sum+r.rows[0].result.reserved,0),100);
    assert.equal(Number((await db.query("select sum(amount) as amount from voucher_reservations where voucher_id=$1 and status='reserved'",[a.credit])).rows[0].amount),100);
  });
  await check('late payment cannot consume credit reserved by a newer checkout', async () => {
    const a=await seed({voucher:60,balance:100}),b=await seed({ledger:false});
    await db.query("update voucher_reservations set expires_at=now()-interval '1 minute' where booking_id=$1",[a.booking]);
    await db.query('select reserve_voucher_amount($1,$2,$3,80)',[a.credit,b.booking,id(1)]);
    const before=await state(a);
    assert.equal((await confirm(db,a)).error,'voucher_shortfall');
    assert.deepEqual(await state(a),before);
  });
}
