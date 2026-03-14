-- Migration: Riya Life State System
-- Created: 2026-03-14
-- Purpose: Store Riya's dynamic weekly life state, injected into the system prompt.
--          History table lets the AI scheduler see the last N weeks when writing the next chapter.

-- =============================================
-- TABLE: riya_life_state
-- Single-row table (always exactly one active row).
-- =============================================
CREATE TABLE IF NOT EXISTS riya_life_state (
    id                 SERIAL PRIMARY KEY,
    current_focus      TEXT NOT NULL,
    mood_baseline      TEXT NOT NULL,
    recent_events      TEXT NOT NULL,
    background_tension TEXT NOT NULL,
    week_number        INTEGER NOT NULL DEFAULT 1,
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TABLE: riya_life_state_history
-- Archive of past weeks — read by the weekly scheduler
-- to give Gemini long-term story arc context.
-- =============================================
CREATE TABLE IF NOT EXISTS riya_life_state_history (
    id                 SERIAL PRIMARY KEY,
    current_focus      TEXT NOT NULL,
    mood_baseline      TEXT NOT NULL,
    recent_events      TEXT NOT NULL,
    background_tension TEXT NOT NULL,
    week_number        INTEGER NOT NULL,
    archived_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_life_history_week ON riya_life_state_history(week_number DESC);

-- =============================================
-- SEED: Week 1 — Placement season begins
-- Only insert if table is empty (idempotent)
-- =============================================
INSERT INTO riya_life_state (current_focus, mood_baseline, recent_events, background_tension, week_number)
SELECT
    'Placement season just started. Applied to 6 companies. Waiting nervously.',
    'Anxious but putting on a calm face',
    'Portal notification gave a heart attack (spam), chai at midnight, called Priya',
    'Project group has one person doing nothing. Not addressing it yet.',
    1
WHERE NOT EXISTS (SELECT 1 FROM riya_life_state);
