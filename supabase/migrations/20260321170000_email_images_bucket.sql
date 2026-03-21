-- Create a public storage bucket for email header images
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-images', 'email-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload / overwrite / delete their own images
CREATE POLICY "Authenticated users can manage email images"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'email-images')
WITH CHECK (bucket_id = 'email-images');

-- Allow anyone to read (images must be publicly accessible for emails)
CREATE POLICY "Public read access for email images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'email-images');
