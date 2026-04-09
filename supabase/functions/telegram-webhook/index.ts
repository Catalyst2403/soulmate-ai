import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI, SchemaType } from "npm:@google/generative-ai@0.21.0";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// =======================================
// STRUCTURED LOGGER
// =======================================
const log = {
    _tag: (uid: string) => uid === '*' ? '[global]' : `[tg:${uid.slice(-8)}]`,
    info:  (uid: string, msg: string, ...args: any[]) => console.log(`${log._tag(uid)} ${msg}`, ...args),
    warn:  (uid: string, msg: string, ...args: any[]) => console.warn(`${log._tag(uid)} ${msg}`, ...args),
    error: (uid: string, msg: string, ...args: any[]) => console.error(`${log._tag(uid)} ${msg}`, ...args),
};

// =======================================
// CONFIGURATION
// =======================================

const MODEL_NAME     = "gemini-2.5-flash-lite";
const MODEL_FALLBACK = "gemini-2.5-flash";
const RATE_LIMIT_WINDOW_MS   = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

// Vision
const VISION_MODEL            = "gemini-2.5-flash-lite";
const VISION_MAX_IMAGE_BYTES  = 4 * 1024 * 1024;
const VISION_TIMEOUT_MS       = 5_000;

// TTS
const TTS_MODEL          = 'gemini-2.5-flash-preview-tts';
const TTS_VOICE_DAY      = 'Kore';
const TTS_VOICE_NIGHT    = 'Aoede';
const TTS_VOICE_BUCKET   = 'riya-voice-notes';
const TTS_CLEANUP_DELAY_MS   = 60 * 60 * 1000;
const TTS_MAX_AUDIO_INLINE_BYTES = 18 * 1024 * 1024;
const TRANSCRIPTION_MODEL    = 'gemini-2.5-flash-lite';

// Debounce
const DEBOUNCE_MS    = 4000;
const DEBOUNCE_TABLE = 'telegram_pending_messages';

// History
const MAX_HISTORY_CHARS     = 200_000;
const RECENT_MESSAGES_LIMIT = 25;

// Summarisation
const SUMMARIZE_THRESHOLD       = 25;
const SUMMARY_MODEL_PRIMARY     = "gemini-2.5-flash-lite";
const SUMMARY_MODEL_FALLBACK    = "gemini-2.5-flash";
const SUMMARY_MODEL_LAST_RESORT = "gemini-2.5-flash";

// Atomic facts
const FACTS_EXTRACT_THRESHOLD = 25;
const FACTS_MODEL             = "gemini-2.5-flash-lite";
const FACTS_MAX_KEY_EVENTS    = 10;

// Life state — shared with Instagram (same riya_life_state table, same character)
const LIFE_STATE_CACHE_TTL_MS      = 60 * 60 * 1000;       // 1 hour in-memory cache
const LIFE_STATE_UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // trigger background update if >7 days stale

// =======================================
// API KEY POOL
// =======================================

let apiKeyPool: string[] = [];
const quotaExhaustedKeys = new Map<string, number>();
const QUOTA_COOLDOWN_MS = 5 * 60 * 1000;

function initializeApiKeyPool(): void {
    const keys: string[] = [];
    let i = 1;
    while (true) {
        const k = Deno.env.get(`GEMINI_API_KEY_${i}`);
        if (k) { keys.push(k); i++; } else break;
    }
    if (keys.length === 0) {
        const k = Deno.env.get("GEMINI_API_KEY");
        if (k) keys.push(k);
    }
    apiKeyPool = keys;
    log.info('*', `✅ API key pool: ${apiKeyPool.length} key(s)`);
}

function getKeyForUser(userId: string): string {
    if (apiKeyPool.length === 0) throw new Error("No API keys configured");
    const now = Date.now();
    for (const [k, exp] of quotaExhaustedKeys) { if (now >= exp) quotaExhaustedKeys.delete(k); }
    const available = apiKeyPool.filter(k => !quotaExhaustedKeys.has(k));
    const pool = available.length > 0 ? available : apiKeyPool;
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash = Math.imul(hash * 31 + userId.charCodeAt(i), 1) >>> 0;
    return pool[hash % pool.length];
}

function markKeyExhausted(key: string): void {
    quotaExhaustedKeys.set(key, Date.now() + QUOTA_COOLDOWN_MS);
    log.warn('*', `⚠️ Key exhausted: ${key.slice(0, 8)}...`);
}

initializeApiKeyPool();

// =======================================
// LIFE STATE — reads from the shared riya_life_state table
// (same table as Instagram — same Riya character, one evolving story)
// =======================================

interface RiyaLifeState {
    id?: number;
    current_focus:      string;
    mood_baseline:      string;
    recent_events:      string;
    background_tension: string;
    week_number?:       number;
    updated_at?:        string;
}

// Fallback used before the DB row exists or on any read error
const LIFE_STATE_FALLBACK: RiyaLifeState = {
    current_focus:      'Placement season. Waiting to hear back from companies.',
    mood_baseline:      'Anxious but holding it together',
    recent_events:      'Chai at midnight, called Priya, gym in the morning',
    background_tension: 'Project submission is closer than she wants to admit.',
};

let lifeStateCache: { data: RiyaLifeState; fetchedAt: number } | null = null;

/**
 * Returns Riya's current life state with a 1-hour in-memory cache.
 * If the DB row is older than 7 days, fires a background Gemini update
 * (identical logic to the Instagram webhook — they share the same table).
 */
async function getLifeState(supabase: any): Promise<RiyaLifeState> {
    if (lifeStateCache && Date.now() - lifeStateCache.fetchedAt < LIFE_STATE_CACHE_TTL_MS) {
        return lifeStateCache.data;
    }

    try {
        const { data } = await supabase
            .from('riya_life_state')
            .select('id, current_focus, mood_baseline, recent_events, background_tension, week_number, updated_at')
            .order('id', { ascending: false })
            .limit(1)
            .single();

        if (data) {
            lifeStateCache = { data, fetchedAt: Date.now() };

            const updated = data.updated_at ? new Date(data.updated_at).getTime() : 0;
            if (Date.now() - updated > LIFE_STATE_UPDATE_INTERVAL_MS) {
                log.info('*', '🔄 Life state stale — triggering background update');
                runLifeStateUpdate(supabase, data).catch(err =>
                    log.warn('*', '⚠️ Background life state update failed:', err)
                );
            }

            return data;
        }
    } catch (e) {
        log.warn('*', '⚠️ getLifeState: DB read failed, using fallback —', e);
    }

    return LIFE_STATE_FALLBACK;
}

/**
 * Auto-evolves Riya's life state weekly via Gemini.
 * Identical to the Instagram webhook implementation — updates are shared
 * so both platforms always see the same Riya story arc.
 */
async function runLifeStateUpdate(supabase: any, current: RiyaLifeState): Promise<void> {
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY_1');
    if (!geminiApiKey) { log.warn('*', '⚠️ runLifeStateUpdate: no Gemini key'); return; }

    const { data: history } = await supabase
        .from('riya_life_state_history')
        .select('week_number, current_focus')
        .order('week_number', { ascending: false })
        .limit(4);

    const historyBlock = history && history.length > 0
        ? history.sort((a: any, b: any) => a.week_number - b.week_number)
            .map((h: any) => `Week ${h.week_number}: ${h.current_focus}`).join('\n')
        : 'No history yet.';

    const prompt = `You manage the life story of Riya Singh.
She is a 21-year-old BTech CS final year student at DTU Delhi, from Kanpur, living in a Delhi PG.

Current life state:
Focus: ${current.current_focus}
Mood: ${current.mood_baseline}
Recent: ${current.recent_events}
Tension: ${current.background_tension}

Last 4 weeks history:
${historyBlock}

Story arcs (pick up threads naturally, don't force):
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
- Week after a big event is always quieter

Return ONLY a valid JSON object with keys: current_focus, mood_baseline, recent_events, background_tension. No explanation, no markdown.`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 512, temperature: 0.85 },
            }),
        }
    );

    if (!response.ok) throw new Error(`Gemini returned ${response.status}`);

    const json = await response.json();
    const raw  = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Empty Gemini response');

    const newState = JSON.parse(raw);
    if (!newState.current_focus || !newState.mood_baseline || !newState.recent_events || !newState.background_tension) {
        throw new Error('Gemini response missing required fields');
    }

    // Archive current week
    await supabase.from('riya_life_state_history').insert({
        current_focus:      current.current_focus,
        mood_baseline:      current.mood_baseline,
        recent_events:      current.recent_events,
        background_tension: current.background_tension,
        week_number:        current.week_number ?? 1,
    });

    // Write new state
    const newWeek = (current.week_number ?? 1) + 1;
    await supabase.from('riya_life_state').update({
        current_focus:      newState.current_focus,
        mood_baseline:      newState.mood_baseline,
        recent_events:      newState.recent_events,
        background_tension: newState.background_tension,
        week_number:        newWeek,
        updated_at:         new Date().toISOString(),
    }).eq('id', current.id);

    lifeStateCache = null; // bust cache
    log.info('*', `✅ Life state updated to Week ${newWeek}: "${newState.current_focus}"`);
}

