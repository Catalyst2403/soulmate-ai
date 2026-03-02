-- SQL to add new images (6 to 9) for the study_grind category
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
('study_06', 'study_grind/study_06.png', NULL, 'study_grind', 14, 18,
 'Riya deep in focus, looking at laptop screen with a serious study expression',
 ARRAY['studying', 'busy', 'padhai', 'work', 'laptop'], false),
 
('study_07', 'study_grind/study_07.png', NULL, 'study_grind', 14, 18,
 'Riya taking a quick break from studying, smiling at the camera with notes visible',
 ARRAY['studying', 'notes', 'busy', 'work'], false),
 
('study_08', 'study_grind/study_08.png', NULL, 'study_grind', 14, 18,
 'Riya looking tired but determined, textbooks open on the desk',
 ARRAY['exams', 'stressed', 'study', 'tired'], false),
 
('study_09', 'study_grind/study_09.png', NULL, 'study_grind', 14, 18,
 'Riya drinking coffee while typing an assignment, evening study grind',
 ARRAY['coffee', 'study', 'padhai', 'afternoon'], false);
