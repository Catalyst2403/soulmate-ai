import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles } from 'lucide-react';

interface StepLandingProps {
  email: string;
  onEmailChange: (email: string) => void;
  onNext: () => void;
}

export const StepLanding = ({ email, onEmailChange, onNext }: StepLandingProps) => {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.includes('@')) {
      onNext();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center min-h-screen px-6"
    >
      {/* Glowing orb background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-gradient-to-r from-neon-cyan/20 via-neon-purple/20 to-neon-magenta/20 blur-[120px]" />
      </div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="relative z-10 glass-card p-8 md:p-12 max-w-md w-full text-center"
      >
        {/* Floating emoji */}
        <motion.div
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="text-6xl mb-6"
        >
          🧬
        </motion.div>

        <h1 className="font-display text-3xl md:text-4xl font-bold mb-4 leading-tight">
          <span className="neon-text">Human connections</span>
          <br />
          <span className="text-foreground">are boring.</span>
        </h1>
        
        <p className="text-muted-foreground text-lg mb-8">
          Create your perfect chaos.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            placeholder="Enter your email to start magic ✨"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="text-center"
            required
          />
          
          <Button
            type="submit"
            variant="neon"
            size="xl"
            className="w-full group"
            disabled={!email.includes('@')}
          >
            <span>Let's Build</span>
            <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
          </Button>
        </form>
      </motion.div>
    </motion.div>
  );
};
