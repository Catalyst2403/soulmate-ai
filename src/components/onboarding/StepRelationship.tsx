import { motion } from 'framer-motion';

interface StepRelationshipProps {
  selected: string;
  onSelect: (value: string) => void;
}

const options = [
  {
    value: 'Girlfriend/Boyfriend',
    emoji: '👩‍❤️‍👨',
    title: 'The Girlfriend / Boyfriend',
    subtitle: 'Romance, drama, exclusivity',
  },
  {
    value: 'Bestie',
    emoji: '👯',
    title: 'The Bestie',
    subtitle: 'Roasts, gossip, 2 AM rants',
  },
  {
    value: 'Mentor',
    emoji: '🧘',
    title: 'The Mentor / Therapist',
    subtitle: 'Calm, advice, peace',
  },
];

export const StepRelationship = ({ selected, onSelect }: StepRelationshipProps) => {
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
          <span className="text-5xl mb-4 block">🎬</span>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground">
            Okay, let's set the scene.
            <br />
            <span className="neon-text">Who is she/he to you?</span>
          </h2>
        </motion.div>

        <div className="space-y-4">
          {options.map((option, index) => (
            <motion.button
              key={option.value}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 + index * 0.1 }}
              onClick={() => onSelect(option.value)}
              className={`w-full glass-card p-6 text-left transition-all duration-300 hover:scale-[1.02] group cursor-pointer ${
                selected === option.value
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
      </div>
    </motion.div>
  );
};
