-- 1. First, we need to update the CHECK constraint to allow the new 'angry' category.
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
    'happy',
    'sad',    -- Including 'sad' since it was recently added to prompts
    'angry'   -- <-- New Category Added Here
));

-- 2. Insert the 6 new images into the 'angry' category.
-- Make sure the images are uploaded to the 'angry' folder in your storage bucket.
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
('angry_01', 'angry/angry_01.png', NULL, 'angry', 0, 24,
 'Riya looking visibly upset, arms crossed, annoyed expression',
 ARRAY['angry', 'upset', 'mad', 'kutti', 'gussa'], false),
 
('angry_02', 'angry/angry_02.png', NULL, 'angry', 0, 24,
 'Riya giving a deadly stare, serious and angry face, not playing around',
 ARRAY['angry', 'stare', 'gussa', 'serious'], false),
 
('angry_03', 'angry/angry_03.png', NULL, 'angry', 0, 24,
 'Riya looking away with a pouting, grumpy, annoyed look',
 ARRAY['angry', 'annoyed', 'pout', 'grumpy'], false),
 
('angry_04', 'angry/angry_04.png', NULL, 'angry', 0, 24,
 'Riya looking frustrated, rubbing forehead or sighing, annoyed mood',
 ARRAY['angry', 'frustrated', 'annoyed', 'irritated'], false),
 
('angry_05', 'angry/angry_05.png', NULL, 'angry', 0, 24,
 'Riya with a sassy but angry expression, raised eyebrow, confrontational',
 ARRAY['angry', 'sassy', 'attitude', 'gussa'], false),
 
('angry_06', 'angry/angry_06.png', NULL, 'angry', 0, 24,
 'Riya ignoring the camera, looking cold and distant, silent treatment vibes',
 ARRAY['angry', 'cold', 'ignore', 'silent'], false);
