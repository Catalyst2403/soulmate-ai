import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_PROJECT = Deno.env.get("VERTEX_DEFAULT_PROJECT") ?? "project-daba100c-c6fe-4fef-b20";

function buildUrls(project: string) {
  return {
    global: `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models`,
    regional: `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models`,
    tts: `https://us-central1-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/us-central1/publishers/google/models`,
  };
}

async function testModel(key: string, url: string, modelId: string, body: object): Promise<string> {
  try {
    const res = await fetch(`${url}/${modelId}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return "✅ OK";
    const json = await res.json().catch(() => ({}));
    const message = (json?.error?.message ?? res.statusText).slice(0, 150);
    return `❌ ${res.status}: ${message}`;
  } catch (e) {
    return `❌ ERROR: ${String(e).slice(0, 150)}`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const foundKeys: Array<{ name: string; value: string; project: string }> = [];

  for (let i = 1; i <= 20; i++) {
    const value = Deno.env.get(`GEMINI_API_KEY_${i}`);
    if (!value) break;
    const project = Deno.env.get(`GEMINI_API_KEY_${i}_PROJECT`) ?? DEFAULT_PROJECT;
    foundKeys.push({ name: `GEMINI_API_KEY_${i}`, value, project });
  }
  if (foundKeys.length === 0) {
    const value = Deno.env.get("GEMINI_API_KEY");
    if (value) foundKeys.push({ name: "GEMINI_API_KEY", value, project: DEFAULT_PROJECT });
  }

  if (foundKeys.length === 0) {
    return new Response(
      JSON.stringify({ error: "No GEMINI_API_KEY_* secrets found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 },
    );
  }

  const TEXT_BODY = { contents: [{ role: "user", parts: [{ text: "Hi" }] }], generationConfig: { maxOutputTokens: 5 } };
  const TTS_BODY = {
    contents: { role: "user", parts: { text: "Hi" } },
    generation_config: {
      speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } },
      response_modalities: ["AUDIO"],
    },
  };

  const results = await Promise.all(
    foundKeys.map(async ({ name, value, project }) => {
      const urls = buildUrls(project);
      const [textGlobal, textRegional, speech] = await Promise.all([
        testModel(value, urls.global, "gemini-3.1-flash-lite-preview", TEXT_BODY),
        testModel(value, urls.regional, "gemini-2.5-flash", TEXT_BODY),
        testModel(value, urls.tts, "gemini-2.5-flash-lite-preview-tts", TTS_BODY),
      ]);
      return {
        key: name,
        project,
        "gemini-3.1-flash-lite-preview (global)": textGlobal,
        "gemini-2.5-flash (regional)": textRegional,
        "gemini-2.5-flash-lite-preview-tts (speech)": speech,
      };
    }),
  );

  const fullyWorking = results.filter(r =>
    r["gemini-3.1-flash-lite-preview (global)"].startsWith("✅") &&
    r["gemini-2.5-flash (regional)"].startsWith("✅") &&
    r["gemini-2.5-flash-lite-preview-tts (speech)"].startsWith("✅")
  ).length;

  return new Response(
    JSON.stringify({ summary: `${fullyWorking}/${results.length} keys fully working`, results }, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
