import { useState } from 'react';
import { PersonalizationOption } from '@/config/characters.config';

interface CharacterOnboardingData {
    userName: string;
    email: string;
    mobileNumber: string;
    selectedPersonalization: PersonalizationOption | null;
}

export const useCharacterOnboarding = () => {
    const [step, setStep] = useState(0);
    const [formData, setFormData] = useState<CharacterOnboardingData>({
        userName: '',
        email: '',
        mobileNumber: '',
        selectedPersonalization: null,
    });

    const updateFormData = <K extends keyof CharacterOnboardingData>(
        key: K,
        value: CharacterOnboardingData[K]
    ) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
    };

    const nextStep = () => {
        setStep((prev) => prev + 1);
    };

    const prevStep = () => {
        setStep((prev) => Math.max(0, prev - 1));
    };

    const resetForm = () => {
        setFormData({
            userName: '',
            email: '',
            mobileNumber: '',
            selectedPersonalization: null,
        });
        setStep(0);
    };

    // Calculate progress (2 steps total: basics + personalization)
    const progress = ((step + 1) / 2) * 100;

    return {
        step,
        formData,
        progress,
        updateFormData,
        nextStep,
        prevStep,
        resetForm,
    };
};