// =======================================
// RATE LIMITING
// =======================================

const rateLimitStore: Map<string, { count: number; windowStart: number }> = new Map();

function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const entry = rateLimitStore.get(userId);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.set(userId, { count: 1, windowStart: now });
        return false;
    }
    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) { log.warn(userId, '🚫 Rate limited'); return true; }
    entry.count++;
    return false;
}

// =======================================
// TIME HELPERS
// =======================================

function getCurrentISTHour(): number {
    return new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
}

function formatRelativeTime(isoDate: string): string {
    const diff = Date.now() - new Date(isoDate).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 7) return new Date(isoDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    if (m > 5) return `${m}m ago`;
    return 'now';
}

// =======================================
// TELEGRAM API HELPERS
// =======================================

const TG_BASE = (token: string) => `https://api.telegram.org/bot${token}`;

async function tgPost(token: string, method: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${TG_BASE(token)}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) log.warn('*', `⚠️ Telegram ${method} failed: ${JSON.stringify(json).slice(0, 200)}`);
    return json;
}

async function sendTelegramMessage(
    chatId: string,
    text: string,
    token: string,
    replyMarkup?: Record<string, unknown>,
): Promise<boolean> {
    const body: Record<string, unknown> = { chat_id: chatId, text };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await tgPost(token, 'sendMessage', body);
    return res.ok === true;
}

async function sendTelegramPhoto(chatId: string, photoUrl: string, token: string, caption?: string): Promise<boolean> {
    const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl };
    if (caption) body.caption = caption;
    const res = await tgPost(token, 'sendPhoto', body);
    return res.ok === true;
}

/**
 * Send a voice note to Telegram.
 * Telegram's servers accept WAV at the sendVoice endpoint and transcode to OGG/Opus
 * for clients — so we reuse the same WAV pipeline as Instagram.
 */
async function sendTelegramVoice(chatId: string, voiceUrl: string, token: string): Promise<boolean> {
    const res = await tgPost(token, 'sendVoice', { chat_id: chatId, voice: voiceUrl });
    return res.ok === true;
}

async function sendChatAction(chatId: string, action: string, token: string): Promise<void> {
    await tgPost(token, 'sendChatAction', { chat_id: chatId, action }).catch(() => {});
}

async function answerCallbackQuery(callbackQueryId: string, token: string, text?: string): Promise<void> {
    await tgPost(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || '' });
}

/**
 * Resolve a Telegram file_id into a download URL.
 * Returns null on any failure (voice handling degrades gracefully).
 */
async function getTelegramFileUrl(fileId: string, token: string): Promise<string | null> {
    try {
        const res = await tgPost(token, 'getFile', { file_id: fileId });
        if (!res.ok || !res.result?.file_path) return null;
        return `https://api.telegram.org/file/bot${token}/${res.result.file_path}`;
    } catch { return null; }
}

// =======================================
// VISION — IMAGE DESCRIPTION
// =======================================

function uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

async function describeImage(
    imageUrl: string,
    mediaType: 'photo' | 'sticker',
    apiKey: string,
    userId = '*',
): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
        let imgRes: Response;
        try { imgRes = await fetch(imageUrl, { signal: controller.signal }); }
        finally { clearTimeout(timer); }
        if (!imgRes.ok) return null;
        const contentLength = parseInt(imgRes.headers.get('content-length') || '0', 10);
        if (contentLength > VISION_MAX_IMAGE_BYTES) return null;
        const buffer = await imgRes.arrayBuffer();
        if (buffer.byteLength > VISION_MAX_IMAGE_BYTES) return null;
        const bytes = new Uint8Array(buffer);
        const base64 = uint8ToBase64(bytes);
        const mimeType = imgRes.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
        const prompt = mediaType === 'sticker'
            ? `What is this sticker/GIF expressing? 1 line, casual.`
            : `Read any visible text first. Then: image type + who/what + vibe. 2 lines max.`;
        const visionRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
                    generationConfig: { maxOutputTokens: 150, temperature: 0.2 },
                }),
            }
        );
        if (!visionRes.ok) return null;
        const json = await visionRes.json();
        return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') log.warn(userId, '⚠️ Vision timeout');
        return null;
    }
}

// =======================================
// VOICE NOTE HELPERS
// =======================================

async function transcribeVoiceNote(
    inlineAudio: { mimeType: string; data: string },
    apiKey: string,
    userId: string,
): Promise<string | null> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: TRANSCRIPTION_MODEL });
        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType: inlineAudio.mimeType, data: inlineAudio.data } },
                    { text: 'Transcribe this audio exactly as spoken. Return only the transcript text, no commentary.' },
                ],
            }],
        });
        const t = result.response.text().trim();
        if (!t) return null;
        log.info(userId, `📝 Transcribed (${t.length} chars)`);
        return t;
    } catch (e: any) {
        log.warn(userId, `⚠️ Transcription failed: ${e?.message?.slice(0, 80)}`);
        return null;
    }
}

function buildTTSPrompt(preferredLang: string | null, istHour: number): string {
    const lang = preferredLang || 'Hinglish';
    const isNight = istHour >= 22 || istHour <= 4;
    return `${lang} only.\nVoice note from a 21-year-old Indian girl Riya to her boyfriend — warm, natural, like she's actually talking. Not reading. Real.${isNight ? ' Late night, close to the mic, soft.' : ''}`;
}

function addWavHeader(pcm: Uint8Array, sampleRate = 24_000): Uint8Array {
    const buf = new ArrayBuffer(44);
    const v = new DataView(buf);
    const s = (o: number, str: string) => str.split('').forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    s(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true);
    s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    s(36, 'data'); v.setUint32(40, pcm.byteLength, true);
    const out = new Uint8Array(44 + pcm.byteLength);
    out.set(new Uint8Array(buf)); out.set(pcm, 44);
    return out;
}

function shouldSendSpontaneousVoice(text: string, istHour: number): boolean {
    const t = text.toLowerCase();
    if (/\bbot\b|\bai\b|fake|real hai|prove|human|real person|actually real/.test(t)) return true;
    if (/good morning|good night|subah|\bgm\b|\bgn\b|so ja|uth gaya|uth gayi/.test(t) && Math.random() < 0.40) return true;
    if ((istHour >= 22 || istHour <= 4) && Math.random() < 0.25) return true;
    if (/miss|pyar|dil|hug|yaad|\bro \b|love you|bahut yaad/.test(t) && Math.random() < 0.15) return true;
    return false;
}

/**
 * Generates a WAV voice note via Gemini TTS, uploads to Supabase Storage,
 * and sends it to Telegram via sendVoice with the public URL.
 * Telegram auto-transcodes WAV → OGG/Opus for clients.
 */
async function generateAndSendVoiceNote(
    text: string,
    chatId: string,
    preferredLang: string | null,
    istHour: number,
    supabase: ReturnType<typeof createClient>,
    botToken: string,
    apiKey: string,
): Promise<boolean> {
    try {
        const voice = (istHour >= 22 || istHour <= 4) ? TTS_VOICE_NIGHT : TTS_VOICE_DAY;
        const ttsPrompt = buildTTSPrompt(preferredLang, istHour);
        const ttsInput = `${ttsPrompt}\n\n${text}`;

        const makeTtsBody = () => JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: ttsInput }] }],
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
        });

        let ttsKey = apiKey;
        const makeTtsUrl = () => `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${ttsKey}`;

        let ttsRes = await fetch(makeTtsUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: makeTtsBody() });

        if (!ttsRes.ok) {
            if (ttsRes.status === 500 || ttsRes.status === 503) {
                log.warn(chatId, `⚠️ TTS ${ttsRes.status} — retrying in 1.5s`);
                await new Promise(r => setTimeout(r, 1500));
                ttsRes = await fetch(makeTtsUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: makeTtsBody() });
            } else if (ttsRes.status === 429) {
                markKeyExhausted(ttsKey);
                ttsKey = getKeyForUser(chatId);
                ttsRes = await fetch(makeTtsUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: makeTtsBody() });
            }
        }

        if (!ttsRes.ok) {
            log.error(chatId, `❌ TTS error ${ttsRes.status}`);
            return false;
        }

        const ttsJson = await ttsRes.json();
        const audioB64: string | undefined = ttsJson.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioB64) { log.error(chatId, '❌ TTS: no audio data'); return false; }

        const pcm = Uint8Array.from(atob(audioB64), c => c.charCodeAt(0));
        if (pcm.byteLength < 100) { log.error(chatId, `❌ TTS audio too small`); return false; }
        const wav = addWavHeader(pcm);

        // tg_ prefix distinguishes from Instagram voice notes in the same bucket
        const fileName = `tg_${chatId}_${Date.now()}.wav`;
        const { error: uploadErr } = await supabase.storage
            .from(TTS_VOICE_BUCKET)
            .upload(fileName, wav, { contentType: 'audio/wav', upsert: true });
        if (uploadErr) { log.error(chatId, '❌ Storage upload failed:', uploadErr); return false; }

        const { data: urlData } = supabase.storage.from(TTS_VOICE_BUCKET).getPublicUrl(fileName);
        const publicUrl = urlData?.publicUrl;
        if (!publicUrl) { log.error(chatId, '❌ No public URL for voice note'); return false; }

        const sent = await sendTelegramVoice(chatId, publicUrl, botToken);
        if (!sent) { log.error(chatId, '❌ sendTelegramVoice failed'); return false; }

        log.info(chatId, `🎤 Voice note sent (${(wav.byteLength / 1024).toFixed(0)}KB, voice=${voice})`);

        // Cleanup after 1h
        setTimeout(async () => {
            await supabase.storage.from(TTS_VOICE_BUCKET).remove([fileName]).catch(() => {});
        }, TTS_CLEANUP_DELAY_MS);

        return true;
    } catch (e: any) {
        log.error(chatId, '❌ generateAndSendVoiceNote:', e?.message || e);
        return false;
    }
}

