import { motion } from 'framer-motion';

interface StepVibeProps {
  selected: string;
  onSelect: (value: string) => void;
}

const options = [
  {
    value: 'Cozy',
    emoji: '🧸',
    title: 'Cozy & Soft',
    subtitle: "Blankets, Netflix, 'Baby' texts",
    gradient: 'from-pink-500/20 to-orange-500/20',
  },
  {
    value: 'Sassy',
    emoji: '🌶️',
    title: 'Sassy & Mean',
    subtitle: "Roasting, hard-to-get, 'Huh?' texts",
    gradient: 'from-red-500/20 to-pink-500/20',
  },
  {
    value: 'Wild',
    emoji: '⚡',
    title: 'Wild & Manic',
    subtitle: 'Spamming msgs, random plans, chaos',
    gradient: 'from-yellow-500/20 to-green-500/20',
  },
  {
    value: 'Deep',
    emoji: '🧠',
    title: 'Deep & Dark',
    subtitle: 'Philosophy, universe talks, intense',
    gradient: 'from-purple-500/20 to-blue-500/20',
  },
];

export const StepVibe = ({ selected, onSelect }: StepVibeProps) => {
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
          <span className="text-5xl mb-4 block">🌃</span>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground">
            What's the vibe for
            <br />
            <span className="neon-text">a Friday Night?</span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-2 gap-4">
          {options.map((option, index) => (
            <motion.button
              key={option.value}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 + index * 0.1 }}
              onClick={() => onSelect(option.value)}
              className={`glass-card p-5 text-center transition-all duration-300 hover:scale-105 group cursor-pointer ${
                selected === option.value
                  ? 'border-primary shadow-[0_0_20px_hsla(174,100%,50%,0.3)]'
                  : 'hover:border-primary/50'
              }`}
            >
              <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${option.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
              <div className="relative z-10">
                <span className="text-4xl block mb-3 group-hover:scale-110 transition-transform duration-300">
                  {option.emoji}
                </span>
                <h3 className="font-display text-sm font-semibold text-foreground mb-1">
                  {option.title}
                </h3>
                <p className="text-muted-foreground text-xs">{option.subtitle}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
};
