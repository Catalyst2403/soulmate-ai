import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/hooks/use-toast';

/**
 * Riya Profile Setup
 * Collects username, age, and gender after Google authentication
 */
const RiyaProfileSetup = () => {
    const [username, setUsername] = useState('');
    const [age, setAge] = useState(22); // Default age
    const [gender, setGender] = useState<'male' | 'female' | 'other' | ''>('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    // Pre-fill username from Google
    useEffect(() => {
        const fullName = localStorage.getItem('riya_full_name');
        if (fullName) {
            setUsername(fullName);
        }
    }, []);

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

        if (age < 1 || age > 70) {
            toast({
                title: 'Invalid age',
                description: 'Please select an age between 1 and 70',
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
                    user_age: age,
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
            localStorage.removeItem('riya_full_name');

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
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            {/* WhatsApp-style background pattern */}
            <div
                className="fixed inset-0 opacity-5 pointer-events-none"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300d4aa' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            />

            <div className="relative z-10 max-w-md w-full glass-card p-8 space-y-6">
                {/* Header */}
                <div className="text-center space-y-3">
                    <h2 className="font-display text-3xl font-bold text-foreground">
                        Tell me about yourself 😊
                    </h2>
                    <p className="text-muted-foreground">
                        Just a few details to personalize your experience
                    </p>
                </div>

                {/* Form */}
                <div className="space-y-5">
                    {/* Username */}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                            What should I call you?
                        </label>
                        <Input
                            placeholder="Your name"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full bg-muted/30 border-border"
                            disabled={isLoading}
                        />
                    </div>

                    {/* Age */}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                            How old are you?
                        </label>
                        <div className="space-y-4">
                            <div className="text-center">
                                <span className="text-4xl font-bold text-primary">{age}</span>
                                <span className="text-lg text-muted-foreground ml-1">years</span>
                            </div>
                            <Slider
                                value={[age]}
                                onValueChange={(values) => setAge(values[0])}
                                min={0}
                                max={70}
                                step={1}
                                className="w-full"
                                disabled={isLoading}
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>0</span>
                                <span>70</span>
                            </div>
                        </div>
                    </div>

                    {/* Gender */}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-2">
                            Gender
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            <Button
                                type="button"
                                variant={gender === 'male' ? 'glow' : 'outline'}
                                onClick={() => setGender('male')}
                                disabled={isLoading}
                                className="w-full"
                            >
                                Male
                            </Button>
                            <Button
                                type="button"
                                variant={gender === 'female' ? 'glow' : 'outline'}
                                onClick={() => setGender('female')}
                                disabled={isLoading}
                                className="w-full"
                            >
                                Female
                            </Button>
                            <Button
                                type="button"
                                variant={gender === 'other' ? 'glow' : 'outline'}
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
                    variant="glow"
                    size="lg"
                    className="w-full"
                >
                    {isLoading ? 'Setting up...' : 'Meet Riya →'}
                </Button>
            </div>
        </div>
    );
};

export default RiyaProfileSetup;
