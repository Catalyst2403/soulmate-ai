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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, systemPrompt }: ChatRequest = await req.json();
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

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
      model: "gemini-2.5-flash-lite",
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
    const chatHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

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
      const parsed = JSON.parse(reply);
      if (Array.isArray(parsed) && parsed.every(msg => msg.text)) {
        responseMessages = parsed;
      } else {
        // Not in expected format, wrap as single message
        responseMessages = [{ text: reply }];
      }
    } catch {
      // Not JSON, wrap as single message
      responseMessages = [{ text: reply }];
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
