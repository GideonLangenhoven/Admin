-- The app uses the anon key (no Supabase Auth session), so storage
-- policies must allow anon + authenticated roles for uploads.

-- Drop previous policies
DROP POLICY IF EXISTS "email-images: public read" ON storage.objects;
DROP POLICY IF EXISTS "email-images: auth insert" ON storage.objects;
DROP POLICY IF EXISTS "email-images: auth update" ON storage.objects;
DROP POLICY IF EXISTS "email-images: auth delete" ON storage.objects;

-- SELECT: anyone can read (images must be public for emails)
CREATE POLICY "email-images: public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'email-images');

-- INSERT: anon and authenticated can upload
CREATE POLICY "email-images: upload"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'email-images');

-- UPDATE: anon and authenticated can overwrite (upsert)
CREATE POLICY "email-images: update"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'email-images')
WITH CHECK (bucket_id = 'email-images');

-- DELETE: anon and authenticated can remove
CREATE POLICY "email-images: delete"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'email-images');
