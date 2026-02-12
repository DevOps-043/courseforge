-- Add SCORM states to artifact_state enum
ALTER TYPE artifact_state ADD VALUE IF NOT EXISTS 'SCORM_UPLOADED';
ALTER TYPE artifact_state ADD VALUE IF NOT EXISTS 'SCORM_PARSING';
ALTER TYPE artifact_state ADD VALUE IF NOT EXISTS 'SCORM_ANALYZED';
ALTER TYPE artifact_state ADD VALUE IF NOT EXISTS 'SCORM_ENRICHING';
ALTER TYPE artifact_state ADD VALUE IF NOT EXISTS 'SCORM_READY_FOR_QA';

-- Create scorm_imports table
CREATE TABLE IF NOT EXISTS scorm_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL, -- Can be null initially if artifact not created yet

  -- Original File Information
  original_filename text NOT NULL,
  storage_path text NOT NULL,           -- Path to ZIP in 'scorm-packages' bucket

  -- SCORM Metadata
  scorm_version text,                   -- '1.2' | '2004'
  manifest_raw jsonb,                   -- imsmanifest.xml parseado

  -- Extracted Structure
  organizations jsonb,                  -- Course structure
  resources jsonb,                      -- Resource mapping
  sco_count integer DEFAULT 0,

  -- Processing Status
  status text DEFAULT 'UPLOADED',       -- UPLOADED, PARSING, ANALYZED, ENRICHING, TRANSFORMING, COMPLETED, FAILED
  processing_step text,                 -- Current step description
  error_message text,

  -- Content Analysis
  content_analysis jsonb DEFAULT '{}'::jsonb, -- Result of per-lesson analysis
  detected_components jsonb DEFAULT '[]'::jsonb, -- Detected component types

  -- AI Gaps & Plan
  gaps_detected jsonb DEFAULT '[]'::jsonb,
  enrichment_plan jsonb DEFAULT '{}'::jsonb,

  -- Tracking
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id)
);

-- Enable RLS for scorm_imports
ALTER TABLE scorm_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON scorm_imports
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Enable insert access for authenticated users" ON scorm_imports
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Enable update access for creators" ON scorm_imports
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = created_by);


-- Create scorm_resources table
CREATE TABLE IF NOT EXISTS scorm_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorm_import_id uuid REFERENCES scorm_imports(id) ON DELETE CASCADE,

  -- SCORM Identifiers
  resource_identifier text NOT NULL,    -- identifier from <resource>
  scorm_type text,                      -- 'sco' | 'asset'

  -- Files
  href text,                            -- Main file
  files jsonb DEFAULT '[]'::jsonb,      -- Associated files list
  extracted_path text,                  -- Path extracted in storage

  -- Analysis Results
  content_type text,                    -- READING, VIDEO, QUIZ, DEMO_GUIDE, MIXED
  raw_html text,                        -- Main extracted HTML
  clean_text text,                      -- Clean text (stripped tags)
  word_count integer DEFAULT 0,

  -- Detected Assets
  images jsonb DEFAULT '[]'::jsonb,     -- Image URLs
  videos jsonb DEFAULT '[]'::jsonb,     -- Embedded video URLs
  documents jsonb DEFAULT '[]'::jsonb,  -- PDFs, etc.

  -- Quiz Data (if applicable)
  has_quiz boolean DEFAULT false,
  quiz_raw jsonb,                       -- Quiz in original format
  quiz_transformed jsonb,               -- Quiz in Courseforge format

  -- Mapping to Courseforge
  mapped_to_lesson_id text,             -- lesson_id in syllabus
  material_component_id uuid,           -- Generated component ID

  created_at timestamptz DEFAULT now()
);

-- Enable RLS for scorm_resources
ALTER TABLE scorm_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users" ON scorm_resources
    FOR SELECT
    TO authenticated
    USING (true);

-- Create storage bucket for SCORM packages if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('scorm-packages', 'scorm-packages', false)
ON CONFLICT (id) DO NOTHING;

-- Policy to allow authenticated users to upload SCORM packages
CREATE POLICY "Allow authenticated uploads"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'scorm-packages');

-- Policy to allow authenticated users to read SCORM packages
CREATE POLICY "Allow authenticated reads"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'scorm-packages');
