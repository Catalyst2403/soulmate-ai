-- Add initial_greeting_sent column to personas table
-- This tracks whether the initial greeting message has been sent to the user

ALTER TABLE personas
ADD COLUMN IF NOT EXISTS initial_greeting_sent BOOLEAN DEFAULT FALSE;

-- Update existing personas to have the flag set to false
UPDATE personas
SET initial_greeting_sent = FALSE
WHERE initial_greeting_sent IS NULL;
