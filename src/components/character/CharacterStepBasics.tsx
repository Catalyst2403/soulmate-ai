import { motion } from 'framer-motion';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CharacterStepBasicsProps {
    userName: string;
    email: string;
    mobileNumber: string;
    onUserNameChange: (value: string) => void;
    onEmailChange: (value: string) => void;
    onMobileNumberChange: (value: string) => void;
    onComplete: () => void;
    characterName: string;
}

export const CharacterStepBasics = ({
    userName,
    email,
    mobileNumber,
    onUserNameChange,
    onEmailChange,
    onMobileNumberChange,
    onComplete,
    characterName,
}: CharacterStepBasicsProps) => {
    const [errors, setErrors] = useState({ userName: '', email: '', mobileNumber: '' });

    const validateEmail = (email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    const validateMobile = (mobile: string) => {
        const mobileRegex = /^[6-9]\d{9}$/; // Indian mobile number format
        return mobileRegex.test(mobile);
    };

    const handleSubmit = () => {
        const newErrors = { userName: '', email: '', mobileNumber: '' };
        let hasError = false;

        if (!userName.trim()) {
            newErrors.userName = 'Please enter your name';
            hasError = true;
        }

        if (!email.trim()) {
            newErrors.email = 'Please enter your email';
            hasError = true;
        } else if (!validateEmail(email)) {
            newErrors.email = 'Please enter a valid email';
            hasError = true;
        }

        if (!mobileNumber.trim()) {
            newErrors.mobileNumber = 'Please enter your mobile number';
            hasError = true;
        } else if (!validateMobile(mobileNumber)) {
            newErrors.mobileNumber = 'Please enter a valid 10-digit mobile number';
            hasError = true;
        }

        setErrors(newErrors);

        if (!hasError) {
            onComplete();
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className="min-h-screen flex items-center justify-center p-6"
        >
            <div className="w-full max-w-md space-y-8">
                <div className="text-center space-y-2">
                    <motion.h1
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.2 }}
                        className="text-4xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent"
                    >
                        Meet {characterName} 💜
                    </motion.h1>
                    <p className="text-muted-foreground text-lg">
                        Your AI friend who actually gets you
                    </p>
                </div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="space-y-6"
                >
                    <div className="space-y-2">
                        <Label htmlFor="userName">Your Name</Label>
                        <Input
                            id="userName"
                            type="text"
                            placeholder="What should I call you?"
                            value={userName}
                            onChange={(e) => onUserNameChange(e.target.value)}
                            className={errors.userName ? 'border-red-500' : ''}
                        />
                        {errors.userName && (
                            <p className="text-sm text-red-500">{errors.userName}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="your@email.com"
                            value={email}
                            onChange={(e) => onEmailChange(e.target.value)}
                            className={errors.email ? 'border-red-500' : ''}
                        />
                        {errors.email && (
                            <p className="text-sm text-red-500">{errors.email}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="mobileNumber">Mobile Number</Label>
                        <Input
                            id="mobileNumber"
                            type="tel"
                            placeholder="9876543210"
                            value={mobileNumber}
                            onChange={(e) => {
                                // Only allow digits
                                const value = e.target.value.replace(/\D/g, '');
                                if (value.length <= 10) {
                                    onMobileNumberChange(value);
                                }
                            }}
                            className={errors.mobileNumber ? 'border-red-500' : ''}
                        />
                        {errors.mobileNumber && (
                            <p className="text-sm text-red-500">{errors.mobileNumber}</p>
                        )}
                    </div>

                    <Button
                        onClick={handleSubmit}
                        className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                        size="lg"
                    >
                        Continue
                    </Button>
                </motion.div>
            </div>
        </motion.div>
    );
};
