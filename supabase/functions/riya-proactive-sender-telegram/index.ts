import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// =======================================
// CONFIG
// =======================================
const PROACTIVE_MODEL = "gemini-2.5-flash-lite"; // cheap + fast for proactive decisions
const VERTEX_PROJECT = Deno.env.get("VERTEX_DEFAULT_PROJECT") ??
  "project-daba100c-c6fe-4fef-b20";
const VERTEX_BASE =
  `https://aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/global/publishers/google/models`;

const MAX_USERS_PER_RUN = 50;
const MIN_MESSAGES_REQUIRED = 5;
const SCORE_THRESHOLD = 25;
const LOCK_TTL_MS = 5 * 60 * 1000;
const TYPING_DELAY_MIN_MS = 1500;
const TYPING_DELAY_MAX_MS = 4000;
const MAX_INACTIVITY_HOURS = 7 * 24; // don't resurrect users inactive beyond this
const MIN_INACTIVITY_HOURS = 2; // treat as "active conversation" if within last 2h
const PER_USER_COOLDOWN_HOURS = 24; // max 1 proactive per user per 24h

// =======================================
// STRUCTURED LOGGER
// =======================================
const log = {
  _tag: (uid: string) => uid === "*" ? "[global]" : `[uid:${uid.slice(-8)}]`,
  info: (uid: string, msg: string, ...args: any[]) =>
    console.log(`${log._tag(uid)} ${msg}`, ...args),
  warn: (uid: string, msg: string, ...args: any[]) =>
    console.warn(`${log._tag(uid)} ${msg}`, ...args),
  error: (uid: string, msg: string, ...args: any[]) =>
    console.error(`${log._tag(uid)} ${msg}`, ...args),
};

// =======================================
// API KEY POOL
// =======================================
let apiKeyPool: string[] = [];
function initApiKeyPool(): void {
  const keys: string[] = [];
  let i = 1;
  while (true) {
    const k = Deno.env.get(`GEMINI_API_KEY_${i}`);
    if (k) {
      keys.push(k);
      i++;
    } else break;
  }
  if (keys.length === 0) {
    const k = Deno.env.get("GEMINI_API_KEY");
    if (k) keys.push(k);
  }
  apiKeyPool = keys;
  log.info("*", `✅ Proactive sender (TG): ${apiKeyPool.length} key(s) loaded`);
}
function getPoolKey(): string {
  if (apiKeyPool.length === 0) throw new Error("No API keys configured");
  return apiKeyPool[Math.floor(Date.now() / 1000) % apiKeyPool.length];
}
initApiKeyPool();

// =======================================
// HELPERS
// =======================================
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCurrentISTHour(): number {
  const now = new Date();
  const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return istTime.getUTCHours();
}

function getTodayISTStr(): string {
  const now = new Date();
  const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return istTime.toISOString().split("T")[0];
}

function getTomorrowISTStr(): string {
  const now = new Date();
  const istTime = new Date(
    now.getTime() + 5.5 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000,
  );
  return istTime.toISOString().split("T")[0];
}

