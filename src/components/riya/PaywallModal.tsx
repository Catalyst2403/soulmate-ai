import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Crown, Clock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaywallModalProps {
    isOpen: boolean;
    onClose: () => void;
    resetsAt?: string;
}

/**
 * Paywall Modal Component
 * Shown when free user reaches daily message limit (30 messages)
 */
const PaywallModal = ({ isOpen, onClose, resetsAt }: PaywallModalProps) => {
    const navigate = useNavigate();
    const [timeUntilReset, setTimeUntilReset] = useState('');

    useEffect(() => {
        if (!resetsAt) return;

        const updateTimer = () => {
            const now = new Date();
            const resetTime = new Date(resetsAt);
            const diff = resetTime.getTime() - now.getTime();

            if (diff <= 0) {
                setTimeUntilReset('Refreshing...');
                // Reload page to reset message count
                setTimeout(() => window.location.reload(), 1000);
                return;
            }

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            setTimeUntilReset(`${hours}h ${minutes}m`);
        };

        updateTimer();
        const interval = setInterval(updateTimer, 60000); // Update every minute

        return () => clearInterval(interval);
    }, [resetsAt]);

    const handleUpgrade = () => {
        onClose();
        navigate('/riya/pricing');
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="relative w-full max-w-sm glass-card p-6 space-y-6"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    {/* Emoji/Icon */}
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 mb-2">
                            <Crown className="w-8 h-8 text-white" />
                        </div>
                    </div>

                    {/* Title */}
                    <div className="text-center space-y-2">
                        <h2 className="font-display text-2xl font-bold text-foreground">
                            You're on a roll! 🔥
                        </h2>
                        <p className="text-muted-foreground">
                            You've used all <span className="text-primary font-semibold">30 free messages</span> for today.
                        </p>
                    </div>

                    {/* Upgrade CTA */}
                    <div className="space-y-4">
                        <Button
                            onClick={handleUpgrade}
                            variant="glow"
                            size="lg"
                            className="w-full"
                        >
                            <Sparkles className="w-5 h-5 mr-2" />
                            Get Pro - Just ₹29
                        </Button>

                        <p className="text-center text-sm text-muted-foreground">
                            Unlimited messages • No daily limits
                        </p>
                    </div>

                    {/* Reset Timer */}
                    {timeUntilReset && (
                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground border-t border-border pt-4">
                            <Clock className="w-4 h-4" />
                            <span>Free messages reset in: <span className="text-foreground font-medium">{timeUntilReset}</span></span>
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default PaywallModal;
