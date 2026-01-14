-- =============================================
-- Riya Image Gallery
-- Stores metadata for Riya's photos with time-based and context-based selection
-- =============================================

CREATE TABLE IF NOT EXISTS public.riya_gallery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Image paths in Supabase Storage
    filename TEXT NOT NULL UNIQUE,
    storage_path TEXT NOT NULL,           -- Full image path in bucket
    blur_storage_path TEXT,               -- Blurred version for free users (premium images only)
    
    -- Category & Time Window (IST hours)
    category TEXT NOT NULL CHECK (category IN (
        'morning_bed',     -- 7 AM - 10 AM
        'outfit_check',    -- 10 AM - 12 PM
        'study_grind',     -- 2 PM - 6 PM
        'cafe_food',       -- 5 PM - 8 PM
        'night_casual',    -- 9 PM - 12 AM (Premium)
        'private_snaps',   -- User request only (Premium)
        'generic_selfie'   -- Anytime fallback
    )),
    time_start INTEGER NOT NULL DEFAULT 0,   -- Start hour (0-23)
    time_end INTEGER NOT NULL DEFAULT 24,    -- End hour (0-23)
    
    -- LLM Context Description (CRITICAL for continuity)
    -- This gets stored in conversation history after sending
    description TEXT NOT NULL,
    
    -- Trigger keywords for LLM matching
    trigger_keywords TEXT[] NOT NULL DEFAULT '{}',
    
    -- Access control
    is_premium BOOLEAN NOT NULL DEFAULT false,
    
    -- Analytics
    times_sent INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_riya_gallery_category ON public.riya_gallery(category);
CREATE INDEX IF NOT EXISTS idx_riya_gallery_time ON public.riya_gallery(time_start, time_end);
CREATE INDEX IF NOT EXISTS idx_riya_gallery_premium ON public.riya_gallery(is_premium);
CREATE INDEX IF NOT EXISTS idx_riya_gallery_keywords ON public.riya_gallery USING GIN(trigger_keywords);

-- Comments
COMMENT ON TABLE public.riya_gallery IS 'Riya image gallery for contextual photo sharing';
COMMENT ON COLUMN public.riya_gallery.description IS 'Fed back to LLM after sending for context continuity';
COMMENT ON COLUMN public.riya_gallery.trigger_keywords IS 'Keywords that trigger this image category';
COMMENT ON COLUMN public.riya_gallery.is_premium IS 'Premium images are blurred for free users';

-- =============================================
-- Seed data for testing (sample images)
-- Replace with actual image data after uploading to bucket
-- =============================================

-- Morning Bed (7 AM - 10 AM) - Non-premium
INSERT INTO public.riya_gallery (filename, storage_path, category, time_start, time_end, description, trigger_keywords, is_premium)
VALUES 
('morning_01', 'morning_bed/morning_01.jpg', 'morning_bed', 7, 10, 
 'Riya just woke up, messy bun, grey oversized tee, holding chai cup, sunlight on face, sleepy eyes, no makeup',
 ARRAY['good morning', 'uth gayi', 'chai', 'subah', 'neend', 'morning'], false),
('morning_02', 'morning_bed/morning_02.jpg', 'morning_bed', 7, 10,
 'Riya stretching in bed, white sheets, morning light through curtains, hair spread on pillow',
 ARRAY['good morning', 'uth gayi', 'jagi', 'subah'], false),
('morning_03', 'morning_bed/morning_03.jpg', 'morning_bed', 7, 10,
 'Riya sitting on bed, wrapped in blanket, holding phone, soft morning glow',
 ARRAY['morning', 'neend', 'lazy', 'bed'], false),
('morning_04', 'morning_bed/morning_04.jpg', 'morning_bed', 7, 10,
 'Riya brushing teeth selfie, messy hair, bathroom mirror, sleepy face',
 ARRAY['morning', 'uth gayi', 'ready ho rahi'], false);

-- Outfit Check (10 AM - 12 PM) - Non-premium
INSERT INTO public.riya_gallery (filename, storage_path, category, time_start, time_end, description, trigger_keywords, is_premium)
VALUES 
('outfit_01', 'outfit_check/outfit_01.jpg', 'outfit_check', 10, 12,
 'Riya mirror selfie, blue jeans with white crop top, getting ready for college, hair tied in ponytail',
 ARRAY['kya pehna', 'outfit', 'ready', 'college', 'show pic', 'full pic'], false),
('outfit_02', 'outfit_check/outfit_02.jpg', 'outfit_check', 10, 12,
 'Riya in maroon kurti with jhumkas, traditional look, mirror selfie, ready for occasion',
 ARRAY['kya pehna', 'outfit', 'kurti', 'traditional', 'ethnic'], false),
