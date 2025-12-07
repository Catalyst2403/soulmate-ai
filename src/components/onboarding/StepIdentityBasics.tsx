import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface StepIdentityBasicsProps {
    name: string;
    gender: string;
    onNameChange: (name: string) => void;
    onGenderSelect: (gender: string) => void;
    onComplete: () => void;
}

const genderOptions = [
    { value: 'Female', emoji: '👩', label: 'Female 👩' },
    { value: 'Male', emoji: '👨', label: 'Male 👨' },
    { value: 'Non-Binary', emoji: '🌈', label: 'Non-Binary 🌈' },
];

export const StepIdentityBasics = ({
    name,
    gender,
    onNameChange,
    onGenderSelect,
    onComplete
}: StepIdentityBasicsProps) => {
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim() && gender) {
            onComplete();
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
                    <motion.span
                        animate={{ rotate: [0, 10, -10, 0] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="text-5xl mb-4 block"
                    >
                        🧬
                    </motion.span>
                    <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground">
                        Let's build a human.
                        <br />
                        <span className="neon-text">Naam aur Gender batao.</span>
                    </h2>
                    <p className="text-muted-foreground text-sm mt-3">
                        (Zaruri nahi sabko ladki hi chahiye, be honest!)
                    </p>
                </motion.div>

                <motion.form
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    onSubmit={handleSubmit}
                    className="glass-card p-8 space-y-6"
                >
                    <div className="space-y-2">
                        <label className="text-sm text-muted-foreground">Name</label>
                        <Input
                            type="text"
                            placeholder="e.g. Aryan, Zoya"
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            className="text-center text-lg h-12"
                            required
                        />
                    </div>

                    <div className="space-y-3">
                        <label className="text-sm text-muted-foreground">Gender</label>
                        <div className="grid grid-cols-3 gap-3">
                            {genderOptions.map((option, index) => (
                                <motion.button
                                    key={option.value}
                                    type="button"
                                    initial={{ y: 20, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                    transition={{ delay: 0.3 + index * 0.1 }}
                                    onClick={() => onGenderSelect(option.value)}
                                    className={`glass-card p-4 text-center transition-all duration-300 hover:scale-105 cursor-pointer ${gender === option.value
                                        ? 'border-primary shadow-[0_0_20px_hsla(174,100%,50%,0.3)]'
                                        : 'hover:border-primary/50'
                                        }`}
                                >
                                    <span className="text-3xl block mb-2">{option.emoji}</span>
                                    <span className="text-xs text-foreground">{option.value}</span>
                                </motion.button>
                            ))}
                        </div>
                    </div>

                    <Button
                        type="submit"
                        variant="neon"
                        size="xl"
                        className="w-full"
                        disabled={!name.trim() || !gender}
                    >
                        Next →
                    </Button>
                </motion.form>
            </div>
        </motion.div>
    );
};
