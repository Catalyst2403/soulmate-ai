import { motion } from 'framer-motion';
import { useState } from 'react';
import { Input } from '@/components/ui/input';

interface StepAgeArchetypeProps {
    selected: string;
    onSelect: (value: string) => void;
}

const options = [
    {
        value: '20-year-old College Student',
        emoji: '🎓',
        title: 'Gen-Z Chaos (18-22)',
        subtitle: 'Slang heavy, broke, stressed about exams, impulsive.',
    },
    {
        value: '25-year-old Working Professional',
        emoji: '💼',
        title: 'Quarter-Life Crisis (23-27)',
        subtitle: 'Hates job, loves weekends, coffee addict, trying to figure life out.',
    },
    {
        value: '30-year-old Experienced Adult',
        emoji: '🧘',
        title: 'Sorted & Mature (28+)',
        subtitle: 'Calm, gives good advice, stable, less drama.',
    },
];

export const StepAgeArchetype = ({ selected, onSelect }: StepAgeArchetypeProps) => {
    const [showCustom, setShowCustom] = useState(false);
    const [customValue, setCustomValue] = useState('');

    const handleCustomSubmit = () => {
        if (customValue.trim()) {
            onSelect(customValue);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center justify-center min-h-screen px-6 py-12"
        >
            <div className="max-w-lg w-full">
                <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="text-center mb-10"
                >
                    <span className="text-5xl mb-4 block">🎂</span>
                    <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground">
                        How old is your friend?
                        <br />
                        <span className="neon-text">Choose wisely!</span>
                    </h2>
                    <p className="text-muted-foreground text-sm mt-3">
                        Bachpana chahiye ya Maturity? Harkatein waisi hi hongi.
                    </p>
                </motion.div>

                <div className="space-y-4">
                    {options.map((option, index) => (
                        <motion.button
                            key={option.value}
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.2 + index * 0.1 }}
                            onClick={() => onSelect(option.value)}
                            className={`w-full glass-card p-6 text-left transition-all duration-300 hover:scale-[1.02] group cursor-pointer ${selected === option.value
                                ? 'border-primary shadow-[0_0_20px_hsla(174,100%,50%,0.3)]'
                                : 'hover:border-primary/50'
                                }`}
                        >
                            <div className="flex items-center gap-4">
                                <span className="text-4xl group-hover:scale-110 transition-transform duration-300">
                                    {option.emoji}
                                </span>
                                <div>
                                    <h3 className="font-display text-lg font-semibold text-foreground">
                                        {option.title}
                                    </h3>
                                    <p className="text-muted-foreground text-sm">{option.subtitle}</p>
                                </div>
                            </div>
                        </motion.button>
                    ))}
                </div>

                {!showCustom ? (
                    <motion.button
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.6 }}
                        onClick={() => setShowCustom(true)}
                        className="w-full glass-card p-4 text-center text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all duration-300 mt-4"
                    >
                        ✏️ Something else? (Custom)
                    </motion.button>
                ) : (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="glass-card p-4 space-y-3 mt-4"
                    >
                        <Input
                            type="text"
                            placeholder="Type your custom answer..."
                            value={customValue}
                            onChange={(e) => setCustomValue(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleCustomSubmit()}
                            className="text-sm"
                            autoFocus
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={handleCustomSubmit}
                                disabled={!customValue.trim()}
                                className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                            >
                                Submit
                            </button>
                            <button
                                onClick={() => setShowCustom(false)}
                                className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </motion.div>
                )}
            </div>
        </motion.div>
    );
};
