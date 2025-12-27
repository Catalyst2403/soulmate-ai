/**
 * Character Configuration
 * Defines pre-made characters with their personalities and onboarding flows
 */

export interface PersonalizationOption {
    id: string;
    label: string;
    emoji: string;
    lore: string;
    vibe: string;
    archetype: string;
}

export interface CharacterConfig {
    id: string;
    name: string;
    age: number;
    gender: string;
    archetype: string;
    nationality: string;
    language: string;

    // Personality (fixed traits)
    defaultVibe: string;
    defaultLore: string;
    defaultConflict: string;

    // Avatar/branding
    avatarUrl?: string;
    tagline: string;

    // Onboarding customization
    personalizationQuestion: {
        question: string;
        options: PersonalizationOption[];
    };
}

/**
 * Available Characters
 * Empty for now - new character architecture coming soon
 */
export const CHARACTERS: Record<string, CharacterConfig> = {
    // Characters will be added with the new architecture
};

/**
 * Get character by ID
 */
export const getCharacter = (characterId: string): CharacterConfig | undefined => {
    return CHARACTERS[characterId];
};

/**
 * Get all available characters
 */
export const getAllCharacters = (): CharacterConfig[] => {
    return Object.values(CHARACTERS);
};