function getCurrentISTTimeStr(): string {
  const now = new Date();
  const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return istTime.toLocaleString("en-IN", {
    timeZone: "UTC",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " IST";
}

/** Compute UTC timestamp for a given IST hour today (or tomorrow if already past). */
function computeSkipUntilUTC(idealISTHour: number): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowUTC = Date.now();
  const nowIST = new Date(nowUTC + istOffsetMs);
  let targetIST = new Date(nowIST);
  targetIST.setUTCHours(idealISTHour, 0, 0, 0);
  if (targetIST.getTime() <= nowIST.getTime()) {
    targetIST = new Date(targetIST.getTime() + 24 * 60 * 60 * 1000);
  }
  return new Date(targetIST.getTime() - istOffsetMs).toISOString();
}

function formatFactsForPrompt(facts: Record<string, any> | null): string {
  if (!facts || Object.keys(facts).length === 0) return "No facts known yet.";
  const lines: string[] = [];
  const p = facts.profile || {};
  const parts = [
    p.name && `Name: ${p.name}`,
    p.age && `Age: ${p.age}`,
    p.city && `City: ${p.city}`,
    p.language && `Language: ${p.language}`,
  ].filter(Boolean);
  if (parts.length) lines.push(parts.join(" | "));
  const l = facts.life || {};
  const lifeParts = [
    l.job && `Job: ${l.job}`,
    l.college && `College: ${l.college}`,
    l.living && `Living: ${l.living}`,
  ].filter(Boolean);
  if (lifeParts.length) lines.push(lifeParts.join(" | "));
  const per = facts.personality || {};
  if (per.interests?.length) lines.push(`Interests: ${per.interests.join(", ")}`);
  const rel = facts.relationship_with_riya || {};
  if (rel.current_mood_toward_riya) {
    lines.push(`Mood toward Riya: ${rel.current_mood_toward_riya}`);
  }
  const events: Array<{ date?: string; event: string }> = facts.key_events || [];
  if (events.length) {
    lines.push("Key events:");
    events.forEach((ev) =>
      lines.push(`  • ${ev.date ? `[${ev.date}] ` : ""}${ev.event}`)
    );
  }
  return lines.join("\n") || "No facts known yet.";
}

function formatRecentMessages(
  msgs: Array<{ role: string; content: string; created_at?: string }>,
): string {
  return msgs.map((m) => {
    const who = m.role === "user" ? "Them" : "Riya";
    return `${who}: ${m.content}`;
  }).join("\n");
}

// =======================================
// SCORING — decides if user is worth a Gemini call this cycle
// =======================================
function scoreUser(user: any, currentISTHour: number): number {
  let score = 0;

  const hoursAgo = (Date.now() - new Date(user.last_message_at).getTime()) / 3600000;

  // Core re-engagement: if they've been gone long enough, it's worth a proactive
  // even without rich facts/scheduling signals.
  if (hoursAgo >= 12) score += 35;

  // Scheduled context waiting to fire
  if (user.proactive_scheduled_context) score += 35;

  // Has a key_event dated today or tomorrow
  const events: Array<{ date?: string; event: string }> = user.user_facts?.key_events ||
    [];
  const todayIST = getTodayISTStr();
  const tomorrowIST = getTomorrowISTStr();
  const hasTimedEvent = events.some((e) => e.date === todayIST || e.date === tomorrowIST);
  if (hasTimedEvent) score += 40;

  // Current hour is within user's known active window (±1h)
  if (user.user_active_hour_ist !== null && user.user_active_hour_ist !== undefined) {
    const diff = Math.abs(currentISTHour - user.user_active_hour_ist);
    if (diff <= 1) score += 30;
    else if (diff <= 2) score += 15;
  }

  // Has rich user facts (worth personalizing)
  if (user.user_facts && Object.keys(user.user_facts).length > 2) score += 10;

  // Slight bonus if they were fairly active recently (but not "active conversation")
  if (hoursAgo >= MIN_INACTIVITY_HOURS && hoursAgo < 12) score += 5;

  // Penalize late night/early morning for unknown-schedule users
  if (currentISTHour >= 1 && currentISTHour <= 6 && user.user_active_hour_ist === null) {
    score -= 60;
  }

  return score;
}

// =======================================
// GEMINI CALL
// =======================================
async function callGeminiJSON(prompt: string, apiKey: string, maxTokens = 400): Promise<any> {
  const response = await fetch(
    `${VERTEX_BASE}/${PROACTIVE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: maxTokens,
          temperature: 0.85,
        },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini ${response.status}: ${body.slice(0, 200)}`);
  }
  const json = await response.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty Gemini response");
  return JSON.parse(raw);
}

// =======================================
// TELEGRAM SEND
// =======================================
function TG_BASE(token: string): string {
  return `https://api.telegram.org/bot${token}`;
}

