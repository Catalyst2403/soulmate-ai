import { motion } from 'framer-motion';
import { PersonalizationOption } from '@/config/characters.config';

interface CharacterStepPersonalizationProps {
    question: string;
    options: PersonalizationOption[];
    onSelect: (option: PersonalizationOption) => void;
    characterName: string;
}

export const CharacterStepPersonalization = ({
    question,
    options,
    onSelect,
    characterName,
}: CharacterStepPersonalizationProps) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className="min-h-screen flex items-center justify-center p-6"
        >
            <div className="w-full max-w-2xl space-y-8">
                <div className="text-center space-y-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.2 }}
                        className="space-y-2"
                    >
                        <h1 className="text-3xl md:text-4xl font-bold">
                            {question}
                        </h1>
                        <p className="text-muted-foreground">
                            Help {characterName} understand you better
                        </p>
                    </motion.div>
                </div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="grid grid-cols-1 md:grid-cols-2 gap-4"
                >
                    {options.map((option, index) => (
                        <motion.button
                            key={option.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 * index }}
                            onClick={() => onSelect(option)}
                            className="group relative overflow-hidden rounded-xl border-2 border-border bg-card p-6 text-left transition-all hover:border-purple-500 hover:shadow-lg hover:shadow-purple-500/20 active:scale-95"
                        >
                            <div className="flex items-start gap-4">
                                <div className="text-4xl">{option.emoji}</div>
                                <div className="flex-1 space-y-2">
                                    <h3 className="text-lg font-semibold group-hover:text-purple-500 transition-colors">
                                        {option.label}
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        {option.archetype}
                                    </p>
                                </div>
                            </div>

                            {/* Gradient overlay on hover */}
                            <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </motion.button>
                    ))}
                </motion.div>

                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    className="text-center text-sm text-muted-foreground"
                >
                    Your choice helps personalize how {characterName} chats with you
                </motion.p>
            </div>
        </motion.div>
    );
};
