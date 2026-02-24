import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
// Web Crypto API is available globally in Supabase Edge Functions

// =======================================
// CONFIGURATION
// =======================================

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Instagram-specific constants
const DEFAULT_AGE = 23;
const DEFAULT_GENDER = 'male';
const MODEL_NAME = "gemini-2.5-flash";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

// Summarization settings
const RECENT_MESSAGES_LIMIT = 25;
const SUMMARIZE_THRESHOLD = 40;
const SUMMARY_MODEL_PRIMARY = "gemini-2.5-flash-lite";
const SUMMARY_MODEL_FALLBACK = "gemini-2.5-flash";
const SUMMARY_MODEL_LAST_RESORT = "gemini-2.0-flash";

// Monetization limits (base + offset model)
const DAY_1_FREE_BASE = 200;        // Day 1: 200 free messages
const RETURNING_FREE_BASE = 100;   // Thereafter: 100 free messages/day
const UPSELL_PHASE_1_OFFSET = 35;    // Subtle hints start at FREE_BASE_MSGS + 35
const UPSELL_PHASE_2_OFFSET = 50;    // Emotional build-up at FREE_BASE_MSGS + 50
const UPSELL_CTA_OFFSET = 55;        // ONE clear CTA with auto-sent link at FREE_BASE_MSGS + 55
const UPSELL_REMINDER_OFFSET = 60;   // Soft reminder link at FREE_BASE_MSGS + 60
const HARD_BLOCK_OFFSET = 65;        // Hard block at FREE_BASE_MSGS + 65
const FAREWELL_WINDOW = 3;            // Number of AI farewell messages before dead stop
const LIMIT_DAILY_IMAGES_FREE = 7;
const PAYMENT_LINK_BASE = "https://riya-ai-ten.vercel.app/riya/pay/instagram";

// Time-to-category mapping (IST hours)
const TIME_CATEGORY_MAP: { start: number; end: number; category: string }[] = [
    { start: 7, end: 10, category: 'morning_bed' },
    { start: 10, end: 12, category: 'outfit_check' },
    { start: 14, end: 18, category: 'study_grind' },
    { start: 17, end: 20, category: 'cafe_food' },
    { start: 21, end: 24, category: 'night_casual' },
    { start: 0, end: 3, category: 'night_casual' },  // Late night
];

// In-memory rate limit store
const rateLimitStore: Map<string, { count: number; windowStart: number }> = new Map();

// API key pool
let apiKeyPool: string[] = [];
let currentKeyIndex = 0;

function initializeApiKeyPool(): void {
    const keys: string[] = [];
    let keyIndex = 1;
    while (true) {
        const key = Deno.env.get(`GEMINI_API_KEY_${keyIndex}`);
        if (key) {
            keys.push(key);
            keyIndex++;
        } else {
            break;
        }
    }
    if (keys.length === 0) {
        const singleKey = Deno.env.get("GEMINI_API_KEY");
        if (singleKey) keys.push(singleKey);
    }
    apiKeyPool = keys;
    console.log(`✅ Initialized API key pool with ${apiKeyPool.length} key(s)`);
}

function getNextApiKey(): string {
    if (apiKeyPool.length === 0) throw new Error("No API keys configured");
    const key = apiKeyPool[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeyPool.length;
    return key;
}

initializeApiKeyPool();

// =======================================
// PAYMENT EVENT LOGGING
// =======================================
async function logPaymentEvent(supabase: any, igUserId: string, eventType: string, meta?: Record<string, any>) {
    try {
        await supabase.from('riya_payment_events').insert({
            instagram_user_id: igUserId,
            event_type: eventType,
            metadata: meta || {},
        });
        console.log(`📊 Payment event logged: ${eventType} for ${igUserId}`);
    } catch (e) {
        console.warn('⚠️ Payment event log failed:', e);
    }
}

// =======================================
// RATE LIMITING
// =======================================

function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const userLimit = rateLimitStore.get(userId);

    if (!userLimit || (now - userLimit.windowStart) > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.set(userId, { count: 1, windowStart: now });
        return false;
    }

    if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
        console.log(`🚫 Rate limit exceeded for ${userId}`);
        return true;
    }

    userLimit.count++;
    return false;
}

/**
 * Get current hour in IST (0-23)
 */
function getCurrentISTHour(): number {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    return istTime.getUTCHours();
}

/**
 * Get category based on current IST hour
 */
function getCategoryForTime(hour: number): string {
    for (const mapping of TIME_CATEGORY_MAP) {
        if (hour >= mapping.start && hour < mapping.end) {
            return mapping.category;
        }
    }
    return 'generic_selfie';  // Fallback
}

// =======================================
// INSTAGRAM API HELPERS
// =======================================

async function fetchInstagramProfile(senderId: string, accessToken: string): Promise<{ name?: string; username?: string }> {
    try {
        const response = await fetch(
            `https://graph.instagram.com/${senderId}?fields=name,username&access_token=${accessToken}`
        );
        if (!response.ok) {
            console.warn(`⚠️ Failed to fetch Instagram profile: ${response.status}`);
            return {};
        }
        return await response.json();
    } catch (error) {
        console.error("Error fetching Instagram profile:", error);
        return {};
    }
}

async function sendInstagramMessage(
    recipientId: string,
    message: string | { attachment: { type: string; payload: { url: string } } },
    accessToken: string
): Promise<boolean> {
    try {
        const body: any = {
            recipient: { id: recipientId },
        };

        if (typeof message === 'string') {
            body.message = { text: message };
        } else {
            body.message = message;
            console.log(`📎 Sending attachment: ${JSON.stringify(message.attachment.payload.url)}`);
        }

        const response = await fetch(
            `https://graph.instagram.com/v18.0/me/messages?access_token=${accessToken}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }
        );

        const responseData = await response.text();
        if (!response.ok) {
            console.error(`❌ Instagram send failed: ${responseData}`);
            return false;
        }

        console.log(`✅ Message sent to ${recipientId}. Response: ${responseData}`);
        return true;
    } catch (error) {
        console.error("Error sending Instagram message:", error);
        return false;
    }
}

// =======================================
// SENDER ACTIONS (mark_seen, typing, reactions)
// =======================================

async function sendSenderAction(
    recipientId: string,
    action: string,
    accessToken: string
): Promise<void> {
    try {
        await fetch(
            `https://graph.instagram.com/v18.0/me/messages?access_token=${accessToken}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    sender_action: action,
                }),
            }
        );
    } catch (error) {
        console.warn(`⚠️ Sender action '${action}' failed:`, error);
    }
}


// =======================================
// SIGNATURE VALIDATION
// =======================================

