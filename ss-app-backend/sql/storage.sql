-- ═══════════════════════════════════════════
-- Supabase Storage - Product Images Bucket
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════

-- Create the storage bucket (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to product images
CREATE POLICY "Public read product images"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- Allow service role to upload/delete
CREATE POLICY "Service upload product images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'service_role');

CREATE POLICY "Service delete product images"
ON storage.objects FOR DELETE
USING (bucket_id = 'product-images' AND auth.role() = 'service_role');
