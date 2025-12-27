-- Fix riya_sessions table to support upsert on user_id
-- Add unique constraint since each user should only have one session record

-- Add unique constraint on user_id
ALTER TABLE public.riya_sessions 
ADD CONSTRAINT riya_sessions_user_id_unique UNIQUE (user_id);

-- Update the comment
COMMENT ON CONSTRAINT riya_sessions_user_id_unique ON public.riya_sessions 
IS 'Ensures one session record per user for upsert operations';