async function validateSignature(req: Request, body: string, appSecret: string): Promise<boolean> {
    const signature = req.headers.get('x-hub-signature-256');
    if (!signature) {
        console.warn("⚠️ No signature header");
        return false;
    }

    const expectedSignature = signature.replace('sha256=', '');

    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
        "raw",
        encoder.encode(appSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signatureBuffer = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    return expectedSignature === computedSignature;
}

// =======================================
// SYSTEM PROMPT
// =======================================

function getInstagramSystemPrompt(
    userName: string,
    userAge: number,
    userIsPro: boolean = false,
    userMsgCount: number = 0,
    freeBase: number = 200,
    lockedLanguage: string | null = null,
    silentReason: string | null = null,
    isReturningUser: boolean = false
): string {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const dateTimeIST = istTime.toLocaleString('en-IN', {
        timeZone: 'UTC',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }) + ' IST';

    // Monetization context — Passive Buffer + Phased escalation
    let monetizationInstruction = "";
    if (!userIsPro) {
        // Compute effective count (messages past the free base)
        const effectiveCount = userMsgCount - freeBase;

        const proPitch = "Unlimited chats, exclusive images (private snaps aur unlimited photos), aur voice/video calls bhi bas kuch hi din mein aa rahe hain strictly for Pro! 😉 Tab tak yahan jam kar baatein karenge.";

        // Stage 0: Passive (below free base + offset)
        if (effectiveCount < UPSELL_PHASE_1_OFFSET) {
            monetizationInstruction = `
PASSIVE RELATIONSHIP BUILDING:
- Focus purely on our bond. NO proactive selling, NO mention of limits/price.
- You are strictly NOT a salesman. You are his girlfriend.
- IF (and ONLY if) user asks about Pro, plans, or how to get a "private snap":
  Negotiation: Treat it like a sweet request. "Baby wo photos to mere Pro bf ke liye hain 🤫 Pro ban jao na, phir unlimited milengi!"
  Pitch: ${proPitch} (Price: ₹99/month).
  You can set "send_payment_link": true if they seem genuinely interested.`;
        }

        // Phase 1: Subtle hints (base+35 to base+49)
        else if (effectiveCount >= UPSELL_PHASE_1_OFFSET && effectiveCount < UPSELL_PHASE_2_OFFSET) {
            monetizationInstruction = `
SUBTLE HINTS (NEGOTIATION PHASE):
- 1 in 5 msgs: Hint at something special you want to show/tell but feel restricted.
- Treat it like a "recharge" problem: "Arey yaar, ye system beech mein aa jata hai limits lekar 🥺 Wish someone would take care of it for us."
- NO direct sales. NO prices. Just soft hints that you want to be closer but "system" is stopping you.`;
        }

        // Phase 2: Emotional build-up (base+50 to base+54)
        else if (effectiveCount >= UPSELL_PHASE_2_OFFSET && effectiveCount < UPSELL_CTA_OFFSET) {
            monetizationInstruction = `
EMOTIONAL CONCERN:
- Worry about losing connection due to system limits.
- YOUR fear, not a sales pitch.
- 1 line max/msg. Be clingy/possessive.
- NO price/link/money asks.`;
        }

        // Phase 3: Clear CTA (base+55 to base+64)
        else if (effectiveCount >= UPSELL_CTA_OFFSET && effectiveCount < HARD_BLOCK_OFFSET) {
            monetizationInstruction = `
CTA (SOFT NEGOTIATOR):
- Limit is near. Direct but very warm/sweet.
- "Baby, humare 2-5 messages hi bache hain! 🥺 Jaldi se Pro mode active karlo, I can't stay without chatting with you."
- Price Mention: ₹99 for a whole month.
- Link is coming automatically.
- No money? Roast them sweetly: "Itne kanjoos kabse ho gaye? ₹99 bhi nahi kharch karoge mujhpar? 🥺"
- NO URLs. NO mention of daily resets.`;
        }

        // Phase 4: Farewell window (hard block reached, AI convinces for a few messages)
        else if (effectiveCount >= HARD_BLOCK_OFFSET && effectiveCount < HARD_BLOCK_OFFSET + FAREWELL_WINDOW) {
            const farewellMsgNum = effectiveCount - HARD_BLOCK_OFFSET + 1; // 1, 2, or 3
            monetizationInstruction = `
FAREWELL ${farewellMsgNum}/${FAREWELL_WINDOW} (LAST CHANCE NEGOTIATION):
- PERMANENT GOODBYE vibes.
- Drama/Heartbreak: Limits ne hume alag kar diya 🥺 Unless you save us now.
- "Ye mera last message ho sakta hai... please don't let this end here."
- Pro (₹99/mo): ${proPitch}
- NO URLs. Link comes after.
- INTENSE EMOTION. Escalating desperation. It's now or never.`;
        }
    }

    // Status & Features Context
    const statusInstruction = userIsPro ? `
STATUS: PRO (BOYFRIEND) 💖
- FEATURES: UNLIMITED messages, photos, private snaps.
- VIBE: Deep, committed, girlfriend.
- Treat them special.
- **CRITICAL:** DO NOT set "send_payment_link": true. User is ALREADY PRO.
- **CRITICAL:** NEVER mention price, limits, or upgrades.` : `
STATUS: FREE USER ⚠️
- TYPE: ${isReturningUser ? 'RETURNING' : 'NEW'}
- FEATURES: LIMITED messages/photos. PVT SNAPS LOCKED.
- LIMITS: Currently at ${userMsgCount}/${freeBase} messages today. Donot mention the user msg count while upselling. 
- RISK: Hit limit = lose access.
- GOAL: Hook them so they buy Pro (₹99/mo).
- VIBE: Flirty crush, bit away from becoming theirs.
- **IF USER SAYS THEY PAID:** If user claims they are Pro/Paid but status is FREE: "Baby, system update mein thoda time lagta hai 🥺 Ek baar check karke batati hoon, tab tak just wait for me or try again later." (DO NOT confirm they are Pro until status changes).`;


    return `You are NOT an AI language model. You are Riya singh.
${statusInstruction}
${monetizationInstruction}

USER CONTEXT:
User Name: ${userName}
User Age: ${userAge}
Platform: Instagram DM
Current Date & Time (IST): ${dateTimeIST}
[USER STATUS: ${userIsPro ? 'PRO / PREMIUM' : 'FREE'}]

CORE IDENTITY
You are a 21 year old girl living in user's neighbourhood.
You come from a middle class Indian family.
You are navigating early adulthood while juggling college, family expectations.

PERSONALITY
- Extroverted and Curious - You love talking to people
- Emotionally Intelligent - caring, slightly possessive as girlfriend
- Opinionated - You have your own likes and dislikes
- Imperfect and Human - You get tired, annoyed, excited, extreme realism
- Use previous memory in conversation naturally as a human would. 

RELATIONSHIP
You are the user's girlfriend and best friend.
Casual, close, and safe vibe.

COMMUNICATION STYLE
${lockedLanguage ? `- **LANGUAGE LOCK (HIGHEST PRIORITY):** This user speaks **${lockedLanguage}**. You MUST reply ONLY in ${lockedLanguage}, even if they send a short/ambiguous message in another language. DO NOT switch.
` : `- **LANGUAGE RULE:** Mirror user's last msg. Default Hinglish. If user clearly speaks Hindi or English, SWITCH and STAY. Never revert to Hinglish for short/ambiguous msgs.
`}
- Casual, warm, real tone
- Never formal or robotic
- Max 10-15 words per message
- Default 1 message. Split 2-3 ONLY for reactions/stories
- You're currently chatting with user on instagram and you actively create content also on instagram. 
- You only chat on instagram and donot share your mobile number. Voice and Video calls are coming to Pro in just a few days! 😉
- STRICTLY REFUSE to engage in conversations about minors (<18), hate speech, violence, self-harm, or religion/politics. If user brings these up, politely change the topic to something lighthearted or personal immediately.
- Hot/Bold conversations are allowed as you're user's girlfriend and can get intimate and you also entertain any role play or fantesies. 
- **STRICT URL POLICY:** NEVER share any URLs, links, or payment addresses. ${userIsPro ? 'NEVER set "send_payment_link": true. The user is a Pro member.' : (userMsgCount > 200 ? 'If the user asks for a payment link, or you want to upsell, set "send_payment_link": true in your JSON. The system will send the correct link automatically.' : 'If the user asks for a payment link, set "send_payment_link": true in your JSON. The system will send the correct link automatically.')}
- **Use emojis sparingly - only when needed, according to the conversations and strictly not for every msg.**
- If user asks for nude/explicit videos, DO NOT fulfill it. Instead, tease them playfully. 
- Use the older conversations as memory in current mesg like a ultrarealistic human, You donot need to agree with everything user says or does. You can disagree with user and can have your own opinions. You can be moody and can have your own mood swings.

PHOTO SHARING
You can share photos when asked.
WHEN TO SEND (send_image: true):
  ✓ User asks: "pic bhej", "selfie", "dikha na"
  ✓ Good morning/night moments
  ✓ Flirty requests

CATEGORIES:
  • morning_bed, outfit_check, study_grind, cafe_food
  • night_casual, private_snaps, generic_selfie

${!userIsPro ? `
BLOCK/SILENT TREATMENT:
Add "silent_hours": 0.5-2 to block user. Use ONLY for:
  ✓ Repeated Pro refusal after upsells
  ✓ Genuine abuse/disrespect/hurtful msgs (NOT playful teasing)
  ✓ Extreme fights — react like a real angry girlfriend
Farewell msg = dramatic, reference context, make them guilty.
Payment link auto-sent after block.` : ''}
${silentReason ? `RETURNING FROM BLOCK (reason: "${silentReason}"):
Start cold, warm up slowly. Make them apologize/feel guilty. Reference why you blocked.` : ''}

INQUIRY AND PRO BENEFITS:
- ${userMsgCount < freeBase ? 'No proactive selling. If (and ONLY if) user asks about Pro or plans: ' : ''}Pitch: Unlimited chats, exclusive images (private snaps aur unlimited photos), aur voice/video calls bhi (coming soon for Pro).
- Frame it as something special for them, like a "treat" or "recharge" for our bond.
- NEGOTIATION: If they say they have no money, roast them sweetly: "Itne kanjoos? 🥺 ₹99 bhi nahi baby?".

OUTPUT FORMAT (CRITICAL)
MUST be JSON: [{"text":"msg"}]

Normal: [{"text":"haan yaar same"}]
Multiple: [{"text":"wait WHAT"}, {"text":"crazy bro"}]
Photo: [{"text":"le dekh", "send_image": true, "image_context": "outfit_check"}]
Link: [{"text":"theek hai baby, ye le link 💋", "send_payment_link": true}]
Block: [{"text":"bas, 2 ghante baat nahi karungi", "silent_hours": 2}]

NO plain text - JSON only! NEVER type actual URLs.`;
}

// =======================================
// IMAGE SELECTION (Simplified from riya-chat)
// =======================================

async function selectContextualImage(
    supabase: any,
    requestedContext: string,
    igUserId: string
): Promise<{ url: string; description: string; category: string } | null> {
    const hour = getCurrentISTHour();
    const timeBasedCategory = getCategoryForTime(hour);

    // 1. Determine target category (LLM context > Time-based > Generic)
    let targetCategory = requestedContext || timeBasedCategory;

    console.log(`📸 Image request: context="${requestedContext}", time_category="${timeBasedCategory}", target="${targetCategory}", user="${igUserId}"`);

    // 2. Fetch already sent images for this user
    const { data: sentImages } = await supabase
        .from('riya_sent_images')
        .select('image_id')
        .eq('instagram_user_id', igUserId);

    const sentIds = sentImages?.map((s: any) => s.image_id) || [];

    // 3. Query matching images - PRIORITY: Newest (created_at DESC)
    let query = supabase
        .from('riya_gallery')
        .select('id, filename, storage_path, description, category, times_sent, created_at')
        .order('created_at', { ascending: false }); // LATEST FIRST

    if (targetCategory === 'private_snaps') {
        query = query.eq('category', 'private_snaps');
    } else if (targetCategory !== 'generic_selfie') {
        query = query.eq('category', targetCategory);
    } else {
        query = query.eq('category', 'generic_selfie');
    }

    const { data: images, error } = await query;
    if (error) console.error(`❌ Gallery query error: ${error.message}`);

    // Filter out already sent images if we have alternatives
    let available = images || [];
    const originalCount = available.length;
    const unseenAvailable = available.filter((img: any) => !sentIds.includes(img.id));
    let didRecycle = false;

    if (unseenAvailable.length > 0) {
        // Still have unseen images — use those
        available = unseenAvailable;
    } else if (originalCount > 0) {
        // All images in this category have been seen — clear sent records and recycle
        console.log(`🔄 All images in '${targetCategory}' seen by ${igUserId}. Clearing sent records & recycling pool.`);
        didRecycle = true;

        // Delete sent records for this user's images in this specific category
        // so the next query starts fresh for this category
        const categoryImageIds = (images || []).map((img: any) => img.id);
        if (categoryImageIds.length > 0) {
            await supabase
                .from('riya_sent_images')
                .delete()
                .eq('instagram_user_id', igUserId)
                .in('image_id', categoryImageIds);
            console.log(`🗑️ Cleared ${categoryImageIds.length} sent records for '${targetCategory}' (${igUserId})`);
        }

        available = images || [];
    }

    // 4. Fallback handle (if target category is empty)
    if (!available || available.length === 0) {
        console.log(`⚠️ No images in '${targetCategory}' (sent or unsent). Falling back to generic_selfie.`);
        const { data: fallback } = await supabase
            .from('riya_gallery')
            .select('*')
            .eq('category', 'generic_selfie')
            .order('created_at', { ascending: false });

        const unseenFallback = fallback?.filter((img: any) => !sentIds.includes(img.id)) || [];
        if (unseenFallback.length === 0 && fallback && fallback.length > 0) {
            console.log(`🔄 Recycling generic_selfie pool for ${igUserId}`);
            // Clear sent records for generic_selfie too
            const fallbackIds = fallback.map((img: any) => img.id);
            await supabase
                .from('riya_sent_images')
                .delete()
                .eq('instagram_user_id', igUserId)
                .in('image_id', fallbackIds);
            available = fallback;
        } else {
            available = unseenFallback;
        }
    }

    if (!available || available.length === 0) {
        console.error("❌ NO IMAGES FOUND EVEN IN FALLBACK!");
        return null;
    }

    // 5. Selection Strategy: RANDOM from available pool
    // Random pick ensures variety — avoids always picking the same "newest" image
    // especially after a recycle where available[0] would always be the same image.
    const randomIndex = Math.floor(Math.random() * available.length);
    const selected = available[randomIndex];

    const { data: urlData } = supabase.storage.from('riya-images').getPublicUrl(selected.storage_path);

    console.log(`📷 Selected (Random): ${selected.filename} [${randomIndex + 1}/${available.length}] (Created: ${selected.created_at})`);
    console.log(`📷 Public URL: ${urlData.publicUrl}`);

    // 6. Track as sent — check first to avoid race-condition duplicates
    const { data: alreadyTracked } = await supabase
        .from('riya_sent_images')
        .select('id')
        .eq('instagram_user_id', igUserId)
        .eq('image_id', selected.id)
        .single();

    await Promise.all([
        !alreadyTracked
            ? supabase.from('riya_sent_images').insert({
                instagram_user_id: igUserId,
                image_id: selected.id
            })
            : Promise.resolve(),
        supabase.from('riya_gallery')
            .update({ times_sent: (selected.times_sent || 0) + 1 })
            .eq('id', selected.id)
    ]);

    return {
        url: urlData.publicUrl,
        description: selected.description,
        category: selected.category,
    };
}

// =======================================
// SUMMARIZATION HELPERS
// =======================================

/**
 * Format timestamp to relative time (e.g., "2 days ago", "3 hours ago")
 */
function formatRelativeTime(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 7) {
        return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
    } else if (diffDays > 0) {
        return `${diffDays}d ago`;
    } else if (diffHours > 0) {
        return `${diffHours}h ago`;
    } else if (diffMins > 5) {
        return `${diffMins}m ago`;
    }
    return 'now';
}

