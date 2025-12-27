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
      // Using Gemini 2.5 Flash - best price-performance for conversational AI
      // 13x cheaper on input, 16x cheaper on output vs Gemini 3 Pro
      model: "gemini-2.5-flash",
      systemInstruction: systemPrompt,
      // Safety settings removed - using Gemini's defaults
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
        maxOutputTokens: 8192, // Increased for Gemini 3 Pro (supports up to 65k)
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
      let debugInfo = `API Error: ${apiError?.message || 'Unknown'}`;

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
      } else if (apiError?.message?.includes("models/") || apiError?.message?.includes("not found") || apiError?.message?.includes("404")) {
        userFriendlyMessage = "Model not available. Please check API access and model name.";
        debugInfo = `Model Error: ${apiError?.message || 'Model not found or not accessible'}`;
        console.error("🚨 MODEL ERROR: Model not found or not accessible with this API key");
      }

      // Include debug info in development (helps with troubleshooting)
      throw new Error(`${userFriendlyMessage}\n\nDebug: ${debugInfo}`);
    }

    // Check if response was blocked
    const response = result.response;

    // Enhanced logging for debugging empty responses
    console.log("=== RESPONSE OBJECT DEBUG ===");
    console.log("Response exists:", !!response);
    console.log("Candidates count:", response?.candidates?.length || 0);
    console.log("Block reason:", response?.promptFeedback?.blockReason || "none");
    console.log("Finish reason:", response?.candidates?.[0]?.finishReason || "none");
    console.log("Safety ratings:", JSON.stringify(response?.promptFeedback?.safetyRatings, null, 2));
    console.log("============================");

    if (!response || response.promptFeedback?.blockReason) {
      console.error("=== RESPONSE BLOCKED ===");
      console.error("Block reason:", response?.promptFeedback?.blockReason);
      console.error("Safety ratings:", JSON.stringify(response?.promptFeedback?.safetyRatings, null, 2));
      console.error("========================");
      throw new Error("Sorry yaar, AI ne ye message block kar diya. Kuch aur topic pe baat karte hain?");
    }

    // Check if response has candidates
    if (!response.candidates || response.candidates.length === 0) {
      console.error("=== NO CANDIDATES IN RESPONSE ===");
      console.error("This usually means the model couldn't generate a response");
      console.error("Prompt feedback:", JSON.stringify(response?.promptFeedback, null, 2));
      console.error("=================================");
      throw new Error("AI response mein kuch nahi aaya. Phir se try karo!");
    }

    // Check finish reason
    const finishReason = response.candidates[0]?.finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.log("=== UNUSUAL FINISH REASON ===");
      console.log("Finish reason:", finishReason);
      console.log("=============================");

      if (finishReason === "SAFETY") {
        throw new Error("Sorry yaar, safety reasons ke liye response rok diya gaya. Kuch aur baat karte hain?");
      } else if (finishReason === "MAX_TOKENS") {
        console.warn("⚠️ Response was truncated due to MAX_TOKENS, but still usable");
        // Don't throw error - the response is still valid, just truncated
      }
    }

    // Debug: Log the actual candidate structure
    console.log("=== CANDIDATE STRUCTURE DEBUG ===");
    console.log("Full candidate[0]:", JSON.stringify(response.candidates[0], null, 2));
    console.log("Parts:", response.candidates[0]?.content?.parts);
    console.log("=================================");

    // Try to extract text from response
    let reply;
    try {
      reply = response.text();
      console.log("✅ response.text() succeeded:", reply ? "has content" : "EMPTY!");
    } catch (textError) {
      console.error("❌ response.text() failed:", textError);
      // Fallback: try to manually extract from parts
      const parts = response.candidates[0]?.content?.parts;
      if (parts && parts.length > 0) {
        reply = parts.map((p: any) => p.text).join('');
        console.log("✅ Manually extracted from parts:", reply);
      }
    }

    if (!reply) {
      console.error("❌ No text content found in response!");
      reply = "Arre yaar, kuch gadbad ho gaya. Phir se try kar?";
    }

    console.log("\n=== RAW LLM RESPONSE ===");
    console.log(reply);
    console.log("========================\n");

    // ============================================
    // COST ESTIMATION (Gemini 2.5 Flash Pricing)
    // ============================================
    // Pricing per 1M tokens (Paid tier):
    // - Input: $0.30
    // - Output: $2.50
    const usageMetadata = response.usageMetadata;
    if (usageMetadata) {
      const inputTokens = usageMetadata.promptTokenCount || 0;
      const outputTokens = usageMetadata.candidatesTokenCount || 0;
      const totalTokens = usageMetadata.totalTokenCount || 0;

      // Calculate costs in USD
      const inputCost = (inputTokens / 1_000_000) * 0.30;
      const outputCost = (outputTokens / 1_000_000) * 2.50;
      const totalCost = inputCost + outputCost;

      // Convert to Indian Rupees (1 USD = 90.57 INR)
      const USD_TO_INR = 90.57;
      const totalCostINR = totalCost * USD_TO_INR;

      console.log("=== 💰 COST ESTIMATION ===");
      console.log(`Input tokens:  ${inputTokens.toLocaleString()} tokens`);
      console.log(`Output tokens: ${outputTokens.toLocaleString()} tokens (including thinking tokens)`);
      console.log(`Total tokens:  ${totalTokens.toLocaleString()} tokens`);
      console.log(`---`);
      console.log(`Input cost:    $${inputCost.toFixed(6)} USD`);
      console.log(`Output cost:   $${outputCost.toFixed(6)} USD`);
      console.log(`Total cost:    $${totalCost.toFixed(6)} USD`);
      console.log(`Total cost:    ₹${totalCostINR.toFixed(4)} INR`);
      console.log(`===========================\n`);
    } else {
      console.log("⚠️ Usage metadata not available for cost estimation");
    }

    // Try to parse response as JSON array for multi-message support
    let responseMessages;
    try {
      let jsonString = reply.trim();

      // Step 1: Check if response is wrapped in markdown code blocks
      const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
      const match = jsonString.match(codeBlockRegex);

      if (match) {
        jsonString = match[1].trim();
        console.log("📦 Extracted JSON from markdown code block");
      }

      // Step 2: Handle case where LLM returns JSON objects WITHOUT array brackets
      // e.g., {"text": "msg1"}, {"text": "msg2"} or with newlines between them
      if (!jsonString.startsWith('[')) {
        // Check if it looks like comma-separated JSON objects (with or without newlines)
        // Pattern: starts with { and contains },\s*{ (allowing whitespace/newlines between objects)
        const hasMultipleObjects = jsonString.startsWith('{') && /\},\s*\{/.test(jsonString);

        if (hasMultipleObjects) {
          console.log("⚠️ LLM returned JSON objects without array brackets, auto-wrapping...");
          jsonString = '[' + jsonString + ']';
        }
      }

      // Step 3: Try to parse the JSON
      const parsed = JSON.parse(jsonString);

      if (Array.isArray(parsed) && parsed.every(msg => typeof msg === 'object' && msg.text)) {
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
      console.log("Parse error:", parseError instanceof Error ? parseError.message : String(parseError));
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

    // Return detailed error info for better frontend debugging
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorDetails = {
      error: errorMessage,
      errorType: error?.constructor?.name || "UnknownError",
      timestamp: new Date().toISOString(),
    };

    console.error("Returning error response:", errorDetails);

    return new Response(
      JSON.stringify(errorDetails),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
