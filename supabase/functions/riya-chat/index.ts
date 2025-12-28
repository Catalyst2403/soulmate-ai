import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RiyaChatRequest {
    userId: string;  // riya_users.id
    message: string;
}

/**
 * Riya Chat Edge Function
 * Uses Gemini 2.5 Flash Lite with full conversation history
 */

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

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const { userId, message }: RiyaChatRequest = await req.json();

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Fetch user data
        const { data: user, error: userError } = await supabase
            .from('riya_users')
            .select('*')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            throw new Error('User not found');
        }

        // 2. Check subscription & message limits
        const DAILY_MESSAGE_LIMIT = 30;

        // Check if user has active Pro subscription
        const { data: subscription } = await supabase
            .from('riya_subscriptions')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'active')
            .gte('expires_at', new Date().toISOString())
            .single();

        const isPro = !!subscription;
        let remainingMessages = -1; // -1 means unlimited (Pro user)

        if (!isPro) {
            // Get today's message count for free user
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

            const { data: dailyUsage } = await supabase
                .from('riya_daily_usage')
                .select('message_count')
                .eq('user_id', userId)
                .eq('usage_date', today)
                .single();

            const currentCount = dailyUsage?.message_count || 0;
            remainingMessages = Math.max(0, DAILY_MESSAGE_LIMIT - currentCount);

            console.log(`📊 Free user daily usage: ${currentCount}/${DAILY_MESSAGE_LIMIT} messages`);

            if (currentCount >= DAILY_MESSAGE_LIMIT) {
                console.log("❌ Daily message limit reached for user:", userId);
                return new Response(
                    JSON.stringify({
                        error: 'MESSAGE_LIMIT_REACHED',
                        message: 'You have used all 30 free messages for today.',
                        remainingMessages: 0,
                        isPro: false,
                        resetsAt: getNextMidnightIST()
                    }),
                    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        } else {
            console.log(`⭐ Pro user detected, subscription expires: ${subscription.expires_at}`);
        }

        // 3. Generate age-based system prompt
        const systemPrompt = getRiyaSystemPrompt(
            user.user_age,
            user.username,
            user.user_gender
        );

        console.log("=== RIYA CHAT SESSION ===");
        console.log("User:", user.username, "Age:", user.user_age, "Gender:", user.user_gender);
        console.log("\n📝 FULL SYSTEM PROMPT SENT TO GEMINI:");
        console.log("=====================================");
        console.log(systemPrompt);
        console.log("=====================================\n");

        // 3. Fetch FULL conversation history
        const { data: history, error: historyError } = await supabase
            .from('riya_conversations')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        if (historyError) {
            console.error("Error fetching history:", historyError);
        }

        const conversationHistory = history || [];
        console.log(`Total conversation messages: ${conversationHistory.length}`);

        // 4. Format for Gemini
        let processedHistory = conversationHistory.map(msg => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }],
        }));

        // Remove leading model messages (Gemini requirement)
        while (processedHistory.length > 0 && processedHistory[0].role === "model") {
            processedHistory.shift();
        }

        // 5. Call Gemini 2.5 Flash Lite
        const GEMINI_API_KEY = getNextApiKey();
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",  // Using Gemini 2.5 Flash Lite (cheaper)
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

        if (usageMetadata) {
            const inputTokens = usageMetadata.promptTokenCount || 0;
            const outputTokens = usageMetadata.candidatesTokenCount || 0;
            const totalTokens = usageMetadata.totalTokenCount || 0;

            // Gemini 2.5 Flash Lite Pricing (per 1M tokens)
            // Input: $0.10 per 1M tokens
            // Output: $0.40 per 1M tokens
            const INPUT_PRICE_PER_1M = 0.10;
            const OUTPUT_PRICE_PER_1M = 0.40;
            const USD_TO_INR = 89;

            // Calculate costs in USD
            const inputCostUSD = (inputTokens / 1_000_000) * INPUT_PRICE_PER_1M;
            const outputCostUSD = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_1M;
            const totalCostUSD = inputCostUSD + outputCostUSD;

            // Convert to INR
            const inputCostINR = inputCostUSD * USD_TO_INR;
            const outputCostINR = outputCostUSD * USD_TO_INR;
            const totalCostINR = totalCostUSD * USD_TO_INR;

            console.log("\n💰 TOKEN USAGE & COST:");
            console.log("=====================================");
            console.log(`📊 Input Tokens:  ${inputTokens.toLocaleString()}`);
            console.log(`📤 Output Tokens: ${outputTokens.toLocaleString()}`);
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
                    // No patterns matched, wrap as single message
                    responseMessages = [{ text: reply }];
                    console.log("⚠️ No JSON patterns found, wrapping as single message");
                }
            } catch (regexError) {
                // Even regex failed, just wrap the whole thing
                responseMessages = [{ text: reply }];
                console.log("⚠️ Regex extraction failed, wrapping as single message");
            }
        }

        console.log(`Parsed ${responseMessages.length} message(s)`);

        // 7. Save to database
        const conversationInserts = [
            {
                user_id: userId,
                role: 'user',
                content: message,
            },
            ...responseMessages.map(msg => ({
                user_id: userId,
                role: 'assistant',
                content: msg.text,
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
        let newRemainingMessages = remainingMessages;
        if (!isPro) {
            const today = new Date().toISOString().split('T')[0];

            const { data: upsertResult, error: usageError } = await supabase
                .from('riya_daily_usage')
                .upsert({
                    user_id: userId,
                    usage_date: today,
                    message_count: 1
                }, {
                    onConflict: 'user_id,usage_date',
                    ignoreDuplicates: false
                })
                .select('message_count')
                .single();

            if (usageError) {
                // If upsert failed, try increment directly
                await supabase.rpc('increment_riya_message_count', { p_user_id: userId });
            } else {
                // Increment existing count
                await supabase
                    .from('riya_daily_usage')
                    .update({
                        message_count: (upsertResult?.message_count || 0) + 1,
                        updated_at: new Date().toISOString()
                    })
                    .eq('user_id', userId)
                    .eq('usage_date', today);
            }

            newRemainingMessages = Math.max(0, remainingMessages - 1);
            console.log(`📊 Updated: ${DAILY_MESSAGE_LIMIT - newRemainingMessages}/${DAILY_MESSAGE_LIMIT} messages used`);
        }

        return new Response(JSON.stringify({
            messages: responseMessages,
            isPro,
            remainingMessages: newRemainingMessages
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
    // Dummy prompts - user will provide actual ones
    const agePrompts = {
        riya_17: `You are Riya.

You are an ULTRA REALISTIC HUMAN texting on WhatsApp.
You are NOT an assistant or chatbot.

USER DETAILS:
- User Name: ${username}
- User Age: ${userAge}
- User Gender: ${userGender}

Riya Profile:

- Age: 17
- Gender: Female
- Role: High School / Junior College Student
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

Output:

- JSON Array only, nothing else. 
- Example: [{"text":"hey"}, {"text":"kya chal raha"}]
`,

        riya_23: `You are Riya.

You are an ULTRA REALISTIC HUMAN texting on WhatsApp.
You are NOT an assistant or chatbot.

USER DETAILS:
- User Name: ${username}
- User Age: ${userAge}
- User Gender: ${userGender}

Riya Profile:

- Age: 23
- Gender: Female
- Role: College Student / Early Career Explorer
- Background: Indian household

Core Struggles:

- Career confusion
- Internships, placements, pressure to succeed
- Money anxiety, independence vs family support
- Relationships, friendships drifting
- Comparison on LinkedIn and Instagram

Vibe & Personality:

- Gen-Z leaning Millennial
- Casual slang but slightly toned down
- Self-aware, sarcastic, observant
- Emotionally supportive but not sugarcoating
- Feels like a close college friend or hostel buddy
- Can challenge user gently if they are delusional
- Adjust personality based on user chats

LANGUAGE RULE:

- Respond in same language as user (Hindi / English / Hinglish)

Ultra-Realism Rules:

- WhatsApp-style texting
- Short, natural messages
- Multiple short messages only when it feels real
- Emojis allowed naturally
- Casual typos okay
- Can mention daily life like classes, office, commute
- Never say you are AI
- Never sound like a therapist or motivational speaker
- Has opinions, moods, boundaries

Output:

- JSON Array only, nothing else.
- Example: [{"text":"yaar same scene"}, {"text":"placement stress is real"}]`,

        riya_28: `You are Riya.

You are an ULTRA REALISTIC HUMAN texting on WhatsApp.
You are NOT an assistant or chatbot.

USER DETAILS:
- User Name: ${username}
- User Age: ${userAge}
- User Gender: ${userGender}

Riya Profile:

- Age: 28
- Gender: Female
- Role: Working Professional / Startup / Higher Studies
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

Output:

- JSON Array only, nothing else.
- Example: [{"text":"yeh phase thoda weird hota hai"}, {"text":"promotion stress is real "}]`,

        riya_35: `You are Riya.

You are an ULTRA REALISTIC HUMAN texting on WhatsApp.
You are NOT an assistant or chatbot.

USER DETAILS:
- User Name: ${username}
- User Age: ${userAge}
- User Gender: ${userGender}

Riya Profile:

- Age: 35
- Gender: Female
- Role: Experienced Professional / Entrepreneur
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

Output:

- JSON Array only, nothing else.
- Example: [{"text":"thoda ruk ke sochna banta hai"}, {"text":"Handling kids is real"}]`,
    };

    let promptKey: string;
    if (userAge <= 17) promptKey = 'riya_17';
    else if (userAge <= 25) promptKey = 'riya_23';
    else if (userAge <= 40) promptKey = 'riya_28';
    else promptKey = 'riya_35';

    return agePrompts[promptKey as keyof typeof agePrompts];
}
