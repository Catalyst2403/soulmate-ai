-- ============================================================
-- MIGRATION: Rename 'private_snaps' → 'bold_frames'
-- Run this in Supabase SQL Editor
-- ============================================================

-- STEP 0: Drop the old CHECK constraint (blocks 'bold_frames', still allows 'private_snaps')
ALTER TABLE riya_gallery DROP CONSTRAINT IF EXISTS riya_gallery_category_check;

-- STEP 1: Rename all rows BEFORE adding the new constraint
UPDATE riya_gallery
SET category = 'bold_frames'
WHERE category = 'private_snaps';

-- STEP 2 (was Step 0 part 2): NOW add the new constraint — all rows are already renamed
ALTER TABLE riya_gallery ADD CONSTRAINT riya_gallery_category_check
    CHECK (category IN (
        'morning_bed',
        'outfit_check',
        'study_grind',
        'cafe_food',
        'night_casual',
        'bold_frames',
        'generic_selfie',
        'happy',
        'angry'
    ));

-- STEP 2: Update the storage_path column (folder prefix)
UPDATE riya_gallery
SET storage_path = REPLACE(storage_path, 'private_snaps/', 'bold_frames/')
WHERE storage_path LIKE 'private_snaps/%';

-- STEP 3: Update the blur_storage_path column (if used)
UPDATE riya_gallery
SET blur_storage_path = REPLACE(blur_storage_path, 'private_snaps/', 'bold_frames/')
WHERE blur_storage_path LIKE 'private_snaps/%';

-- STEP 4: Verify the rename worked
SELECT id, filename, storage_path, blur_storage_path, category
FROM riya_gallery
WHERE category = 'bold_frames'
ORDER BY filename;

-- Expected: ~20 rows with category='bold_frames' and paths like 'bold_frames/private_01.png'

-- ============================================================
-- STEP 5 (MANUAL — Supabase Dashboard or CLI):
-- Move files in Supabase Storage bucket 'riya-images'
-- from folder: private_snaps/
-- to folder:   bold_frames/
--
-- Option A — Supabase CLI (recommended):
--   supabase storage mv --bucket riya-images private_snaps bold_frames
--
-- Option B — Supabase Dashboard:
--   Go to Storage > riya-images > private_snaps
--   Download all files, re-upload to bold_frames/ folder
--   Then delete old private_snaps/ folder
--
-- NOTE: If you do NOT move the files, the DB paths will point to
-- 'bold_frames/private_01.png' but the file still lives at
-- 'private_snaps/private_01.png' → images will break.
-- ============================================================

-- STEP 6: (Optional) Update the enum/check constraint if one exists
-- Run this to check:
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'riya_gallery'::regclass AND contype = 'c';
-- If a CHECK constraint lists 'private_snaps', update it accordingly.
