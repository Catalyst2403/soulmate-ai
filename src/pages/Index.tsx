import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useOnboarding } from '@/hooks/useOnboarding';
import { ProgressBar } from '@/components/onboarding/ProgressBar';
import { StepLanding } from '@/components/onboarding/StepLanding';
import { StepIdentityBasics } from '@/components/onboarding/StepIdentityBasics';
import { StepAgeArchetype } from '@/components/onboarding/StepAgeArchetype';
import { StepRelationship } from '@/components/onboarding/StepRelationship';
import { StepVibe } from '@/components/onboarding/StepVibe';
import { StepLore } from '@/components/onboarding/StepLore';
import { StepConflict } from '@/components/onboarding/StepConflict';
import { LoadingScreen } from '@/components/onboarding/LoadingScreen';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const Index = () => {
  const navigate = useNavigate();
  const {
    step,
    formData,
    progress,
    updateFormData,
    nextStep,
    generateSystemPrompt,
  } = useOnboarding();

  const [isLoading, setIsLoading] = useState(false);
  const [showLoader, setShowLoader] = useState(false);

  // Check for existing session
  useEffect(() => {
    const userId = localStorage.getItem('soulmate_user_id');
    if (userId) {
      // Check if user has a persona
      checkExistingPersona(userId);
    }
  }, []);

  const checkExistingPersona = async (userId: string) => {
    const { data: persona } = await supabase
      .from('personas')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (persona) {
      navigate('/chat');
    }
  };

  const handleComplete = async () => {
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
      } else {
        // Create new user
        const { data: newUser, error: userError } = await supabase
          .from('users')
          .insert({ email: formData.email })
          .select()
          .single();

        if (userError) throw userError;
        userId = newUser.id;
      }

      // Store user ID in localStorage for simple session management
      localStorage.setItem('soulmate_user_id', userId);
      localStorage.setItem('soulmate_email', formData.email);

      // Generate system prompt
      const systemPrompt = generateSystemPrompt();

      // Debug: Log the system prompt being saved
      console.log('=== ONBOARDING COMPLETION DEBUG ===');
      console.log('Generated System Prompt:');
      console.log(systemPrompt);
      console.log('Form Data:', formData);
      console.log('===================================');

      // Build persona data object - only include non-empty fields
      const personaData: any = {
        user_id: userId,
        system_prompt: systemPrompt,
      };

      // Add optional fields only if they have values
      if (formData.identity_name) personaData.identity_name = formData.identity_name;
      if (formData.identity_gender) personaData.identity_gender = formData.identity_gender;
      if (formData.age_archetype) personaData.age_archetype = formData.age_archetype;
      if (formData.relationship) personaData.relationship = formData.relationship;
      if (formData.vibe) personaData.vibe = formData.vibe;
      if (formData.lore) personaData.lore = formData.lore;
      if (formData.conflict) personaData.conflict = formData.conflict;

      // Create persona with dynamic fields
      const { error: personaError } = await supabase
        .from('personas')
        .insert(personaData);

      if (personaError) throw personaError;

      // Wait for loader animation
      await new Promise(resolve => setTimeout(resolve, 3000));

      navigate('/chat');
    } catch (error) {
      console.error('Error creating user/persona:', error);
      toast({
        title: 'Error',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
      setIsLoading(false);
      setShowLoader(false);
    }
  };

  const handleIdentityComplete = () => {
    setTimeout(nextStep, 300);
  };

  const handleAgeArchetypeSelect = (value: string) => {
    updateFormData('age_archetype', value);
    setTimeout(nextStep, 300);
  };

  const handleRelationshipSelect = (value: string) => {
    updateFormData('relationship', value);
    setTimeout(nextStep, 300);
  };

  const handleVibeSelect = (value: string) => {
    updateFormData('vibe', value);
    setTimeout(nextStep, 300);
  };

  const handleLoreSelect = (value: string) => {
    updateFormData('lore', value);
    setTimeout(nextStep, 300);
  };

  const handleConflictSelect = (value: string) => {
    updateFormData('conflict', value);
    // Last step, trigger completion
    setTimeout(handleComplete, 300);
  };

  if (showLoader) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-background">
      <ProgressBar progress={progress} />

      <AnimatePresence mode="wait">
        {step === 0 && (
          <StepLanding
            key="landing"
            email={formData.email}
            onEmailChange={(email) => updateFormData('email', email)}
            onNext={nextStep}
          />
        )}

        {step === 1 && (
          <StepIdentityBasics
            key="identity"
            name={formData.identity_name}
            gender={formData.identity_gender}
            onNameChange={(name) => updateFormData('identity_name', name)}
            onGenderSelect={(gender) => updateFormData('identity_gender', gender)}
            onComplete={handleIdentityComplete}
          />
        )}

        {step === 2 && (
          <StepAgeArchetype
            key="age"
            selected={formData.age_archetype}
            onSelect={handleAgeArchetypeSelect}
          />
        )}

        {step === 3 && (
          <StepRelationship
            key="relationship"
            selected={formData.relationship}
            onSelect={handleRelationshipSelect}
          />
        )}

        {step === 4 && (
          <StepVibe
            key="vibe"
            selected={formData.vibe}
            onSelect={handleVibeSelect}
          />
        )}

        {step === 5 && (
          <StepLore
            key="lore"
            selected={formData.lore}
            onSelect={handleLoreSelect}
          />
        )}

        {step === 6 && (
          <StepConflict
            key="conflict"
            selected={formData.conflict}
            onSelect={handleConflictSelect}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Index;
