import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { LoadingScreen } from '@/components/onboarding/LoadingScreen';
import { Message, Persona } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const Chat = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const storedUserId = localStorage.getItem('soulmate_user_id');

    if (!storedUserId) {
      navigate('/');
      return;
    }

    setUserId(storedUserId);
    loadUserData(storedUserId);
  }, [navigate]);

  // Subscribe to new messages
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('messages-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const loadUserData = async (uid: string) => {
    try {
      // Load persona
      const { data: personaData, error: personaError } = await supabase
        .from('personas')
        .select('*')
        .eq('user_id', uid)
        .maybeSingle();

      if (personaError) throw personaError;

      if (!personaData) {
        navigate('/');
        return;
      }

      setPersona(personaData as Persona);

      // Load messages
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('user_id', uid)
        .order('timestamp', { ascending: true });

      if (messagesError) throw messagesError;

      setMessages((messagesData as Message[]) || []);
      setIsLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load chat data.',
        variant: 'destructive',
      });
      navigate('/');
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!userId || !persona) return;

    // Save user message to DB (realtime subscription will add it to state)
    const { error: saveError } = await supabase
      .from('messages')
      .insert({
        user_id: userId,
        role: 'user',
        content,
      });

    if (saveError) {
      console.error('Error saving message:', saveError);
      toast({
        title: 'Error',
        description: 'Failed to send message. Please try again.',
        variant: 'destructive',
      });
      return;
    }

    // Show typing indicator
    setIsTyping(true);

    try {
      // Prepare conversation history (last 10 messages for context)
      const conversationHistory = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      conversationHistory.push({ role: 'user', content });

      // Call AI edge function
      const { data, error } = await supabase.functions.invoke('chat', {
        body: {
          messages: conversationHistory,
          systemPrompt: persona.system_prompt,
        },
      });

      if (error) throw error;

      const aiReply = data?.reply || 'Aree yaar, kuch gadbad ho gaya!';

      // Save AI response to DB (realtime subscription will add it to state)
      await supabase.from('messages').insert({
        user_id: userId,
        role: 'assistant',
        content: aiReply,
      });
    } catch (error) {
      console.error('Error getting AI response:', error);
      toast({
        title: 'Error',
        description: 'Failed to get response. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsTyping(false);
    }
  };

  if (isLoading || !persona || !userId) {
    return <LoadingScreen />;
  }

  return (
    <ChatInterface
      userId={userId}
      persona={persona}
      messages={messages}
      onSendMessage={handleSendMessage}
      isTyping={isTyping}
    />
  );
};

export default Chat;
