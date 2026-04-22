-- ============================================================
-- MIGRATION: Enable RLS on all tables flagged by Security Advisor
-- Date: 2026-04-22
-- Safe: All Edge Functions use SUPABASE_SERVICE_ROLE_KEY which
--       bypasses RLS. service_role policies ensure backend access.
--       Frontend-accessed tables get authenticated/anon policies.
-- Note: Uses DROP POLICY IF EXISTS + CREATE POLICY (idempotent).
--       "IF NOT EXISTS" on CREATE POLICY requires PG17; Supabase is PG15.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. riya_conversations
--    "Policy Exists RLS Disabled" — policies exist but RLS
--    was never turned on, so policies were being ignored!
--    Frontend: RiyaGuestChat.tsx inserts with anon key (guest sessions)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conv_service_role_all" ON public.riya_conversations;
CREATE POLICY "conv_service_role_all"
  ON public.riya_conversations FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "conv_authenticated_read_own" ON public.riya_conversations;
CREATE POLICY "conv_authenticated_read_own"
  ON public.riya_conversations FOR SELECT
  TO authenticated
  USING (
    user_id IN (
      SELECT id FROM public.riya_users
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR guest_session_id IS NOT NULL
  );

DROP POLICY IF EXISTS "conv_anon_insert_guest" ON public.riya_conversations;
CREATE POLICY "conv_anon_insert_guest"
  ON public.riya_conversations FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL AND guest_session_id IS NOT NULL);

-- ────────────────────────────────────────────────────────────
-- 2. riya_users
--    Frontend: RiyaChat, RiyaCallback, RiyaLanding, RiyaProfileSetup,
--    RiyaPricing, RiyaEmailLogin, RiyaGuestChat all read/write this.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "riya_users_service_role_all" ON public.riya_users;
CREATE POLICY "riya_users_service_role_all"
  ON public.riya_users FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "riya_users_authenticated_read_own" ON public.riya_users;
CREATE POLICY "riya_users_authenticated_read_own"
  ON public.riya_users FOR SELECT
  TO authenticated
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "riya_users_authenticated_insert_own" ON public.riya_users;
CREATE POLICY "riya_users_authenticated_insert_own"
  ON public.riya_users FOR INSERT
  TO authenticated
  WITH CHECK (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "riya_users_authenticated_update_own" ON public.riya_users;
CREATE POLICY "riya_users_authenticated_update_own"
  ON public.riya_users FOR UPDATE
  TO authenticated
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- ────────────────────────────────────────────────────────────
-- 3. riya_gallery
--    Frontend: AdminDashboard.tsx reads with authenticated session.
--    Images are public assets — anyone can read.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_gallery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gallery_service_role_all" ON public.riya_gallery;
CREATE POLICY "gallery_service_role_all"
  ON public.riya_gallery FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "gallery_public_read" ON public.riya_gallery;
CREATE POLICY "gallery_public_read"
  ON public.riya_gallery FOR SELECT
  TO anon, authenticated USING (true);

-- ────────────────────────────────────────────────────────────
-- 4. riya_conversation_summaries — Edge Functions only
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_conversation_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conv_summaries_service_role_all" ON public.riya_conversation_summaries;
CREATE POLICY "conv_summaries_service_role_all"
  ON public.riya_conversation_summaries FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 5. riya_sessions — Edge Functions only
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_service_role_all" ON public.riya_sessions;
CREATE POLICY "sessions_service_role_all"
  ON public.riya_sessions FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 6. riya_proactive_lock — Edge Functions only (singleton lock row)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_proactive_lock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proactive_lock_service_role_all" ON public.riya_proactive_lock;
CREATE POLICY "proactive_lock_service_role_all"
  ON public.riya_proactive_lock FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 7. riya_instagram_users — Edge Functions only
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_instagram_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ig_users_service_role_all" ON public.riya_instagram_users;
CREATE POLICY "ig_users_service_role_all"
  ON public.riya_instagram_users FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 8. riya_life_state — Edge Functions only
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_life_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "life_state_service_role_all" ON public.riya_life_state;
CREATE POLICY "life_state_service_role_all"
  ON public.riya_life_state FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 9. riya_life_state_history — Edge Functions only
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_life_state_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "life_state_history_service_role_all" ON public.riya_life_state_history;
CREATE POLICY "life_state_history_service_role_all"
  ON public.riya_life_state_history FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 10. riya_image_usage — Edge Functions only (daily image limit tracking)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_image_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "image_usage_service_role_all" ON public.riya_image_usage;
CREATE POLICY "image_usage_service_role_all"
  ON public.riya_image_usage FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 11. riya_credit_transactions — Edge Functions only (credit audit ledger)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_txn_service_role_all" ON public.riya_credit_transactions;
CREATE POLICY "credit_txn_service_role_all"
  ON public.riya_credit_transactions FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 12. riya_sent_images — Edge Functions only (duplicate image prevention)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_sent_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sent_images_service_role_all" ON public.riya_sent_images;
CREATE POLICY "sent_images_service_role_all"
  ON public.riya_sent_images FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 13. riya_recharge_packs
--     Payment page reads active packs using anon key (browser).
--     Only service_role can modify pack pricing.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.riya_recharge_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recharge_packs_service_role_all" ON public.riya_recharge_packs;
CREATE POLICY "recharge_packs_service_role_all"
  ON public.riya_recharge_packs FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "recharge_packs_public_read" ON public.riya_recharge_packs;
CREATE POLICY "recharge_packs_public_read"
  ON public.riya_recharge_packs FOR SELECT
  TO anon, authenticated USING (is_active = true);

-- ────────────────────────────────────────────────────────────
-- 14. telegram_users — Edge Functions only
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.telegram_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tg_users_service_role_all" ON public.telegram_users;
CREATE POLICY "tg_users_service_role_all"
  ON public.telegram_users FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 15. telegram_conversation_summaries — Edge Functions only
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.telegram_conversation_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tg_conv_summaries_service_role_all" ON public.telegram_conversation_summaries;
CREATE POLICY "tg_conv_summaries_service_role_all"
  ON public.telegram_conversation_summaries FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────
-- 16. telegram_sent_images — Edge Functions only
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.telegram_sent_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tg_sent_images_service_role_all" ON public.telegram_sent_images;
CREATE POLICY "tg_sent_images_service_role_all"
  ON public.telegram_sent_images FOR ALL
  TO service_role USING (true) WITH CHECK (true);
