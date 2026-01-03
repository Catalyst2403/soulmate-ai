import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

/**
 * Riya Email Login/Signup Page
 * Allows users to sign in or sign up with email and password
 */
const RiyaEmailLogin = () => {
    const navigate = useNavigate();
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const checkAndRedirect = async (userId: string, userEmail: string) => {
        // Check if Riya profile exists
        const { data: riyaUser } = await supabase
            .from('riya_users')
            .select('*')
            .eq('google_id', userId) // Using google_id column for auth ID mapping
            .maybeSingle();

        if (riyaUser) {
            localStorage.setItem('riya_user_id', riyaUser.id);
            navigate('/riya/chat');
        } else {
            // Start onboarding
            localStorage.setItem('riya_google_id', userId);
            localStorage.setItem('riya_email', userEmail);
            navigate('/riya/onboarding/profile');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            if (isSignUp) {
                // Sign Up Flow
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                });

                if (error) throw error;

                if (data.session) {
                    // Auto-logged in (email confirmation disabled or not required immediately)
                    await checkAndRedirect(data.session.user.id, email);
                } else if (data.user) {
                    // Email confirmation required
                    toast({
                        title: 'Account created!',
                        description: 'Please check your email to confirm your account before signing in.',
                    });
                    // Switch to login mode
                    setIsSignUp(false);
                }
            } else {
                // Login Flow
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (error) throw error;

                if (data.session) {
                    await checkAndRedirect(data.session.user.id, email);
                }
            }
        } catch (error) {
            console.error('Auth error:', error);
            toast({
                title: isSignUp ? 'Sign up failed' : 'Login failed',
                description: error instanceof Error ? error.message : 'Authentication failed',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            {/* Background Pattern */}
            <div
                className="fixed inset-0 opacity-5 pointer-events-none"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300d4aa' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            />

            <div className="relative z-10 max-w-md w-full glass-card p-8 space-y-6">
                <div className="text-center space-y-2">
                    <div className="flex justify-center mb-4">
                        <div className="w-16 h-16 rounded-full overflow-hidden border-3 border-neon-cyan/50 shadow-lg neon-glow">
                            <img
                                src="/riya-avatar.jpg"
                                alt="Riya"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    </div>
                    <h1 className="font-display text-2xl font-bold text-foreground">
                        {isSignUp ? 'Create Account' : 'Sign In'}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {isSignUp ? 'Join Riya today' : 'Welcome back to Riya'}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Email</label>
                        <Input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@example.com"
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Password</label>
                        <Input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            minLength={6}
                            required
                        />
                    </div>

                    <Button
                        type="submit"
                        disabled={isLoading}
                        variant="glow"
                        className="w-full"
                    >
                        {isLoading
                            ? (isSignUp ? 'Creating account...' : 'Signing in...')
                            : (isSignUp ? 'Sign Up' : 'Sign In')}
                    </Button>
                </form>

                <div className="space-y-4 text-center">
                    <button
                        type="button"
                        onClick={() => setIsSignUp(!isSignUp)}
                        className="text-sm text-primary hover:underline font-medium"
                    >
                        {isSignUp
                            ? 'Already have an account? Sign In'
                            : "Don't have an account? Sign Up"}
                    </button>

                    <div>
                        <Link to="/riya" className="text-xs text-muted-foreground hover:text-foreground">
                            ← Back to Home
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RiyaEmailLogin;
