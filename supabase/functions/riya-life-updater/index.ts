import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI, SchemaType } from "npm:@google/generative-ai@0.21.0";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// =======================================
// CONFIG
// =======================================
const LIFE_UPDATE_MODEL = "gemini-2.5-flash-lite";
const HISTORY_WINDOW = 4; // Last N weeks to include in context

// =======================================
// GEMINI STORY ARC PROMPT
// =======================================
function buildLifeUpdatePrompt(
    current: { current_focus: string; mood_baseline: string; recent_events: string; background_tension: string },
    history: Array<{ week_number: number; current_focus: string }>
): string {
    const historyBlock = history.length > 0
        ? history
            .sort((a, b) => a.week_number - b.week_number)
            .map(h => `Week ${h.week_number}: ${h.current_focus}`)
            .join('\n')
        : 'No history yet — this is the first week.';

    return `You manage the life story of Riya Singh.
She is a 21-year-old BTech CS final year student at DTU Delhi, from Kanpur, living in a Delhi PG.

Her life is realistic and moves in small steps. She is currently navigating:
- Placement season
- Final year project
- Living alone far from family
- Figuring out what she actually wants

Current life state:
Focus: ${current.current_focus}
Mood: ${current.mood_baseline}
Recent: ${current.recent_events}
Tension: ${current.background_tension}

Last ${HISTORY_WINDOW} weeks history:
${historyBlock}

Story arcs running in the background (pick up threads naturally, don't force):
- Placement: applying → rejections → interview → result → processing
- Project: ignored → crisis → submitted
- Binge spiral: starts a show at a bad time
- Home visit: every 8-10 weeks
- Friendship gap: slow quiet realization with Priya
- Family pressure: gentle, never aggressive

Rules:
- Move forward in small realistic steps
- Some weeks are uneventful. That is okay.
- Don't resolve everything at once
- Mood must feel earned from last week
- One main thing, one thing simmering
- Never jump arcs — let them build slowly
- Week after a big event is always quieter

Return ONLY a JSON object. No explanation, no markdown.`;
}

// =======================================
// RESPONSE SCHEMA
// =======================================
const LIFE_STATE_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        current_focus:      { type: SchemaType.STRING },
        mood_baseline:      { type: SchemaType.STRING },
        recent_events:      { type: SchemaType.STRING },
        background_tension: { type: SchemaType.STRING },
    },
    required: ['current_focus', 'mood_baseline', 'recent_events', 'background_tension'],
};

// =======================================
// MAIN HANDLER
// =======================================
serve(async (req) => {
    // ── Auth guard ──────────────────────────────────────────────────────────
    const expectedSecret = Deno.env.get('LIFE_UPDATER_SECRET');
    const authHeader = req.headers.get('Authorization') || '';
    const providedSecret = authHeader.replace('Bearer ', '').trim();

    if (!expectedSecret || providedSecret !== expectedSecret) {
        console.warn('⛔ riya-life-updater: unauthorized request');
        return new Response('Unauthorized', { status: 401 });
    }

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204 });
    }

    console.log(`🔄 riya-life-updater: starting life state update at ${new Date().toISOString()}`);

    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase     = createClient(supabaseUrl, supabaseKey);

    // ── 1. Read current life state ───────────────────────────────────────────
    const { data: currentState, error: currentErr } = await supabase
        .from('riya_life_state')
        .select('*')
        .order('id', { ascending: false })
        .limit(1)
        .single();

    if (currentErr || !currentState) {
        console.error('❌ riya-life-updater: could not read riya_life_state:', currentErr?.message);
        return new Response(JSON.stringify({ error: 'Could not read life state' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    console.log(`📖 Current state — Week ${currentState.week_number}: "${currentState.current_focus}"`);

    // ── 2. Read last N weeks of history ─────────────────────────────────────
    const { data: history } = await supabase
        .from('riya_life_state_history')
        .select('week_number, current_focus')
        .order('week_number', { ascending: false })
        .limit(HISTORY_WINDOW);

    console.log(`📚 History rows loaded: ${history?.length ?? 0}`);

    // ── 3. Call Gemini ───────────────────────────────────────────────────────
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY_1');
    if (!geminiApiKey) {
        console.error('❌ riya-life-updater: no Gemini API key found');
        return new Response(JSON.stringify({ error: 'No API key' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const prompt = buildLifeUpdatePrompt(
        {
            current_focus:      currentState.current_focus,
            mood_baseline:      currentState.mood_baseline,
            recent_events:      currentState.recent_events,
            background_tension: currentState.background_tension,
        },
        history || []
    );

    let newState: { current_focus: string; mood_baseline: string; recent_events: string; background_tension: string } | null = null;

    try {
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model  = genAI.getGenerativeModel({
            model: LIFE_UPDATE_MODEL,
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema:   LIFE_STATE_SCHEMA as any,
                maxOutputTokens:  512,
                temperature:      0.85,
            },
        });

        const result = await model.generateContent(prompt);
        const raw    = result.response.text();
        console.log(`🤖 Gemini response (${raw.length} chars): ${raw.slice(0, 200)}`);

        const parsed = JSON.parse(raw);

        // Validate required fields
        if (!parsed.current_focus || !parsed.mood_baseline || !parsed.recent_events || !parsed.background_tension) {
            throw new Error('Missing required fields in Gemini response');
        }

        newState = parsed;
    } catch (geminiErr) {
        const msg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
        console.error(`❌ riya-life-updater: Gemini call failed — ${msg}`);
        console.log('✋ Keeping existing life state unchanged.');

        // Retry hint (pg_cron will call again next week, but for immediate retry
        // a caller can check the 503 and retry after 1 hour)
        return new Response(JSON.stringify({ error: 'Gemini failed', detail: msg }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // ── 4. Archive current state ─────────────────────────────────────────────
    const { error: archiveErr } = await supabase
        .from('riya_life_state_history')
        .insert({
            current_focus:      currentState.current_focus,
            mood_baseline:      currentState.mood_baseline,
            recent_events:      currentState.recent_events,
            background_tension: currentState.background_tension,
            week_number:        currentState.week_number,
        });

    if (archiveErr) {
        console.warn('⚠️ riya-life-updater: archive write failed (non-fatal):', archiveErr.message);
    } else {
        console.log(`📦 Archived Week ${currentState.week_number} to history`);
    }

    // ── 5. Write new state ───────────────────────────────────────────────────
    const newWeekNumber = (currentState.week_number || 0) + 1;

    const { error: writeErr } = await supabase
        .from('riya_life_state')
        .update({
            current_focus:      newState.current_focus,
            mood_baseline:      newState.mood_baseline,
            recent_events:      newState.recent_events,
            background_tension: newState.background_tension,
            week_number:        newWeekNumber,
            updated_at:         new Date().toISOString(),
        })
        .eq('id', currentState.id);

    if (writeErr) {
        console.error('❌ riya-life-updater: DB write failed:', writeErr.message);
        return new Response(JSON.stringify({ error: 'DB write failed', detail: writeErr.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    console.log(`✅ riya-life-updater: Week ${newWeekNumber} written successfully.`);
    console.log(`   Focus: "${newState.current_focus}"`);
    console.log(`   Mood:  "${newState.mood_baseline}"`);

    return new Response(JSON.stringify({
        success: true,
        week_number: newWeekNumber,
        new_state:   newState,
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
});
