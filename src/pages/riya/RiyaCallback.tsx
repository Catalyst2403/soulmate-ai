import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

/**
 * Google OAuth Callback Handler for Riya
 * Handles the redirect after Google authentication
 */
const RiyaCallback = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const handleCallback = async () => {
            try {
                // Get the session after Google redirect
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error || !session) {
                    console.error('Auth error:', error);
                    navigate('/riya');
                    return;
                }

                const googleId = session.user.id;
                const email = session.user.email || '';
                const fullName = session.user.user_metadata?.full_name || '';

                console.log('Google auth successful:', { googleId, email, fullName });

                // Check if user exists in riya_users
                const { data: existingUser, error: fetchError } = await supabase
                    .from('riya_users')
                    .select('*')
                    .eq('google_id', googleId)
                    .maybeSingle();

                if (fetchError) {
                    console.error('Error fetching user:', fetchError);
                }

                // Helper to migrate guest session
                const migrateGuestSession = async (riyaUserId: string) => {
                    const pendingGuestSession = localStorage.getItem('riya_pending_guest_session');
                    if (pendingGuestSession) {
                        console.log('Migrating guest session:', pendingGuestSession);

                        // Mark guest session as converted (don't update user_id on messages - keeps analytics clean)
                        // @ts-ignore - Table exists after migration
                        await supabase
                            .from('riya_guest_sessions')
                            .update({
                                converted: true,
                                converted_user_id: riyaUserId,
                            })
                            .eq('session_id', pendingGuestSession);

                        // Clean up
                        localStorage.removeItem('riya_pending_guest_session');
                        localStorage.removeItem('riya_guest_session_id');
                    }
                };

                if (existingUser) {
                    // Existing user - go to chat
                    console.log('Existing user found, redirecting to chat');
                    localStorage.setItem('riya_user_id', existingUser.id);

                    // Migrate any guest session
                    await migrateGuestSession(existingUser.id);

                    navigate('/riya/chat');
                } else {
                    // New user - complete profile
                    console.log('New user, redirecting to profile setup');
                    localStorage.setItem('riya_google_id', googleId);
                    localStorage.setItem('riya_email', email);
                    localStorage.setItem('riya_full_name', fullName);
                    navigate('/riya/onboarding/profile');
                }
            } catch (error) {
                console.error('Callback error:', error);
            }
            navigate('/riya');
        };

        handleCallback();
    }, [navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900">
            <div className="text-center space-y-4">
                <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-lg text-gray-700 dark:text-gray-300">
                    Signing you in...
                </p>
            </div>
        </div>
    );
};

export default RiyaCallback;
