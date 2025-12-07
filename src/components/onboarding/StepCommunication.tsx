import { motion } from 'framer-motion';

interface StepCommunicationProps {
  selected: string;
  onSelect: (value: string) => void;
}

const options = [
  {
    value: 'Burst',
    title: 'Burst Mode',
    bubbles: ['Oye!', 'Sunn na', 'Miss u 🥺'],
  },
  {
    value: 'Paragraph',
    title: 'Paragraph Mode',
    bubbles: ['Hey! I was just thinking about you and how our day went. Aaj bohot hectic tha na? Tell me everything...'],
  },
  {
    value: 'Slang',
    title: 'Slang Mode',
    bubbles: ['Ded 💀', 'Fr tho? No cap.', 'Bruh moment'],
  },
];

export const StepCommunication = ({ selected, onSelect }: StepCommunicationProps) => {
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
          <span className="text-5xl mb-4 block">💬</span>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground">
            How should they
            <br />
            <span className="neon-text">text you?</span>
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
              className={`w-full glass-card p-5 text-left transition-all duration-300 hover:scale-[1.02] cursor-pointer ${selected === option.value
                  ? 'border-primary shadow-[0_0_20px_hsla(174,100%,50%,0.3)]'
                  : 'hover:border-primary/50'
                }`}
            >
              <h3 className="font-display text-lg font-semibold text-foreground mb-3">
                {option.title}
              </h3>
              <div className="space-y-2">
                {option.bubbles.map((bubble, i) => (
                  <motion.div
                    key={i}
                    initial={{ x: -10, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.3 + i * 0.1 }}
                    className="chat-bubble-bot inline-block max-w-[80%]"
                  >
                    <p className="text-sm text-foreground">{bubble}</p>
                  </motion.div>
                ))}
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
};