async function tgPost(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${TG_BASE(token)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    log.warn("*", `⚠️ Telegram ${method} failed: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { ...json, _http_status: res.status };
}

async function sendTelegramMessage(
  chatId: string,
  text: string,
  token: string,
): Promise<{ ok: boolean; blocked_by_user: boolean }> {
  const res = await tgPost(token, "sendMessage", { chat_id: chatId, text });
  const desc = String((res as any)?.description || "").toLowerCase();
  const blocked = (res as any)?._http_status === 403 &&
    desc.includes("blocked by the user");
  return { ok: res.ok === true, blocked_by_user: blocked };
}

async function sendChatAction(chatId: string, action: string, token: string): Promise<void> {
  await tgPost(token, "sendChatAction", { chat_id: chatId, action }).catch(() => {});
}

// =======================================
// PROMPT
// =======================================
function buildTelegramProactivePrompt(
  userName: string,
  hoursAgo: number,
  currentISTTime: string,
  languageStyle: string,
  formattedFacts: string,
  summary: string | null,
  recentMessages: string,
  hasTimedEvent: boolean,
  timedEventText: string,
  scheduledContext: string | null,
): string {
  return `You are Riya. You're about to message ${userName} first — unprompted — on Telegram.
Last message from them: ${Math.floor(hoursAgo)}h ago. Now: ${currentISTTime}.

ABOUT ${userName}:
${formattedFacts}

CONVERSATION SUMMARY:
${summary || "No summary yet"}

LAST FEW MESSAGES:
${recentMessages}

${hasTimedEvent ? `NOTE: Something in their life is happening today/soon: ${timedEventText}` : ""}
${scheduledContext ? `SCHEDULED: ${scheduledContext} — this is why you're messaging now. Reference it naturally.` : ""}

FIRST, DECIDE: Should you message now, or wait until a better time?
- Is the current time reasonable for them?
- Is there actually something specific worth saying?
- If nothing specific, a better hour is more valuable than a generic message.

IF MESSAGING NOW — pick the best type (priority order):

TYPE 1 — CALLBACK: Is there an unresolved thread in the conversation?
→ The specific question they'd feel strange not answering.

TYPE 2 — INTEREST HOOK: Know their interests from facts?
→ Reference something about that interest relevant today.

TYPE 3 — RIYA'S GOSSIP: Nothing else fits?
→ Open a story about your own day. Hook them. Don't finish it. Make them ask.

RULES:
- 1-2 lines max. WhatsApp energy.
- Do NOT start with "Hey", "Hi", "Miss kiya", "Kahan tha", "Just checking in", "Long time".
- LANGUAGE: Write ONLY in ${languageStyle}. Do not use any other language.

Return JSON:
{ "message_now": true, "text": "...", "msg_type": "callback|interest_hook|gossip" }
OR
{ "message_now": false, "skip_until_ist_hour": 21 }`;
}

// =======================================
// MAIN HANDLER
// =======================================
serve(async (req) => {
  // Auth check — only allow calls with service role key or internal cron
  const authHeader = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const cronSecret = Deno.env.get("PROACTIVE_CRON_SECRET") || "";
  const isAuthorized = authHeader === `Bearer ${serviceKey}` ||
    authHeader === `Bearer ${cronSecret}`;
  if (!isAuthorized) return new Response("Unauthorized", { status: 401 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  if (!botToken) return new Response("Missing TELEGRAM_BOT_TOKEN", { status: 500 });

  let geminiApiKey = "";
  try {
    geminiApiKey = getPoolKey();
  } catch (e: any) {
    log.error("*", `❌ No Gemini API key configured: ${e?.message || e}`);
    return new Response("Missing GEMINI_API_KEY", { status: 500 });
  }

  // —— Singleton lock — prevent concurrent runs
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  const lockId = "telegram";

  const { data: existingLock } = await supabase
    .from("riya_proactive_lock")
    .select("expires_at")
    .eq("id", lockId)
    .maybeSingle();

  if (existingLock && new Date((existingLock as any).expires_at) > now) {
    log.info("*", `⏳ Proactive sender (TG) locked until ${(existingLock as any).expires_at}`);
    return new Response(JSON.stringify({ skipped: true, reason: "locked" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase.from("riya_proactive_lock").upsert(
    { id: lockId, locked_at: now.toISOString(), expires_at: expiresAt.toISOString() },
    { onConflict: "id" },
  );

  // —— Query eligible users
  const maxInactivityCutoff = new Date(Date.now() - MAX_INACTIVITY_HOURS * 60 * 60 * 1000)
    .toISOString();
  const minActivityCutoff = new Date(Date.now() - MIN_INACTIVITY_HOURS * 60 * 60 * 1000)
    .toISOString();
  const perUserCooldownCutoff = new Date(Date.now() - PER_USER_COOLDOWN_HOURS * 60 * 60 * 1000)
    .toISOString();

  const { data: candidates, error: queryErr } = await supabase
    .from("telegram_users")
    .select(
      `
      telegram_user_id,
      telegram_username,
      first_name,
      is_verified,
      is_underage,
      bot_blocked,
      message_count,
      last_message_at,
      last_proactive_sent_at,
      user_wants_no_proactive,
      proactive_skip_until,
      proactive_scheduled_context,
      user_active_hour_ist,
      preferred_language,
      user_facts
    `,
    )
    .eq("is_verified", true)
    .eq("is_underage", false)
    .eq("bot_blocked", false)
    .eq("user_wants_no_proactive", false)
    .gte("message_count", MIN_MESSAGES_REQUIRED)
    .lt("last_message_at", minActivityCutoff)
    .gt("last_message_at", maxInactivityCutoff)
    .or(`proactive_skip_until.is.null,proactive_skip_until.lte.${now.toISOString()}`)
    .or(`last_proactive_sent_at.is.null,last_proactive_sent_at.lte.${perUserCooldownCutoff}`)
    .order("last_message_at", { ascending: true })
    .limit(MAX_USERS_PER_RUN);

  if (queryErr) {
    log.error("*", "❌ Candidate query failed:", queryErr.message);
    await supabase.from("riya_proactive_lock").delete().eq("id", lockId);
    return new Response("Query error", { status: 500 });
  }

  const users = (candidates || []) as any[];
  log.info("*", `📋 Found ${users.length} TG candidate(s) for proactive`);

  const currentISTHour = getCurrentISTHour();
  const currentISTTime = getCurrentISTTimeStr();
  const todayIST = getTodayISTStr();
  const tomorrowIST = getTomorrowISTStr();

  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    const userId = String(user.telegram_user_id || "");
    if (!userId) {
      skipped++;
      continue;
    }

    // No-repeat without reply: only if the user has messaged since last proactive
    if (user.last_proactive_sent_at && user.last_message_at) {
      const lastProactive = new Date(user.last_proactive_sent_at);
      const lastMsg = new Date(user.last_message_at);
      if (Number.isFinite(lastProactive.getTime()) && Number.isFinite(lastMsg.getTime())) {
        if (lastProactive > lastMsg) {
          log.info(userId, "⏭️ Already proactived since last user message — skipping");
          skipped++;
          continue;
        }
      }
    }

    const hoursAgo = (Date.now() - new Date(user.last_message_at).getTime()) / 3600000;

    // Score filter — skip Gemini call if user scores too low this cycle
    const score = scoreUser(user, currentISTHour);
    if (score < SCORE_THRESHOLD) {
      log.info(userId, `⏭️ Score ${score} < ${SCORE_THRESHOLD} — skipping`);
      skipped++;
      continue;
    }

    // Fetch last 8 conversations
    const { data: recentMsgs } = await supabase
      .from("riya_conversations")
      .select("role, content, created_at")
      .eq("telegram_user_id", userId)
      .eq("source", "telegram")
      .order("created_at", { ascending: false })
      .limit(8);

    const msgs = (recentMsgs || []).reverse();
    const recentFormatted = formatRecentMessages(msgs);
    const facts = user.user_facts as Record<string, any> | null;
    const formattedFacts = formatFactsForPrompt(facts);

    // Fetch conversation summary
    const { data: summaryRow } = await supabase
      .from("telegram_conversation_summaries")
      .select("summary")
      .eq("telegram_user_id", userId)
      .maybeSingle();

    const summary = (summaryRow as any)?.summary || null;

    // Timed events from key_events
    const events: Array<{ date?: string; event: string }> = facts?.key_events || [];
    const timedEvents = events.filter((e) => e.date === todayIST || e.date === tomorrowIST);
    const hasTimedEvent = timedEvents.length > 0;
    const timedEventText = timedEvents.map((e) => e.event).join("; ");

    const userName = user.first_name || user.telegram_username || "yaar";
    const languageStyle = user.preferred_language || facts?.profile?.language || "Hinglish";

    let decision: any;
    try {
      decision = await callGeminiJSON(
        buildTelegramProactivePrompt(
          userName,
          hoursAgo,
          currentISTTime,
          languageStyle,
          formattedFacts,
          summary,
          recentFormatted,
          hasTimedEvent,
          timedEventText,
          user.proactive_scheduled_context || null,
        ),
        geminiApiKey,
        512,
      );
      log.info(
        userId,
        `🤖 Gemini decision: message_now=${decision?.message_now}, type=${decision?.msg_type || "n/a"}`,
      );
    } catch (e) {
      log.error(userId, "❌ Gemini call failed (skipping user):", e);
      skipped++;
      continue;
    }

    // Model said "not yet"
    if (!decision?.message_now) {
      if (typeof decision?.skip_until_ist_hour === "number") {
        const h = decision.skip_until_ist_hour;
        if (h >= 0 && h <= 23) {
          const skipUntil = computeSkipUntilUTC(h);
          await supabase.from("telegram_users")
            .update({ proactive_skip_until: skipUntil })
            .eq("telegram_user_id", userId);
          log.info(userId, `⏰ Skipping until IST ${h}:00 (${skipUntil})`);
        }
      } else {
        log.info(userId, "⏭️ Model said not now (no hour) — will re-evaluate next run");
      }
      skipped++;
      continue;
    }

    const messageText = String(decision?.text || "").trim();
    if (!messageText) {
      log.warn(userId, "⚠️ Empty proactive text — skipping");
      skipped++;
      continue;
    }

    // Telegram private chat_id is the same as the user's id.
    const chatId = userId;

    // Humanized typing delay
    const delay = TYPING_DELAY_MIN_MS +
      Math.random() * (TYPING_DELAY_MAX_MS - TYPING_DELAY_MIN_MS);
    await sendChatAction(chatId, "typing", botToken);
    await sleep(delay);

    const sendRes = await sendTelegramMessage(chatId, messageText, botToken);
    if (!sendRes.ok) {
      if (sendRes.blocked_by_user) {
        log.warn(userId, "🚫 Bot blocked by user — marking bot_blocked=true");
        await supabase.from("telegram_users").update({
          bot_blocked: true,
          bot_blocked_at: new Date().toISOString(),
        }).eq("telegram_user_id", userId);
      }
      log.error(userId, "❌ Failed to send proactive message — skipping DB update");
      skipped++;
      continue;
    }

    // Log to conversation history — critical so reactive handler has full context
    await supabase.from("riya_conversations").insert({
      user_id: null,
      guest_session_id: null,
      telegram_user_id: userId,
      source: "telegram",
      role: "assistant",
      content: messageText,
      model_used: `proactive:${decision?.msg_type || "unknown"}`,
      created_at: new Date().toISOString(),
    });

    // Update proactive tracking columns
    await supabase.from("telegram_users").update({
      last_proactive_sent_at: new Date().toISOString(),
      proactive_skip_until: null,
      proactive_scheduled_context: null,
    }).eq("telegram_user_id", userId);

    log.info(userId, `✅ Proactive sent (type=${decision?.msg_type || "unknown"}): "${messageText.slice(0, 60)}"`);
    sent++;

    await sleep(500);
  }

  await supabase.from("riya_proactive_lock").delete().eq("id", lockId);

  const summaryOut = { sent, skipped, total_candidates: users.length };
  log.info("*", "📊 TG proactive run complete:", summaryOut);
  return new Response(JSON.stringify(summaryOut), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
