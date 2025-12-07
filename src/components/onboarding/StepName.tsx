import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Zap } from 'lucide-react';

interface StepNameProps {
  name: string;
  onNameChange: (name: string) => void;
  onComplete: () => void;
  isLoading: boolean;
}

export const StepName = ({ name, onNameChange, onComplete, isLoading }: StepNameProps) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
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
      <div className="max-w-md w-full">
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
            🏷️
          </motion.span>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-foreground">
            Almost alive.
            <br />
            <span className="neon-text">What do we call them?</span>
          </h2>
        </motion.div>

        <motion.form
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          onSubmit={handleSubmit}
          className="glass-card p-8 space-y-6"
        >
          <Input
            type="text"
            placeholder="Name your human..."
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="text-center text-xl h-14"
            required
          />

          <Button
            type="submit"
            variant="neon"
            size="xl"
            className="w-full group"
            disabled={!name.trim() || isLoading}
          >
            {isLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                ⚡
              </motion.div>
            ) : (
              <>
                <span>WAKE THEM UP</span>
                <Zap className="w-5 h-5 group-hover:animate-pulse" />
              </>
            )}
          </Button>
        </motion.form>
      </div>
    </motion.div>
  );
};
