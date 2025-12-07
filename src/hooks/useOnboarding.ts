import { useState } from 'react';
import { FormData } from '@/types';
import { generateSystemPromptFromPersona } from '@/utils/systemPrompt';

const initialFormData: FormData = {
  email: '',
  identity_name: '',
  identity_gender: '',
  age_archetype: '',
  relationship: '',
  vibe: '',
  lore: '',
  conflict: '',
};

export const useOnboarding = () => {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);

  const updateFormData = (key: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const nextStep = () => setStep(prev => Math.min(prev + 1, 6));
  const prevStep = () => setStep(prev => Math.max(prev - 1, 0));

  // Progress calculation: step 0 (landing) doesn't count, so we have 6 actual onboarding questions (steps 1-6)
  const progress = step === 0 ? 0 : (step / 6) * 100;

  const generateSystemPrompt = (): string => {
    // Convert FormData to Persona-like object for the generator
    return generateSystemPromptFromPersona({
      identity_name: formData.identity_name,
      identity_gender: formData.identity_gender,
      age_archetype: formData.age_archetype,
      relationship: formData.relationship,
      vibe: formData.vibe,
      lore: formData.lore,
      conflict: formData.conflict,
    } as any);
  };

  return {
    step,
    formData,
    progress,
    updateFormData,
    nextStep,
    prevStep,
    generateSystemPrompt,
    setStep,
  };
};
