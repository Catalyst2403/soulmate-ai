import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

/**
 * Riya Landing Page
 * Entry point for Riya character system
 */
const RiyaLanding = () => {
    const navigate = useNavigate();

    useEffect(() => {
        // Check if user is already authenticated
        const checkAuthentication = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            if (session) {
                // User is authenticated, check if they have a Riya profile
                const googleId = session.user.id;

                const { data: riyaUser } = await supabase
                    .from('riya_users')
                    .select('*')
                    .eq('google_id', googleId)
                    .maybeSingle();

                if (riyaUser) {
                    // Existing user - go to chat
                    localStorage.setItem('riya_user_id', riyaUser.id);
                    navigate('/riya/chat');
                } else {
                    // Authenticated but no profile - complete onboarding
                    localStorage.setItem('riya_google_id', googleId);
                    localStorage.setItem('riya_email', session.user.email || '');
                    navigate('/riya/onboarding/profile');
                }
            }
        };

        checkAuthentication();
    }, [navigate]);

    const handleGoogleSignIn = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/riya/callback`,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                },
            },
        });

        if (error) {
            console.error('Google auth error:', error);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900">
            <div className="max-w-md w-full p-8 text-center space-y-8">
                {/* Logo/Avatar */}
                <div className="flex justify-center">
                    <div className="w-24 h-24 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-4xl font-bold">
                        R
                    </div>
                </div>

                {/* Title */}
                <div className="space-y-2">
                    <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
                        Meet Riya 👋
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-300">
                        Your AI friend who actually gets you
                    </p>
                </div>

                {/* Features */}
                <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center justify-center gap-2">
                        <span>💬</span>
                        <span>Natural, flowing conversations</span>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                        <span>🎯</span>
                        <span>Adapts to your age and vibe</span>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                        <span>🔒</span>
                        <span>Private and secure</span>
                    </div>
                </div>

                {/* Google Sign-In Button */}
                <Button
                    onClick={handleGoogleSignIn}
                    className="w-full bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 shadow-sm"
                    size="lg"
                >
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                        <path
                            fill="currentColor"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                            fill="currentColor"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                            fill="currentColor"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                            fill="currentColor"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                    </svg>
                    Continue with Google
                </Button>

                <p className="text-xs text-gray-500 dark:text-gray-400">
                    By continuing, you agree to our Terms and Privacy Policy
                </p>
            </div>
        </div>
    );
};

export default RiyaLanding;
