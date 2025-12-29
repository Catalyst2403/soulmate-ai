import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
        <div className="min-h-screen flex items-center justify-center bg-background">
            {/* WhatsApp-style background pattern */}
            <div
                className="fixed inset-0 opacity-5 pointer-events-none"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300d4aa' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            />

            <div className="relative z-10 max-w-md w-full p-8 text-center space-y-8">
                {/* Logo/Avatar */}
                <div className="flex justify-center">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-neon-cyan to-neon-magenta flex items-center justify-center text-4xl font-bold text-white shadow-lg neon-glow">
                        R
                    </div>
                </div>

                {/* Title */}
                <div className="space-y-3">
                    <h1 className="font-display text-5xl font-bold text-foreground">
                        Riya AI ✨
                    </h1>
                    <p className="text-lg text-muted-foreground">
                        Your AI wellness companion
                    </p>
                </div>

                {/* Features */}
                <div className="glass-card p-6 space-y-4 text-sm">
                    <div className="flex items-center gap-3 text-left">
                        <span className="text-2xl">💬</span>
                        <span className="text-foreground">Personalized AI support</span>
                    </div>
                    <div className="flex items-center gap-3 text-left">
                        <span className="text-2xl">🎯</span>
                        <span className="text-foreground">Adapts to your needs</span>
                    </div>
                    <div className="flex items-center gap-3 text-left">
                        <span className="text-2xl">🔒</span>
                        <span className="text-foreground">Private and secure</span>
                    </div>
                </div>

                {/* Google Sign-In Button */}
                <Button
                    onClick={handleGoogleSignIn}
                    variant="glow"
                    size="lg"
                    className="w-full"
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

                <Button
                    variant="outline"
                    size="lg"
                    className="w-full border-primary/20 hover:bg-primary/5 hover:text-primary"
                    onClick={() => navigate('/riya/email-login')}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Continue with Email
                </Button>

                <p className="text-xs text-muted-foreground">
                    By continuing, you agree to our{' '}
                    <Link to="/riya/terms" className="underline hover:text-foreground">Terms</Link> and{' '}
                    <Link to="/riya/privacy-policy" className="underline hover:text-foreground">Privacy Policy</Link>
                </p>
                <div className="flex flex-wrap justify-center gap-3 text-xs text-muted-foreground mt-2">
                    <Link to="/riya/pricing" className="underline hover:text-foreground">Pricing</Link>
                    <span>·</span>
                    <Link to="/riya/shipping-policy" className="underline hover:text-foreground">Shipping</Link>
                    <span>·</span>
                    <Link to="/riya/cancellation-refund" className="underline hover:text-foreground">Refunds</Link>
                    <span>·</span>
                    <Link to="/riya/contact" className="underline hover:text-foreground">Contact</Link>
                </div>
            </div>
        </div>
    );
};

export default RiyaLanding;
