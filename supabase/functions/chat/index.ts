import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const VERTEX_PROJECT = Deno.env.get('VERTEX_DEFAULT_PROJECT') ?? 'project-daba100c-c6fe-4fef-b20';
const VERTEX_BASE = `https://aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT}/locations/global/publishers/google/models`;

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

    // Build conversation history for Vertex AI
    let processedHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    // Vertex AI requires history to start with a user message
    while (processedHistory.length > 0 && processedHistory[0].role === "model") {
      console.log("⚠️ Removing leading model message from history");
      processedHistory.shift();
    }

    const lastMessage = messages[messages.length - 1];

    // Call Vertex AI directly
    let vertexJson: any;
    try {
      const vertexRes = await fetch(
        `${VERTEX_BASE}/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [...processedHistory, { role: 'user', parts: [{ text: lastMessage.content }] }],
            generationConfig: { maxOutputTokens: 8192, temperature: 0.9 },
          }),
        }
      );
      if (!vertexRes.ok) {
        const errText = await vertexRes.text();
        const msg = `Vertex AI ${vertexRes.status}: ${errText.slice(0, 200)}`;
        let userFriendlyMessage = "Arre yaar, kuch gadbad ho gaya. Phir se try kar?";
        if (vertexRes.status === 429) userFriendlyMessage = "Thoda slow down kar yaar! 1-2 min baad try kar.";
        else if (vertexRes.status === 403) userFriendlyMessage = "Server configuration issue hai. Admin ko batao!";
        else if (vertexRes.status === 404) userFriendlyMessage = "Model not available. Please check API access.";
        throw new Error(`${userFriendlyMessage}\n\nDebug: ${msg}`);
      }
      vertexJson = await vertexRes.json();
    } catch (apiError: any) {
      if (apiError.message?.includes("Vertex AI")) throw apiError;
      throw new Error(`Arre yaar, kuch gadbad ho gaya. Phir se try kar?\n\nDebug: ${apiError?.message || 'Unknown'}`);
    }

    // Validate response
    if (vertexJson.promptFeedback?.blockReason) {
      console.error("=== RESPONSE BLOCKED ===", vertexJson.promptFeedback.blockReason);
      throw new Error("Sorry yaar, AI ne ye message block kar diya. Kuch aur topic pe baat karte hain?");
    }
    if (!vertexJson.candidates?.length) {
      throw new Error("AI response mein kuch nahi aaya. Phir se try karo!");
    }
    const finishReason = vertexJson.candidates[0]?.finishReason;
    if (finishReason === "SAFETY") {
      throw new Error("Sorry yaar, safety reasons ke liye response rok diya gaya. Kuch aur baat karte hain?");
    }

    // Extract reply text
    let reply = (vertexJson.candidates[0]?.content?.parts ?? [])
      .map((p: any) => p.text ?? '').join('') || "Arre yaar, kuch gadbad ho gaya. Phir se try kar?";

    console.log("\n=== RAW LLM RESPONSE ===");
    console.log(reply);
    console.log("========================\n");

    // ============================================
    // COST ESTIMATION (Gemini 2.5 Flash Pricing)
    // ============================================
    // Pricing per 1M tokens (Paid tier):
    // - Input: $0.30
    // - Output: $2.50
    const usageMetadata = vertexJson.usageMetadata;
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