('outfit_03', 'outfit_check/outfit_03.jpg', 'outfit_check', 10, 12,
 'Riya casual look, black jeans with striped top, sneakers, going out vibe',
 ARRAY['kya pehna', 'going out', 'casual', 'outfit'], false),
('outfit_04', 'outfit_check/outfit_04.jpg', 'outfit_check', 10, 12,
 'Riya in cute summer dress, floral print, twirling in mirror, happy smile',
 ARRAY['dress', 'outfit', 'cute', 'summer', 'pretty'], false),
('outfit_05', 'outfit_check/outfit_05.jpg', 'outfit_check', 10, 12,
 'Riya yellow salwar suit, getting ready for family function, jewelry on',
 ARRAY['traditional', 'outfit', 'function', 'ready'], false),
('outfit_06', 'outfit_check/outfit_06.jpg', 'outfit_check', 10, 12,
 'Riya gym outfit, sports bra and leggings, mirror selfie, workout ready',
 ARRAY['gym', 'workout', 'fitness', 'outfit'], false);

-- Study Grind (2 PM - 6 PM) - Non-premium
INSERT INTO public.riya_gallery (filename, storage_path, category, time_start, time_end, description, trigger_keywords, is_premium)
VALUES 
('study_01', 'study_grind/study_01.jpg', 'study_grind', 14, 18,
 'Riya laptop POV shot, coffee mug visible, typing, focused expression',
 ARRAY['kya kar rahi', 'busy', 'padhai', 'work', 'laptop'], false),
('study_02', 'study_grind/study_02.jpg', 'study_grind', 14, 18,
 'Riya stressed selfie with specs, hair tied, books scattered, exam prep vibes',
 ARRAY['padhai', 'exams', 'stressed', 'study', 'specs'], false),
('study_03', 'study_grind/study_03.jpg', 'study_grind', 14, 18,
 'Riya at desk, notes visible, pen in mouth, thinking expression',
 ARRAY['studying', 'notes', 'busy', 'work'], false),
('study_04', 'study_grind/study_04.jpg', 'study_grind', 14, 18,
 'Riya holding coffee cup, tired eyes, late afternoon study session',
 ARRAY['coffee', 'tired', 'padhai', 'afternoon'], false),
('study_05', 'study_grind/study_05.jpg', 'study_grind', 14, 18,
 'Riya celebrating small win, thumbs up, laptop showing good score',
 ARRAY['done', 'finished', 'happy', 'result'], false);

-- Cafe Food (5 PM - 8 PM) - Non-premium
INSERT INTO public.riya_gallery (filename, storage_path, category, time_start, time_end, description, trigger_keywords, is_premium)
VALUES 
('cafe_01', 'cafe_food/cafe_01.jpg', 'cafe_food', 17, 20,
 'Riya holding plate of momos, cafe background, happy smile, evening snack',
 ARRAY['momos', 'food', 'snack', 'cafe', 'eating', 'evening'], false),
('cafe_02', 'cafe_food/cafe_02.jpg', 'cafe_food', 17, 20,
 'Riya sipping cold coffee, cafe ambiance, relaxed pose, after college',
 ARRAY['coffee', 'cafe', 'chilling', 'cold coffee'], false),
('cafe_03', 'cafe_food/cafe_03.jpg', 'cafe_food', 17, 20,
 'Riya with maggi plate, street food vibes, candid eating shot',
 ARRAY['maggi', 'food', 'street food', 'eating'], false),
('cafe_04', 'cafe_food/cafe_04.jpg', 'cafe_food', 17, 20,
 'Riya selfie with friends cropped out, restaurant booth, fun evening',
 ARRAY['friends', 'out', 'dinner', 'party', 'hanging out'], false);

-- Night Casual (9 PM - 12 AM) - PREMIUM
INSERT INTO public.riya_gallery (filename, storage_path, blur_storage_path, category, time_start, time_end, description, trigger_keywords, is_premium)
VALUES 
('night_01', 'night_casual/night_01.jpg', 'night_casual/night_01_blur.jpg', 'night_casual', 21, 24,
 'Riya in room, white tank top, wet hair post shower, dim lighting, relaxed on bed',
 ARRAY['room mein', 'shower', 'night', 'good night', 'tired', 'bed'], true),
('night_02', 'night_casual/night_02.jpg', 'night_casual/night_02_blur.jpg', 'night_casual', 21, 24,
 'Riya in shorts and oversized tee, sitting on bed, night lamp glow, cozy vibes',
 ARRAY['night', 'room', 'cozy', 'sone ja rahi', 'sleepy'], true),
