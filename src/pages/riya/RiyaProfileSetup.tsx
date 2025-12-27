import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

/**
 * Riya Profile Setup
 * Collects username, age, and gender after Google authentication
 */
const RiyaProfileSetup = () => {
    const [username, setUsername] = useState('');
    const [age, setAge] = useState('');
    const [gender, setGender] = useState<'male' | 'female' | 'other' | ''>('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    const handleComplete = async () => {
        // Validation
        if (!username.trim()) {
            toast({
                title: 'Username required',
                description: 'Please enter your username',
                variant: 'destructive',
            });
            return;
        }

        const ageNum = parseInt(age);
        if (!age || ageNum < 1 || ageNum > 120) {
            toast({
                title: 'Invalid age',
                description: 'Please enter a valid age',
                variant: 'destructive',
            });
            return;
        }

        if (!gender) {
            toast({
                title: 'Gender required',
                description: 'Please select your gender',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);

        try {
            const googleId = localStorage.getItem('riya_google_id');
            const email = localStorage.getItem('riya_email');

            if (!googleId || !email) {
                throw new Error('Authentication data missing. Please sign in again.');
            }

            // Create riya_user
            const { data: riyaUser, error } = await supabase
                .from('riya_users')
                .insert({
                    google_id: googleId,
                    email: email,
                    username: username.trim(),
                    user_age: ageNum,
                    user_gender: gender,
                })
                .select()
                .single();

            if (error) {
                console.error('Error creating user:', error);
                throw new Error('Failed to create profile. Please try again.');
            }

            console.log('Riya user created:', riyaUser);

            // Save user ID and navigate to chat
            localStorage.setItem('riya_user_id', riyaUser.id);

            // Clean up temp storage
            localStorage.removeItem('riya_google_id');
            localStorage.removeItem('riya_email');

            toast({
                title: 'Welcome!',
                description: `Let's start chatting, ${username}!`,
            });

            navigate('/riya/chat');
        } catch (error) {
            console.error('Profile setup error:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Something went wrong',
                variant: 'destructive',
            });
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900 p-4">
            <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 space-y-6">
                {/* Header */}
                <div className="text-center space-y-2">
                    <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                        Tell me about yourself 😊
                    </h2>
                    <p className="text-gray-600 dark:text-gray-400">
                        Just a few details to personalize your experience
                    </p>
                </div>

                {/* Form */}
                <div className="space-y-4">
                    {/* Username */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            What should I call you?
                        </label>
                        <Input
                            placeholder="Your name"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full"
                            disabled={isLoading}
                        />
                    </div>

                    {/* Age */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            How old are you?
                        </label>
                        <Input
                            type="number"
                            placeholder="Your age"
                            value={age}
                            onChange={(e) => setAge(e.target.value)}
                            min="1"
                            max="120"
                            className="w-full"
                            disabled={isLoading}
                        />
                    </div>

                    {/* Gender */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Gender
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            <Button
                                type="button"
                                variant={gender === 'male' ? 'default' : 'outline'}
                                onClick={() => setGender('male')}
                                disabled={isLoading}
                                className="w-full"
                            >
                                Male
                            </Button>
                            <Button
                                type="button"
                                variant={gender === 'female' ? 'default' : 'outline'}
                                onClick={() => setGender('female')}
                                disabled={isLoading}
                                className="w-full"
                            >
                                Female
                            </Button>
                            <Button
                                type="button"
                                variant={gender === 'other' ? 'default' : 'outline'}
                                onClick={() => setGender('other')}
                                disabled={isLoading}
                                className="w-full"
                            >
                                Other
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Submit Button */}
                <Button
                    onClick={handleComplete}
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    size="lg"
                >
                    {isLoading ? 'Setting up...' : 'Meet Riya →'}
                </Button>
            </div>
        </div>
    );
};

export default RiyaProfileSetup;
