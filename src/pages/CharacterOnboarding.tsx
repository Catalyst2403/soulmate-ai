import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useCharacterOnboarding } from '@/hooks/useCharacterOnboarding';
import { getCharacter } from '@/config/characters.config';
import { CharacterStepBasics } from '@/components/character/CharacterStepBasics';
import { CharacterStepPersonalization } from '@/components/character/CharacterStepPersonalization';
import { ProgressBar } from '@/components/onboarding/ProgressBar';
import { LoadingScreen } from '@/components/onboarding/LoadingScreen';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { generateCharacterSystemPrompt } from '@/utils/systemPrompt';
import { PersonalizationOption } from '@/config/characters.config';

const CharacterOnboarding = () => {
    const { characterId } = useParams<{ characterId: string }>();
    const navigate = useNavigate();
    const { step, formData, progress, updateFormData, nextStep } = useCharacterOnboarding();
    const [isLoading, setIsLoading] = useState(false);
    const [showLoader, setShowLoader] = useState(false);

    // Get character configuration
    const character = characterId ? getCharacter(characterId) : null;

    if (!character) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center space-y-4">
                    <h1 className="text-3xl font-bold">Character Not Found</h1>
                    <p className="text-muted-foreground">
                        The character you're looking for doesn't exist.
                    </p>
                    <button
                        onClick={() => navigate('/')}
                        className="text-purple-500 hover:underline"
                    >
                        Go back home
                    </button>
                </div>
            </div>
        );
    }

    const handleBasicsComplete = () => {
        nextStep();
    };

    const handlePersonalizationSelect = async (option: PersonalizationOption) => {
        updateFormData('selectedPersonalization', option);

        // Start loading and create user/persona
        setIsLoading(true);
        setShowLoader(true);

        try {
            // Check if user exists
            let { data: existingUser } = await supabase
                .from('users')
                .select('*')
                .eq('email', formData.email)
                .maybeSingle();

            let userId: string;

            if (existingUser) {
                userId = existingUser.id;

                // Update mobile number if provided
                if (formData.mobileNumber) {
                    await supabase
                        .from('users')
                        .update({ mobile_number: formData.mobileNumber })
                        .eq('id', userId);
                }
            } else {
                // Create new user
                const { data: newUser, error: userError } = await supabase
                    .from('users')
                    .insert({
                        email: formData.email,
                        mobile_number: formData.mobileNumber,
                    })
                    .select()
                    .single();

                if (userError) throw userError;
                userId = newUser.id;
            }

            // Store user ID in localStorage
            localStorage.setItem('soulmate_user_id', userId);
            localStorage.setItem('soulmate_email', formData.email);

            // Generate character-specific system prompt
            const systemPrompt = generateCharacterSystemPrompt(
                character.name,
                character.age,
                character.gender,
                character.archetype,
                character.nationality,
                character.language,
                character.defaultVibe,
                character.defaultLore,
                character.defaultConflict,
                {
                    lore: option.lore,
                    vibe: option.vibe,
                    archetype: option.archetype,
                }
            );

            console.log('=== CHARACTER ONBOARDING DEBUG ===');
            console.log('Character:', character.name);
            console.log('User personalization:', option);
            console.log('Generated System Prompt:', systemPrompt);
            console.log('===================================');

            // Create character persona
            const personaData = {
                user_id: userId,
                character_id: character.id,
                character_type: 'character',
                identity_name: character.name,
                identity_gender: character.gender,
                age_archetype: character.archetype,
                relationship: 'friend',
                vibe: `${character.defaultVibe}, ${option.vibe}`,
                lore: `${character.defaultLore}, ${option.lore}`,
                conflict: character.defaultConflict,
                system_prompt: systemPrompt,
            };

            const { error: personaError } = await supabase
                .from('personas')
                .insert(personaData);

            if (personaError) throw personaError;

            // Wait for loader animation
            await new Promise((resolve) => setTimeout(resolve, 3000));

            navigate('/chat');
        } catch (error) {
            console.error('Error creating character persona:', error);
            toast({
                title: 'Error',
                description: 'Something went wrong. Please try again.',
                variant: 'destructive',
            });
            setIsLoading(false);
            setShowLoader(false);
        }
    };

    if (showLoader) {
        return <LoadingScreen />;
    }

    return (
        <div className="min-h-screen bg-background">
            <ProgressBar progress={progress} />

            <AnimatePresence mode="wait">
                {step === 0 && (
                    <CharacterStepBasics
                        key="basics"
                        userName={formData.userName}
                        email={formData.email}
                        mobileNumber={formData.mobileNumber}
                        onUserNameChange={(value) => updateFormData('userName', value)}
                        onEmailChange={(value) => updateFormData('email', value)}
                        onMobileNumberChange={(value) =>
                            updateFormData('mobileNumber', value)
                        }
                        onComplete={handleBasicsComplete}
                        characterName={character.name}
                    />
                )}

                {step === 1 && (
                    <CharacterStepPersonalization
                        key="personalization"
                        question={character.personalizationQuestion.question}
                        options={character.personalizationQuestion.options}
                        onSelect={handlePersonalizationSelect}
                        characterName={character.name}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default CharacterOnboarding;
