import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const loadingTexts = [
  'Hacking the matrix...',
  'Downloading personality...',
  'Injecting sass...',
  'Loading emotions...',
  'Calibrating vibes...',
];

export const LoadingScreen = () => {
  const [textIndex, setTextIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTextIndex((prev) => (prev + 1) % loadingTexts.length);
    }, 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background flex items-center justify-center z-50"
    >
      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-neon-cyan/20 blur-[100px]"
        />
        <motion.div
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
          className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-neon-magenta/20 blur-[100px]"
        />
      </div>

      <div className="relative z-10 text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="text-6xl mb-8"
        >
          ⚡
        </motion.div>
        
        <motion.p
          key={textIndex}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="font-display text-xl text-foreground"
        >
          {loadingTexts[textIndex]}
        </motion.p>

        <div className="mt-8 flex justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.2,
              }}
              className="w-3 h-3 rounded-full bg-primary"
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
};
