INSERT INTO public.riya_gallery (filename, storage_path, category, time_start, time_end, description, trigger_keywords, is_premium)
VALUES 
('cafe_05', 'cafe_food/cafe_05.png', 'cafe_food', 17, 20, 
 'Riya holding a large iced latte, cafe background, smiling and looking at camera, casual evening vibe',
 ARRAY['coffee', 'cafe', 'date', 'evening', 'drink'], false),

('cafe_06', 'cafe_food/cafe_06.png', 'cafe_food', 17, 20,
 'Riya with a slice of cheesecake, fork in hand, excited expression, cozy cafe lighting',
 ARRAY['food', 'cake', 'dessert', 'sweet', 'yum'], false),

('cafe_07', 'cafe_food/cafe_07.png', 'cafe_food', 17, 20,
 'Riya looking out of cafe window, thoughtful pose, holding warm cup, rainy mood outside',
 ARRAY['mood', 'thinking', 'weather', 'rain', 'coffee'], false),

('cafe_08', 'cafe_food/cafe_08.png', 'cafe_food', 17, 20,
 'Riya laughing with a friend (friend cropped), table full of snacks, fries and burgers visible',
 ARRAY['friends', 'fun', 'party', 'food', 'hungry'], false);