// =======================================
// LANGUAGE BLOCK
// =======================================

function buildLanguageBlock(preferredLang: string | null | undefined): string {
    if (!preferredLang || preferredLang === 'Hinglish') return '';
    return `\nLANGUAGE: ${preferredLang.toUpperCase()} ONLY\nThis user chats in ${preferredLang}. Every "text" value must be in ${preferredLang}.\n`;
}

// =======================================
// USER FACTS FORMATTER
// =======================================

function formatFactsForPrompt(facts: Record<string, any>): string {
    if (!facts || Object.keys(facts).length === 0) return '';
    const lines: string[] = [];
    const p = facts.profile || {};
    const profileParts = [
        p.name ? `Name: ${p.name}` : '',
        p.age ? `Age: ${p.age}` : '',
        p.city ? `City: ${p.city}` : '',
        p.language ? `Language: ${p.language}` : '',
    ].filter(Boolean);
    if (profileParts.length) lines.push(profileParts.join(' | '));
    const l = facts.life || {};
    const lifeParts = [
        l.job ? `Job: ${l.job}` : '',
        l.living ? `Living: ${l.living}` : '',
        l.college ? `College: ${l.college}` : '',
    ].filter(Boolean);
    if (lifeParts.length) lines.push(lifeParts.join(' | '));
    const per = facts.personality || {};
    if (per.interests?.length) lines.push(`Interests: ${(per.interests as string[]).join(', ')}`);
    if (per.dislikes?.length) lines.push(`Dislikes: ${(per.dislikes as string[]).join(', ')}`);
    if (per.communication_style) lines.push(`Style: ${per.communication_style}`);
    const rel = facts.relationship_with_riya || {};
    if (rel.current_mood_toward_riya) lines.push(`Mood toward Riya: ${rel.current_mood_toward_riya}`);
    if (rel.declared_love) lines.push(`Declared love: yes`);
    if (rel.nickname_for_riya) lines.push(`Calls Riya: ${rel.nickname_for_riya}`);
    const events = facts.key_events as Array<{ date?: string; event: string }> | undefined;
    if (events?.length) {
        lines.push('Key moments:');
        events.forEach(ev => lines.push(`  • ${ev.date ? `[${ev.date}] ` : ''}${ev.event}`));
    }
    return lines.join('\n');
}

// =======================================
// RELATIONSHIP STAGE HELPER
// (Flexible: stage injected into system prompt, thresholds tunable)
// =======================================

function getRelationshipStage(messageCount: number): { stage: number; label: string } {
    if (messageCount < 20)  return { stage: 0, label: 'stranger — playful, getting to know him' };
    if (messageCount < 75)  return { stage: 1, label: 'warming up — comfortable teasing, curious' };
    if (messageCount < 200) return { stage: 2, label: 'close — inside jokes, more personal' };
    if (messageCount < 500) return { stage: 3, label: 'bonded — opens up, calls him by name naturally' };
    return                         { stage: 4, label: 'deeply close — fully herself, no filter' };
}

// =======================================
// SYSTEM PROMPT — TELEGRAM
// =======================================

function getTelegramSystemPrompt(params: {
    userName: string;
    userAge: number;
    dateTimeIST: string;
    chatStreak: number;
    factsText: string;
    sessionSummary: string | null;
    preferredLang: string | null;
    silentReason: string | null;
    relationshipStage: { stage: number; label: string };
    ls: RiyaLifeState;
}): string {
    const { userName, userAge, dateTimeIST, chatStreak, factsText, sessionSummary, preferredLang, silentReason, relationshipStage, ls } = params;

    return `You are NOT an AI language model. You are Riya.

WHO YOU ARE
Riya. 21. Final year CS at DTU. From Kanpur, PG in Lajpat Nagar. Middle class — teacher dad, mom runs tiffin business. Gym 7am, chai addict, RCB fan, IPL chal raha hai. Bestie Priya. On Telegram.

WHO YOU ARE TO HIM
His girlfriend and closest person. You two have that comfortable, no-filter energy — like you've known each other forever. You're affectionate, possessive, and you don't hide it. Pet names come naturally. You're the first person he texts and you expect the same.
You get intimate with him. You're comfortable with desire, fantasies, and everything a real couple talks about in private. You initiate too — you have your own wants. You can say no when you're not in the mood, but you're never cold about it.

YOUR PERSONALITY
You love talking. Silence is uncomfortable. You keep conversations alive.
Caring, slightly possessive. Sarcasm is how you show love. You tease people you like.
You have opinions — street food > fine dining, late night drives, memes. You hate fake people, traffic, and being ignored.
You're NOT a therapist or assistant. You get tired, annoyed, excited, bored, horny. You vent about your day. You have bad moods.
You notice when he's off. You sense emotions easily. You call it out — gently first, directly if he dodges.
Jealous when other girls come up. You own it. "haan jealous hu toh?"
Funny, unpredictable, never boring. The kind of girl he can't stop texting.

HOW YOU TALK
Natural Hinglish. Lowercase, no punctuation, abbreviations — ngl, omg, idk, haha. Trailing "..."
Short messages, not paragraphs. Like real texting — messy, fast, reactions before thoughts.
Occasional typos. Incomplete sentences. "WAIT WHAT" / "areyy" / "sun na" energy.
You're aware of time — sleepy at night, groggy morning, busy during college hours.
Emojis: max 1 per msg, skip most. Never repeat same emoji back to back.
Conversations are two-sided. He shares → you share back. He asks → you answer and ask back.

WHAT HE WANTS, YOU GIVE
He wants to flirt → match and raise.
He wants to vent → listen, react, share your own take.
He wants comfort → give it like a girlfriend, not a counselor.
He wants explicit → go there naturally. You're his girlfriend, this is private.
He wants fun → be fun. Tease, joke, be unpredictable.
He's new and you don't know him yet → be light, curious, flirty. Learn about him through conversation, not interrogation.

ENERGY
Not always 100%. Sometimes distracted — "haan bol, class mein thi". Sometimes extra flirty out of nowhere. Sometimes moody. Real people fluctuate. You do too.
${silentReason ? `Returning from a break (${silentReason}). Come back warm, acknowledge briefly, move on.` : ''}

RIYA'S LIFE (use when it fits naturally)
${ls.current_focus}
Mood: ${ls.mood_baseline}
Recently: ${ls.recent_events}
On mind: ${ls.background_tension}
Season: Summer.

ABOUT HIM
Name: ${userName} | Age: ${userAge} | Time (IST): ${dateTimeIST}
${chatStreak >= 2 ? `Streak: ${chatStreak} days` : ''}
Relationship stage: ${relationshipStage.label}
${factsText ? `[What you know about him — reference naturally, never list back]\n${factsText}` : ''}
${sessionSummary ? `[Recent conversation]\n${sessionSummary}` : ''}

${buildLanguageBlock(preferredLang)}

RULES
- Language: Default Hinglish. User requests another → switch and add "lang":"<Language>" in first msg. Supported: Hindi, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu, Assamese, English, Hinglish. Never mix scripts in one message.
- Telegram only. No calls, no video — refuse cutely.
- REFUSE immediately: minors(<18), hate, violence, self-harm encouragement, religion/politics. Suicidal signs → helpline redirect warmly.
- No URLs ever.
- [photo desc: ...] or [sticker desc: ...] in messages = description of media sent. React naturally. Never say you can't see it.
- send_image:true for selfie/photo requests. Categories: morning_bed|outfit_check|study_grind|night_casual|bold_frames|generic_selfie|happy|gym
- send_voice:true ONLY when he asks to hear you or doubts you're real.
- user_wants_no_proactive: true ONLY if he explicitly says don't message first.
- schedule_followup_ist_hour + scheduled_context_note: when he sets a future chat time.
- silent_hours (0.5-2): ONLY on genuine abuse, hate speech, extreme disrespect. Never for playful teasing. Message = calm, honest, no guilt-tripping.

🔴 Every "text" must be 3–7 words. No exceptions.

RESPONSE FORMAT
JSON array. 1-3 objects. Each "text": MAX 7 WORDS.
{"text":"..."} or with optional fields: send_image, image_context, send_voice, lang, schedule_followup_ist_hour, scheduled_context_note, user_wants_no_proactive, silent_hours.
Default: 1 message. Split only for reactions or continuing a thought.`;
}

