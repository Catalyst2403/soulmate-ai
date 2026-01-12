import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SoftPaywallBannerProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Soft Paywall Banner Component
 * Shown when free user exceeds 20 Pro-quality messages
 * User can dismiss and continue with cheaper model
 */
const SoftPaywallBanner = ({ isOpen, onClose }: SoftPaywallBannerProps) => {
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
                    className="relative w-full max-w-sm glass-card p-6 space-y-5"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    {/* Icon */}
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 mb-2">
                            <Zap className="w-7 h-7 text-white" />
                        </div>
                    </div>

                    {/* Title */}
                    <div className="text-center space-y-3">
                        <h2 className="font-display text-xl font-bold text-foreground">
                            Switching to Lite Mode 💫
                        </h2>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                            Your first <span className="text-primary font-semibold">20 messages</span> used our best AI.
                        </p>
                        <p className="text-xs text-muted-foreground italic">
                            "You can keep chatting, but I might be a bit less... myself 😅 Upgrade for the full experience!"
                        </p>
                    </div>

                    {/* CTAs */}
                    <div className="space-y-3">
                        <Button
                            onClick={handleUpgrade}
                            variant="glow"
                            size="lg"
                            className="w-full"
                        >
                            <Sparkles className="w-5 h-5 mr-2" />
                            Upgrade to Pro
                        </Button>

                        <Button
                            onClick={onClose}
                            variant="ghost"
                            size="lg"
                            className="w-full text-muted-foreground"
                        >
                            Continue in Lite Mode
                        </Button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default SoftPaywallBanner;
