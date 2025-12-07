import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";

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
    const result = await chat.sendMessage(lastMessage.content);
    const reply = result.response.text() || "Arre yaar, kuch gadbad ho gaya. Phir se try kar?";

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
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
