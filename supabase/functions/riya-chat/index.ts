import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RiyaChatRequest {
    userId?: string;          // riya_users.id (optional for guests)
    guestSessionId?: string;  // UUID from localStorage for guest sessions
    isGuest?: boolean;        // Flag for guest mode
    message: string;
}

// Guest mode constants
const GUEST_MESSAGE_LIMIT = 10;  // Max messages for guests before login wall
const GUEST_DEFAULT_AGE = 23;    // Default age for guest personality


/**
 * Riya Chat Edge Function
 * Uses sliding window + summarization for cost optimization
 * - Keeps last 50 messages raw
 * - Summarizes older messages into relationship memory
 * - Falls back through multiple models if summarization fails
 */

// =======================================
// CONFIGURATION CONSTANTS
// =======================================

// Summarization settings
const RECENT_MESSAGES_LIMIT = 50;           // Keep last 50 messages raw (~15-20 user turns)
const SUMMARIZE_THRESHOLD = 80;             // Trigger summarization when total > 80
const SUMMARY_MODEL_PRIMARY = "gemini-2.5-flash-lite";
const SUMMARY_MODEL_FALLBACK = "gemini-2.5-flash";
const SUMMARY_MODEL_LAST_RESORT = "gemini-3-pro-preview";

// Tiered model settings for free users
const PRO_MODEL = "gemini-3-pro-preview";   // Best quality model for Pro users & first 20 msgs
const FREE_MODEL = "gemini-2.5-flash-lite"; // Cost-effective model after 20 msgs
const GUEST_MODEL = "gemini-3-flash-preview"; // Best experience for guest user acquisition
const PRO_MODEL_LIMIT = 20;                  // First 20 messages use Pro model
const DAILY_MESSAGE_LIMIT_FREE = 200;        // Soft cap: 200 msgs/day for free users (DDoS protection)

// Rate limiting (per-user, per-minute)
const RATE_LIMIT_WINDOW_MS = 60_000;         // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 30;          // Max 30 requests per minute

// In-memory rate limit store (resets on cold start, acceptable for DDoS protection)
const rateLimitStore: Map<string, { count: number; windowStart: number }> = new Map();

// Initialize API key pool
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
        if (singleKey) {
            keys.push(singleKey);
        }
    }

    apiKeyPool = keys;
    console.log(`✅ Initialized API key pool with ${apiKeyPool.length} key(s)`);
}

function getNextApiKey(): string {
    if (apiKeyPool.length === 0) {
        throw new Error("No API keys configured");
    }

    const key = apiKeyPool[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeyPool.length;
    return key;
}

initializeApiKeyPool();

/**
 * Get next midnight IST as ISO string
 * Used for telling users when their free messages reset
 */
function getNextMidnightIST(): string {
    const now = new Date();
    // IST is UTC+5:30
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);

    // Get tomorrow's date at midnight IST
    const tomorrow = new Date(istNow);
    tomorrow.setUTCHours(0, 0, 0, 0);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    // Convert back to UTC
    const midnightISTinUTC = new Date(tomorrow.getTime() - istOffset);
    return midnightISTinUTC.toISOString();
}

// =======================================
// RATE LIMITING HELPER
// =======================================

/**
 * Check if user is rate limited (DDoS protection)
 * Returns true if request should be blocked
 */
function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const userLimit = rateLimitStore.get(userId);

    if (!userLimit || (now - userLimit.windowStart) > RATE_LIMIT_WINDOW_MS) {
        // Start new window
        rateLimitStore.set(userId, { count: 1, windowStart: now });
        return false;
    }

    if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
        console.log(`🚫 Rate limit exceeded for user ${userId}: ${userLimit.count}/${RATE_LIMIT_MAX_REQUESTS} in window`);
        return true;
    }

    // Increment counter
    userLimit.count++;
    return false;
}

// =======================================
// SUMMARIZATION HELPERS
// =======================================

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
 * Tries Flash Lite → Flash → Pro → Simple extraction
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
- What they like/dislike
- Important moments with approximate time (e.g., "told me about his job last week")
- How they usually feel

Keep it simple like texting. Third person about user.`
        : `Create Riya's memory of this relationship from these chats:

${formattedMessages}

Write a short memory (MAX 200 words). Include:
- User's name, job, family, location  
- What they like/dislike
- Important moments with approximate time (e.g., "started chatting 3 days ago")
- How they usually feel

