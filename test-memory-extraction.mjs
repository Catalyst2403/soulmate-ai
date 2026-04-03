/**
 * Quick test for the updated facts extraction + summary prompts.
 * Run with: node test-memory-extraction.mjs
 *
 * Set your Gemini API key: GEMINI_API_KEY=your_key node test-memory-extraction.mjs
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("❌  Set GEMINI_API_KEY env var first");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const today = new Date().toISOString().split("T")[0];

// ─── SAMPLE CONVERSATIONS ──────────────────────────────────────────────────
// Craft messages that cover common failure cases:
//  1. City mentioned early (should not be lost)
//  2. Family member mentioned (new field)
//  3. Riya says something that could be wrongly attributed to user
//  4. Reel share / transient message (should NOT be stored)
//  5. current_context (ongoing life situation)

const TEST_CASES = [
    {
        label: "Basic demographics + family + Riya-contamination risk",
        existingFacts: {},
        existingSummary: null,
        messages: [
            { role: "user",  content: "hi main Arjun hoon, 21 saal ka, Mumbai mein rehta hoon" },
            { role: "model", content: "Arjun! kitna pyara naam hai 😊 Mumbai mein toh bahut mast hoga na?" },
            { role: "user",  content: "haan yaar, Andheri mein rehta hoon apni family ke saath, mom strict hai thodi" },
            { role: "model", content: "aww strict moms are the best secretly 🥺 tum toh engineering kar rahe ho na?" },
            { role: "user",  content: "haan VIT mein 3rd year CSE" },
            { role: "model", content: "wah Vellore gaye ho kabhi campus mein?" },
            { role: "user",  content: "haan on campus hi hoon abhi, CAT ki taiyari bhi chal rahi hai saath mein" },
            { role: "user",  content: "dekh ye reel 😂" },  // should NOT create a key_event
        ],
    },
    {
        label: "Friend + interest specificity + no mood storage",
        existingFacts: {
            profile: { name: "Arjun", city: "Mumbai", language: "Hinglish" },
            life: { college: "VIT 3rd year CSE" },
        },
        existingSummary: "Arjun is a 21-year-old engineering student at VIT from Mumbai. Lives with family, mom is strict. Preparing for CAT.",
        messages: [
            { role: "user",  content: "aaj mera best friend Rahul aya tha hostel mein" },
            { role: "model", content: "Rahul kaisa hai? tumhare baarein mein kya kehta hai woh? 👀" },
            { role: "user",  content: "hahaha kuch nahi, hum saath cricket khelte hain weekends pe, main medium pace bowler hoon" },
            { role: "model", content: "ooh dangerous bowler 😤 MI ka fan ho tum?" },
            { role: "user",  content: "haan bhai MI hi zindagi hai, Bumrah fan hu" },
            { role: "model", content: "lagta hai aaj tumhara mood thoda off hai?" },  // Riya guesses mood
            { role: "user",  content: "nahi nahi sab theek hai" },  // user denies — mood should NOT be stored
        ],
    },
    {
        label: "Key event — real life vs transient",
        existingFacts: {
            profile: { name: "Arjun", city: "Mumbai" },
            people: { friends: ["best friend Rahul"] },
        },
        existingSummary: null,
        messages: [
            { role: "user",  content: "yaar aaj bahut bura din tha, papa ki tabiyat kharab ho gayi, hospital le jaana pada" },
            { role: "model", content: "oh no Arjun 😢 kya hua unhe?" },
            { role: "user",  content: "chest pain tha, tests chal rahe hain abhi" },
            { role: "user",  content: "kal mock test dena hai CAT ka, tension ho rahi hai dono cheezein manage karna" },
            { role: "user",  content: "https://instagram.com/reel/xyz" },  // reel — should NOT be stored
        ],
    },
];

// ─── FACTS EXTRACTION TEST ─────────────────────────────────────────────────
async function testFactsExtraction(tc) {
    const MONETIZATION_PATTERNS = [
        /pro lo/i, /₹199/i, /payment/i, /free msg/i, /msgs khatam/i,
        /unlimited baat/i, /subscribe/i, /razorpay/i, /upgrade/i,
        /limit khatam/i, /sales window/i, /riya-ai-ten\.vercel/i,
    ];

    const userMessagesOnly = tc.messages
        .filter(m => m.role === "user")
        .filter(m => !MONETIZATION_PATTERNS.some(p => p.test(m.content)))
        .map(m => `User: ${m.content}`)
        .join("\n");

    const summaryContext = tc.existingSummary
        ? `\nHISTORICAL SUMMARY (background reference only — use this ONLY to fill gaps missing from EXISTING FACTS that aren't in recent messages. Never extract a fact from it directly — it contains both User and Riya speech):\n${tc.existingSummary}\n`
        : "";

    const prompt = `You are Riya's memory assistant. Extract facts about the USER from their messages.

RULE #1 — CRITICAL: Extract ONLY what the user explicitly stated in USER MESSAGES below. If you are inferring it, or it came from something Riya said — skip it.
RULE #2: Return ONLY fields with NEW or CHANGED values vs existing facts. Return {} if nothing new.
RULE #3: For array fields (people.family, people.friends, personality.interests, personality.dislikes) — return ONLY new items to add. Do not repeat existing ones. Server will merge.
RULE #4: key_events — return the FULL updated array (you curate). ONLY real life moments: health issue, family crisis, job/career change, exam result, relationship milestone, major travel. NEVER: payment events, message limits, moods, sharing reels, app events.
RULE #5: declared_love — set true ONLY if user said "I love you" or exact Hindi/Hinglish equivalent. Never set false.
RULE #6: current_context — one sentence about their current life situation right now (e.g. "preparing for CAT exam", "just started new job in Bangalore"). Overwrite when it changes.
RULE #7: Do NOT extract negatives or absences. Only confirmed positives explicitly stated by user.
Today: ${today}

EXISTING KNOWN FACTS (do not re-extract):
${JSON.stringify(tc.existingFacts)}
${summaryContext}
USER MESSAGES (extract from these only):
${userMessagesOnly}

Return delta as JSON (omit any field you have nothing new for):
{"profile":{"name":"string","age":0,"city":"string","language":"Hinglish|Hindi|English"},"life":{"job":"string","college":"string","living":"living situation e.g. with family in Mumbai / alone / with roommates"},"people":{"family":["new entries only e.g. mom is strict, younger sister Priya"],"friends":["new entries only e.g. best friend Rahul"]},"personality":{"interests":["new only — be specific: plays gully cricket not just cricket"],"dislikes":["new only"],"communication_style":"string"},"relationship_with_riya":{"declared_love":true,"nickname_for_riya":"string"},"current_context":"one sentence about current life situation","key_events":[{"date":"YYYY-MM-DD","event":"real life moment only — one sentence"}]}

Return ONLY the JSON object. No markdown, no explanation.`;

    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 800 },
    });

    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
}

// ─── SUMMARY TEST ──────────────────────────────────────────────────────────
async function testSummary(tc) {
    const formatted = tc.messages
        .map(m => `${m.role === "user" ? "User" : "Riya"}: ${m.content}`)
        .join("\n");

    const factsNote = Object.keys(tc.existingFacts).length > 0
        ? `\nALREADY IN STRUCTURED MEMORY (no need to repeat these in prose — focus on what's missing or behavioral):\n${JSON.stringify(tc.existingFacts)}\n`
        : "";

    const prompt = tc.existingSummary
        ? `Update this user profile for Riya (AI girlfriend) using the new chat.

CRITICAL: Only infer facts/traits from lines starting with "User:". Lines starting with "Riya:" are her AI responses — never attribute her words or questions as user facts.
${factsNote}
CURRENT PROFILE:
${tc.existingSummary}

NEW CHAT:
${formatted}

Rules:
- Preserve all confirmed demographics (name, city, job, college, family members) even if not mentioned in new chat — only update them if user explicitly changed something.
- Add new behavioral patterns you observe from User: lines.
- Capture recurring patterns, not one-off moments ("gets clingy when insecure" ✓ vs "was clingy once" ✗).
- Remove anything that now seems wrong based on new User: statements.
- No timestamps, no placeholders, max 140 words, third person.`
        : `Write a profile of this user for Riya (AI girlfriend).

CRITICAL: Only infer facts/traits from lines starting with "User:". Lines starting with "Riya:" are her AI responses — never attribute her words or questions as user facts.
${factsNote}
CHAT:
${formatted}

Include only what User: lines confirm. Para 1: demographics (name, city, job/college, language) + personality + emotional style. Para 2: dynamic with Riya + what they share + family/friends mentioned. Para 3 (optional): habits + recurring quirks + goals. No timestamps, no placeholders, max 150 words, third person.`;

    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",
        generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
}

// ─── RUN ALL TESTS ─────────────────────────────────────────────────────────
async function run() {
    for (const tc of TEST_CASES) {
        console.log(`\n${"═".repeat(60)}`);
        console.log(`📋 TEST: ${tc.label}`);
        console.log("═".repeat(60));

        // Facts extraction
        console.log("\n🧠 FACTS DELTA:");
        try {
            const facts = await testFactsExtraction(tc);
            console.log(JSON.stringify(facts, null, 2));

            // Quick assertions
            const issues = [];
            if (tc.label.includes("contamination") && facts.profile?.city && facts.profile.city !== "Mumbai" && facts.profile.city !== "Andheri") {
                issues.push(`❌ City contaminated: got "${facts.profile.city}"`);
            }
            if (facts.relationship_with_riya?.current_mood_toward_riya) {
                issues.push(`❌ current_mood_toward_riya still being extracted: "${facts.relationship_with_riya.current_mood_toward_riya}"`);
            }
            if (Array.isArray(facts.key_events)) {
                const badEvents = facts.key_events.filter(e =>
                    /reel|insta|link|payment|subscribe|mood|bored/i.test(e.event)
                );
                if (badEvents.length > 0) {
                    issues.push(`❌ Bad key_events snuck through: ${JSON.stringify(badEvents)}`);
                }
            }
            if (issues.length === 0) console.log("✅ No obvious issues");
            else issues.forEach(i => console.log(i));
        } catch (e) {
            console.error("❌ Facts extraction failed:", e.message);
        }

        // Summary
        console.log("\n📝 SUMMARY:");
        try {
            const summary = await testSummary(tc);
            console.log(summary);
        } catch (e) {
            console.error("❌ Summary failed:", e.message);
        }
    }
}

run().catch(console.error);
