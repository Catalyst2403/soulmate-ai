ALTER TABLE public.riya_pending_messages
    ADD COLUMN IF NOT EXISTS message_parts JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.telegram_pending_messages
    ADD COLUMN IF NOT EXISTS message_parts JSONB NOT NULL DEFAULT '[]'::jsonb;