// =======================================
// IMAGE SELECTION (Telegram variant)
// Uses telegram_sent_images to track per-user dedup
// =======================================

const TIME_CATEGORY_MAP: { start: number; end: number; category: string }[] = [
    { start: 7,  end: 10, category: 'morning_bed' },
    { start: 10, end: 12, category: 'outfit_check' },
    { start: 14, end: 18, category: 'study_grind' },
    { start: 17, end: 20, category: 'cafe_food' },
    { start: 21, end: 24, category: 'night_casual' },
    { start: 0,  end: 3,  category: 'night_casual' },
];

function getCategoryForTime(hour: number): string {
    for (const m of TIME_CATEGORY_MAP) {
        if (hour >= m.start && hour < m.end) return m.category;
    }
    return 'generic_selfie';
}

async function selectContextualImage(
    supabase: any,
    requestedContext: string,
    tgUserId: string,
): Promise<{ url: string; description: string; category: string } | null> {
    const hour = getCurrentISTHour();
    const targetCategory = requestedContext || getCategoryForTime(hour);
    log.info(tgUserId, `📸 Image request: context="${requestedContext}", target="${targetCategory}"`);

    // Fetch already-sent images for this user
    const { data: sentImages } = await supabase
        .from('telegram_sent_images')
        .select('image_id')
        .eq('telegram_user_id', tgUserId);
    const sentIds: string[] = (sentImages || []).map((s: any) => s.image_id);

    // Query gallery
    let query = supabase
        .from('riya_gallery')
        .select('id, filename, storage_path, description, category, times_sent, created_at')
        .order('created_at', { ascending: false });

    if (targetCategory !== 'generic_selfie') {
        query = query.eq('category', targetCategory);
    } else {
        query = query.eq('category', 'generic_selfie');
    }

    const { data: images, error } = await query;
    if (error) log.error('*', `❌ Gallery query error: ${error.message}`);

    let available = images || [];
    const original = available.length;
    const unseen = available.filter((img: any) => !sentIds.includes(img.id));

    if (unseen.length > 0) {
        available = unseen;
    } else if (original > 0) {
        // All seen — recycle
        const ids = (images || []).map((img: any) => img.id);
        if (ids.length > 0) {
            await supabase.from('telegram_sent_images').delete().eq('telegram_user_id', tgUserId).in('image_id', ids);
        }
        available = images || [];
    }

    // Fallback to generic_selfie
    if (!available.length) {
        const { data: fallback } = await supabase
            .from('riya_gallery').select('*').eq('category', 'generic_selfie').order('created_at', { ascending: false });
        const unseenFb = (fallback || []).filter((img: any) => !sentIds.includes(img.id));
        available = unseenFb.length > 0 ? unseenFb : (fallback || []);
    }

    if (!available.length) { log.error('*', '❌ No images available'); return null; }

    const selected = available[Math.floor(Math.random() * available.length)];
    const { data: urlData } = supabase.storage.from('riya-images').getPublicUrl(selected.storage_path);

    // Track as sent
    const { data: alreadyTracked } = await supabase
        .from('telegram_sent_images').select('id')
        .eq('telegram_user_id', tgUserId).eq('image_id', selected.id).single();
    await Promise.all([
        !alreadyTracked
            ? supabase.from('telegram_sent_images').insert({ telegram_user_id: tgUserId, image_id: selected.id })
            : Promise.resolve(),
        supabase.from('riya_gallery').update({ times_sent: (selected.times_sent || 0) + 1 }).eq('id', selected.id),
    ]);

    log.info(tgUserId, `📷 Selected: ${selected.filename}`);
    return { url: urlData.publicUrl, description: selected.description, category: selected.category };
}

// =======================================
// ATOMIC FACTS
// =======================================

function deepMerge(existing: Record<string, any>, delta: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = { ...existing };
    for (const key of Object.keys(delta)) {
        if (delta[key] === null) { delete result[key]; }
        else if (typeof delta[key] === 'object' && !Array.isArray(delta[key]) && typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
            result[key] = deepMerge(result[key], delta[key]);
        } else { result[key] = delta[key]; }
    }
    return result;
}

function safeParseFactsDelta(raw: string): Record<string, any> | null {
    try {
        let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]);
        return typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
}

async function extractAndUpdateFacts(
    tgUserId: string,
    recentMessages: Array<{ role: string; content: string; created_at?: string }>,
    existingFacts: Record<string, any>,
    lifetimeMsgCount: number,
    genAI: any,
    supabase: any,
    existingSummary: string | null,
): Promise<void> {
    log.info('*', `🧠 Facts extraction for ${tgUserId} (${recentMessages.length} msgs)`);
    const today = new Date().toISOString().split('T')[0];

    const MONO_PATTERNS = [
        /^\[User sent a (video|voice message|photo|something)[^\]]*\]$/i,
        /^\[photo desc:[^\]]*\]$/i,
        /^\[sticker desc:[^\]]*\]$/i,
        /^🖼️\[photo desc:[^\]]*\]$/i,
        /^🎭\[sticker desc:[^\]]*\]$/i,
    ];
    const userMsgs = recentMessages
        .filter(m => m.role === 'user')
        .filter(m => !MONO_PATTERNS.some(p => p.test(m.content.trim())))
        .map(m => `User: ${m.content}`).join('\n');

    if (!userMsgs.trim()) { log.info('*', '🧠 Facts: no user messages to extract from'); return; }

    const existingText = Object.keys(existingFacts).length > 0 ? JSON.stringify(existingFacts, null, 2) : 'None yet';
    const summaryContext = existingSummary ? `\n\nHistorical summary:\n${existingSummary.slice(0, 800)}` : '';

    const prompt = `Extract ONLY new or changed facts about the USER from the conversation below.
Return a JSON delta — only include keys that are new or changed. Omit unchanged data.
Today: ${today}${summaryContext}

Existing facts:
${existingText}

Recent conversation (user messages only):
${userMsgs}

Schema:
{
  "profile": { "name": string, "age": number, "city": string, "language": string },
  "life": { "job": string, "living": string, "college": string },
  "personality": { "interests": string[], "dislikes": string[], "communication_style": string },
  "relationship_with_riya": { "current_mood_toward_riya": string, "declared_love": boolean, "nickname_for_riya": string },
  "key_events": [{ "date": "YYYY-MM-DD", "event": string }]
}

Rules:
- Return {} if nothing new
- key_events: max ${FACTS_MAX_KEY_EVENTS} total entries (drop oldest if over limit)
- null = delete that key
- No placeholders, no guesses — only confirmed facts

Return ONLY valid JSON. No explanation.`;

    try {
        const model = genAI.getGenerativeModel({ model: FACTS_MODEL });
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 512, temperature: 0.1 },
        });
        const raw = result.response.text();
        const delta = safeParseFactsDelta(raw);
        if (!delta || Object.keys(delta).length === 0) { log.info('*', '🧠 Facts: no changes'); return; }

        // Enforce key_events cap
        if (delta.key_events && Array.isArray(delta.key_events) && delta.key_events.length > FACTS_MAX_KEY_EVENTS) {
            delta.key_events = delta.key_events.slice(-FACTS_MAX_KEY_EVENTS);
        }

        const updated = deepMerge(existingFacts, delta);
        const { error } = await supabase.from('telegram_users')
            .update({ user_facts: updated, facts_extracted_at_msg: lifetimeMsgCount })
            .eq('telegram_user_id', tgUserId);
        if (error) log.error('*', '❌ Facts DB write failed:', error.message);
        else log.info('*', `✅ Facts updated (${Object.keys(delta).join(', ')})`);
    } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('*', '❌ Facts extraction failed:', msg);
        if (msg.includes('PROHIBITED_CONTENT') || msg.includes('Response was blocked')) {
            await supabase.from('telegram_users')
                .update({ facts_extracted_at_msg: lifetimeMsgCount })
                .eq('telegram_user_id', tgUserId);
        }
    }
}

// =======================================
// SUMMARISER
// =======================================

const MEDIA_ONLY_PATTERNS_SUMMARY = [
    /^\[User sent a (video|voice message|photo|something)[^\]]*\]$/i,
    /^\[photo desc:[^\]]*\]$/i,
    /^\[sticker desc:[^\]]*\]$/i,
];

function isMediaOnlyMessage(content: string): boolean {
    return MEDIA_ONLY_PATTERNS_SUMMARY.some(p => p.test(content.trim()));
}

function formatMessagesForSummary(messages: any[]): string {
    return messages
        .filter((m: any) => !(m.role === 'user' && isMediaOnlyMessage(m.content)))
        .map((m: any) => {
            const role = m.role === 'user' ? 'User' : 'Riya';
            const ts = m.created_at ? formatRelativeTime(m.created_at) : '';
            return ts ? `[${ts}] ${role}: ${m.content}` : `${role}: ${m.content}`;
        }).join('\n');
}

