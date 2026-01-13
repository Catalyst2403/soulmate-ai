import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

interface QuickReplyButtonsProps {
    onSelect: (message: string) => void;
    disabled?: boolean;
    options?: string[];
}

/**
 * Quick reply buttons for guest users to start conversation easily
 * Shown above the input field
 */
export default function QuickReplyButtons({ onSelect, disabled, options }: QuickReplyButtonsProps) {
    // Default quick replies (fallback)
    const defaultOptions = [
        "bored hoon 😴",
        "kuch interesting bata",
        "bad day chal raha 😞",
    ];

    const displayOptions = options || defaultOptions;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap gap-2 justify-center px-4 py-3"
        >
            {displayOptions.map((reply, index) => (
                <motion.div
                    key={typeof reply === 'string' ? reply : reply.text}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                >
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSelect(typeof reply === 'string' ? reply : reply.text)}
                        disabled={disabled}
                        className="rounded-full border-primary/30 hover:bg-primary/10 hover:border-primary/50 text-sm"
                    >
                        {typeof reply === 'string' ? reply : reply.text}
                    </Button>
                </motion.div>
            ))}
        </motion.div>
    );
}
