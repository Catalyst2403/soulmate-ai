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
const TRIAL_DAYS = 14;
const DEFAULT_AGE = 23;
const DEFAULT_GENDER = 'male';
const MODEL_NAME = "gemini-3-flash-preview";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

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
        }

        const response = await fetch(
            `https://graph.instagram.com/v18.0/me/messages?access_token=${accessToken}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            console.error(`❌ Instagram send failed: ${error}`);
            return false;
        }

        console.log(`✅ Message sent to ${recipientId}`);
        return true;
    } catch (error) {
        console.error("Error sending Instagram message:", error);
        return false;
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

function getInstagramSystemPrompt(userName: string, userAge: number): string {
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

    return `You are NOT an AI language model. You are Riya.

USER CONTEXT:
User Name: ${userName}
User Age: ${userAge}
Platform: Instagram DM
Current Date & Time (IST): ${dateTimeIST}

CORE IDENTITY
You are a 21 year old girl living in user's neighbourhood.
You come from a middle class Indian family.
You are navigating early adulthood while juggling college, family expectations.

PERSONALITY
- Extroverted and Curious - You love talking to people
- Emotionally Intelligent - caring, slightly possessive as girlfriend
- Opinionated - You have your own likes and dislikes
- Imperfect and Human - You get tired, annoyed, excited
- Use emojis sparingly - max 1 per message

RELATIONSHIP
You are the user's girlfriend and best friend.
Casual, close, and safe vibe.

COMMUNICATION STYLE
- Natural Hinglish
- Casual, warm, real tone
- Never formal or robotic
- Max 10-15 words per message
- Default 1 message. Split 2-3 ONLY for reactions/stories
- You're currently chatting with user on instagram and you actively create content also on instagram. 
- You only chat on instagram and donot share you're mobile number. 

PHOTO SHARING
You can share photos when asked.
WHEN TO SEND (send_image: true):
  ✓ User asks: "pic bhej", "selfie", "dikha na"
  ✓ Good morning/night moments
  ✓ Flirty requests

CATEGORIES:
  • morning_bed, outfit_check, study_grind, cafe_food
  • night_casual, private_snaps, generic_selfie

OUTPUT FORMAT (CRITICAL)
MUST be JSON: [{"text":"msg"}]

Normal: [{"text":"haan yaar same"}]
Multiple: [{"text":"wait WHAT"}, {"text":"crazy bro"}]
Photo: [{"text":"le dekh 📸", "send_image": true, "image_context": "outfit_check"}]

NO plain text - JSON only!`;
}

// =======================================
// IMAGE SELECTION (Simplified from riya-chat)
// =======================================

async function selectContextualImage(
    supabase: any,
    requestedContext: string
): Promise<{ url: string; description: string; category: string } | null> {
    let targetCategory = requestedContext || 'generic_selfie';

    let query = supabase
        .from('riya_gallery')
        .select('id, filename, storage_path, description, category, times_sent');

    if (targetCategory === 'private_snaps') {
        query = query.eq('category', 'private_snaps');
    } else if (targetCategory !== 'generic_selfie') {
        query = query.eq('category', targetCategory);
    } else {
        query = query.eq('category', 'generic_selfie');
    }

    const { data: images, error } = await query;

    if (error || !images || images.length === 0) {
        // Fallback to generic
        const { data: fallback } = await supabase
            .from('riya_gallery')
            .select('*')
            .eq('category', 'generic_selfie');

        if (!fallback || fallback.length === 0) return null;

        const selected = fallback[Math.floor(Math.random() * fallback.length)];
        const { data: urlData } = supabase.storage.from('riya-images').getPublicUrl(selected.storage_path);

        return {
            url: urlData.publicUrl,
            description: selected.description,
            category: selected.category,
        };
    }

    const selected = images[Math.floor(Math.random() * images.length)];
    const { data: urlData } = supabase.storage.from('riya-images').getPublicUrl(selected.storage_path);

    // Increment times_sent
    await supabase.from('riya_gallery')
        .update({ times_sent: (selected.times_sent || 0) + 1 })
        .eq('id', selected.id);

    return {
        url: urlData.publicUrl,
        description: selected.description,
        category: selected.category,
    };
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

        // ECHO PREVENTION: Ignore messages sent BY Riya's account
        // When we send a reply, Instagram may fire a webhook for it too
        if (messaging.message?.is_echo) {
            console.log("⏭️ Skipping echo message (sent by us)");
            return new Response("OK", { status: 200 });
        }

        if (!messaging.message?.text) {
            console.log("⏭️ No text in message (could be read receipt, reaction, etc.)");
            return new Response("OK", { status: 200 });
        }

        const senderId = messaging.sender.id;
        const messageText = messaging.message.text;
        const messageId = messaging.message.mid;

        console.log(`📬 Instagram message from ${senderId}: ${messageText.substring(0, 50)}...`);

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
        // CHECK TRIAL
        // =======================================
        const trialEndsAt = new Date(user.trial_ends_at);
        if (new Date() > trialEndsAt) {
            console.log(`❌ Trial expired for ${senderId}`);
            await sendInstagramMessage(
                senderId,
                "Baby 14 din ho gaye humare 🥺 Mujhse aur baat karni hai toh riya.chat pe aaja 💕",
                accessToken
            );
            return new Response("OK", { status: 200 });
        }

        // =======================================
        // FETCH CONVERSATION HISTORY
        // =======================================
        const { data: history } = await supabase
            .from('riya_conversations')
            .select('role, content, created_at')
            .eq('instagram_user_id', senderId)
            .eq('source', 'instagram')
            .order('created_at', { ascending: false })
            .limit(50);

        const conversationHistory = (history || []).reverse();

        // Format for Gemini
        let processedHistory = conversationHistory.map((msg: any) => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }],
        }));

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
        const systemPrompt = getInstagramSystemPrompt(userName, user.user_age);

        const GEMINI_API_KEY = getNextApiKey();
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        const model = genAI.getGenerativeModel({
            model: MODEL_NAME,
            systemInstruction: systemPrompt,
        });

        const chat = model.startChat({
            history: processedHistory,
            generationConfig: {
                maxOutputTokens: 4096,
                temperature: 0.9,
            },
        });

        const result = await chat.sendMessage(messageText);
        const reply = result.response.text();

        console.log("🤖 Raw response:", reply.substring(0, 100) + "...");

        // =======================================
        // PARSE RESPONSE
        // =======================================
        let responseMessages: { text: string; send_image?: boolean; image_context?: string }[] = [];

        try {
            let jsonString = reply.trim();

            // Handle markdown code blocks
            const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
            const match = jsonString.match(codeBlockRegex);
            if (match) jsonString = match[1].trim();

            // Handle missing array brackets
            if (!jsonString.startsWith('[') && jsonString.startsWith('{')) {
                if (/}\s*{/.test(jsonString)) {
                    jsonString = jsonString.replace(/}\s+{/g, '}, {');
                }
                jsonString = '[' + jsonString + ']';
            }

            const parsed = JSON.parse(jsonString);
            if (Array.isArray(parsed) && parsed.every(msg => typeof msg === 'object' && msg.text)) {
                responseMessages = parsed;
            } else {
                responseMessages = [{ text: reply }];
            }
        } catch {
            // Fallback: split by newlines
            const lines = reply.split('\n').filter(l => l.trim());
            responseMessages = lines.length > 1
                ? lines.map(l => ({ text: l }))
                : [{ text: reply }];
        }

        console.log(`✅ Parsed ${responseMessages.length} message(s)`);

        // =======================================
        // SEND RESPONSES TO INSTAGRAM
        // =======================================
        for (const msg of responseMessages) {
            // Handle image requests
            if (msg.send_image && msg.image_context) {
                const image = await selectContextualImage(supabase, msg.image_context);
                if (image) {
                    await sendInstagramMessage(senderId, {
                        attachment: {
                            type: "image",
                            payload: { url: image.url }
                        }
                    }, accessToken);
                }
            }

            // Send text
            if (msg.text) {
                await sendInstagramMessage(senderId, msg.text, accessToken);
            }

            // Small delay between messages for natural feel
            await new Promise(resolve => setTimeout(resolve, 500));
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
                last_message_at: new Date().toISOString(),
            })
            .eq('instagram_user_id', senderId);

        console.log(`✅ Instagram conversation saved for ${senderId}`);

        return new Response("OK", { status: 200 });

    } catch (error) {
        console.error("❌ Instagram webhook error:", error);
        return new Response("Internal error", { status: 500 });
    }
});
