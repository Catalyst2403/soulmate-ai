-- SQL to add 7 more images (04 to 10) for the happy category
-- Make sure these images are uploaded to the 'happy' folder in your storage bucket.

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
('happy_04', 'happy/happy_04.png', NULL, 'happy', 0, 24,
 'Riya laughing out loud, big authentic smile, having a great time',
 ARRAY['happy', 'laugh', 'smile', 'joy', 'cute'], false),
 
('happy_05', 'happy/happy_05.png', NULL, 'happy', 0, 24,
 'Riya with a soft, warm smile, looking directly at the camera, happy mood',
 ARRAY['happy', 'smile', 'khush', 'cute', 'sweet'], false),
 
('happy_06', 'happy/happy_06.png', NULL, 'happy', 0, 24,
 'Riya smiling brightly outdoors, sunny day, very positive vibes',
 ARRAY['happy', 'sunshine', 'smile', 'cheerful'], false),
 
('happy_07', 'happy/happy_07.png', NULL, 'happy', 0, 24,
 'Riya playfully smiling, slightly teasing but very happy expression',
 ARRAY['happy', 'playful', 'smile', 'cute'], false),
 
('happy_08', 'happy/happy_08.png', NULL, 'happy', 0, 24,
 'Riya giggling, covering mouth slightly, looking very happy',
 ARRAY['happy', 'giggle', 'laugh', 'cute', 'smile'], false),
 
('happy_09', 'happy/happy_09.png', NULL, 'happy', 0, 24,
 'Riya very excited and happy, big eyes, joyful expression',
 ARRAY['happy', 'excited', 'joy', 'smile'], false),
 
('happy_10', 'happy/happy_10.png', NULL, 'happy', 0, 24,
 'Riya in a peaceful, happy state, soft aesthetic, gentle smile',
 ARRAY['happy', 'peaceful', 'smile', 'relax', 'cute'], false);
