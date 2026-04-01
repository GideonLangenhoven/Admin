-- Marketing Engine v3 fixes: phone column, RLS policies, atomic counter RPCs

---------------------------------------------------------------------------
-- 1. Add phone column to marketing_contacts
---------------------------------------------------------------------------
ALTER TABLE public.marketing_contacts ADD COLUMN IF NOT EXISTS phone text;

---------------------------------------------------------------------------
-- 2. Add missing INSERT/UPDATE/DELETE RLS policies on marketing_queue
---------------------------------------------------------------------------
CREATE POLICY IF NOT EXISTS marketing_queue_insert_own
  ON public.marketing_queue FOR INSERT
  WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY IF NOT EXISTS marketing_queue_update_own
  ON public.marketing_queue FOR UPDATE
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

---------------------------------------------------------------------------
-- 3. Add INSERT policy on marketing_events for service_role (already exists)
--    and marketing_unsubscribe_tokens (already exists via service policy)
---------------------------------------------------------------------------
-- Already covered by the service_role ALL policies.

---------------------------------------------------------------------------
-- 4. Atomic counter increment RPCs to prevent race conditions
---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_campaign_counter(
  p_campaign_id uuid,
  p_column text,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  -- Only allow known counter columns to prevent SQL injection
  IF p_column NOT IN ('total_sent', 'total_failed', 'total_opens', 'total_clicks', 'total_unsubscribes', 'total_bounces') THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE public.marketing_campaigns SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_column, p_column
  ) USING p_amount, p_campaign_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_campaign_counter TO service_role;

CREATE OR REPLACE FUNCTION public.increment_contact_counter(
  p_contact_id uuid,
  p_column text,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  IF p_column NOT IN ('total_received', 'total_opens', 'total_clicks') THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE public.marketing_contacts SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_column, p_column
  ) USING p_amount, p_contact_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_contact_counter TO service_role;

---------------------------------------------------------------------------
-- 5. Fix storage policy to scope by business_id path
---------------------------------------------------------------------------
DROP POLICY IF EXISTS marketing_assets_insert ON storage.objects;
DROP POLICY IF EXISTS marketing_assets_delete ON storage.objects;

CREATE POLICY marketing_assets_insert
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'marketing-assets'
    AND (
      auth.role() = 'service_role'
      OR (
        auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] IN (
          SELECT au.business_id::text FROM public.admin_users au WHERE au.id = auth.uid()
        )
      )
    )
  );

CREATE POLICY marketing_assets_delete
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'marketing-assets'
    AND (
      auth.role() = 'service_role'
      OR (
        auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] IN (
          SELECT au.business_id::text FROM public.admin_users au WHERE au.id = auth.uid()
        )
      )
    )
  );
