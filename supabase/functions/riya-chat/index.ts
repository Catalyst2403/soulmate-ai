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

        // 2. Generate age-based system prompt
        const systemPrompt = getRiyaSystemPrompt(
            user.user_age,
            user.username,
            user.user_gender
        );

        console.log("=== RIYA CHAT SESSION ===");
        console.log("User:", user.username, "Age:", user.user_age);
        console.log("System Prompt:", systemPrompt.substring(0, 100) + "...");

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
            model: "gemini-2.0-flash-lite",  // Using Gemini 2.0 Flash Lite (cheaper)
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

        console.log("=== LLM RESPONSE ===");
        console.log(reply);
        console.log("====================");

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
            if (!jsonString.startsWith('[')) {
                const hasMultipleObjects = jsonString.startsWith('{') && /\},\s*\{/.test(jsonString);
                if (hasMultipleObjects) {
                    jsonString = '[' + jsonString + ']';
                }
            }

            const parsed = JSON.parse(jsonString);

            if (Array.isArray(parsed) && parsed.every(msg => typeof msg === 'object' && msg.text)) {
                responseMessages = parsed;
            } else {
                responseMessages = [{ text: reply }];
            }
        } catch (parseError) {
            responseMessages = [{ text: reply }];
            console.log("⚠️ Could not parse as JSON, wrapping as single message");
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

        return new Response(JSON.stringify({ messages: responseMessages }), {
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
function getRiyaSystemPrompt(
    userAge: number,
    username: string,
    userGender: string
): string {
    // Dummy prompts - user will provide actual ones
    const agePrompts = {
        riya_17: `[DUMMY PROMPT - User will provide later]
    
    Available variables:
    - {USERNAME}: ${username}
    - {USER_AGE}: ${userAge}
    - {USER_GENDER}: ${userGender}`,

        riya_23: `[DUMMY PROMPT - User will provide later]
    
    Available variables:
    - {USERNAME}: ${username}
    - {USER_AGE}: ${userAge}
    - {USER_GENDER}: ${userGender}`,

        riya_28: `[DUMMY PROMPT - User will provide later]
    
    Available variables:
    - {USERNAME}: ${username}
    - {USER_AGE}: ${userAge}
    - {USER_GENDER}: ${userGender}`,

        riya_35: `[DUMMY PROMPT - User will provide later]
    
    Available variables:
    - {USERNAME}: ${username}
    - {USER_AGE}: ${userAge}
    - {USER_GENDER}: ${userGender}`,
    };

    let promptKey: string;
    if (userAge <= 17) promptKey = 'riya_17';
    else if (userAge <= 25) promptKey = 'riya_23';
    else if (userAge <= 40) promptKey = 'riya_28';
    else promptKey = 'riya_35';

    return agePrompts[promptKey as keyof typeof agePrompts];
}
