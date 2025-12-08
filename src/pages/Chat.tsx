import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { LoadingScreen } from '@/components/onboarding/LoadingScreen';
import { Message, Persona } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { generateSystemPromptFromPersona, SYSTEM_PROMPT_VERSION } from '@/utils/systemPrompt';


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

      // Regenerate system prompt with latest version
      const updatedSystemPrompt = generateSystemPromptFromPersona(personaData as unknown as Persona);

      // Check if system prompt needs updating
      const needsUpdate = personaData.system_prompt !== updatedSystemPrompt;

      if (needsUpdate) {
        // Update the system prompt in database
        const { error: updateError } = await supabase
          .from('personas')
          .update({ system_prompt: updatedSystemPrompt })
          .eq('user_id', uid);

        if (updateError) {
          console.error('❌ Failed to update system prompt:', updateError);
        } else {
          console.log('✅ System prompt updated');
          // Update the local persona object
          personaData.system_prompt = updatedSystemPrompt;
        }
      }

      setPersona(personaData as Persona);

      // Check if initial greeting needs to be sent
      if (!personaData.initial_greeting_sent) {
        console.log('👋 Sending initial greeting message...');

        // Dynamically import the greeting utility
        const { getInitialGreeting } = await import('@/utils/greetingMessages');

        // Get the appropriate greeting message
        const greetingMessage = getInitialGreeting(
          personaData.relationship,
          personaData.lore
        );

        console.log('Greeting message:', greetingMessage);

        // Insert the greeting message as an assistant message
        const { error: greetingError } = await supabase
          .from('messages')
          .insert({
            user_id: uid,
            role: 'assistant',
            content: greetingMessage,
          });

        if (greetingError) {
          console.error('Failed to send greeting message:', greetingError);
        } else {
          // Update the persona to mark greeting as sent
          const { error: updateGreetingError } = await supabase
            .from('personas')
            .update({ initial_greeting_sent: true })
            .eq('user_id', uid);

          if (updateGreetingError) {
            console.error('Failed to update greeting flag:', updateGreetingError);
          } else {
            console.log('✅ Initial greeting sent successfully!');
            // Update local persona object
            personaData.initial_greeting_sent = true;
          }
        }
      }

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

      // Check for errors from the Edge Function
      if (error) {
        console.error('❌ Edge Function Error:', error.message || error);
        throw error;
      }

      // Check if response contains an error message (from our custom error handling)
      if (data?.error) {
        console.error('❌ API Error:', data.error);

        // Display the user-friendly error message from backend
        toast({
          title: 'Error from AI',
          description: data.error,
          variant: 'destructive',
        });
        return; // Exit early, don't try to process messages
      }

      // Handle multi-message response
      const responseMessages = data?.messages || [{ text: data?.reply || 'Aree yaar, kuch gadbad ho gaya!' }];

      // Configurable delay between messages (in milliseconds)
      const MESSAGE_DELAY_MS = 2000;

      // Send each message sequentially with typing indicator
      for (let i = 0; i < responseMessages.length; i++) {
        // Show typing indicator before each message
        setIsTyping(true);

        // Wait before sending message (simulate typing)
        await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));

        // Save AI response to DB (realtime subscription will add it to state)
        await supabase.from('messages').insert({
          user_id: userId,
          role: 'assistant',
          content: responseMessages[i].text,
        });

        // Brief pause to hide typing indicator and let UI update
        setIsTyping(false);

        // Small gap between messages (except after the last one)
        if (i < responseMessages.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    } catch (error: any) {
      console.error('❌ Chat Error:', error?.message || error);

      toast({
        title: 'Error',
        description: error?.message || 'Failed to get response. Please try again.',
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
