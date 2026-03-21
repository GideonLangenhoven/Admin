-- Drop the broken ALL policies
DROP POLICY IF EXISTS "Authenticated users can manage email images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for email images" ON storage.objects;

-- SELECT: anyone can read (images must be public for emails)
CREATE POLICY "email-images: public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'email-images');

-- INSERT: authenticated users can upload
CREATE POLICY "email-images: auth insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'email-images');

-- UPDATE: authenticated users can overwrite (upsert)
CREATE POLICY "email-images: auth update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'email-images')
WITH CHECK (bucket_id = 'email-images');

-- DELETE: authenticated users can remove
CREATE POLICY "email-images: auth delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'email-images');
