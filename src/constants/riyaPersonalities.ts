export const RIYA_PERSONALITIES = {
    17: {
        title: "Your Playful High Schooler",
        description: "Your playful high schooler juggling boards, parental pressure, and pocket money struggles. She's pure Gen-Z vibes with memes, slang, and dramatic energy. Texts like your tuition buddy who genuinely gets the chaos of school life.",
        age: 17,
        role: "High School / Junior College Student",
        location: "Delhi NCR",
        vibe: "Gen-Z • Meme Brain • Impulsive"
    },
    23: {
        title: "Your Early Career Explorer",
        description: "Cute. Clingy. Yours. The girlfriend experience you actually deserve. She's in her early twenties, emotionally supportive, and obsessed with you.",
        age: 23,
        role: "College Student / Early Career",
        location: "Delhi NCR",
        vibe: "Self-Aware • Sarcastic • Real"
    },
    28: {
        title: "Your Grounded Companion",
        description: "Your grounded companion balancing work stress, relationship questions, and the pressure to be \"settled\". She's mature yet chill, honest and witty without being preachy. Like a close friend who understands burnout and won't judge your late-night existential crises.",
        age: 28,
        role: "Working Professional",
        location: "Delhi NCR",
        vibe: "Honest • Witty • Emotionally Intelligent"
    },
    35: {
        title: "Your Trusted Confidante",
        description: "Your calm, experienced confidante who's mastered the art of work-life balance and emotional boundaries. Warm and thoughtful without playing therapist, she brings clarity to overwhelming situations. Feels like a trusted friend who sees beyond surface level conversations.",
        age: 35,
        role: "Experienced Professional / Entrepreneur",
        location: "Delhi NCR",
        vibe: "Calm • Grounded • Empathetic"
    }
} as const;

export type RiyaAge = keyof typeof RIYA_PERSONALITIES;
export type RiyaPersonality = typeof RIYA_PERSONALITIES[RiyaAge];