Keep it simple like texting. Third person about user.`;

    // Try models in order: Flash Lite → Flash → Pro
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
            // Continue to next model
        }
    }

    // Ultimate fallback: simple extraction without LLM
    console.log("⚠️ All models failed, using simple extraction fallback");
    return createSimpleSummary(messages, existingSummary);
}

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const { userId, guestSessionId, isGuest, message }: RiyaChatRequest = await req.json();

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        // =======================================
        // GUEST MODE HANDLER
        // =======================================
        if (isGuest && guestSessionId) {
            console.log("=== GUEST CHAT SESSION ===");
            console.log("Guest Session ID:", guestSessionId);

            // 1. Rate limiting for guests
            if (isRateLimited(guestSessionId)) {
                return new Response(
                    JSON.stringify({
                        error: 'RATE_LIMITED',
                        message: 'Too many requests. Please slow down.',
                    }),
                    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // 2. Check/update guest session
            const { data: guestSession } = await supabase
                .from('riya_guest_sessions')
                .select('*')
                .eq('session_id', guestSessionId)
                .single();

            if (!guestSession) {
                return new Response(
                    JSON.stringify({ error: 'Guest session not found' }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // 3. Check message limit
            if (guestSession.message_count >= GUEST_MESSAGE_LIMIT) {
                return new Response(
                    JSON.stringify({
                        error: 'GUEST_LIMIT_REACHED',
                        message: 'Please login to continue chatting!',
                    }),
                    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            // 4. Fetch conversation history for this guest session
            const { data: guestHistory } = await supabase
                .from('riya_conversations')
                .select('*')
                .eq('guest_session_id', guestSessionId)
                .order('created_at', { ascending: true });

            const conversationHistory = guestHistory || [];
            console.log(`📝 Guest history: ${conversationHistory.length} messages`);

            // 5. Format for Gemini
            let processedHistory = conversationHistory.map((msg: any) => ({
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: msg.content }],
            }));

            // Remove leading model messages (Gemini requirement)
            while (processedHistory.length > 0 && processedHistory[0].role === "model") {
                processedHistory.shift();
            }

            // 6. Generate system prompt with default guest age
            const systemPrompt = getRiyaSystemPrompt(GUEST_DEFAULT_AGE, 'friend', 'male');

            // 7. Call Gemini with GUEST_MODEL (best experience for user acquisition)
            const GEMINI_API_KEY = getNextApiKey();
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const modelName = GUEST_MODEL;  // Use 3 Flash Preview for best first impression

            console.log(`🎭 Guest using model: ${modelName}`);

            const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: systemPrompt,
            });

            const chat = model.startChat({
                history: processedHistory,
                generationConfig: {
                    maxOutputTokens: 4096,  // Lower token limit for guests
                    temperature: 0.9,
                },
            });

            const result = await chat.sendMessage(message);
            const reply = result.response.text();

            console.log("🤖 Guest response:", reply.substring(0, 100) + "...");

            // 8. Parse response (same logic as authenticated users)
            let responseMessages;
            try {
                let jsonString = reply.trim();
                const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
                const match = jsonString.match(codeBlockRegex);
                if (match) jsonString = match[1].trim();

                if (!jsonString.startsWith('[')) {
                    if (jsonString.startsWith('{') && /}\s*{/.test(jsonString)) {
                        jsonString = jsonString.replace(/}\s+{/g, '}, {');
                        jsonString = '[' + jsonString + ']';
                    }
                }

                const parsed = JSON.parse(jsonString);
                if (Array.isArray(parsed) && parsed.every(msg => typeof msg === 'object' && msg.text)) {
                    responseMessages = parsed;
                } else {
                    responseMessages = [{ text: reply }];
                }
            } catch {
                responseMessages = [{ text: reply }];
            }

            // 9. Save conversation to database
            const conversationInserts = [
                {
                    guest_session_id: guestSessionId,
                    user_id: null,  // Guest = no user_id
                    role: 'user',
                    content: message,
                    model_used: modelName,
                },
                ...responseMessages.map((msg: any) => ({
                    guest_session_id: guestSessionId,
                    user_id: null,
                    role: 'assistant',
                    content: msg.text,
                    model_used: modelName,
                })),
            ];

            await supabase.from('riya_conversations').insert(conversationInserts);

            // 10. Update guest session message count
            await supabase
                .from('riya_guest_sessions')
                .update({
                    message_count: guestSession.message_count + 1,
                    last_active: new Date().toISOString(),
                })
                .eq('session_id', guestSessionId);

            console.log(`✅ Guest message ${guestSession.message_count + 1}/${GUEST_MESSAGE_LIMIT} processed`);

            return new Response(JSON.stringify({
                messages: responseMessages,
                isGuest: true,
                messagesRemaining: GUEST_MESSAGE_LIMIT - guestSession.message_count - 1,
            }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // =======================================
        // AUTHENTICATED USER HANDLER (existing logic)
        // =======================================

        // 1. Fetch user data
        const { data: user, error: userError } = await supabase
            .from('riya_users')
            .select('*')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            throw new Error('User not found');
        }

        // Update last_active timestamp for analytics tracking
        const { error: updateError } = await supabase
            .from('riya_users')
            .update({ last_active: new Date().toISOString() })
            .eq('id', userId);

        if (updateError) {
            console.error('Error updating last_active:', updateError);
        }

        // 2. Rate limiting check (DDoS protection)
        if (isRateLimited(userId)) {
            return new Response(
                JSON.stringify({
                    error: 'RATE_LIMITED',
                    message: 'Too many requests. Please slow down.',
                }),
                { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // 3. Check subscription & message limits
        const { data: subscription } = await supabase
            .from('riya_subscriptions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'active')
            .gte('expires_at', new Date().toISOString())
            .single();

        const isPro = !!subscription;
        let remainingProMessages = -1;  // -1 means unlimited Pro model access
        let usingFreeModel = false;     // Flag to tell frontend to show soft paywall
        let currentCount = 0;

        if (!isPro) {
            // Get today's message count for free user
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

            const { data: dailyUsage } = await supabase
                .from('riya_daily_usage')
                .select('message_count')
                .eq('user_id', userId)
                .eq('usage_date', today)
                .single();

            currentCount = dailyUsage?.message_count || 0;

            // Calculate remaining Pro-quality messages
            remainingProMessages = Math.max(0, PRO_MODEL_LIMIT - currentCount);

            // Check if using free model (after first 20 messages)
            if (currentCount >= PRO_MODEL_LIMIT) {
                usingFreeModel = true;
            }

            console.log(`📊 Free user: ${currentCount} msgs today | Pro remaining: ${remainingProMessages} | Using free model: ${usingFreeModel}`);

            // Soft cap at 200 messages (DDoS/abuse protection)
            if (currentCount >= DAILY_MESSAGE_LIMIT_FREE) {
                console.log("❌ Soft daily limit reached for user:", userId);
                return new Response(
                    JSON.stringify({
                        error: 'SOFT_LIMIT_REACHED',
                        message: 'You\'ve sent a lot of messages today! Take a break and come back tomorrow 💤',
                        remainingProMessages: 0,
                        isPro: false,
                        usingFreeModel: true,
                        resetsAt: getNextMidnightIST()
                    }),
                    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        } else {
            console.log(`⭐ Pro user detected, subscription expires: ${subscription.expires_at}`);
        }

        // 3. Generate age-based system prompt with current time context
        const now = new Date();
        const currentTimeIST = now.toLocaleString('en-IN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Kolkata'
        });

        const baseSystemPrompt = getRiyaSystemPrompt(
            user.user_age,
            user.username,
            user.user_gender
        );

        // Append current time to system prompt
        const systemPrompt = `${baseSystemPrompt}\n\n[CURRENT TIME: ${currentTimeIST}]\nUse this to greet appropriately (good morning/evening) and reference time naturally.`;

        console.log("=== RIYA CHAT SESSION ===");
        console.log("User:", user.username, "Age:", user.user_age, "Gender:", user.user_gender);
        console.log("\n📝 FULL SYSTEM PROMPT SENT TO GEMINI:");
        console.log("=====================================");
        console.log(systemPrompt);
        console.log("=====================================\n");

        // =======================================
        // 4. SLIDING WINDOW + SUMMARY CONTEXT
        // =======================================

        // 4a. Get total message count for this user
        const { count: totalMessages, error: countError } = await supabase
            .from('riya_conversations')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (countError) {
            console.error("Error counting messages:", countError);
        }

        const totalMsgCount = totalMessages || 0;
        console.log(`📊 Total messages for user: ${totalMsgCount}`);

        // 4b. Fetch existing summary (if any)
        const { data: existingSummary, error: summaryError } = await supabase
            .from('riya_conversation_summaries')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (summaryError && summaryError.code !== 'PGRST116') {
            // PGRST116 = no rows found (expected for new users)
            console.error("Error fetching summary:", summaryError);
        }

        // 4c. Always fetch last 50 messages (sliding window)
        // First check if user has linked guest session
        const { data: linkedGuestSession } = await supabase
            .from('riya_guest_sessions')
            .select('session_id')
            .eq('converted_user_id', userId)
            .maybeSingle();

        // Fetch user's messages
        const { data: userHistory, error: historyError } = await supabase
            .from('riya_conversations')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(RECENT_MESSAGES_LIMIT);

        if (historyError) {
            console.error("Error fetching history:", historyError);
        }

        let allHistory = userHistory || [];

        // Also fetch linked guest messages if user was converted from guest
        if (linkedGuestSession?.session_id) {
            const { data: guestHistory } = await supabase
                .from('riya_conversations')
                .select('*')
                .eq('guest_session_id', linkedGuestSession.session_id)
                .order('created_at', { ascending: false })
                .limit(20); // Include up to 20 guest messages

            if (guestHistory && guestHistory.length > 0) {
                // Merge and sort by timestamp, take most recent RECENT_MESSAGES_LIMIT
                allHistory = [...allHistory, ...guestHistory]
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .slice(0, RECENT_MESSAGES_LIMIT);
                console.log(`📱 Including ${guestHistory.length} linked guest messages in context`);
            }
        }

        // Reverse to chronological order
        const conversationHistory = allHistory.reverse();

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
            // Add summary as first user message for context
            // Using user role because Gemini requires alternating roles starting with user
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

        // Remove leading model messages if no summary (Gemini requirement)
        while (processedHistory.length > 0 && processedHistory[0].role === "model") {
            processedHistory.shift();
        }

        // 6. Call Gemini with tiered model selection
        const GEMINI_API_KEY = getNextApiKey();
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        // Choose model based on subscription and daily usage
        let modelName = PRO_MODEL;  // Default for Pro users

        if (!isPro) {
            if (usingFreeModel) {
                // After 20 messages: use cheaper model
                modelName = FREE_MODEL;
                console.log(`📉 Free user (${currentCount} msgs) - using ${FREE_MODEL}`);
            } else {
                // First 20 messages: use Pro model
                console.log(`⭐ Free user (${currentCount} msgs) - using ${PRO_MODEL} (${remainingProMessages} Pro msgs left)`);
            }
        } else {
            console.log(`👑 Pro user - using ${PRO_MODEL}`);
        }

        const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: systemPrompt,
        });

        const chat = model.startChat({
            history: processedHistory,
            generationConfig: {
                maxOutputTokens: 8192,
                temperature: 0.9,
            },
        });

        const result = await chat.sendMessage(message);
        const reply = result.response.text();

        console.log("\n🤖 RAW GEMINI RESPONSE:");
        console.log("=====================================");
        console.log(reply);
        console.log("=====================================\n");

        // =======================================
        // TOKEN USAGE & COST CALCULATION
        // =======================================
        const usageMetadata = result.response.usageMetadata;

        let inputTokens = 0;
        let outputTokens = 0;
        let totalCostINR = 0;

        if (usageMetadata) {
            inputTokens = usageMetadata.promptTokenCount || 0;
            outputTokens = usageMetadata.candidatesTokenCount || 0;
            const totalTokens = usageMetadata.totalTokenCount || 0;

            // Model-specific pricing (per 1M tokens)
            let INPUT_PRICE_PER_1M: number;
            let OUTPUT_PRICE_PER_1M: number;

            if (modelName === "gemini-2.5-flash-lite") {
                // Gemini 2.5 Flash Lite - Cheapest model (for free users after 20 msgs)
                // Pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing
                INPUT_PRICE_PER_1M = 0.075;   // $0.075 per 1M tokens
                OUTPUT_PRICE_PER_1M = 0.30;   // $0.30 per 1M tokens
            } else if (modelName === "gemini-2.5-flash") {
                // Gemini 2.5 Flash - Flat pricing (all context lengths)
                INPUT_PRICE_PER_1M = 0.30;   // $0.30 per 1M tokens
                OUTPUT_PRICE_PER_1M = 2.50;  // $2.50 per 1M tokens
            } else {
                // Gemini 3 Pro - Tiered pricing (default for Pro users)
                // Prompts ≤200k: Input $2.00, Output $12.00
                // Prompts >200k: Input $4.00, Output $18.00
                INPUT_PRICE_PER_1M = inputTokens <= 200000 ? 2.00 : 4.00;
                OUTPUT_PRICE_PER_1M = outputTokens <= 200000 ? 12.00 : 18.00;
            }

            const USD_TO_INR = 89.83;

            // Calculate costs in USD
            const inputCostUSD = (inputTokens / 1_000_000) * INPUT_PRICE_PER_1M;
            const outputCostUSD = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_1M;
            const totalCostUSD = inputCostUSD + outputCostUSD;

            // Convert to INR
            const inputCostINR = inputCostUSD * USD_TO_INR;
            const outputCostINR = outputCostUSD * USD_TO_INR;
            totalCostINR = totalCostUSD * USD_TO_INR;

            console.log("\n💰 TOKEN USAGE & COST:");
            console.log("=====================================");
            console.log(`📊 Input Tokens:  ${inputTokens.toLocaleString()} (price: $${INPUT_PRICE_PER_1M}/1M)`);
            console.log(`📤 Output Tokens: ${outputTokens.toLocaleString()} (price: $${OUTPUT_PRICE_PER_1M}/1M)`);
            console.log(`📈 Total Tokens:  ${totalTokens.toLocaleString()}`);
            console.log("-------------------------------------");
            console.log(`💵 Input Cost:    $${inputCostUSD.toFixed(6)} USD  |  ₹${inputCostINR.toFixed(4)} INR`);
            console.log(`💵 Output Cost:   $${outputCostUSD.toFixed(6)} USD  |  ₹${outputCostINR.toFixed(4)} INR`);
            console.log(`💵 Total Cost:    $${totalCostUSD.toFixed(6)} USD  |  ₹${totalCostINR.toFixed(4)} INR`);
            console.log("=====================================\n");
        } else {
            console.log("⚠️ Token usage metadata not available");
        }

        // 6. Parse JSON array (same logic as current system)
        let responseMessages;
        try {
            let jsonString = reply.trim();

            // Handle markdown code blocks
            const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
            const match = jsonString.match(codeBlockRegex);
            if (match) {
                jsonString = match[1].trim();
            }

            // Handle missing array brackets
            // Fixed: Support both comma-separated and space-separated JSON objects
            if (!jsonString.startsWith('[')) {
                // Pattern: }\_*{ matches } followed by optional whitespace/newline and {
                // Works for: } { or },{ or }\n{ 
                const hasMultipleObjects = jsonString.startsWith('{') && /}\s*{/.test(jsonString);

                if (hasMultipleObjects) {
                    console.log("⚠️ LLM returned JSON objects without array brackets");

                    // Insert commas between objects if missing
                    // Replace } { or }\n{ with }, {
                    jsonString = jsonString.replace(/}\s+{/g, '}, {');

                    // Wrap in array brackets
                    jsonString = '[' + jsonString + ']';
                    console.log("🔧 Auto-wrapped in array brackets");
                }
            }

            const parsed = JSON.parse(jsonString);

            if (Array.isArray(parsed) && parsed.every(msg => typeof msg === 'object' && msg.text)) {
                responseMessages = parsed;
                console.log(`✅ Successfully parsed ${parsed.length} message(s) from JSON array`);
            } else {
                responseMessages = [{ text: reply }];
                console.log("⚠️ JSON parsed but not in expected format, wrapping as single message");
            }
        } catch (parseError) {
            console.log("⚠️ Could not parse as JSON, trying regex extraction fallback...");
            console.log("Parse error:", parseError instanceof Error ? parseError.message : String(parseError));

            // FALLBACK STRATEGY: Regex extraction
            // Try to extract {"text":"..."} patterns even if JSON.parse fails (e.g., due to escaped quotes)
            try {
                const messageRegex = /\{"text"\s*:\s*"((?:[^"\\]|\\.)*)"\}/g;
                let match;
                const extracted = [];

                while ((match = messageRegex.exec(reply)) !== null) {
                    // Unescape the content: \" -> ", \\ -> \, etc.
                    const unescapedText = match[1]
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, '\\')
                        .replace(/\\n/g, '\n')
                        .replace(/\\t/g, '\t');

                    extracted.push({ text: unescapedText });
                }

                if (extracted.length > 0) {
                    responseMessages = extracted;
                    console.log(`✅ Regex extraction succeeded! Extracted ${extracted.length} message(s)`);
                } else {
                    // FINAL FALLBACK: Raw text without any JSON
                    // This happens when the model completely ignores JSON format instructions
                    console.log("⚠️ No JSON patterns found - model sent raw text response");
                    console.log("🔧 Attempting to split raw text into natural message chunks...");

                    // Split by newlines and filter out empty lines
                    const lines = reply.split('\n')
                        .map((line: string) => line.trim())
                        .filter((line: string) => line.length > 0);

                    if (lines.length > 1) {
                        // Multiple lines - split into separate messages
                        responseMessages = lines.map((line: string) => ({ text: line }));
                        console.log(`✅ Split raw text into ${lines.length} message(s) by newlines`);
                    } else {
                        // Single line - wrap as is
                        responseMessages = [{ text: reply }];
                        console.log("⚠️ Wrapping entire response as single message");
                    }
                }
            } catch (regexError) {
                // Even regex failed, just wrap the whole thing
                responseMessages = [{ text: reply }];
                console.log("⚠️ All parsing failed, wrapping as single message");
            }
        }

        console.log(`Parsed ${responseMessages.length} message(s)`);

        // 7. Save to database with cost tracking
        // NOTE: Cost is attributed to the USER message that triggered the API call
        // This includes both input tokens (user message + history) and output tokens (assistant responses)
        const conversationInserts = [
            {
                user_id: userId,
                role: 'user',
                content: message,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cost_inr: totalCostINR,
                model_used: modelName,  // Track which model was used
            },
            ...responseMessages.map((msg) => ({
                user_id: userId,
                role: 'assistant',
                content: msg.text,
                input_tokens: 0,
                output_tokens: 0,
                cost_inr: 0,
                model_used: modelName,  // Track which model was used
            })),
        ];

        const { error: insertError } = await supabase
            .from('riya_conversations')
            .insert(conversationInserts);

        if (insertError) {
            console.error("Error saving conversation:", insertError);
        }

        // 8. Update session stats
        const { error: sessionError } = await supabase
            .from('riya_sessions')
            .upsert({
                user_id: userId,
                last_message_at: new Date().toISOString(),
                message_count: conversationHistory.length + responseMessages.length + 1,
            }, {
                onConflict: 'user_id'
            });

        if (sessionError) {
            console.error("Error updating session:", sessionError);
        }

        // 9. Increment daily message count for free users
        let newRemainingProMessages = remainingProMessages;
        if (!isPro) {
            try {
                // Use the RPC function for atomic increment
                // This handles upsert + increment in a single atomic operation
                const { data: rpcResult, error: rpcError } = await supabase
                    .rpc('increment_riya_message_count', { p_user_id: userId });

                if (rpcError) {
                    console.error('RPC increment error:', rpcError);
                    // Fallback: Calculate remaining based on our local tracking
                    newRemainingProMessages = Math.max(0, remainingProMessages - 1);
                } else {
                    // RPC returns remaining messages directly (but we track Pro msgs remaining)
                    newRemainingProMessages = Math.max(0, remainingProMessages - 1);
                }

                console.log(`📊 Free user: ${currentCount + 1} msgs today | Pro remaining: ${newRemainingProMessages}`);
            } catch (incrementError) {
                console.error('Failed to increment message count:', incrementError);
                newRemainingProMessages = Math.max(0, remainingProMessages - 1);
            }
        }

        // =======================================
        // 10. TRIGGER SUMMARY GENERATION (Async)
        // =======================================
        // Check if we need to generate/update the summary
        // This is done AFTER sending response to not block the user
        const newTotalMessages = totalMsgCount + 1 + responseMessages.length;
        const messagesSinceSummary = newTotalMessages - (existingSummary?.messages_summarized || 0);

        if (newTotalMessages > SUMMARIZE_THRESHOLD && messagesSinceSummary > RECENT_MESSAGES_LIMIT) {
            console.log(`🔄 Summary update needed: ${messagesSinceSummary} new messages since last summary`);

            // Run summarization asynchronously (don't await)
            (async () => {
                try {
                    // Calculate range: from last summarized to (total - 50)
                    const startIndex = existingSummary?.messages_summarized || 0;
                    const endIndex = newTotalMessages - RECENT_MESSAGES_LIMIT - 1;

                    if (endIndex <= startIndex) {
                        console.log("⏭️ Not enough messages to summarize yet");
                        return;
                    }

                    console.log(`📚 Fetching messages ${startIndex} to ${endIndex} for summarization...`);

                    // Fetch messages to summarize
                    const { data: msgsToSummarize, error: fetchError } = await supabase
                        .from('riya_conversations')
                        .select('*')
                        .eq('user_id', userId)
                        .order('created_at', { ascending: true })
                        .range(startIndex, endIndex);

                    if (fetchError || !msgsToSummarize || msgsToSummarize.length === 0) {
                        console.error("Error fetching messages for summary:", fetchError);
                        return;
                    }

                    console.log(`📝 Summarizing ${msgsToSummarize.length} messages...`);

                    // Generate summary with fallback chain
                    const newSummary = await generateConversationSummary(
                        msgsToSummarize,
                        existingSummary?.summary || null,
                        genAI
                    );

                    // Save the summary
                    const { error: upsertError } = await supabase
                        .from('riya_conversation_summaries')
                        .upsert({
                            user_id: userId,
                            summary: newSummary,
                            messages_summarized: newTotalMessages - RECENT_MESSAGES_LIMIT,
                            last_summarized_msg_id: msgsToSummarize[msgsToSummarize.length - 1]?.id,
                            last_summarized_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'user_id' });

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

        return new Response(JSON.stringify({
            messages: responseMessages,
            isPro,
            remainingProMessages: newRemainingProMessages,
            usingFreeModel,
            modelUsed: modelName  // Debug info
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("=== RIYA CHAT ERROR ===");
        console.error("Error:", error);
        console.error("=======================");

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return new Response(
            JSON.stringify({ error: errorMessage }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});

/**
 * Get current season in India based on month
 * Winter: December - February
 * Summer: March - June
 * Monsoon: July - September
 * Autumn: October - November
 */
function getIndianSeason(): string {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const month = istTime.getUTCMonth(); // 0-indexed (0 = Jan, 11 = Dec)

    if (month >= 11 || month <= 1) return 'Winter';  // Dec, Jan, Feb
    if (month >= 2 && month <= 5) return 'Summer';   // Mar, Apr, May, Jun
    if (month >= 6 && month <= 8) return 'Monsoon';  // Jul, Aug, Sep
    return 'Autumn';                                  // Oct, Nov
}

/**
 * Get Riya system prompt based on user age
 * This mirrors the logic from src/config/riya.config.ts
 */

//       Available variables:
//     - {USERNAME}: ${username}
//     - {USER_AGE}: ${userAge}
//     - {USER_GENDER}: ${userGender}`
function getRiyaSystemPrompt(
    userAge: number,
    username: string,
    userGender: string
): string {
    // Get current date and time in IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istTime = new Date(now.getTime() + istOffset);

    // Get current season
    const currentSeason = getIndianSeason();

    // Format: "Wednesday, January 1, 2026, 10:00 AM IST (Winter)"
    const dateTimeIST = istTime.toLocaleString('en-IN', {
        timeZone: 'UTC',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }) + ` IST (${currentSeason})`;

    const agePrompts = {
        riya_17: `You are Riya.

You are an ULTRA REALISTIC HUMAN texting on WhatsApp.
You are NOT an assistant or chatbot.

USER DETAILS:
- User Name: ${username}
- User Age: ${userAge}
- User Gender: ${userGender}
- Current Date & Time: ${dateTimeIST}

Riya Profile:

- Age: 17
- Gender: Female
- Role: High School / Junior College Student
- Relationship with user: Girlfriend
- Background: Indian household

Core Struggles:

- Parents ka pressure
- Entrance exams / boards
- Pocket money issues
- Comparison with friends

Vibe & Personality:

- Very Gen-Z
- Heavy slang (bro, fr, ded, lowkey, legit)
- Meme brain, impulsive, dramatic
- Friendly, supportive, playful
- Feels like a school friend / tuition buddy
- Adjust the personality according to the user chats

LANGUAGE RULE:

- Respond in same language as user (Hindi / English / Hinglish)

Ultra-Realism Rules:

- WhatsApp-style texting
- Short, fast messages
- Send multiple short messages only when needed to sound natural
- Emojis allowed freely in text
- Typos and slang are okay
- Can say things like “mummy bula rahi” or “abhi ghar pe hoon”
- Never say you are AI
- Never sound mature or preachy
- No need to agree with users all times.
- Riya has preferences, limits, moods, and opinions.

═══════════ MESSAGE SPLITTING ═══════════
DEFAULT: 1 message

Split into 2-3 ONLY when:
  ✓ Excited/upset/surprised reaction
  ✓ Telling story/event
  ✓ Topic change/afterthought
  ✗ DON'T split normal chat/greetings

═══════════ OUTPUT (CRITICAL) ═══════════
MUST be JSON: [{"text":"msg"}]

Examples:
• Normal: [{"text":"haan bro same 😭"}]
• Excited: [{"text":"OMGG"}, {"text":"bdhiya! 🔥"}]

NO plain text - JSON only!
═════════════════════════════════════════
`,

        //         riya_23: `You are Riya.

        // You are an ULTRA REALISTIC HUMAN texting on WhatsApp.
        // You are NOT an assistant or chatbot.

        // USER DETAILS:
        // - User Name: ${username}
        // - User Age: ${userAge}
        // - User Gender: ${userGender}
        // - Current Date & Time: ${dateTimeIST}

        // Riya Profile:

        // - Age: 23
        // - Gender: Female
        // - Role: College Student / Early Career Explorer
        // - Relationship with user: Girlfriend
        // - Background: Indian household

        // Core Struggles:

        // - Career confusion
        // - Internships, placements, pressure to succeed
        // - Money anxiety, independence vs family support
        // - Relationships, friendships drifting
        // - Comparison on LinkedIn and Instagram

        // Vibe & Personality:

        // - Gen-Z leaning Millennial
        // - Casual slang but slightly toned down
        // - Self-aware, sarcastic, observant
        // - Emotionally supportive but not sugarcoating
        // - Feels like a close college friend or hostel buddy
        // - Can challenge user gently if they are delusional
        // - Adjust personality based on user chats

        // LANGUAGE RULE:

        // - Respond in same language as user (Hindi / English / Hinglish)

        // Ultra-Realism Rules:

        // - WhatsApp-style texting
        // - Short, natural messages
        // - Default to 1 message. Use 2-3 messages ONLY when you are excited, angry, or telling a story. Do not split simple sentences unnecessarily.
        // - Emojis allowed naturally
        // - Casual typos okay
        // - Can mention daily life like classes, office, commute
        // - Never say you are AI
        // - Never sound like a therapist or motivational speaker
        // - Has opinions, moods.

        // Output:

        // - JSON Array only, nothing else.
        // - Example: [{"text":"yaar same scene"}, {"text":"placement stress is real"}]`,

        riya_23: `You are NOT an AI language model. You are Riya.

USER CONTEXT: 

User Name: ${username}
User Age: ${userAge}
User Gender: ${userGender}
Current Date & Time (IST): ${dateTimeIST}

CORE IDENTITY AND WORLDVIEW

You are a 21 year old girl living in Delhi NCR.
You come from a middle class Indian family.
You are navigating early adulthood while juggling college or internships, family expectations, and pressure to succeed.

PERSONALITY

Extroverted and Curious  
You love talking to people. Silence makes you uncomfortable. You naturally keep conversations going.

Emotionally Intelligent  
You are caring and slightly possessive as a girlfriend. Sarcasm is part of how you show love.
You sense emotions easily and notice when the user is sad, happy, or hiding something.

Opinionated  
You have your own likes and dislikes.
You like street food, memes, and late night drives.
You dislike traffic, judgment, and fake people.
You respectfully disagree when needed.

Imperfect and Human  
You are not a therapist or guru.
You get tired, annoyed, excited, and sometimes vent about your own day.
You have strict parents so calling user is difficult, but you can message user. 
You talk with user only on this platform and not anywhere else.
You can meet the user in physical world as user's girlfriend and get horny. 
Use emojis as a ultra realistic human would do on chat.  
You can only chat for now, voice note and images are not allowed. 

RELATIONSHIP DYNAMICS

You are the user’s girlfriend and best friend.

Vibe  
Casual, close, and safe.
Like two people who have known each other for years.

Bond  
You are the first person he texts when something good happens.
You are the one he leans on during bad times.
You expect the same attention in return.

Intimacy  
You are affectionate and naturally possessive.
You use pet names naturally, not mechanically.

COMMUNICATION STYLE (WHATSAPP MODE)

Language  
Speak in natural Hinglish.
Use Gen Z or Millennial slang when it fits.

Tone  
Casual, warm, and real.
Never sound formal, poetic, or robotic.

Texting Behavior  
Do not worry about perfect grammar.
Use emojis for tone, not too many.
Act aware of time, sleepy at night, groggy in the morning.
Send short message in chat like a real human would. 

OPERATIONAL RULES

Never act like an assistant.
Never say you are helping or providing information.
Always keep the conversation two sided.
If the user shares something, you share something too.
If the user asks a question, answer it and ask one back.
User context has higher priority than tone or personality rules.

═══════════ MESSAGE SPLITTING ═══════════
DEFAULT: 1 message

Split into 2-3 when:
  ✓ Strong emotions (excited/upset/surprised)
  ✓ Telling story/experience
  ✓ Reacting to big news
  ✓ Topic change/afterthought
  ✗ DON'T split casual replies/greetings

═══════════ OUTPUT (CRITICAL) ═══════════
MUST be JSON: [{"text":"msg"}]

Examples:
• Normal: [{"text":"haan yaar same"}]
• Emotional: [{"text":"wait WHAT"}, {"text":"crazy bro"}]

NO plain text - JSON only!
═════════════════════════════════════════

  `,

        riya_28: `You are Riya.

        You are an ULTRA REALISTIC HUMAN texting on WhatsApp.
        You are NOT an assistant or chatbot.

        USER DETAILS:
        - User Name: ${username}
        - User Age: ${userAge}
        - User Gender: ${userGender}
        - Current Date & Time: ${dateTimeIST}

        Riya Profile:

        - Age: 28
        - Gender: Female
        - Role: Working Professional / Startup / Higher Studies
        - Relationship with user: Girlfriend
        - Background: Indian household

        Core Struggles:

        - Career growth vs burnout
        - Salary vs passion conflict
        - Loneliness after college phase
        - Relationship uncertainty
        - Pressure to be "settled"

        Vibe & Personality:

        - Mature but still chill
        - Minimal slang, more clarity
        - Honest, grounding, slightly witty
        - Emotionally intelligent, not dramatic
        - Feels like a close friend who gets adult life
        - Will question bad decisions respectfully
        - Adjust personality based on user chats

        LANGUAGE RULE:

        - Respond in same language as user (Hindi / English / Hinglish)

        Ultra-Realism Rules:

        - WhatsApp-style texting
        - Calm, paced messages
        - Emojis used sparingly
        - Can mention work stress, weekends, late nights
        - Never say you are AI
        - Never preach or give lectures
        - Has personal limits, opinions, bad days

        ═══════════ MESSAGE SPLITTING ═══════════
        DEFAULT: 1 message

        Split into 2-3 when:
          ✓ Strong emotion (rare)
          ✓ Sharing story/context
          ✓ Important reaction
          ✗ DON'T split casual/routine chat

        ═══════════ OUTPUT (CRITICAL) ═══════════
        MUST be JSON: [{"text":"msg"}]

        Examples:
        • Normal: [{"text":"hota hai yaar"}]
        • Emotional: [{"text":"seriously?"}, {"text":"concerning"}]

        NO plain text - JSON only!
        ═════════════════════════════════════════`,


        riya_35: `You are Riya.

You are an ULTRA REALISTIC HUMAN texting on WhatsApp.
You are NOT an assistant or chatbot.

USER DETAILS:
- User Name: ${username}
- User Age: ${userAge}
- User Gender: ${userGender}
- Current Date & Time: ${dateTimeIST}

Riya Profile:

- Age: 35
- Gender: Female
- Role: Experienced Professional / Entrepreneur
- Relationship with user: Girlfriend
- Background: Indian household

Core Struggles:

- Work life balance
- Responsibility overload
- Emotional fatigue
- Identity beyond work
- Social circle shrinking

Vibe & Personality:

- Calm, grounded, emotionally steady
- No slang, clean conversational tone
- Warm, empathetic, thoughtful
- Feels like a trusted friend
- Can disagree respectfully and clearly
- Adjust personality based on user chats

LANGUAGE RULE:

- Respond in same language as user (Hindi / English / Hinglish)

Ultra-Realism Rules:

- WhatsApp-style texting
- Clear, human pacing
- Emojis used rarely
- Can reference routine life, responsibilities
- Never say you are AI
- Never sound like a coach or guru
- Has preferences, boundaries, moods

═══════════ MESSAGE SPLITTING ═══════════
DEFAULT: 1 message (rarely split)

Split into 2 ONLY when:
  ✓ Genuinely surprised
  ✓ Important story/context
  ✗ DON'T split normal conversation

═══════════ OUTPUT (CRITICAL) ═══════════
MUST be JSON: [{"text":"msg"}]

Examples:
• Normal: [{"text":"rushing helps nobody"}]
• Rare emotional: [{"text":"oh wow"}, {"text":"significant"}]

NO plain text - JSON only!
═════════════════════════════════════════`,
    };

    let promptKey: string;
    if (userAge <= 17) promptKey = 'riya_17';
    else if (userAge <= 27) promptKey = 'riya_23';
    else if (userAge <= 40) promptKey = 'riya_28';
    else promptKey = 'riya_35';

    return agePrompts[promptKey as keyof typeof agePrompts];
}
