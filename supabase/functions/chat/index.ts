import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "npm:@google/generative-ai@0.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ChatRequest {
  messages: { role: string; content: string }[];
  systemPrompt: string;
}

// ============================================
// API Key Pool Management (Round-Robin)
// ============================================
let apiKeyPool: string[] = [];
let currentKeyIndex = 0;

/**
 * Initialize the API key pool from environment variables.
 * Supports multiple keys: GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
 * Falls back to single GEMINI_API_KEY if numbered keys aren't found.
 */
function initializeApiKeyPool(): void {
  const keys: string[] = [];

  // Try to load numbered keys (GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.)
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

  // Fallback to single key if no numbered keys found
  if (keys.length === 0) {
    const singleKey = Deno.env.get("GEMINI_API_KEY");
    if (singleKey) {
      keys.push(singleKey);
    }
  }

  apiKeyPool = keys;
  console.log(`✅ Initialized API key pool with ${apiKeyPool.length} key(s)`);
}

/**
 * Get the next API key using round-robin selection.
 * Automatically rotates to the next key for load distribution.
 */
function getNextApiKey(): string {
  if (apiKeyPool.length === 0) {
    throw new Error("No API keys configured. Please set GEMINI_API_KEY or GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.");
  }

  const key = apiKeyPool[currentKeyIndex];
  const keyNumber = currentKeyIndex + 1;

  // Round-robin: move to next key for next request
  currentKeyIndex = (currentKeyIndex + 1) % apiKeyPool.length;

  console.log(`🔑 Using API key #${keyNumber} of ${apiKeyPool.length}`);
  return key;
}

// Initialize pool when module loads
initializeApiKeyPool();

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, systemPrompt }: ChatRequest = await req.json();
    const GEMINI_API_KEY = getNextApiKey();

    // Debug logging for current session
    console.log("=== EDGE FUNCTION DEBUG SESSION ===");
    console.log("FULL SYSTEM PROMPT:");
    console.log(systemPrompt);
    console.log("\nMESSAGES RECEIVED:");
    messages.forEach((msg, idx) => {
      console.log(`  [${idx}] ${msg.role}: ${msg.content}`);
    });
    console.log(`\nTotal message count: ${messages.length}`);
    console.log("===================================");

    // Initialize Gemini AI
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      // model: "gemini-2.5-flash-lite",
      model: "gemini-3-pro-preview",
      systemInstruction: systemPrompt,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });

    // Convert messages to Gemini format
    // IMPORTANT: Gemini chat history MUST start with a user message, not a model message
    // So we need to handle the case where we have an initial greeting from the assistant
    let processedHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    // If history starts with a model message, we need to remove leading model messages
    // This happens when we have an initial greeting from the assistant
    while (processedHistory.length > 0 && processedHistory[0].role === "model") {
      console.log("⚠️ Removing leading model message from history (Gemini requires history to start with user)");
      processedHistory.shift();
    }

    const chatHistory = processedHistory;
    const lastMessage = messages[messages.length - 1];

    // Start chat with history
    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.9,
      },
    });

    // Send the latest message
    let result;
    try {
      result = await chat.sendMessage(lastMessage.content);
    } catch (apiError: any) {
      // Enhanced error handling for Gemini API edge cases
      console.error("=== GEMINI API ERROR ===");
      console.error("Error type:", apiError?.constructor?.name);
      console.error("Error message:", apiError?.message);
      console.error("Error details:", JSON.stringify(apiError, null, 2));
      console.error("========================");

      // Check for specific error types
      let userFriendlyMessage = "Arre yaar, kuch gadbad ho gaya. Phir se try kar?";

      if (apiError?.message?.includes("rate limit") || apiError?.message?.includes("429")) {
        userFriendlyMessage = "Thoda slow down kar yaar! Bahut zyada messages bhej diye. 1-2 min baad try kar.";
        console.error("🚨 RATE LIMIT ERROR: User hit API rate limit");
      } else if (apiError?.message?.includes("quota") || apiError?.message?.includes("exceeded")) {
        userFriendlyMessage = "API quota khatam ho gaya hai. Thodi der baad try kar.";
        console.error("🚨 QUOTA ERROR: API quota exceeded");
      } else if (apiError?.message?.includes("safety") || apiError?.message?.includes("blocked")) {
        userFriendlyMessage = "Sorry yaar, ye message thoda inappropriate lag raha hai. Kuch aur baat karte hain?";
        console.error("🚨 SAFETY BLOCK ERROR: Content blocked by safety filters");
      } else if (apiError?.message?.includes("API key")) {
        userFriendlyMessage = "Server configuration issue hai. Admin ko batao!";
        console.error("🚨 API KEY ERROR: Invalid or missing API key");
      }

      throw new Error(userFriendlyMessage);
    }

    // Check if response was blocked
    const response = result.response;
    if (!response || response.promptFeedback?.blockReason) {
      console.error("=== RESPONSE BLOCKED ===");
      console.error("Block reason:", response?.promptFeedback?.blockReason);
      console.error("Safety ratings:", JSON.stringify(response?.promptFeedback?.safetyRatings, null, 2));
      console.error("========================");
      throw new Error("Sorry yaar, AI ne ye message block kar diya. Kuch aur topic pe baat karte hain?");
    }

    const reply = response.text() || "Arre yaar, kuch gadbad ho gaya. Phir se try kar?";

    console.log("\n=== RAW LLM RESPONSE ===");
    console.log(reply);
    console.log("========================\n");

    // Try to parse response as JSON array for multi-message support
    let responseMessages;
    try {
      // First, try to extract JSON from markdown code blocks if present
      let jsonString = reply.trim();

      // Check if response is wrapped in markdown code blocks
      const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
      const match = jsonString.match(codeBlockRegex);

      if (match) {
        // Extract the JSON content from code block
        jsonString = match[1].trim();
        console.log("Extracted JSON from markdown code block");
      }

      // Try to parse the JSON
      const parsed = JSON.parse(jsonString);
      if (Array.isArray(parsed) && parsed.every(msg => msg.text)) {
        responseMessages = parsed;
        console.log(`✅ Successfully parsed ${parsed.length} messages from JSON array`);
      } else {
        // Not in expected format, wrap as single message
        responseMessages = [{ text: reply }];
        console.log("⚠️ JSON parsed but not in expected format, wrapping as single message");
      }
    } catch (parseError) {
      // Not JSON, wrap as single message
      responseMessages = [{ text: reply }];
      console.log("⚠️ Could not parse as JSON, wrapping as single message");
    }

    console.log("Returning", responseMessages.length, "message(s)");

    return new Response(JSON.stringify({ messages: responseMessages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("=== CHAT FUNCTION ERROR ===");
    console.error("Error:", error);
    console.error("Error type:", error?.constructor?.name);
    console.error("===========================");

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        errorType: error?.constructor?.name || "UnknownError"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