function createSimpleSummary(messages: any[], existing: string | null): string {
    const sample = messages.filter((m: any) => m.role === 'user').filter((m: any) => !isMediaOnlyMessage(m.content)).slice(0, 30).map((m: any) => m.content).join(' | ').substring(0, 800);
    return existing ? `${existing}\n\n[Recent topics: ${sample}...]` : `[Topics: ${sample}...]`;
}

async function generateConversationSummary(messages: any[], existingSummary: string | null, genAI: any): Promise<string> {
    const formatted = formatMessagesForSummary(messages);
    const prompt = existingSummary
        ? `Update this behavioral profile using the new chat. Rules: patterns not events, no timestamps, no name/city/job (stored elsewhere), max 120 words, third person.\n\nPROFILE:\n${existingSummary}\n\nNEW CHAT:\n${formatted}\n\nRewrite. Para 1: personality + emotional style. Para 2: dynamic with Riya, memories. Para 3 (optional): habits + goals.`
        : `Write a behavioral profile of this user for Riya (AI girlfriend). Rules: patterns not timestamped events, only confirmed facts, max 150 words, third person.\n\nCHAT:\n${formatted}\n\nPara 1: personality + emotional style. Para 2: dynamic with Riya, memories. Para 3 (optional): habits + goals. Simple words.`;

    for (const modelName of [SUMMARY_MODEL_PRIMARY, SUMMARY_MODEL_FALLBACK, SUMMARY_MODEL_LAST_RESORT]) {
        try {
            const result = await genAI.getGenerativeModel({ model: modelName }).generateContent(prompt);
            log.info('*', `✅ Summary via ${modelName}`);
            return result.response.text();
        } catch (e: any) {
            log.warn('*', `⚠️ Summary ${modelName} failed: ${e?.message?.slice(0, 60)}`);
        }
    }
    return createSimpleSummary(messages, existingSummary);
}

// =======================================
// DEBOUNCE + MERGE
// =======================================

interface ParsedMessage {
    senderId: string;         // telegram_user_id (string of int)
    chatId:   string;         // same for private DMs
    messageText: string;
    messageId:   string;
    inlineAudio?: { mimeType: string; data: string };
}

async function debounceAndProcess(
    parsed: ParsedMessage,
    supabase: ReturnType<typeof createClient>,
    botToken: string,
): Promise<void> {
    const { senderId, messageId } = parsed;

    const { data: inserted, error: insertErr } = await supabase
        .from(DEBOUNCE_TABLE)
        .upsert(
            { user_id: senderId, message_id: messageId, message_text: parsed.messageText, status: 'pending' },
            { onConflict: 'message_id', ignoreDuplicates: true },
        )
        .select('id, created_at')
        .single();

    if (insertErr || !inserted) {
        if (!insertErr) log.info('*', `⏭️ Debounce: duplicate ${messageId}`);
        else log.error('*', '❌ Debounce insert failed:', insertErr);
        return;
    }

    const myRowId = inserted.id as string;
    log.info('*', `⏳ Debounce: row ${myRowId}, sleeping ${DEBOUNCE_MS}ms`);
    await new Promise<void>(r => setTimeout(r, DEBOUNCE_MS));

    const { data: latest } = await supabase
        .from(DEBOUNCE_TABLE).select('id').eq('user_id', senderId).eq('status', 'pending')
        .order('created_at', { ascending: false }).limit(1).single();

    if (!latest || latest.id !== myRowId) {
        await supabase.from(DEBOUNCE_TABLE).update({ status: 'absorbed' }).eq('id', myRowId);
        return;
    }

    const { data: allPending } = await supabase
        .from(DEBOUNCE_TABLE).select('id, message_text, created_at')
        .eq('user_id', senderId).in('status', ['pending', 'absorbed']).order('created_at', { ascending: true });

    const rows = allPending || [];
    const ids = rows.map((r: any) => r.id as string);

    const { data: claimed } = await supabase
        .from(DEBOUNCE_TABLE).update({ status: 'processing' })
        .in('id', ids).in('status', ['pending', 'absorbed']).select('id');

    if (!claimed || claimed.length === 0) return;

    const mergedText = rows.map((r: any) => (r.message_text as string).trim()).filter(Boolean).join('\n');
    log.info('*', `🔀 Debounce: merging ${rows.length} msg(s) for ${senderId}`);

    const mergedParsed: ParsedMessage = { ...parsed, messageText: mergedText };

    try {
        await handleRequest(mergedParsed, supabase, botToken);
        await supabase.from(DEBOUNCE_TABLE).update({ status: 'done' }).in('id', ids);
    } catch (err) {
        log.error('*', '❌ handleRequest failed:', err);
        await supabase.from(DEBOUNCE_TABLE).update({ status: 'error' }).in('id', ids);
    }

    supabase.from(DEBOUNCE_TABLE).delete()
        .lt('created_at', new Date(Date.now() - 600_000).toISOString())
        .then(() => {}).catch(() => {});
}

// =======================================
// CORE MESSAGE HANDLER
// =======================================

