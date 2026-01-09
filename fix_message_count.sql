-- Fix: Deploy this SQL function to your Supabase database
-- Go to Supabase Dashboard → SQL Editor → New Query → Paste this → Run

-- ============================================
-- Helper Function: Increment message count
-- Returns remaining messages after increment
-- ============================================
CREATE OR REPLACE FUNCTION public.increment_riya_message_count(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_new_count INTEGER;
  v_daily_limit INTEGER := 30;
BEGIN
  -- Upsert daily usage record
  INSERT INTO public.riya_daily_usage (user_id, usage_date, message_count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, usage_date)
  DO UPDATE SET 
    message_count = riya_daily_usage.message_count + 1,
    updated_at = NOW()
  RETURNING message_count INTO v_new_count;
  
  RETURN GREATEST(0, v_daily_limit - v_new_count);
END;
$$ LANGUAGE plpgsql;

-- Test the function
SELECT increment_riya_message_count('d283f87c-5216-4af7-859d-345dad6d5c81');
