-- Allow anon to update businesses table
-- Required because the admin dashboard uses custom auth (not Supabase Auth)
-- so all queries run as anon role. Client-side role checks enforce access control.
CREATE POLICY "businesses_anon_update"
  ON public.businesses FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "businesses_anon_insert"
  ON public.businesses FOR INSERT TO anon WITH CHECK (true);