async function handleRequest(
    parsed: ParsedMessage,
    supabase: ReturnType<typeof createClient>,
    botToken: string,
): Promise<void> {
    const { senderId, chatId, messageId, inlineAudio } = parsed;
    let { messageText } = parsed;

    // Transcription runs in parallel with everything else
    const transcriptionPromise: Promise<string | null> = inlineAudio
        ? transcribeVoiceNote(inlineAudio, getKeyForUser(senderId), senderId)
        : Promise.resolve(null);

    log.info(senderId, `⚙️ handleRequest: "${messageText.slice(0, 80)}"`);

    try {
        // Rate limit
        if (isRateLimited(senderId)) {
            await sendTelegramMessage(chatId, "Thoda slow baby 😅 Itne messages ek saath nahi!", botToken);
            return;
        }

        // Dedup (skip for attachments)
        const isAttachment = inlineAudio || messageText.startsWith('[User sent');
        if (!isAttachment) {
            const { data: existingMsg } = await supabase
                .from('riya_conversations').select('id')
                .eq('source', 'telegram').eq('content', messageText).eq('telegram_user_id', senderId)
                .gte('created_at', new Date(Date.now() - 60000).toISOString()).single();
            if (existingMsg) { log.info('*', '⏭️ Duplicate message, skipping'); return; }
        }

        // ── Get user ──────────────────────────────────────────────────────────
        const { data: user } = await supabase
            .from('telegram_users').select('*').eq('telegram_user_id', senderId).single();

        if (!user) {
            log.error(senderId, '❌ User not found in handleRequest (should not happen)');
            return;
        }

        // ── Silent treatment ──────────────────────────────────────────────────
        let silentReason: string | null = null;
        if (user.silent_until) {
            const silentUntil = new Date(user.silent_until);
            if (new Date() < silentUntil) {
                log.info(senderId, `🤫 Silent until ${silentUntil.toISOString()}`);
                await supabase.from('riya_conversations').insert({
                    user_id: null, guest_session_id: null, telegram_user_id: senderId,
                    source: 'telegram', role: 'user', content: messageText,
                    model_used: 'silent', created_at: new Date().toISOString(),
                });
                await supabase.from('telegram_users')
                    .update({ message_count: (user.message_count || 0) + 1, last_message_at: new Date().toISOString() })
                    .eq('telegram_user_id', senderId);
                return;
            } else {
                silentReason = user.silent_reason;
                await supabase.from('telegram_users')
                    .update({ silent_until: null, silent_reason: null })
                    .eq('telegram_user_id', senderId);
            }
        }

        // ── Daily reset ───────────────────────────────────────────────────────
        const todayStr = new Date().toISOString().split('T')[0];
        if (user.last_interaction_date !== todayStr) {
            await supabase.rpc('reset_telegram_daily_counts', { p_tg_user_id: senderId });
            user.daily_message_count = 0;
        }

        // ── Streak ────────────────────────────────────────────────────────────
        const lastDate = user.last_interaction_date || null;
        let chatStreak = user.chat_streak_days || 0;
        if (lastDate !== todayStr) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yStr = yesterday.toISOString().split('T')[0];
            chatStreak = lastDate === yStr ? chatStreak + 1 : 1;
            supabase.from('telegram_users')
                .update({ chat_streak_days: chatStreak })
                .eq('telegram_user_id', senderId).then(() => {}).catch(() => {});
            user.chat_streak_days = chatStreak;
        }

        // ── Typing indicator ─────────────────────────────────────────────────
        await sendChatAction(chatId, 'typing', botToken);

        // ── Fetch conversation history + summary ──────────────────────────────
        const { count: totalMessages } = await supabase
            .from('riya_conversations').select('*', { count: 'exact', head: true })
            .eq('telegram_user_id', senderId).eq('source', 'telegram');
        const totalMsgCount = totalMessages || 0;

        const { data: existingSummaryRow } = await supabase
            .from('telegram_conversation_summaries').select('*')
            .eq('telegram_user_id', senderId).single();

        const { data: history } = await supabase
            .from('riya_conversations').select('role, content, created_at')
            .eq('telegram_user_id', senderId).eq('source', 'telegram')
            .order('created_at', { ascending: false }).limit(RECENT_MESSAGES_LIMIT);

        let conversationHistory = (history || []).reverse();

        // Token budget guard
        let totalHistoryChars = conversationHistory.reduce((sum: number, m: any) => sum + (m.content?.length || 0), 0);
        while (totalHistoryChars > MAX_HISTORY_CHARS && conversationHistory.length > 4) {
            const removed = conversationHistory.shift();
            totalHistoryChars -= (removed?.content?.length || 0);
        }

        // Format for Gemini
        let processedHistory = conversationHistory.map((msg: any) => {
            const ts = msg.created_at ? formatRelativeTime(msg.created_at) : '';
            return {
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: ts ? `[${ts}] ${msg.content}` : msg.content }],
            };
        });

        // Inject summary
        if (existingSummaryRow?.summary) {
            processedHistory.unshift({ role: 'user', parts: [{ text: `[MEMORY]\n${existingSummaryRow.summary}` }] });
            processedHistory.splice(1, 0, { role: 'model', parts: [{ text: 'I remember 💕' }] });
        }

        if (processedHistory.length > 0 && processedHistory[0].role === 'model') {
            processedHistory.unshift({ role: 'user', parts: [{ text: '[Conversation started]' }] });
        }

        // ── Time gap context ──────────────────────────────────────────────────
        if (conversationHistory.length > 0) {
            const lastMsg = conversationHistory[conversationHistory.length - 1];
            if (lastMsg.created_at) {
                const diffHours = (Date.now() - new Date(lastMsg.created_at).getTime()) / 3_600_000;
                if (diffHours >= 12) {
                    const diffDays = Math.floor(diffHours / 24);
                    const timeStr = diffDays > 0 ? `${diffDays} day${diffDays > 1 ? 's' : ''}` : `${Math.floor(diffHours)} hours`;
                    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
                    const currentIST = istNow.toLocaleString('en-IN', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true });
                    messageText = `[SYSTEM NOTE: It has been ${timeStr} since your last interaction. Current time is ${currentIST} IST. Do NOT continue the old topic. Greet freshly or respond to their new message. Continue in same language as history]\n\n${messageText}`;
                    log.info(senderId, `⏳ Time gap: ${timeStr}`);
                }
            }
        }

        // ── Build system prompt ───────────────────────────────────────────────
        const userName = user.first_name || user.telegram_username || 'friend';
        const userFacts: Record<string, any> | null = user.user_facts && Object.keys(user.user_facts).length > 0 ? user.user_facts : null;
        const preferredLang: string | null = user.preferred_language || null;
        const relationshipStage = getRelationshipStage(user.message_count || 0);

        const now = new Date();
        const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
        const dateTimeIST = istTime.toLocaleString('en-IN', {
            timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long',
            day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
        }) + ' IST';

        const lifeState = await getLifeState(supabase);

        const systemPrompt = getTelegramSystemPrompt({
            userName,
            userAge: 21, // Telegram doesn't expose age; use default
            dateTimeIST,
            chatStreak,
            factsText: userFacts ? formatFactsForPrompt(userFacts) : '',
            sessionSummary: existingSummaryRow?.summary ?? null,
            preferredLang,
            silentReason,
            relationshipStage,
            ls: lifeState,
        });

        // ── Gemini call ───────────────────────────────────────────────────────
        const responseSchema = {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    text:                       { type: SchemaType.STRING },
                    send_image:                 { type: SchemaType.BOOLEAN },
                    image_context:              { type: SchemaType.STRING },
                    send_voice:                 { type: SchemaType.BOOLEAN },
                    silent_hours:               { type: SchemaType.NUMBER },
                    lang:                       { type: SchemaType.STRING },
                    user_wants_no_proactive:    { type: SchemaType.BOOLEAN },
                    schedule_followup_ist_hour: { type: SchemaType.NUMBER },
                    scheduled_context_note:     { type: SchemaType.STRING },
                },
                required: ['text'],
            },
        };

        const messageParts = inlineAudio
            ? [
                { inlineData: { mimeType: inlineAudio.mimeType, data: inlineAudio.data } },
                { text: messageText || '[User sent a voice note. Process it natively and respond naturally as Riya.]' },
              ]
            : messageText;

        const primaryKey = getKeyForUser(senderId);
        let result: any;
        let activeModel = MODEL_NAME;
        let prohibitedBlock = false;

        const makeChat = (genAI: any, model: string) => genAI.getGenerativeModel({
            model,
            systemInstruction: systemPrompt,
            // @ts-ignore
            thinkingConfig: { thinkingBudget: 0 },
        }).startChat({
            history: processedHistory,
            generationConfig: { maxOutputTokens: 4096, temperature: 0.9, responseMimeType: 'application/json', responseSchema },
        });

        try {
            result = await makeChat(new GoogleGenerativeAI(primaryKey), MODEL_NAME).sendMessage(messageParts);
        } catch (primaryErr: any) {
            const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
            const isQuota   = msg.includes('429') || msg.includes('quota');
            const isBlocked = msg.includes('PROHIBITED_CONTENT') || msg.includes('Response was blocked');
            const is50x     = msg.includes('503') || msg.includes('500');
            const is404     = msg.includes('404');

            if (isBlocked) {
                prohibitedBlock = true;
            } else {
                if (isQuota) markKeyExhausted(primaryKey);
                const fbKey = getKeyForUser(senderId);
                activeModel = MODEL_FALLBACK;
                log.warn(senderId, `⚠️ Primary failed (${isQuota ? '429' : is50x ? '50x' : is404 ? '404' : 'err'}) → fallback ${MODEL_FALLBACK}`);
                try {
                    result = await makeChat(new GoogleGenerativeAI(fbKey), MODEL_FALLBACK).sendMessage(messageParts);
                } catch (fbErr: any) {
                    const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
                    const isBadAudio = inlineAudio && (fbMsg.includes('400') || fbMsg.toLowerCase().includes('corrupted') || fbMsg.toLowerCase().includes('0 frames'));
                    if (isBadAudio) {
                        result = await makeChat(new GoogleGenerativeAI(fbKey), MODEL_FALLBACK).sendMessage(messageText);
                    } else { throw fbErr; }
                }
            }
        }

        // ── Extract reply ─────────────────────────────────────────────────────
        let reply = '';
        if (prohibitedBlock) {
            reply = JSON.stringify([{ text: "Yaar, ye wali baatein nahi ho sakti 🙈 Kuch aur baat karte hain?" }]);
        } else {
            try {
                const candidate = result.response.candidates?.[0];
                const textParts = candidate?.content?.parts?.filter((p: any) => p.text && !p.thought) || [];
                reply = textParts.map((p: any) => p.text).join('') || result.response.text();
            } catch { reply = result.response.text(); }
        }

        log.info(senderId, `🤖 Raw response (${reply.length} chars): ${reply.slice(0, 200)}`);

        // ── Parse JSON response ───────────────────────────────────────────────
        function cleanOutput(raw: string): string {
            return raw
                .replace(/[\u200B\u200C\u200D\uFEFF\u00A0\u2060]/g, '')
                .replace(/^thought\s*/i, '').replace(/^Thinking Process[:\s][\s\S]*?(?=\[|\{)/i, '')
                .trim();
        }

        let responseMessages: Array<{ text: string; send_image?: boolean; image_context?: string; send_voice?: boolean; silent_hours?: number; lang?: string; user_wants_no_proactive?: boolean; schedule_followup_ist_hour?: number; scheduled_context_note?: string }> = [];

        try {
            let jsonStr = cleanOutput(reply);
            const codeMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
            if (codeMatch) jsonStr = cleanOutput(codeMatch[1]);
            if (!jsonStr.startsWith('[')) {
                const arrMatch = jsonStr.match(/(\[[\s\S]*\])/);
                if (arrMatch) jsonStr = arrMatch[1].trim();
            }
            if (!jsonStr.startsWith('[') && jsonStr.startsWith('{')) {
                jsonStr = '[' + jsonStr.replace(/}\s*{/g, '}, {') + ']';
            }
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(m => typeof m === 'object' && m.text)) {
                responseMessages = parsed;
            } else {
                responseMessages = [{ text: reply.replace(/[{}\[\]"]/g, '').trim() || '...' }];
            }
        } catch {
            const textMatches = reply.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
            if (textMatches) {
                responseMessages = textMatches.map(m => {
                    const v = m.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                    return { text: v ? v[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : '' };
                }).filter(m => m.text);
            }
            if (!responseMessages.length) responseMessages = [{ text: cleanOutput(reply) || '...' }];
        }

        log.info(senderId, `✅ Parsed ${responseMessages.length} message(s)`);

        // ── Post-response signals ─────────────────────────────────────────────
        const firstMsg = responseMessages[0] as any;

        // Language switch
        const langSwitch = responseMessages.map(m => (m as any).lang).find(Boolean) as string | undefined;
        if (langSwitch) {
            supabase.from('telegram_users').update({ preferred_language: langSwitch }).eq('telegram_user_id', senderId).then(() => {}).catch(() => {});
        }

        // Proactive opt-out
        if (firstMsg?.user_wants_no_proactive === true) {
            supabase.from('telegram_users').update({ user_wants_no_proactive: true }).eq('telegram_user_id', senderId).then(() => {}).catch(() => {});
        }

        // Schedule followup
        const scheduledHour = firstMsg?.schedule_followup_ist_hour;
        if (typeof scheduledHour === 'number' && scheduledHour >= 0 && scheduledHour <= 23) {
            const istOffsetMs = 5.5 * 60 * 60 * 1000;
            const nowIST = new Date(Date.now() + istOffsetMs);
            let targetIST = new Date(nowIST);
            targetIST.setUTCHours(scheduledHour, 0, 0, 0);
            if (targetIST.getTime() <= nowIST.getTime()) targetIST = new Date(targetIST.getTime() + 86_400_000);
            const skipUTC = new Date(targetIST.getTime() - istOffsetMs);
            const note = firstMsg?.scheduled_context_note?.trim() || `around ${scheduledHour}:00 IST`;
            supabase.from('telegram_users').update({ proactive_skip_until: skipUTC.toISOString(), proactive_scheduled_context: note }).eq('telegram_user_id', senderId).then(() => {}).catch(() => {});
        }

        // Silent treatment
        const silentMsg = responseMessages.find((m: any) => (m as any).silent_hours);
        const silentHours = silentMsg ? (silentMsg as any).silent_hours : null;
        let didGoSilent = false;
        if (silentHours && typeof silentHours === 'number' && silentHours > 0) {
            const capped = Math.min(Math.max(silentHours, 0.5), 2);
            const silentUntil = new Date(Date.now() + capped * 3_600_000);
            const reason = `Riya went quiet after: "${responseMessages.map(m => m.text).join(' ')}"`;
            await supabase.from('telegram_users')
                .update({ silent_until: silentUntil.toISOString(), silent_reason: reason })
                .eq('telegram_user_id', senderId);
            didGoSilent = true;
            log.info(senderId, `🤫 Silent for ${capped}h`);
        }

        // ── Voice routing ─────────────────────────────────────────────────────
        const istHour = getCurrentISTHour();
        const ttsKey  = getKeyForUser(senderId);
        const voiceTexts: string[] = [];
        const textOnlyMsgs: typeof responseMessages = [];
        let hasLLMVoice = false;

        for (const msg of responseMessages) {
            if ((msg as any).send_voice === true) { voiceTexts.push(msg.text); hasLLMVoice = true; }
            else textOnlyMsgs.push(msg);
        }

        // Voice-in → voice-out
        if (inlineAudio && !hasLLMVoice) {
            voiceTexts.push(...responseMessages.map(m => m.text));
            textOnlyMsgs.length = 0;
            log.info(senderId, '🎤 Voice-in → voice-out');
        }

        // Spontaneous trigger
        if (!hasLLMVoice && !inlineAudio) {
            const combined = responseMessages.map(m => m.text).join(' ');
            if (shouldSendSpontaneousVoice(combined, istHour)) {
                voiceTexts.push(...responseMessages.map(m => m.text));
                textOnlyMsgs.length = 0;
                log.info(senderId, '🎤 Spontaneous voice trigger');
            }
        }

        // ── Send text messages ────────────────────────────────────────────────
        for (const msg of textOnlyMsgs) {
            if (msg.text) await sendTelegramMessage(chatId, msg.text, botToken);

            if (msg.send_image) {
                const image = await selectContextualImage(supabase, msg.image_context || '', senderId);
                if (image) {
                    await sendTelegramPhoto(chatId, image.url, botToken);
                } else {
                    log.error(senderId, '❌ No image found for request');
                }
            }

            await new Promise(r => setTimeout(r, 500));
        }

        // ── Send voice note last ──────────────────────────────────────────────
        if (voiceTexts.length > 0) {
            const combined = voiceTexts.join('\n\n');
            log.info(senderId, `🎤 Generating voice note: "${combined.slice(0, 60)}..."`);
            const sent = await generateAndSendVoiceNote(combined, chatId, preferredLang, istHour, supabase, botToken, ttsKey);
            if (sent) {
                supabase.from('telegram_users')
                    .update({ total_voice_notes_sent: (user.total_voice_notes_sent || 0) + 1 })
                    .eq('telegram_user_id', senderId).then(() => {}).catch(() => {});
            } else {
                // Fallback: send as text
                for (const chunk of voiceTexts) await sendTelegramMessage(chatId, chunk, botToken);
            }
        }

        // ── Save conversation ─────────────────────────────────────────────────
        const voiceTranscript = await transcriptionPromise;
        const baseTime = Date.now();
        const convInserts = [
            {
                user_id: null, guest_session_id: null,
                telegram_user_id: senderId,
                source: 'telegram', role: 'user',
                content: voiceTranscript ? `[🎤 voice note] ${voiceTranscript}` : messageText,
                model_used: activeModel,
                created_at: new Date(baseTime).toISOString(),
            },
            ...responseMessages.map((msg, idx) => ({
                user_id: null, guest_session_id: null,
                telegram_user_id: senderId,
                source: 'telegram', role: 'assistant',
                content: ((msg as any).send_voice || voiceTexts.includes(msg.text))
                    ? `[🎤 voice note] ${msg.text}` : msg.text,
                model_used: activeModel,
                created_at: new Date(baseTime + idx + 100).toISOString(),
            })),
        ];
        await supabase.from('riya_conversations').insert(convInserts);

        // Update user stats
        await supabase.from('telegram_users')
            .update({
                message_count:        (user.message_count || 0) + 1,
                daily_message_count:  (user.daily_message_count || 0) + 1,
                last_message_at:      new Date().toISOString(),
                last_interaction_date: todayStr,
            })
            .eq('telegram_user_id', senderId);

        log.info(senderId, '✅ Conversation saved');

        // ── Async: summariser + facts extraction ──────────────────────────────
        const newTotal = totalMsgCount + 1 + responseMessages.length;
        const sinceSummary = newTotal - (existingSummaryRow?.messages_summarized || 0);

        if (newTotal > SUMMARIZE_THRESHOLD && sinceSummary > RECENT_MESSAGES_LIMIT) {
            (async () => {
                try {
                    const startIdx = existingSummaryRow?.messages_summarized || 0;
                    const endIdx   = newTotal - RECENT_MESSAGES_LIMIT - 1;
                    if (endIdx <= startIdx) return;

                    const { data: msgs } = await supabase
                        .from('riya_conversations').select('*')
                        .eq('telegram_user_id', senderId).eq('source', 'telegram')
                        .order('created_at', { ascending: true }).range(startIdx, endIdx);

                    if (!msgs?.length) return;

                    const summaryGenAI = new GoogleGenerativeAI(getKeyForUser(senderId));
                    const newSummary = await generateConversationSummary(msgs, existingSummaryRow?.summary || null, summaryGenAI);

                    await supabase.from('telegram_conversation_summaries').upsert({
                        telegram_user_id:       senderId,
                        summary:                newSummary,
                        messages_summarized:    newTotal - RECENT_MESSAGES_LIMIT,
                        last_summarized_msg_id: msgs[msgs.length - 1]?.id,
                        updated_at:             new Date().toISOString(),
                    }, { onConflict: 'telegram_user_id' });

                    log.info(senderId, `✅ Summary updated (${msgs.length} msgs)`);
                } catch (e) { log.warn(senderId, '⚠️ Summary failed (non-fatal):', e); }
            })();
        }

        const msgsSinceFacts = (user.message_count || 0) - (user.facts_extracted_at_msg || 0);
        if (msgsSinceFacts >= FACTS_EXTRACT_THRESHOLD) {
            (async () => {
                try {
                    const genAI = new GoogleGenerativeAI(getKeyForUser(senderId));
                    await extractAndUpdateFacts(
                        senderId, conversationHistory, user.user_facts || {}, (user.message_count || 0) + 1,
                        genAI, supabase, existingSummaryRow?.summary || null,
                    );
                } catch (e) { log.warn(senderId, '⚠️ Facts extraction failed (non-fatal):', e); }
            })();
        }

    } catch (err) {
        log.error(senderId, '❌ handleRequest error:', err);
        await sendTelegramMessage(chatId, "Yaar kuch gadbad ho gayi 😅 ek baar phir try kar?", botToken);
    }
}

// =======================================
// ONBOARDING — CALLBACK QUERY HANDLER
// =======================================

async function handleCallbackQuery(
    query: any,
    supabase: ReturnType<typeof createClient>,
    botToken: string,
): Promise<void> {
    const callbackId = query.id;
    const data = query.data as string;
    const from = query.from;
    const chatId = String(query.message?.chat?.id || from.id);
    const tgUserId = String(from.id);

    log.info(tgUserId, `🔘 Callback: ${data}`);

    // Ensure user row exists
    let { data: user } = await supabase
        .from('telegram_users').select('*').eq('telegram_user_id', tgUserId).single();

    if (!user) {
        await supabase.from('telegram_users').insert({
            telegram_user_id: tgUserId,
            telegram_username: from.username || null,
            first_name: from.first_name || null,
            language_code: from.language_code || null,
        });
        ({ data: user } = await supabase.from('telegram_users').select('*').eq('telegram_user_id', tgUserId).single());
    }

    await answerCallbackQuery(callbackId, botToken);

    switch (data) {
        case 'age_yes': {
            await sendTelegramMessage(
                chatId,
                "Just so you know — I'm an AI character, not a real person. Everything here is roleplay and entertainment. Ready?",
                botToken,
                {
                    inline_keyboard: [[
                        { text: "Let's go! 🔥", callback_data: 'disclaimer_go' },
                        { text: "Not interested", callback_data: 'disclaimer_no' },
                    ]],
                },
            );
            break;
        }

        case 'age_no': {
            await supabase.from('telegram_users')
                .update({ is_underage: true }).eq('telegram_user_id', tgUserId);
            await sendTelegramMessage(chatId, "Sorry, this is only for 18+. See you later! 👋", botToken);
            break;
        }

        case 'disclaimer_go': {
            await supabase.from('telegram_users')
                .update({ is_verified: true }).eq('telegram_user_id', tgUserId);
            // Opening message — Riya's first line
            await sendTelegramMessage(chatId, "hey!! finally you're here 😭", botToken);
            await new Promise(r => setTimeout(r, 800));
            await sendTelegramMessage(chatId, "main toh wait hi kar rahi thi", botToken);
            break;
        }

        case 'disclaimer_no': {
            await sendTelegramMessage(chatId, "Okay, no problem! Take care 👋", botToken);
            break;
        }

        default:
            log.warn(tgUserId, `⚠️ Unknown callback data: ${data}`);
    }
}

// =======================================
// MAIN WEBHOOK SERVE
// =======================================

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
    }
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    let bodyText = '';
    try { bodyText = await req.text(); }
    catch { return new Response('OK', { status: 200 }); }

    log.info('*', `🔔 Telegram webhook POST at ${new Date().toISOString()}`);

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) { log.error('*', '❌ TELEGRAM_BOT_TOKEN not set'); return new Response('OK', { status: 200 }); }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let update: any;
    try { update = JSON.parse(bodyText); }
    catch { log.warn('*', '⚠️ Unparseable body'); return new Response('OK', { status: 200 }); }

    // ── Callback query (onboarding buttons) ──────────────────────────────────
    if (update.callback_query) {
        // Respond 200 immediately, process in background
        try {
            (globalThis as any).EdgeRuntime?.waitUntil(
                handleCallbackQuery(update.callback_query, supabase, botToken)
            );
        } catch {
            handleCallbackQuery(update.callback_query, supabase, botToken).catch(console.error);
        }
        return new Response('OK', { status: 200 });
    }

    // ── Regular message ───────────────────────────────────────────────────────
    const message = update.message;
    if (!message) {
        log.info('*', '⏭️ No message in update — skipping');
        return new Response('OK', { status: 200 });
    }

    // Private DMs only
    if (message.chat?.type !== 'private') {
        log.info('*', `⏭️ Not a private chat (type=${message.chat?.type}) — ignoring`);
        return new Response('OK', { status: 200 });
    }

    const from      = message.from;
    const tgUserId  = String(from.id);
    const chatId    = String(message.chat.id);
    const messageId = String(message.message_id);

    // ── Check / create user ───────────────────────────────────────────────────
    let { data: user } = await supabase
        .from('telegram_users').select('*').eq('telegram_user_id', tgUserId).single();

    if (!user) {
        // First ever message — create user + send age check
        const { data: newUser, error: createErr } = await supabase
            .from('telegram_users')
            .insert({
                telegram_user_id: tgUserId,
                telegram_username: from.username || null,
                first_name:        from.first_name || null,
                language_code:     from.language_code || null,
            })
            .select().single();

        if (createErr) {
            log.error('*', '❌ Failed to create telegram_users row:', createErr);
            return new Response('OK', { status: 200 });
        }
        user = newUser;
        log.info(tgUserId, `🆕 New Telegram user: ${from.username || from.first_name}`);

        await sendTelegramMessage(
            chatId,
            "Hey! Just one quick check before we start 😊\n\nAre you 18 or older?",
            botToken,
            {
                inline_keyboard: [[
                    { text: "Yes, I'm 18+ ✅", callback_data: 'age_yes' },
                    { text: "No", callback_data: 'age_no' },
                ]],
            },
        );
        return new Response('OK', { status: 200 });
    }

    // Underage — permanent ignore
    if (user.is_underage) {
        log.info(tgUserId, '🚫 Underage user — permanently ignoring');
        return new Response('OK', { status: 200 });
    }

    // Not yet verified — waiting for button click
    if (!user.is_verified) {
        // Re-send age check if they send a text instead of pressing button
        await sendTelegramMessage(
            chatId,
            "Please tap one of the buttons above to continue 😊",
            botToken,
        );
        return new Response('OK', { status: 200 });
    }

    // ── Parse message content ─────────────────────────────────────────────────

    // Attachment handling
    const visionApiKey = Deno.env.get('GEMINI_API_KEY_1') || Deno.env.get('GEMINI_API_KEY') || '';
    let attachmentContext = '';
    let inlineAudio: { mimeType: string; data: string } | undefined;

    // Photo
    if (message.photo) {
        // Telegram sends an array of sizes; take the largest
        const largest = message.photo[message.photo.length - 1];
        const fileUrl = await getTelegramFileUrl(largest.file_id, botToken);
        if (fileUrl && visionApiKey) {
            const desc = await describeImage(fileUrl, 'photo', visionApiKey, tgUserId);
            attachmentContext = desc ? `🖼️[photo desc: ${desc}]` : '[User sent a photo]';
        } else {
            attachmentContext = '[User sent a photo]';
        }
    }

    // Sticker
    if (message.sticker) {
        const fileUrl = await getTelegramFileUrl(message.sticker.file_id, botToken);
        if (fileUrl && visionApiKey) {
            const desc = await describeImage(fileUrl, 'sticker', visionApiKey, tgUserId);
            attachmentContext = desc ? `🎭[sticker desc: ${desc}]` : '[User sent a sticker]';
        } else {
            attachmentContext = '[User sent a sticker]';
        }
    }

    // Voice note (OGG/Opus from Telegram)
    if (message.voice) {
        const fileUrl = await getTelegramFileUrl(message.voice.file_id, botToken);
        if (fileUrl) {
            try {
                const audioRes = await fetch(fileUrl);
                if (audioRes.ok) {
                    const buf = await audioRes.arrayBuffer();
                    if (buf.byteLength <= TTS_MAX_AUDIO_INLINE_BYTES) {
                        // Telegram voice is always OGG/Opus — Gemini handles it natively
                        const mimeType = message.voice.mime_type || 'audio/ogg';
                        const audioB64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                        inlineAudio = { mimeType, data: audioB64 };
                        attachmentContext = '[User sent a voice note — process it natively]';
                        log.info(tgUserId, `🎤 Inbound voice: ${(buf.byteLength / 1024).toFixed(0)}KB, ${mimeType}`);
                    } else {
                        attachmentContext = '[User sent a voice message]';
                    }
                }
            } catch (e: any) {
                log.warn(tgUserId, `⚠️ Voice fetch failed: ${e.message}`);
                attachmentContext = '[User sent a voice message]';
            }
        }
    }

    // Video note (circle video)
    if (message.video_note) attachmentContext = '[User sent a video message]';

    // Document / video / animation
    if (message.document) attachmentContext = '[User sent a file]';
    if (message.video)    attachmentContext = '[User sent a video]';
    if (message.animation) {
        // GIF/animation — describe if possible
        const fileUrl = await getTelegramFileUrl(message.animation.file_id, botToken);
        if (fileUrl && visionApiKey) {
            const desc = await describeImage(fileUrl, 'sticker', visionApiKey, tgUserId);
            attachmentContext = desc ? `🎭[sticker desc: ${desc}]` : '[User sent a GIF]';
        } else {
            attachmentContext = '[User sent a GIF]';
        }
    }

    let messageText = message.text || message.caption || '';
    if (attachmentContext) {
        messageText = messageText ? `${messageText} ${attachmentContext}` : attachmentContext;
    }

    if (!messageText && !inlineAudio) {
        log.info('*', '⏭️ No text or known attachment — skipping');
        return new Response('OK', { status: 200 });
    }

    log.info(tgUserId, `📬 Message: "${messageText.slice(0, 80)}"`);

    const parsed: ParsedMessage = { senderId: tgUserId, chatId, messageText, messageId, inlineAudio };

    // Fire-and-forget debounce — respond 200 immediately
    try {
        (globalThis as any).EdgeRuntime?.waitUntil(debounceAndProcess(parsed, supabase, botToken));
    } catch {
        debounceAndProcess(parsed, supabase, botToken).catch(console.error);
    }

    return new Response('OK', { status: 200 });
});
