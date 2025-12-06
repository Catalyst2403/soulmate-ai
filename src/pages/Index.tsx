import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useOnboarding } from '@/hooks/useOnboarding';
import { ProgressBar } from '@/components/onboarding/ProgressBar';
import { StepLanding } from '@/components/onboarding/StepLanding';
import { StepRelationship } from '@/components/onboarding/StepRelationship';
import { StepVibe } from '@/components/onboarding/StepVibe';
import { StepCommunication } from '@/components/onboarding/StepCommunication';
import { StepName } from '@/components/onboarding/StepName';
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

      // Create persona
      const { error: personaError } = await supabase
        .from('personas')
        .insert({
          user_id: userId,
          bot_name: formData.bot_name,
          relationship_type: formData.relationship_type,
          vibe: formData.vibe,
          communication_style: formData.communication_style,
          system_prompt: systemPrompt,
        });

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

  const handleRelationshipSelect = (value: string) => {
    updateFormData('relationship_type', value);
    setTimeout(nextStep, 300);
  };

  const handleVibeSelect = (value: string) => {
    updateFormData('vibe', value);
    setTimeout(nextStep, 300);
  };

  const handleCommunicationSelect = (value: string) => {
    updateFormData('communication_style', value);
    setTimeout(nextStep, 300);
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
          <StepRelationship
            key="relationship"
            selected={formData.relationship_type}
            onSelect={handleRelationshipSelect}
          />
        )}
        
        {step === 2 && (
          <StepVibe
            key="vibe"
            selected={formData.vibe}
            onSelect={handleVibeSelect}
          />
        )}
        
        {step === 3 && (
          <StepCommunication
            key="communication"
            selected={formData.communication_style}
            onSelect={handleCommunicationSelect}
          />
        )}
        
        {step === 4 && (
          <StepName
            key="name"
            name={formData.bot_name}
            onNameChange={(name) => updateFormData('bot_name', name)}
            onComplete={handleComplete}
            isLoading={isLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Index;