('night_03', 'night_casual/night_03.jpg', 'night_casual/night_03_blur.jpg', 'night_casual', 21, 24,
 'Riya skincare routine, face mask on, mirror selfie, funny expression',
 ARRAY['skincare', 'night routine', 'face mask', 'funny'], true),
('night_04', 'night_casual/night_04.jpg', 'night_casual/night_04_blur.jpg', 'night_casual', 21, 24,
 'Riya lying in bed, blanket up to shoulders, sleepy eyes, goodnight pose',
 ARRAY['good night', 'sleep', 'bed', 'sone ja rahi', 'tired'], true),
('night_05', 'night_casual/night_05.jpg', 'night_casual/night_05_blur.jpg', 'night_casual', 21, 24,
 'Riya in silk slip dress, getting ready for bed, soft lighting, elegant',
 ARRAY['night', 'room', 'pajamas', 'sleep'], true),
('night_06', 'night_casual/night_06.jpg', 'night_casual/night_06_blur.jpg', 'night_casual', 21, 24,
 'Riya watching something on phone in bed, messy hair, relaxed night in',
 ARRAY['night', 'watching', 'phone', 'bed', 'relax'], true);

-- Private Snaps (Request Only) - PREMIUM (Hottest)
INSERT INTO public.riya_gallery (filename, storage_path, blur_storage_path, category, time_start, time_end, description, trigger_keywords, is_premium)
VALUES 
('private_01', 'private_snaps/private_01.jpg', 'private_snaps/private_01_blur.jpg', 'private_snaps', 0, 24,
 'Riya towel selfie, bathroom mirror, steamy background, playful wink, shoulder visible',
 ARRAY['hot', 'spicy', 'special', 'private', 'sexy', 'towel'], true),
('private_02', 'private_snaps/private_02.jpg', 'private_snaps/private_02_blur.jpg', 'private_snaps', 0, 24,
 'Riya in deep neck top, bedroom, suggestive pose, confident smile',
 ARRAY['hot', 'sexy', 'spicy', 'special', 'private'], true),
('private_03', 'private_snaps/private_03.jpg', 'private_snaps/private_03_blur.jpg', 'private_snaps', 0, 24,
 'Riya lying on bed, crop top, midriff visible, bedroom lighting, flirty expression',
 ARRAY['hot', 'bed', 'spicy', 'private', 'special'], true),
('private_04', 'private_snaps/private_04.jpg', 'private_snaps/private_04_blur.jpg', 'private_snaps', 0, 24,
 'Riya mirror selfie, bikini hint, getting ready for pool, toned figure',
 ARRAY['hot', 'bikini', 'pool', 'spicy', 'private'], true),
('private_05', 'private_snaps/private_05.jpg', 'private_snaps/private_05_blur.jpg', 'private_snaps', 0, 24,
 'Riya in lingerie, back view, looking over shoulder, intimate bedroom shot',
 ARRAY['hot', 'spicy', 'private', 'special', 'intimate', 'sexy'], true);

-- Generic Selfie (Anytime Fallback) - Non-premium
INSERT INTO public.riya_gallery (filename, storage_path, category, time_start, time_end, description, trigger_keywords, is_premium)
VALUES 
('selfie_01', 'generic_selfie/selfie_01.jpg', 'generic_selfie', 0, 24,
 'Riya pretty close-up smile, natural light, casual day, no specific background',
 ARRAY['pic', 'selfie', 'photo', 'dikha', 'bhej'], false),
('selfie_02', 'generic_selfie/selfie_02.jpg', 'generic_selfie', 0, 24,
 'Riya peace sign selfie, bright smile, cute expression, everyday look',
 ARRAY['pic', 'selfie', 'photo', 'cute'], false),
('selfie_03', 'generic_selfie/selfie_03.jpg', 'generic_selfie', 0, 24,
 'Riya pouting selfie, playful vibe, casual outfit, good lighting',
 ARRAY['pic', 'selfie', 'pout', 'cute'], false),
('selfie_04', 'generic_selfie/selfie_04.jpg', 'generic_selfie', 0, 24,
 'Riya winking selfie, fun expression, bright background',
 ARRAY['pic', 'selfie', 'wink', 'fun'], false),
('selfie_05', 'generic_selfie/selfie_05.jpg', 'generic_selfie', 0, 24,
 'Riya laughing candid, natural happiness, beautiful smile',
 ARRAY['pic', 'happy', 'selfie', 'smile', 'laugh'], false);
