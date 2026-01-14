import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';

interface GuestLoginModalProps {
    isOpen: boolean;
    onClose: () => void;
    guestSessionId: string;
    canClose?: boolean; // If false (10 msgs exhausted), cannot close modal
}

/**
 * Login wall shown after guest uses 10 messages or clicks camera
 * Full-screen modal with Hinglish copy and login options
 * canClose=true: Shows X button (e.g., camera click)
 * canClose=false: No X button (e.g., 10 msgs exhausted)
 */
export default function GuestLoginModal({ isOpen, onClose, guestSessionId, canClose = true }: GuestLoginModalProps) {
    const navigate = useNavigate();

    const handleGoogleSignIn = async () => {
        // Store guest session ID in localStorage for migration after login
        localStorage.setItem('riya_pending_guest_session', guestSessionId);

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

    const handleEmailLogin = () => {
        // Store guest session ID for migration after login
        localStorage.setItem('riya_pending_guest_session', guestSessionId);
        navigate('/riya/email-login');
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        transition={{ type: 'spring', duration: 0.5 }}
                        className="relative w-full max-w-sm bg-background rounded-2xl overflow-hidden shadow-2xl border border-border"
                    >
                        {/* Close button - only shown when canClose is true */}
                        {canClose && (
                            <button
                                onClick={onClose}
                                className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}

                        {/* Riya's Avatar */}
                        <div className="flex flex-col items-center pt-8 pb-4 bg-gradient-to-b from-primary/10 to-transparent">
                            <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-primary/50 shadow-lg mb-4">
                                <img
                                    src="/riya-avatar.jpg"
                                    alt="Riya"
                                    className="w-full h-full object-cover"
                                />
                            </div>

                            {/* Hinglish message */}
                            <div className="px-6 text-center">
                                <p className="text-lg font-medium text-foreground leading-relaxed">
                                    "Oye, conversation save karni hai toh Login kar le, warna main bhool jaungi tujhe!" 💭
                                </p>
                            </div>
                        </div>

                        {/* Login buttons */}
                        <div className="p-6 space-y-3">
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
                                onClick={handleEmailLogin}
                                variant="outline"
                                size="lg"
                                className="w-full border-primary/20 hover:bg-primary/5"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                                Continue with Email
                            </Button>
                        </div>

                        {/* Benefits */}
                        <div className="px-6 pb-6 text-center text-sm text-muted-foreground space-y-1">
                            <p>✨ 50 free messages daily after login</p>
                            <p>📸 Unlock Riya's special photos & surprise pics</p>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
