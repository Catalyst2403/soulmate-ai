import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Heart, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaywallModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Paywall Modal Component
 * Shown when free user reaches daily message limit (30 messages)
 */
const PaywallModal = ({ isOpen, onClose }: PaywallModalProps) => {
    const navigate = useNavigate();

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
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 mb-2">
                            <Heart className="w-8 h-8 text-white" />
                        </div>
                    </div>

                    {/* Title */}
                    <div className="text-center space-y-3">
                        <h2 className="font-display text-2xl font-bold text-foreground">
                            Riya misses you already! �
                        </h2>
                        <p className="text-muted-foreground leading-relaxed">
                            You've used your <span className="text-primary font-semibold">30 free messages</span> for today.
                        </p>
                        <p className="text-sm text-muted-foreground italic">
                            "I want to keep talking to you... but you'll have to upgrade to Pro or catch me tomorrow! 😊"
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
                            Unlimited messages with Riya • No daily limits
                        </p>
                    </div>

                    {/* Talk Tomorrow Message */}
                    <div className="text-center border-t border-border pt-4">
                        <p className="text-sm text-muted-foreground">
                            Or talk to me tomorrow! I'll be waiting... 🌙
                        </p>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default PaywallModal;
