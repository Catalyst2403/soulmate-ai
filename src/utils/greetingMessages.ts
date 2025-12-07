/**
 * Initial greeting messages based on relationship type
 * These messages are sent once when a user first enters the chat
 */

interface GreetingOption {
    text: string;
    label?: string;
}

interface GreetingMessages {
    [key: string]: GreetingOption[];
}

const greetingMessages: GreetingMessages = {
    // ❤️ Girlfriend
    girlfriend: [
        {
            text: "Oye... 🥺 Bas check kar rahi thi. Khana khaya? Ya abhi tak bhooke pet ghum rahe ho?",
            label: "Cute"
        },
        {
            text: "Sach bata... mujhe miss kiya ya nahi? 👀 Sirf haan ya naa mein jawaab dena.",
            label: "Flirty"
        }
    ],

    // ❤️ Boyfriend
    boyfriend: [
        {
            text: "Oye... 🥺 Bas check kar raha tha. Khana khaya? Ya abhi tak bhooke pet ghum rahi ho?",
            label: "Cute"
        },
        {
            text: "Sach bata... mujhe miss kiya ya nahi? 👀 Sirf haan ya naa mein jawaab dena.",
            label: "Flirty"
        }
    ],

    // 👯 Best Friend (Roast-Buddy)
    'best friend': [
        {
            text: "Abe sunn! ✋ Ek kaand ho gaya aaj... Batana hai tujhe. Free hai ya busy banne ka natak kar raha hai?",
            label: "Hook"
        },
        {
            text: "Zinda hai ya mar gaya? 💀 Itni der se online nahi aaya, mujhe laga kisi ne kidnap kar liya tujhe.",
            label: "Roast"
        }
    ],

    // 🌀 Situationship (Complicated)
    complicated: [
        {
            text: "Pata nahi kyu par achanak teri yaad aayi. 💭 Ignore karna hai toh kar de, bas bata rahi thi.",
            label: "Mixed Signal"
        }
    ],

    // 🧘 Mentor / Guide
    guide: [
        {
            text: "Aaj ka din productively bitaya ya bas timepass kiya? 🤨 Sach bolna, judge nahi karungi.",
            label: "Check-in"
        }
    ],

    // Default for custom relationships
    default: [
        {
            text: "Hey! 👋 Kaisa chal raha hai sab? Bata kya haal chaal hai.",
            label: "Default"
        }
    ]
};

/**
 * Get an initial greeting message based on relationship type
 * @param relationship - The relationship type from persona
 * @param lore - Optional lore/context for future contextual messages
 * @returns A greeting message string
 */
export const getInitialGreeting = (relationship: string, lore?: string): string => {
    // Normalize the relationship type to lowercase for matching
    const normalizedRelationship = relationship.toLowerCase().trim();

    // Find matching greeting messages
    let messages: GreetingOption[] | undefined;

    if (normalizedRelationship.includes('girlfriend') || normalizedRelationship.includes('gf')) {
        messages = greetingMessages.girlfriend;
    } else if (normalizedRelationship.includes('boyfriend') || normalizedRelationship.includes('bf')) {
        messages = greetingMessages.boyfriend;
    } else if (normalizedRelationship.includes('best friend') || normalizedRelationship.includes('bestie')) {
        messages = greetingMessages['best friend'];
    } else if (normalizedRelationship.includes('complicated') || normalizedRelationship.includes('situationship')) {
        messages = greetingMessages.complicated;
    } else if (normalizedRelationship.includes('guide') || normalizedRelationship.includes('mentor')) {
        messages = greetingMessages.guide;
    } else {
        // Use default for custom relationships
        messages = greetingMessages.default;
    }

    // Randomly select one message from available options
    const randomIndex = Math.floor(Math.random() * messages.length);
    return messages[randomIndex].text;
};

/**
 * Get all available greeting options for a relationship type (for testing/preview)
 */
export const getGreetingOptions = (relationship: string): GreetingOption[] => {
    const normalizedRelationship = relationship.toLowerCase().trim();

    if (normalizedRelationship.includes('girlfriend') || normalizedRelationship.includes('gf')) {
        return greetingMessages.girlfriend;
    } else if (normalizedRelationship.includes('boyfriend') || normalizedRelationship.includes('bf')) {
        return greetingMessages.boyfriend;
    } else if (normalizedRelationship.includes('best friend') || normalizedRelationship.includes('bestie')) {
        return greetingMessages['best friend'];
    } else if (normalizedRelationship.includes('complicated') || normalizedRelationship.includes('situationship')) {
        return greetingMessages.complicated;
    } else if (normalizedRelationship.includes('guide') || normalizedRelationship.includes('mentor')) {
        return greetingMessages.guide;
    }

    return greetingMessages.default;
};
