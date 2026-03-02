-- SQL to add new images (5 to 12) for the morning_bed category
-- Using .png extension as seen in the database screenshot

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
('morning_05', 'morning_bed/morning_05.png', NULL, 'morning_bed', 7, 10,
 'Riya waking up, sleepy smile, hair messy, soft morning light',
 ARRAY['good morning', 'uth gayi', 'chai', 'subah', 'neend', 'morning'], false),
 
('morning_06', 'morning_bed/morning_06.png', NULL, 'morning_bed', 7, 10,
 'Riya stretching in bed, comfortable pajamas, early morning vibes',
 ARRAY['good morning', 'stretching', 'lazy', 'morning'], false),
 
('morning_07', 'morning_bed/morning_07.png', NULL, 'morning_bed', 7, 10,
 'Riya looking at the camera from under the blanket, cozy and sleepy',
 ARRAY['blanket', 'cold', 'neend', 'cozy', 'subah'], false),
 
('morning_08', 'morning_bed/morning_08.png', NULL, 'morning_bed', 7, 10,
 'Riya with a fresh morning face, sitting up in bed',
 ARRAY['morning face', 'fresh', 'uth gayi', 'subah'], false),
 
('morning_09', 'morning_bed/morning_09.png', NULL, 'morning_bed', 7, 10,
 'Riya sipping morning tea/coffee in bed, sunlight hitting her face',
 ARRAY['chai', 'coffee', 'morning', 'subah'], false),
 
('morning_10', 'morning_bed/morning_10.png', NULL, 'morning_bed', 7, 10,
 'Riya taking a cute morning selfie with messy hair',
 ARRAY['selfie', 'morning', 'cute', 'messy hair'], false),
 
('morning_11', 'morning_bed/morning_11.png', NULL, 'morning_bed', 7, 10,
 'Riya still half asleep, rubbing her eyes in bed',
 ARRAY['sleepy', 'neend', 'aankh', 'morning'], false),
 
('morning_12', 'morning_bed/morning_12.png', NULL, 'morning_bed', 7, 10,
 'Riya smiling brightly, ready to start the day, sitting on bed',
 ARRAY['happy', 'morning', 'ready', 'subah'], false);
