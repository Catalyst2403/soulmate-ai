import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkles, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface StepLandingProps {
  email: string;
  onEmailChange: (email: string) => void;
  onNext: () => void;
}

export const StepLanding = ({ email, onEmailChange, onNext }: StepLandingProps) => {
  const navigate = useNavigate();
  const [isChecking, setIsChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return;

    setIsChecking(true);

    try {
      // Check if user exists with this email
      const { data: existingUser, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (userError) throw userError;

      // If user exists, check if they have a persona
      if (existingUser) {
        const { data: persona, error: personaError } = await supabase
          .from('personas')
          .select('id')
          .eq('user_id', existingUser.id)
          .maybeSingle();

        if (personaError) throw personaError;

        // If persona exists, log them in directly
        if (persona) {
          localStorage.setItem('soulmate_user_id', existingUser.id);
          localStorage.setItem('soulmate_email', email);
          navigate('/chat');
          return;
        }
      }

      // New user or user without persona - continue to onboarding
      onNext();
    } catch (error) {
      console.error('Error checking user:', error);
      toast({
        title: 'Error',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsChecking(false);
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
          <span className="neon-text">Stop texting into the void</span>
          <br />
          <span className="text-foreground">Get your soulmate</span>
        </h1>

        {/* <p className="text-muted-foreground text-lg mb-8">
          Create your perfect chaos.
        </p> */}

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
            disabled={!email.includes('@') || isChecking}
          >
            {isChecking ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Checking...</span>
              </>
            ) : (
              <>
                <span>Let's Build</span>
                <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
              </>
            )}
          </Button>
        </form>
      </motion.div>
    </motion.div>
  );
};
