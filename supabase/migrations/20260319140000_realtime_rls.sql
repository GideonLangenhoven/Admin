-- Ensure RLS is enabled on chat_messages so Realtime payloads are
-- restricted to the authenticated user's business. Without this,
-- a Realtime subscription could leak messages across tenants.

ALTER TABLE IF EXISTS public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Allow service-role full access (Edge Functions use the service key).
-- Authenticated users (admin dashboard) can only see their own business rows.

DO $$
BEGIN
  -- Drop existing policies if they exist to make migration idempotent
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chat_messages' AND policyname = 'chat_messages_service_all') THEN
    DROP POLICY chat_messages_service_all ON public.chat_messages;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chat_messages' AND policyname = 'chat_messages_select_own_business') THEN
    DROP POLICY chat_messages_select_own_business ON public.chat_messages;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chat_messages' AND policyname = 'chat_messages_insert_own_business') THEN
    DROP POLICY chat_messages_insert_own_business ON public.chat_messages;
  END IF;
END $$;

-- Service role bypass (for Edge Functions)
CREATE POLICY chat_messages_service_all
  ON public.chat_messages
  FOR ALL
  USING (auth.role() = 'service_role');

-- Authenticated users can SELECT only their business's messages.
-- The admin's business_id is looked up from admin_users by their auth.uid().
CREATE POLICY chat_messages_select_own_business
  ON public.chat_messages
  FOR SELECT
  USING (
    business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  );

-- Authenticated users can INSERT only into their business's messages.
CREATE POLICY chat_messages_insert_own_business
  ON public.chat_messages
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  );
