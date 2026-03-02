-- SQL to add new images (14 to 17) for the outfit_check category
-- Make sure to update the descriptions to match the actual image contents!

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
('outfit_14', 'outfit_check/outfit_14.png', NULL, 'outfit_check', 10, 12,
 'Riya mirror selfie, casual and stylish look, getting ready for the day',
 ARRAY['kya pehna', 'outfit', 'ready', 'college', 'show pic', 'full pic'], false),
 
('outfit_15', 'outfit_check/outfit_15.png', NULL, 'outfit_check', 10, 12,
 'Riya taking a quick outfit check photo, confident and smiling',
 ARRAY['kya pehna', 'outfit', 'ready', 'college', 'show pic', 'full pic'], false),
 
('outfit_16', 'outfit_check/outfit_16.png', NULL, 'outfit_check', 10, 12,
 'Riya posing for an outfit check, great fashion sense, ready to go out',
 ARRAY['kya pehna', 'outfit', 'ready', 'college', 'show pic', 'full pic'], false),
 
('outfit_17', 'outfit_check/outfit_17.png', NULL, 'outfit_check', 10, 12,
 'Riya in a beautiful outfit, looking gorgeous for her day out',
 ARRAY['kya pehna', 'outfit', 'ready', 'college', 'show pic', 'full pic'], false);