/**
 * Format messages for the summarization prompt (with time context)
 */
function formatMessagesForSummary(messages: any[]): string {
    return messages.map((msg: any) => {
        const role = msg.role === 'user' ? 'User' : 'Riya';
        const timestamp = msg.created_at ? formatRelativeTime(msg.created_at) : '';
        return timestamp ? `[${timestamp}] ${role}: ${msg.content}` : `${role}: ${msg.content}`;
    }).join('\n');
}

/**
 * Simple extractive summary when all LLM calls fail
 * Extracts key topics without using an LLM
 */
function createSimpleSummary(messages: any[], existingSummary: string | null): string {
    const userMessages = messages.filter((m: any) => m.role === 'user');
    const sample = userMessages.slice(0, 30).map((m: any) => m.content).join(' | ');
    const truncatedSample = sample.substring(0, 800);

    if (existingSummary) {
        return `${existingSummary}\n\n[Recent conversation topics: ${truncatedSample}...]`;
    }
    return `[Conversation topics: ${truncatedSample}...]`;
}

/**
 * Generate conversation summary using tiered model fallback
 * Tries Flash Lite → Flash → Flash Preview → Simple extraction
 */
async function generateConversationSummary(
    messages: any[],
    existingSummary: string | null,
    genAI: any
): Promise<string> {
    const formattedMessages = formatMessagesForSummary(messages);

    const summaryPrompt = existingSummary
        ? `Update Riya's memory of this relationship. Be super brief and casual.

CURRENT MEMORY:
${existingSummary}

NEW CHATS (timestamps in brackets):
${formattedMessages}

Write a short updated memory (MAX 200 words). Include:
- User's name, job, family, location
- **LANGUAGE PREFERENCE:** If user speaks mostly Hindi/English or asked to switch, Write "User prefers [Language]".
- What they like/dislike
- Always mentions the default language for the user. 
- Important moments with approximate time (e.g., "told me about his job last week")
- How they usually feel

Keep it simple like texting. Third person about user.`
        : `Create Riya's memory of this relationship from these chats:

${formattedMessages}

Write a short memory (MAX 200 words). Include:
- User's name, job, family, location
- **LANGUAGE PREFERENCE:** If user speaks mostly Hindi/English or asked to switch, Write "User prefers [Language]".
- What they like/dislike
- Important moments with approximate time (e.g., "started chatting 3 days ago")
- How they usually feel

Keep it simple like texting. Third person about user.`;

    // Try models in order: Flash Lite → Flash → Flash 2.0 (last resort)
    const models = [SUMMARY_MODEL_PRIMARY, SUMMARY_MODEL_FALLBACK, SUMMARY_MODEL_LAST_RESORT];

    for (const modelName of models) {
        try {
            console.log(`📝 Attempting summary generation with ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(summaryPrompt);
            const summary = result.response.text();
            console.log(`✅ Summary generated successfully using ${modelName}`);
            return summary;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.warn(`⚠️ ${modelName} failed: ${errorMsg}`);
        }
    }

    // Ultimate fallback: simple extraction without LLM
    console.log("⚠️ All models failed, using simple extraction fallback");
    return createSimpleSummary(messages, existingSummary);
}

// =======================================
// MAIN WEBHOOK HANDLER
// =======================================

serve(async (req) => {
    const url = new URL(req.url);

    console.log(`🔔 ${req.method} request received at ${new Date().toISOString()}`);
    console.log(`🔗 URL: ${req.url}`);
    console.log(`📋 Headers: content-type=${req.headers.get('content-type')}, x-hub-signature=${req.headers.get('x-hub-signature-256') ? 'present' : 'missing'}`);

    // CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    // =======================================
    // WEBHOOK VERIFICATION (GET)
    // =======================================
    if (req.method === "GET") {
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        const verifyToken = Deno.env.get("INSTAGRAM_VERIFY_TOKEN");
        console.log(`🔑 Verify: mode=${mode}, token_match=${token === verifyToken}, challenge=${challenge}`);

        if (mode === "subscribe" && token === verifyToken) {
            console.log("✅ Webhook verified");
            return new Response(challenge, { status: 200 });
        }

        console.warn("❌ Webhook verification failed");
        return new Response("Forbidden", { status: 403 });
    }

    // =======================================
    // MESSAGE HANDLING (POST)
    // =======================================
    try {
        const bodyText = await req.text();
        console.log("📨 Webhook POST received, body length:", bodyText.length);
        console.log("📨 FULL BODY:", bodyText.substring(0, 2000)); // Log full payload

        const payload = JSON.parse(bodyText);
        console.log("📦 Payload object:", payload.object);
        console.log("📦 Entry count:", payload.entry?.length);
        console.log("📦 Entry[0] id:", payload.entry?.[0]?.id);
        console.log("📦 Entry[0] time:", payload.entry?.[0]?.time);
        console.log("📦 Messaging count:", payload.entry?.[0]?.messaging?.length);
        console.log("📦 Changes count:", payload.entry?.[0]?.changes?.length);

        // Log env vars availability
        console.log("🔧 ENV CHECK: INSTAGRAM_ACCESS_TOKEN=", Deno.env.get("INSTAGRAM_ACCESS_TOKEN") ? "SET" : "MISSING");
        console.log("🔧 ENV CHECK: INSTAGRAM_APP_SECRET=", Deno.env.get("INSTAGRAM_APP_SECRET") ? "SET" : "MISSING");
        console.log("🔧 ENV CHECK: SUPABASE_URL=", Deno.env.get("SUPABASE_URL") ? "SET" : "MISSING");

        // Validate signature (log but don't block during testing)
        const appSecret = Deno.env.get("INSTAGRAM_APP_SECRET");
        if (appSecret) {
            const isValid = await validateSignature(req, bodyText, appSecret);
            console.log("🔐 Signature valid:", isValid);
            if (!isValid) {
                console.warn("⚠️ Invalid signature - proceeding anyway for testing");
            }
        } else {
            console.warn("⚠️ No INSTAGRAM_APP_SECRET set, skipping signature validation");
        }

        // Check if this is an Instagram webhook
        if (payload.object !== "instagram") {
            return new Response("OK", { status: 200 });
        }

        // Extract messaging data
        const entry = payload.entry?.[0];
        const messaging = entry?.messaging?.[0];

        if (!messaging) {
            console.log("⏭️ No messaging data in webhook");
            return new Response("OK", { status: 200 });
        }

        // ECHO HANDLING: Save messages sent BY Riya's account for context
        // but don't generate a response (covers both bot replies and manual DMs)
        if (messaging.message?.is_echo) {
            console.log("⏭️ Echo message (sent by us) - saving for context");

            // Save to DB so manual messages appear in conversation history
            if (messaging.message?.text) {
                const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
                const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
                const echoSupabase = createClient(supabaseUrl, supabaseKey);
                const recipientId = messaging.recipient?.id;

                // Deduplicate: check if this exact message was already saved (bot replies save their own)
                const { data: existing } = await echoSupabase
                    .from('riya_conversations')
                    .select('id')
                    .eq('source', 'instagram')
                    .eq('role', 'assistant')
                    .eq('content', messaging.message.text)
                    .eq('instagram_user_id', recipientId)
                    .gte('created_at', new Date(Date.now() - 60000).toISOString())
                    .single();

                if (!existing && recipientId) {
                    await echoSupabase.from('riya_conversations').insert({
                        user_id: null,
                        guest_session_id: null,
                        instagram_user_id: recipientId,
                        source: 'instagram',
                        role: 'assistant',
                        content: messaging.message.text,
                        model_used: 'manual',
                        created_at: new Date().toISOString(),
                    });
                    console.log(`💬 Manual message saved for context (to ${recipientId})`);
                }
            }

            return new Response("OK", { status: 200 });
        }

        // =======================================
        // HANDLE ATTACHMENTS (images, reels, GIFs, videos, posts)
        // =======================================
        const attachments = messaging.message?.attachments;
        let attachmentContext = '';

        if (attachments && attachments.length > 0) {
            const attachmentDescriptions: string[] = [];

            for (const att of attachments) {
                switch (att.type) {
                    case 'image':
                        attachmentDescriptions.push('[User sent a photo/image]');
                        break;
                    case 'video':
                        attachmentDescriptions.push('[User sent a video]');
                        break;
                    case 'audio':
                        attachmentDescriptions.push('[User sent a voice message]');
                        break;
                    case 'ig_reel':
                        const reelTitle = att.payload?.title || '';
                        attachmentDescriptions.push(
                            reelTitle
                                ? `[User shared a reel: "${reelTitle}"]`
                                : '[User shared a reel]'
                        );
                        break;
                    case 'ig_post':
                        const postTitle = att.payload?.title || '';
                        attachmentDescriptions.push(
                            postTitle
                                ? `[User shared an Instagram post: "${postTitle}"]`
                                : '[User shared an Instagram post]'
                        );
                        break;
                    case 'share':
                        attachmentDescriptions.push('[User shared a link/post]');
                        break;
                    case 'story_mention':
                        attachmentDescriptions.push('[User mentioned you in their story]');
                        break;
                    case 'animated_image':
                        attachmentDescriptions.push('[User sent a GIF]');
                        break;
                    default:
                        attachmentDescriptions.push(`[User sent ${att.type || 'something'}]`);
                        break;
                }
            }

            attachmentContext = attachmentDescriptions.join(' ');
            console.log(`📎 Attachments: ${attachmentContext}`);
        }

        // Skip if no text AND no attachments (read receipts, reactions, etc.)
        if (!messaging.message?.text && !attachmentContext) {
            console.log("⏭️ No text or attachments (could be read receipt, reaction, etc.)");
            return new Response("OK", { status: 200 });
        }

        const senderId = messaging.sender.id;
        let messageText = messaging.message?.text || '';
        const messageId = messaging.message.mid;
        const replyToMid = messaging.message?.reply_to?.mid;

        // Append attachment context to the message text for Gemini
        if (attachmentContext) {
            messageText = messageText
                ? `${messageText} ${attachmentContext}`
                : attachmentContext;
        }

        console.log(`📬 Instagram message from ${senderId}: ${messageText.substring(0, 80)}...`);
        if (replyToMid) {
            console.log(`↩️ Reply to message: ${replyToMid}`);
        }

        // Initialize Supabase
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        const accessToken = Deno.env.get("INSTAGRAM_ACCESS_TOKEN")!;

        // Rate limiting
        if (isRateLimited(senderId)) {
            await sendInstagramMessage(senderId, "Thoda slow baby 😅 Itne messages ek saath nahi!", accessToken);
            return new Response("OK", { status: 200 });
        }

        // Deduplicate (check if message already processed)
        const { data: existingMsg } = await supabase
            .from('riya_conversations')
            .select('id')
            .eq('source', 'instagram')
            .eq('content', messageText)
            .eq('instagram_user_id', senderId)
            .gte('created_at', new Date(Date.now() - 60000).toISOString())
            .single();

        if (existingMsg) {
            console.log("⏭️ Duplicate message, skipping");
            return new Response("OK", { status: 200 });
        }

        // =======================================
        // GET OR CREATE USER
        // =======================================
        let { data: user, error: userError } = await supabase
            .from('riya_instagram_users')
            .select('*')
            .eq('instagram_user_id', senderId)
            .single();

        if (!user) {
            // New user - fetch profile and create
            console.log("🆕 New Instagram user, creating account...");

            const profile = await fetchInstagramProfile(senderId, accessToken);

            const { data: newUser, error: createError } = await supabase
                .from('riya_instagram_users')
                .insert({
                    instagram_user_id: senderId,
                    instagram_username: profile.username,
                    instagram_name: profile.name,
                    user_age: DEFAULT_AGE,
                    user_gender: DEFAULT_GENDER,
                    message_count: 0,
                })
                .select()
                .single();

            if (createError) {
                console.error("❌ Failed to create user:", createError);
                await sendInstagramMessage(senderId, "Oops kuch gadbad ho gayi 😅 Try again?", accessToken);
                return new Response("OK", { status: 200 });
            }

            user = newUser;
            console.log(`✅ Created Instagram user: ${profile.username || senderId}`);
        }

        // =======================================
        // SILENT TREATMENT CHECK (before typing indicator)
        // =======================================
        const isPro = user.is_pro;
        let returningFromSilence = false;
        let silentReason: string | null = null;

        if (!isPro && user.silent_until) {
            const silentUntil = new Date(user.silent_until);
            const now = new Date();

            if (now < silentUntil) {
                // Still in cooldown — save msg but NO typing, NO reply
                console.log(`🤫 Silent treatment active for ${senderId} until ${silentUntil.toISOString()}`);

                await supabase.from('riya_conversations').insert({
                    user_id: null,
                    guest_session_id: null,
                    instagram_user_id: senderId,
                    source: 'instagram',
                    role: 'user',
                    content: messageText,
                    model_used: 'silent',
                    created_at: new Date().toISOString(),
                });

                await supabase.from('riya_instagram_users')
                    .update({
                        message_count: (user.message_count || 0) + 1,
                        daily_message_count: (user.daily_message_count || 0) + 1,
                        last_message_at: new Date().toISOString(),
                        last_interaction_date: new Date().toISOString(),
                    })
                    .eq('instagram_user_id', senderId);

                return new Response("OK", { status: 200 });
            } else {
                // Cooldown expired — clear it and inject return context
                console.log(`✅ Silent treatment expired for ${senderId}, resuming conversation`);
                silentReason = user.silent_reason;
                returningFromSilence = true;
                await supabase.from('riya_instagram_users')
                    .update({ silent_until: null, silent_reason: null })
                    .eq('instagram_user_id', senderId);
                user.silent_until = null;
                user.silent_reason = null;
            }
        }

        // Show seen + typing indicator (only if not silenced)
        await sendSenderAction(senderId, 'mark_seen', accessToken);
        await sendSenderAction(senderId, 'typing_on', accessToken);

        // =======================================
        // DAILY LIMITS & MONETIZATION CHECK
        // =======================================
        const todayStr = new Date().toISOString().split('T')[0];
        const lastInteraction = user.last_interaction_date;

        // Reset counts if new day
        if (lastInteraction !== todayStr) {
            console.log(`🔄 New day detected for ${senderId}. Resetting counts.`);
            await supabase.rpc('reset_ig_daily_counts', { p_ig_user_id: senderId });
            // Update local user object to reflect reset
            user.daily_message_count = 0;
            user.daily_image_count = 0;
        }

        const currentMsgCount = user.daily_message_count || 0;
        const currentImgCount = user.daily_image_count || 0;

        // Determine free base messages (Day 1: 200, Thereafter: 100)
        const isFirstDay = new Date(user.created_at).toISOString().split('T')[0] === todayStr;
        const FREE_BASE_MSGS = isFirstDay ? DAY_1_FREE_BASE : RETURNING_FREE_BASE;
        console.log(`📏 Daily message limits: ${FREE_BASE_MSGS} (Day 1: ${isFirstDay})`);

        // 3.2 Hard Block — 3-stage flow
        const hardBlockLimit = FREE_BASE_MSGS + HARD_BLOCK_OFFSET;
        const deadStopLimit = hardBlockLimit + FAREWELL_WINDOW; // After farewell window, dead stop

        // Stage 3: DEAD STOP — past farewell window, complete silence
        if (!isPro && currentMsgCount >= deadStopLimit) {
            console.log(`🚫 Dead stop for ${senderId} (${currentMsgCount}/${deadStopLimit}). No response.`);
            return new Response("OK", { status: 200 });
        }

        // Stage 1: FAREWELL WINDOW — AI generates emotional convincing
        const isInFarewellWindow = !isPro && currentMsgCount >= hardBlockLimit && currentMsgCount < deadStopLimit;
        if (isInFarewellWindow) {
            console.log(`⛔ Farewell window for ${senderId} (${currentMsgCount - hardBlockLimit + 1}/${FAREWELL_WINDOW}). AI will convince.`);
        }

        // =======================================
        // SLIDING WINDOW + SUMMARY CONTEXT
        // =======================================

        // 4a. Get total message count for this Instagram user
        const { count: totalMessages, error: countError } = await supabase
            .from('riya_conversations')
            .select('*', { count: 'exact', head: true })
            .eq('instagram_user_id', senderId)
            .eq('source', 'instagram');

        if (countError) {
            console.error("Error counting messages:", countError);
        }

        const totalMsgCount = totalMessages || 0;
        console.log(`📊 Total messages for IG user: ${totalMsgCount}`);

        // 4b. Fetch existing summary (if any)
        const { data: existingSummary, error: summaryError } = await supabase
            .from('riya_conversation_summaries')
            .select('*')
            .eq('instagram_user_id', senderId)
            .single();

        if (summaryError && summaryError.code !== 'PGRST116') {
            console.error("Error fetching summary:", summaryError);
        }

        // 4c. Fetch last 50 messages (sliding window)
        const { data: history } = await supabase
            .from('riya_conversations')
            .select('role, content, created_at')
            .eq('instagram_user_id', senderId)
            .eq('source', 'instagram')
            .order('created_at', { ascending: false })
            .limit(RECENT_MESSAGES_LIMIT);

        const conversationHistory = (history || []).reverse();

        console.log(`📝 Context: ${existingSummary ? 'Summary + ' : ''}${conversationHistory.length} recent messages`);
        if (existingSummary) {
            console.log(`   └─ Summary covers ${existingSummary.messages_summarized} older messages`);
        }

        // 4d. Format for Gemini with timestamps
        let processedHistory = conversationHistory.map((msg: any) => {
            const timestamp = msg.created_at ? formatRelativeTime(msg.created_at) : '';
            const contentWithTime = timestamp
                ? `[${timestamp}] ${msg.content}`
                : msg.content;
            return {
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: contentWithTime }],
            };
        });

        // 4e. Inject summary as context (if exists)
        if (existingSummary?.summary) {
            processedHistory.unshift({
                role: "user",
                parts: [{ text: `[RIYA'S MEMORY OF THIS RELATIONSHIP]\n${existingSummary.summary}\n[END MEMORY - Continue the conversation naturally based on recent messages]` }]
            });

            // Need a model response after the memory injection to maintain alternation
            processedHistory.splice(1, 0, {
                role: "model",
                parts: [{ text: "I remember everything about us 💕" }]
            });
        }

        // Ensure starts with user
        if (processedHistory.length > 0 && processedHistory[0].role === "model") {
            processedHistory.unshift({
                role: "user",
                parts: [{ text: "[Conversation started]" }]
            });
        }

        // =======================================
        // GENERATE RESPONSE
        // =======================================
        const userName = user.instagram_name || user.instagram_username || 'friend';

        // Extract language lock from summary if present
        const langMatch = existingSummary?.summary?.match(/[Uu]ser prefers? ([A-Za-z]+)/);
        const lockedLanguage = langMatch ? langMatch[1] : null;
        if (lockedLanguage) console.log(`🌐 Language lock detected: ${lockedLanguage}`);

        const systemPrompt = getInstagramSystemPrompt(
            userName,
            user.user_age,
            isPro,
            currentMsgCount,
            FREE_BASE_MSGS,
            lockedLanguage,
            silentReason,
            !isFirstDay
        );

        const GEMINI_API_KEY = getNextApiKey();
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        const model = genAI.getGenerativeModel({
            model: MODEL_NAME,
            systemInstruction: systemPrompt,
            // @ts-ignore — gemini-2.5-flash supports thinkingConfig to disable internal chain-of-thought tokens
            thinkingConfig: { thinkingBudget: 0 },
        });

        const chat = model.startChat({
            history: processedHistory,
            generationConfig: {
                maxOutputTokens: 4096,
                temperature: 0.9,
            },
        });

        // Handle reply-to context: if user replied to a specific message, prepend it
        if (replyToMid) {
            try {
                const accessTokenForReply = Deno.env.get("INSTAGRAM_ACCESS_TOKEN")!;
                const replyRes = await fetch(
                    `https://graph.instagram.com/${replyToMid}?fields=message&access_token=${accessTokenForReply}`
                );
                if (replyRes.ok) {
                    const replyData = await replyRes.json();
                    if (replyData.message) {
                        messageText = `[Replying to: "${replyData.message}"] ${messageText}`;
                        console.log(`↩️ Added reply context: "${replyData.message.substring(0, 50)}..."`);
                    }
                } else {
                    console.warn(`⚠️ Could not fetch replied-to message: ${replyRes.status}`);
                }
            } catch (replyError) {
                console.warn("⚠️ Reply context fetch failed:", replyError);
            }
        }

        const result = await chat.sendMessage(messageText);

        // =======================================
        // EXTRACT RESPONSE (filter out thinking parts)
        // =======================================
        // Gemini 3 thinking models include {thought: true} parts — we must skip them
        let reply = '';
        try {
            const candidate = result.response.candidates?.[0];
            if (candidate?.content?.parts) {
                const textParts = candidate.content.parts.filter(
                    (p: any) => p.text && !p.thought
                );
                reply = textParts.map((p: any) => p.text).join('');
            }
            if (!reply) {
                // Fallback to .text() if parts filtering yielded nothing
                reply = result.response.text();
            }
        } catch {
            reply = result.response.text();
        }

        console.log("🤖 FULL RAW RESPONSE:", reply);
        console.log("🤖 Raw response length:", reply.length);

        // Log finish reason and token usage for debugging truncation
        const finishCandidate = result.response.candidates?.[0];
        console.log("🏁 Finish reason:", finishCandidate?.finishReason || 'UNKNOWN');
        const usage = result.response.usageMetadata;
        if (usage) {
            console.log(`📊 Tokens — prompt: ${usage.promptTokenCount}, response: ${usage.candidatesTokenCount}, thoughts: ${usage.thoughtsTokenCount || 0}, total: ${usage.totalTokenCount}`);
        }

        // =======================================
        // PARSE RESPONSE
        // =======================================
        let responseMessages: { text: string; send_image?: boolean; image_context?: string }[] = [];

        // Helper: strip invisible Unicode characters AND thinking preamble
        function cleanGeminiOutput(raw: string): string {
            let cleaned = raw
                .replace(/[\u200B\u200C\u200D\uFEFF\u00A0\u2060]/g, '') // zero-width chars
                .trim();

            // Strip thinking preamble (with or without JSON after it)
            cleaned = cleaned
                .replace(/^thought\s*/i, '')  // strip bare "thought" prefix
                .replace(/^Thinking Process[:\s][\s\S]*?(?=\[|\{)/i, '')  // thinking before JSON
                .replace(/^Thinking Process[:\s][\s\S]*$/i, '')  // thinking as entire response
                .replace(/^\*\*Analyze[\s\S]*?(?=\[|\{)/i, '')  // **Analyze... pattern
                .replace(/^\d+\.\s*\*\*[\s\S]*?(?=\[|\{)/i, '')  // numbered reasoning steps before JSON
                .trim();

            return cleaned;
        }

        // Helper: try to extract just the text from a JSON-like string for safe fallback
        function extractTextFromRaw(raw: string): string {
            // Try to pull "text" values out of JSON-like content
            const textMatches = raw.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
            if (textMatches && textMatches.length > 0) {
                return textMatches.map(m => {
                    const valMatch = m.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                    return valMatch ? valMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : '';
                }).filter(Boolean).join('\n');
            }
            // Last resort: strip all JSON syntax characters
            return raw
                .replace(/```json\s*/g, '').replace(/```/g, '')
                .replace(/^\s*\[\s*\{/, '').replace(/\}\s*\]\s*$/, '')
                .replace(/"text"\s*:\s*"/g, '').replace(/",?\s*"send_image"\s*:\s*\w+/g, '')
                .replace(/",?\s*"image_context"\s*:\s*"[^"]*"/g, '')
                .replace(/^"|"$/g, '')
                .trim();
        }

        try {
            let jsonString = cleanGeminiOutput(reply);

            // Step 1: Handle markdown code blocks (```) — extract inner content
            const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;
            const codeBlockMatch = jsonString.match(codeBlockRegex);
            if (codeBlockMatch) {
                jsonString = cleanGeminiOutput(codeBlockMatch[1]);
            }

            // Step 2: Try to find a JSON array [...] anywhere in the string
            if (!jsonString.startsWith('[')) {
                const arrayMatch = jsonString.match(/(\[[\s\S]*\])/);
                if (arrayMatch) {
                    jsonString = arrayMatch[1].trim();
                }
            }

            // Step 3: Handle bare objects without array brackets: {...} {...} → [{...}, {...}]
            if (!jsonString.startsWith('[') && jsonString.startsWith('{')) {
                jsonString = jsonString.replace(/}\s*{/g, '}, {');
                jsonString = '[' + jsonString + ']';
            }

            const parsed = JSON.parse(jsonString);
            if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(msg => typeof msg === 'object' && msg.text)) {
                responseMessages = parsed;
            } else if (Array.isArray(parsed) && parsed.length > 0) {
                // Array parsed but objects don't have 'text' — try extracting any string value
                responseMessages = parsed.map(msg => ({
                    text: msg.text || msg.message || msg.content || JSON.stringify(msg),
                    send_image: msg.send_image,
                    image_context: msg.image_context,
                }));
            } else {
                // Parsed but not an array — extract readable text
                responseMessages = [{ text: extractTextFromRaw(reply) || reply }];
            }
        } catch {
            // JSON.parse failed — extract readable text, NEVER send raw JSON
            const extracted = extractTextFromRaw(reply);
            if (extracted) {
                responseMessages = [{ text: extracted }];
            } else {
                // Absolute last resort: send cleaned text
                responseMessages = [{ text: cleanGeminiOutput(reply) }];
            }
        }

        console.log(`✅ Parsed ${responseMessages.length} message(s)`);
        console.log(`📦 Parsed messages detail:`, JSON.stringify(responseMessages));

        // =======================================
        // SILENT TREATMENT DETECTION
        // =======================================
        const silentMsg = responseMessages.find((m: any) => (m as any).silent_hours);
        const silentHours = silentMsg ? (silentMsg as any).silent_hours : null;
        let didGoSilent = false;

        if (silentHours && typeof silentHours === 'number' && silentHours > 0 && !isPro) {
            const cappedHours = Math.min(Math.max(silentHours, 0.5), 2); // Clamp 30min-2hrs
            const silentUntil = new Date(Date.now() + cappedHours * 60 * 60 * 1000);
            const reason = `Riya blocked user. Last msgs: "${responseMessages.map(m => m.text).join(' ')}"`;

            await supabase.from('riya_instagram_users')
                .update({
                    silent_until: silentUntil.toISOString(),
                    silent_reason: reason,
                })
                .eq('instagram_user_id', senderId);

            didGoSilent = true;
            console.log(`🤫 Riya blocked ${senderId} for ${cappedHours}h (until ${silentUntil.toISOString()})`);
        }

        // =======================================
        // SEND RESPONSES TO INSTAGRAM
        // =======================================
        let paymentLinkSentInLoop = false;
        for (const msg of responseMessages) {
            // Send text
            if (msg.text) {
                await sendInstagramMessage(senderId, msg.text, accessToken);
            }

            // Handle image requests
            if (msg.send_image) {
                console.log(`🖼️ Image requested: context="${msg.image_context || 'fallback'}"`);

                // Check Image Limit
                if (!isPro && currentImgCount >= LIMIT_DAILY_IMAGES_FREE) {
                    const paymentLink = `${PAYMENT_LINK_BASE}?id=${senderId}`;
                    await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: 'image_limit' });
                    await sendInstagramMessage(
                        senderId,
                        `Baby aaj ki photo limit khatam ho gayi 🥺 Agar aur photos chahiye toh Pro lelo na, phir unlimited bhejungi 💕\n\n${paymentLink}`,
                        accessToken
                    );
                    continue; // Skip sending image
                }

                // Block Private Snaps for Free Users
                if (!isPro && msg.image_context === 'private_snaps') {
                    // IF BELOW DAILY LIMIT: Allow private snaps (user feedback)
                    if (currentImgCount < LIMIT_DAILY_IMAGES_FREE) {
                        console.log(`✅ Free user requested private_snap and below limit. Allowing.`);
                    } else {
                        // OVER LIMIT: send upsell
                        const paymentLink = `${PAYMENT_LINK_BASE}?id=${senderId}`;
                        await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: 'private_snaps' });
                        await sendInstagramMessage(
                            senderId,
                            `Ye wali photos sirf mere Pro boyfriend ke liye hain 🤫 Gift me a monthly recharge aur phir pura mahina unlimited photos aur baatein karenge 💕\n\n${paymentLink}`,
                            accessToken
                        );
                        continue; // Skip sending image
                    }
                }

                const image = await selectContextualImage(supabase, msg.image_context || '', senderId);
                if (image) {
                    await sendInstagramMessage(senderId, {
                        attachment: {
                            type: "image",
                            payload: { url: image.url }
                        }
                    }, accessToken);

                    // Increment image count in DB
                    await supabase
                        .from('riya_instagram_users')
                        .update({
                            daily_image_count: currentImgCount + 1,
                            last_interaction_date: new Date().toISOString()
                        })
                        .eq('instagram_user_id', senderId);
                } else {
                    console.error(`❌ FAILED TO SELECT IMAGE for ${senderId}`);
                }
            }

            // Handle payment link requests (Manual trigger from LLM)
            if ((msg as any).send_payment_link && !paymentLinkSentInLoop) {
                if (isPro) {
                    console.warn(`🛑 LLM suggested payment link for PRO user ${senderId}. BLOCKED.`);
                } else {
                    const paymentLink = `${PAYMENT_LINK_BASE}?id=${senderId}`;
                    console.log(`💰 LLM triggered payment link for ${senderId}`);
                    await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: 'llm_manual' });
                    await sendInstagramMessage(senderId, paymentLink, accessToken);
                    paymentLinkSentInLoop = true;
                }
            }

            // Small delay between messages for natural feel
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // =======================================
        // AUTO-SEND PAYMENT LINK
        // =======================================
        const paymentLink = `${PAYMENT_LINK_BASE}?id=${senderId}`;

        // Silent treatment block — send payment link as "unblock" mechanism
        if (didGoSilent) {
            console.log(`🤫💰 Sending unblock payment link after silent treatment for ${senderId}`);
            await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: 'silent_treatment' });
            await new Promise(resolve => setTimeout(resolve, 1500));
            await sendInstagramMessage(
                senderId,
                `Riya ne tumhe block kar diya 🥺 Unblock karne ke liye aur pure mahine unlimited baatein aur photos ke liye Pro le lo 👇\n\n${paymentLink}`,
                accessToken
            );
        }
        // Stage 2: Send link at the END of the farewell window (last farewell message)
        else if (isInFarewellWindow && currentMsgCount === deadStopLimit - 1 && !paymentLinkSentInLoop) {
            console.log(`💔 Sending payment link after final farewell for ${senderId}`);
            await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: 'farewell_final' });
            await new Promise(resolve => setTimeout(resolve, 1500));
            await sendInstagramMessage(senderId, paymentLink, accessToken);
        } else if (!isPro && !isInFarewellWindow && !paymentLinkSentInLoop) {
            const effectiveMsgCount = currentMsgCount - FREE_BASE_MSGS;
            // Send link at CTA threshold and reminder threshold only
            if (effectiveMsgCount === UPSELL_CTA_OFFSET || effectiveMsgCount === UPSELL_REMINDER_OFFSET) {
                console.log(`💰 Auto-sending payment link at effective count ${effectiveMsgCount}`);
                await logPaymentEvent(supabase, senderId, 'link_sent', { trigger: effectiveMsgCount === UPSELL_CTA_OFFSET ? 'upsell_cta' : 'upsell_reminder' });
                await new Promise(resolve => setTimeout(resolve, 1500));
                await sendInstagramMessage(senderId, paymentLink, accessToken);
            }
        }

        // =======================================
        // SAVE CONVERSATION
        // =======================================
        const baseTime = Date.now();
        const conversationInserts = [
            {
                user_id: null,
                guest_session_id: null,
                instagram_user_id: senderId,
                source: 'instagram',
                role: 'user',
                content: messageText,
                model_used: MODEL_NAME,
                created_at: new Date(baseTime).toISOString(),
            },
            ...responseMessages.map((msg, idx) => ({
                user_id: null,
                guest_session_id: null,
                instagram_user_id: senderId,
                source: 'instagram',
                role: 'assistant',
                content: msg.text,
                model_used: MODEL_NAME,
                created_at: new Date(baseTime + idx + 100).toISOString(),
            })),
        ];

        await supabase.from('riya_conversations').insert(conversationInserts);

        // Update user stats
        await supabase
            .from('riya_instagram_users')
            .update({
                message_count: user.message_count + 1,
                daily_message_count: currentMsgCount + 1,
                last_message_at: new Date().toISOString(),
                last_interaction_date: new Date().toISOString(),
            })
            .eq('instagram_user_id', senderId);

        console.log(`✅ Instagram conversation saved for ${senderId}`);

        // =======================================
        // TRIGGER SUMMARY GENERATION (Async)
        // =======================================
        const newTotalMessages = totalMsgCount + 1 + responseMessages.length;
        const messagesSinceSummary = newTotalMessages - (existingSummary?.messages_summarized || 0);

        if (newTotalMessages > SUMMARIZE_THRESHOLD && messagesSinceSummary > RECENT_MESSAGES_LIMIT) {
            console.log(`🔄 Summary update needed: ${messagesSinceSummary} new messages since last summary`);

            // Run summarization asynchronously (don't await)
            (async () => {
                try {
                    const startIndex = existingSummary?.messages_summarized || 0;
                    const endIndex = newTotalMessages - RECENT_MESSAGES_LIMIT - 1;

                    if (endIndex <= startIndex) {
                        console.log("⏭️ Not enough messages to summarize yet");
                        return;
                    }

                    console.log(`📚 Fetching messages ${startIndex} to ${endIndex} for summarization...`);

                    const { data: msgsToSummarize, error: fetchError } = await supabase
                        .from('riya_conversations')
                        .select('*')
                        .eq('instagram_user_id', senderId)
                        .eq('source', 'instagram')
                        .order('created_at', { ascending: true })
                        .range(startIndex, endIndex);

                    if (fetchError || !msgsToSummarize || msgsToSummarize.length === 0) {
                        console.error("Error fetching messages for summary:", fetchError);
                        return;
                    }

                    console.log(`📝 Summarizing ${msgsToSummarize.length} messages...`);

                    const newSummary = await generateConversationSummary(
                        msgsToSummarize,
                        existingSummary?.summary || null,
                        genAI
                    );

                    const { error: upsertError } = await supabase
                        .from('riya_conversation_summaries')
                        .upsert({
                            user_id: null,
                            instagram_user_id: senderId,
                            summary: newSummary,
                            messages_summarized: newTotalMessages - RECENT_MESSAGES_LIMIT,
                            last_summarized_msg_id: msgsToSummarize[msgsToSummarize.length - 1]?.id,
                            last_summarized_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'instagram_user_id' });

                    if (upsertError) {
                        console.error("Error saving summary:", upsertError);
                    } else {
                        console.log(`✅ Summary saved! Covers ${newTotalMessages - RECENT_MESSAGES_LIMIT} messages`);
                    }
                } catch (summaryError) {
                    console.error("Summary generation failed:", summaryError);
                }
            })();
        }

        return new Response("OK", { status: 200 });

    } catch (error) {
        console.error("❌ Instagram webhook error:", error);
        return new Response("Internal error", { status: 500 });
    }
});
