import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_PROJECT = Deno.env.get("VERTEX_DEFAULT_PROJECT") ??
  "project-daba100c-c6fe-4fef-b20";

function buildUrls(project: string) {
  return {
    global:
      `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models`,
    regional:
      `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models`,
    tts:
      `https://us-central1-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/us-central1/publishers/google/models`,
  };
}

function maskKey(key: string): string {
  if (!key) return "none";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

type TestResult = {
  ok: boolean;
  status: number | null;
  detail: string;
};

async function testModel(
  key: string,
  url: string,
  modelId: string,
  body: object,
): Promise<TestResult> {
  try {
    const res = await fetch(`${url}/${modelId}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true, status: res.status, detail: "OK" };
    const json = await res.json().catch(() => ({}));
    const message = (json?.error?.message ?? res.statusText).slice(0, 150);
    return { ok: false, status: res.status, detail: message };
  } catch (e) {
    return { ok: false, status: null, detail: String(e).slice(0, 150) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const chatKeys: Array<{ name: string; value: string; project: string }> = [];
  const ttsKeys: Array<{ name: string; value: string }> = [];

  for (let i = 1; i <= 20; i++) {
    const value = Deno.env.get(`GEMINI_API_KEY_${i}`);
    if (!value) break;
    const project = Deno.env.get(`GEMINI_API_KEY_${i}_PROJECT`) ??
      DEFAULT_PROJECT;
    chatKeys.push({ name: `GEMINI_API_KEY_${i}`, value, project });
  }
  if (chatKeys.length === 0) {
    const value = Deno.env.get("GEMINI_API_KEY");
    if (value) {
      chatKeys.push({
        name: "GEMINI_API_KEY",
        value,
        project: DEFAULT_PROJECT,
      });
    }
  }

  for (let i = 1; i <= 20; i++) {
    const value = Deno.env.get(`GEMINI_TTS_KEY_${i}`);
    if (!value) break;
    ttsKeys.push({ name: `GEMINI_TTS_KEY_${i}`, value });
  }

  if (chatKeys.length === 0 && ttsKeys.length === 0) {
    return new Response(
      JSON.stringify({
        error: "No GEMINI_API_KEY_* or GEMINI_TTS_KEY_* secrets found",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      },
    );
  }

  const TEXT_BODY = {
    contents: [{ role: "user", parts: [{ text: "Hi" }] }],
    generationConfig: { maxOutputTokens: 5 },
  };
  const TTS_BODY = {
    contents: { role: "user", parts: { text: "Hi" } },
    generation_config: {
      speech_config: {
        language_code: "en-US",
        voice_config: { prebuilt_voice_config: { voice_name: "kore" } },
      },
      temperature: 1.0,
      response_modalities: ["AUDIO"],
    },
  };

  const chatResults = await Promise.all(
    chatKeys.map(async ({ name, value, project }) => {
      const urls = buildUrls(project);
      const [textGlobal, textRegional] = await Promise.all([
        testModel(
          value,
          urls.global,
          "gemini-3.1-flash-lite-preview",
          TEXT_BODY,
        ),
        testModel(value, urls.regional, "gemini-2.5-flash", TEXT_BODY),
      ]);
      return {
        key_name: name,
        key_mask: maskKey(value),
        project,
        global_endpoint:
          `${urls.global}/gemini-3.1-flash-lite-preview:generateContent`,
        regional_endpoint: `${urls.regional}/gemini-2.5-flash:generateContent`,
        "gemini-3.1-flash-lite-preview (global)": textGlobal.ok
          ? `? ${textGlobal.status}: OK`
          : `? ${textGlobal.status ?? "ERR"}: ${textGlobal.detail}`,
        "gemini-2.5-flash (regional)": textRegional.ok
          ? `? ${textRegional.status}: OK`
          : `? ${textRegional.status ?? "ERR"}: ${textRegional.detail}`,
      };
    }),
  );

  const ttsPool = ttsKeys.length > 0
    ? ttsKeys
    : chatKeys.map((k) => ({ name: `${k.name} (fallback)`, value: k.value }));
  const ttsProject = DEFAULT_PROJECT;
  const ttsUrls = buildUrls(ttsProject);

  const ttsResults = await Promise.all(
    ttsPool.map(async ({ name, value }) => {
      const speech = await testModel(
        value,
        ttsUrls.tts,
        "gemini-2.5-pro-tts",
        TTS_BODY,
      );
      return {
        key_name: name,
        key_mask: maskKey(value),
        project: ttsProject,
        endpoint: `${ttsUrls.tts}/gemini-2.5-pro-tts:generateContent`,
        "gemini-2.5-pro-tts (speech)": speech.ok
          ? `? ${speech.status}: OK`
          : `? ${speech.status ?? "ERR"}: ${speech.detail}`,
        ok: speech.ok,
        status: speech.status,
      };
    }),
  );

  const chatFullyWorking = chatResults.filter((r) =>
    r["gemini-3.1-flash-lite-preview (global)"].startsWith("?") &&
    r["gemini-2.5-flash (regional)"].startsWith("?")
  ).length;
  const ttsWorking = ttsResults.filter((r) =>
    r.ok
  ).length;
  const ttsAuthFailures =
    ttsResults.filter((r) => r.status === 401 || r.status === 403).length;

  return new Response(
    JSON.stringify(
      {
        summary: {
          chat:
            `${chatFullyWorking}/${chatResults.length} chat keys fully working`,
          tts: `${ttsWorking}/${ttsResults.length} TTS keys working`,
        },
        runtime: {
          default_project: DEFAULT_PROJECT,
          tts_pool_source: ttsKeys.length > 0
            ? "GEMINI_TTS_KEY_*"
            : "fallback_to_GEMINI_API_KEY_*",
        },
        fatal_flags: {
          tts_all_failed: ttsResults.length > 0 && ttsWorking === 0,
          tts_project_mismatch_suspected: ttsResults.length > 0 &&
            ttsAuthFailures === ttsResults.length,
        },
        chat_results: chatResults,
        tts_results: ttsResults,
      },
      null,
      2,
    ),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
