-- 1. First, we need to update the CHECK constraint to allow the new 'happy' category.
-- Note: Replace 'riya_gallery_category_check' with the actual name of your constraint
-- if it was auto-generated differently.

ALTER TABLE public.riya_gallery DROP CONSTRAINT IF EXISTS riya_gallery_category_check;

ALTER TABLE public.riya_gallery ADD CONSTRAINT riya_gallery_category_check 
CHECK (category IN (
    'morning_bed',
    'outfit_check',
    'study_grind',
    'cafe_food',
    'night_casual',
    'private_snaps',
    'generic_selfie',
    'happy' -- <-- New Category Added Here
));

-- 2. Insert the new images into the 'happy' category.
-- Make sure the images are uploaded to the 'happy' folder in your storage bucket.
INSERT INTO public.riya_gallery (
    filename, 
    storage_path, 
    blur_storage_path,
    category, 
    time_start, 
    time_end, 
    description, 
    trigger_keywords, 
    is_premium
)
VALUES 
('happy_01', 'happy/happy_01.png', NULL, 'happy', 0, 24,
 'Riya laughing candidly, bright smile, very happy expression, casual setting',
 ARRAY['happy', 'smile', 'laugh', 'khush', 'cute'], false),
 
('happy_02', 'happy/happy_02.png', NULL, 'happy', 0, 24,
 'Riya smiling widely at the camera, glowing face, feeling great',
 ARRAY['happy', 'smile', 'joy', 'photo', 'khush'], false),
 
('happy_03', 'happy/happy_03.png', NULL, 'happy', 0, 24,
 'Riya in a super cheerful mood, maybe outside on a sunny day, beautiful smile',
 ARRAY['happy', 'cheerful', 'sunshine', 'smile', 'cute'], false);
