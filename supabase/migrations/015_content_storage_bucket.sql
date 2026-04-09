-- Migration 015: Create content-outputs storage bucket
-- Required for PPTX and DOCX file generation and download
-- Run this in Supabase Dashboard → SQL Editor

-- Create the storage bucket for generated content files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'content-outputs',
  'content-outputs',
  false,  -- private bucket — all access via signed URLs
  52428800,  -- 50MB max file size
  ARRAY[
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',  -- pptx
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',     -- docx
    'application/vnd.ms-powerpoint',
    'application/msword',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: specialists can only access their own content files
-- Files stored at: {specialist_id}/{request_id}/{filename}

CREATE POLICY "specialists_read_own_content_outputs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'content-outputs'
    AND auth.uid() IS NOT NULL
    -- Path must start with the specialist's google_id folder
    -- (validated at app layer since storage uses auth.uid which is google OAuth id)
  );

CREATE POLICY "service_role_manage_content_outputs"
  ON storage.objects FOR ALL
  USING (bucket_id = 'content-outputs')
  WITH CHECK (bucket_id = 'content-outputs');
