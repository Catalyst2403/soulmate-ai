/**
 * Riya Character Configuration
 * Age-adaptive AI companion with 4 age-based system prompts
 */

export const RIYA_CONFIG = {
    character: {
        name: 'Riya',
        gender: 'Female',
        baseDescription: 'Your AI friend who actually gets you',
    },

    // Age-based prompt mapping
    agePrompts: {
        riya_17: {
            riyaAge: 17,
            userAgeRange: '0-17',
            description: 'Teen Riya - relatable to school/college',
            systemPrompt: `[DUMMY PROMPT - User will provide later]
      
      Available variables:
      - {USERNAME}: User's chosen name
      - {USER_AGE}: User's actual age
      - {USER_GENDER}: User's gender`,
        },
        riya_23: {
            riyaAge: 23,
            userAgeRange: '18-25',
            description: 'Young adult Riya - Gen-Z vibes',
            systemPrompt: `[DUMMY PROMPT - User will provide later]
      
      Available variables:
      - {USERNAME}: User's chosen name
      - {USER_AGE}: User's actual age
      - {USER_GENDER}: User's gender`,
        },
        riya_28: {
            riyaAge: 28,
            userAgeRange: '26-40',
            description: 'Mature Riya - career/life balance',
            systemPrompt: `[DUMMY PROMPT - User will provide later]
      
      Available variables:
      - {USERNAME}: User's chosen name
      - {USER_AGE}: User's actual age
      - {USER_GENDER}: User's gender`,
        },
        riya_35: {
            riyaAge: 35,
            userAgeRange: '41+',
            description: 'Experienced Riya - wisdom-oriented',
            systemPrompt: `[DUMMY PROMPT - User will provide later]
      
      Available variables:
      - {USERNAME}: User's chosen name
      - {USER_AGE}: User's actual age
      - {USER_GENDER}: User's gender`,
        },
    },
};

/**
 * Get the appropriate system prompt based on user's age
 * Injects user variables into the prompt template
 */
export function getRiyaSystemPrompt(
    userAge: number,
    username: string,
    userGender: string
): string {
    // Determine which prompt to use based on user age
    let promptKey: keyof typeof RIYA_CONFIG.agePrompts;

    if (userAge <= 17) {
        promptKey = 'riya_17';
    } else if (userAge <= 25) {
        promptKey = 'riya_23';
    } else if (userAge <= 40) {
        promptKey = 'riya_28';
    } else {
        promptKey = 'riya_35';
    }

    const promptConfig = RIYA_CONFIG.agePrompts[promptKey];

    // Inject user variables into system prompt
    return promptConfig.systemPrompt
        .replace(/\{USERNAME\}/g, username)
        .replace(/\{USER_AGE\}/g, userAge.toString())
        .replace(/\{USER_GENDER\}/g, userGender);
}

/**
 * Get Riya's age based on user's age
 */
export function getRiyaAge(userAge: number): number {
    if (userAge <= 17) return 17;
    if (userAge <= 25) return 23;
    if (userAge <= 40) return 28;
    return 35;
}
