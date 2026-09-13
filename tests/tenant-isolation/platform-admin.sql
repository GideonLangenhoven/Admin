-- Run only inside a transaction that rolls back. No customer rows are edited.
-- Use disposable invoice numbers so rehearsal does not consume live numbers.
ALTER TABLE public.platform_invoices ALTER COLUMN invoice_number SET DEFAULT 'REHEARSAL-'||gen_random_uuid()::text;
DO $$
DECLARE b uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); sa uuid:=gen_random_uuid(); owner uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid();
  request_id uuid:=gen_random_uuid(); invoice uuid; second_invoice uuid; result jsonb; repeat_result jsonb; snapshot jsonb;
BEGIN
  INSERT INTO businesses(id,name,business_name,operator_email,max_admin_seats) VALUES(b,'Release fixture A','Release fixture A',b::text||'@example.invalid',2),(other,'Release fixture B','Release fixture B',other::text||'@example.invalid',1);
  INSERT INTO admin_users(id,business_id,email,name,role,password_hash,must_set_password) VALUES
    (sa,b,sa::text||'@example.invalid','Release fixture platform','SUPER_ADMIN','',true),
    (owner,b,owner::text||'@example.invalid','Release fixture owner','MAIN_ADMIN','',true),
    (staff,b,staff::text||'@example.invalid','Release fixture staff','ADMIN','',true);
  PERFORM platform_complete_business_setup(b,sa);
  PERFORM platform_complete_business_setup(b,sa);
  ASSERT (SELECT count(*) FROM subscriptions WHERE business_id=b)=1,'Duplicate subscription';
  ASSERT (SELECT period_end IS NULL FROM subscriptions WHERE business_id=b),'Subscription unexpectedly expires';
  ASSERT EXISTS(SELECT 1 FROM policies WHERE business_id=b),'Missing policies';
  BEGIN PERFORM platform_change_seats(other,owner,1); RAISE EXCEPTION 'Cross-tenant seat change accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM platform_change_seats(b,owner,-1); RAISE EXCEPTION 'Seat underflow accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Seat underflow accepted' THEN RAISE; END IF; END;
  BEGIN PERFORM platform_suspend_admin(owner,sa,true); RAISE EXCEPTION 'Last owner suspended'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Last owner suspended' THEN RAISE; END IF; END;
  PERFORM platform_suspend_admin(staff,sa,true);
  result:=platform_change_seats(b,owner,-1);
  ASSERT (result->>'new_seats')::int=1,'Seat change failed';
  BEGIN PERFORM platform_suspend_admin(staff,sa,false); RAISE EXCEPTION 'Reactivated without seat'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Reactivated without seat' THEN RAISE; END IF; END;
  PERFORM platform_change_seats(b,owner,1);
  PERFORM platform_suspend_admin(staff,sa,false);
  ASSERT NOT (SELECT suspended FROM admin_users WHERE id=staff),'Reactivation failed';
  ASSERT (SELECT count(*) FROM billing_line_items WHERE business_id=b AND metadata->>'billing_action'='SEAT_PRORATION')=2,'Seat adjustments missing';
  PERFORM platform_change_business_status(b,owner,'PAUSED','ACTIVE');
  ASSERT (SELECT status='PAUSED' FROM subscriptions WHERE business_id=b),'Pause out of sync';
  PERFORM platform_change_business_status(b,owner,'ACTIVE','PAUSED');
  PERFORM platform_change_business_status(b,sa,'SUSPENDED','ACTIVE');
  BEGIN PERFORM platform_change_business_status(b,owner,'ACTIVE','SUSPENDED'); RAISE EXCEPTION 'Owner bypassed suspension'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM platform_change_business_status(b,sa,'ACTIVE','SUSPENDED');
  PERFORM platform_record_release_check(sa,b,'email_received',true);
  BEGIN PERFORM platform_record_release_check(owner,other,'email_received',true); RAISE EXCEPTION 'Owner wrote release checks'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  snapshot:=platform_operations_snapshot(sa);
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'clients') c WHERE c->>'id'=b::text AND (c->'checks'->>'email_received')::boolean),'Snapshot missing saved check';
  ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'clients') c WHERE c->>'id'=other::text AND coalesce((c->'checks'->>'email_received')::boolean,false)),'Checks overlap tenants';
  BEGIN PERFORM platform_operations_snapshot(owner); RAISE EXCEPTION 'Owner read global snapshot'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  result:=platform_onboard_business(sa,request_id,jsonb_build_object('business_name','Release new fixture','subdomain','fixture-'||request_id,'timezone','Africa/Johannesburg','currency','ZAR'),jsonb_build_object('name','Fixture owner','email',request_id::text||'@example.invalid'),'{}','');
  repeat_result:=platform_onboard_business(sa,request_id,jsonb_build_object('business_name','Release new fixture','subdomain','fixture-'||request_id,'timezone','Africa/Johannesburg','currency','ZAR'),jsonb_build_object('name','Fixture owner','email',request_id::text||'@example.invalid'),'{}','');
  ASSERT result->'business'->>'id'=repeat_result->'business'->>'id','Onboarding retry duplicated business';
  ASSERT EXISTS(SELECT 1 FROM subscriptions WHERE business_id=(result->'business'->>'id')::uuid),'Onboarding missed subscription';
  ASSERT EXISTS(SELECT 1 FROM policies WHERE business_id=(result->'business'->>'id')::uuid),'Onboarding missed policies';

  snapshot:=jsonb_build_object('business_id',b,'period_start','2026-09-01','period_end','2026-09-30','plan_id','standard','plan_name','Standard','monthly_price_zar',2000,'active_days',30,'total_days',30,'pro_rated',false,'amount_zar',2000,'email_overage_count',0,'email_overage_zar',0,'ai_overage_count',0,'ai_overage_zar',0);
  result:=platform_generate_invoice(sa,snapshot); invoice:=(result->>'id')::uuid;
  BEGIN PERFORM platform_generate_invoice(sa,snapshot); RAISE EXCEPTION 'Duplicate invoice accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM platform_void_invoice(invoice,sa,'Rehearsal correction');
  result:=platform_generate_invoice(sa,snapshot); second_invoice:=(result->>'id')::uuid;
  ASSERT invoice<>second_invoice,'Replacement reused old document';
  ASSERT (SELECT status='VOID' FROM platform_invoices WHERE id=invoice),'Void history lost';
  PERFORM platform_reserve_invoice_checkout(second_invoice);
  BEGIN PERFORM platform_void_invoice(second_invoice,sa,'Unsafe correction'); RAISE EXCEPTION 'Checkout invoice voided'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Checkout invoice voided' THEN RAISE; END IF; END;
  UPDATE platform_invoices SET yoco_checkout_id='fixture-checkout' WHERE id=second_invoice;
  BEGIN PERFORM platform_record_invoice_payment(second_invoice,NULL,'YOCO',NULL,'fixture-payment','wrong-checkout',200000,'ZAR'); RAISE EXCEPTION 'Wrong checkout accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Wrong checkout accepted' THEN RAISE; END IF; END;
  BEGIN PERFORM platform_record_invoice_payment(second_invoice,NULL,'YOCO',NULL,'fixture-payment','fixture-checkout',1,'ZAR'); RAISE EXCEPTION 'Wrong amount accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Wrong amount accepted' THEN RAISE; END IF; END;
  PERFORM platform_record_invoice_payment(second_invoice,NULL,'YOCO',NULL,'fixture-payment','fixture-checkout',200000,'ZAR');
  result:=platform_record_invoice_payment(second_invoice,NULL,'YOCO',NULL,'fixture-payment','fixture-checkout',200000,'ZAR');
  ASSERT (result->>'duplicate')::boolean,'Callback not idempotent';
  BEGIN PERFORM platform_void_invoice(second_invoice,sa,'Paid correction'); RAISE EXCEPTION 'Paid invoice voided'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Paid invoice voided' THEN RAISE; END IF; END;
  ASSERT (SELECT count(*) FROM audit_logs WHERE target_id=second_invoice AND action_type='PLATFORM_INVOICE_PAID')=1,'Duplicate payment audit';
  ASSERT NOT has_table_privilege('authenticated','public.client_release_checks','SELECT'),'Release checks exposed';
  ASSERT NOT has_function_privilege('authenticated','public.platform_operations_snapshot(uuid)','EXECUTE'),'Snapshot directly executable';
  ASSERT NOT has_function_privilege('anon','public.platform_record_invoice_payment(uuid,uuid,text,text,text,text,bigint,text)','EXECUTE'),'Payment RPC exposed';
END $$;
