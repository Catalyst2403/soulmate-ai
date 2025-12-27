import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { Send, ArrowLeft, LogOut } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface MessageWithTimestamp {
    text: string;
    isUser: boolean;
    timestamp: string;
}

/**
 * Riya Chat Interface
 * Main chat page for conversations with Riya
 * Matches core soulmate product UI with dark theme and WhatsApp-style bubbles
 */
const RiyaChat = () => {
    const [messages, setMessages] = useState<MessageWithTimestamp[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [userName, setUserName] = useState('');
    const [showLogoutDialog, setShowLogoutDialog] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const init = async () => {
            const userId = localStorage.getItem('riya_user_id');

            if (!userId) {
                navigate('/riya');
                return;
            }

            // Fetch user details
            const { data: user } = await supabase
                .from('riya_users')
                .select('username')
                .eq('id', userId)
                .single();

            if (user) {
                setUserName(user.username);
            }

            // Load conversation history
            const { data: history } = await supabase
                .from('riya_conversations')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: true });

            if (history && history.length > 0) {
                const formattedMessages = history.map(msg => ({
                    text: msg.content,
                    isUser: msg.role === 'user',
                    timestamp: msg.created_at,
                }));
                setMessages(formattedMessages);
            } else {
                // Add initial greeting if no history
                setMessages([
                    {
                        text: `hey ${user?.username || 'there'}! 👋\n\nkaise ho? ready to chat?`,
                        isUser: false,
                        timestamp: new Date().toISOString(),
                    },
                ]);
            }
        };

        init();
    }, [navigate]);

    useEffect(() => {
        // Scroll to bottom when messages change
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    const handleSend = async () => {
        if (!inputMessage.trim() || isTyping) return;

        const userId = localStorage.getItem('riya_user_id');
        if (!userId) {
            toast({
                title: 'Error',
                description: 'Session expired. Please sign in again.',
                variant: 'destructive',
            });
            navigate('/riya');
            return;
        }

        const userMessage = inputMessage.trim();
        setInputMessage('');
        setIsTyping(true);

        // Add user message to UI
        const userMsgWithTimestamp: MessageWithTimestamp = {
            text: userMessage,
            isUser: true,
            timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, userMsgWithTimestamp]);

        try {
            // Call Riya chat edge function using Supabase client
            const { data, error: functionError } = await supabase.functions.invoke('riya-chat', {
                body: {
                    userId,
                    message: userMessage,
                },
            });

            if (functionError) {
                console.error('Edge function error:', functionError);
                throw new Error(functionError.message || 'Failed to get response');
            }

            if (data?.error) {
                console.error('API error:', data.error);
                throw new Error(data.error);
            }

            if (!data?.messages || !Array.isArray(data.messages)) {
                console.error('Invalid response format:', data);
                throw new Error('Invalid response from server');
            }

            // Configurable delay between burst messages (in milliseconds)
            const MESSAGE_DELAY_MS = 1500;

            // Display each message sequentially with typing animation
            for (let i = 0; i < data.messages.length; i++) {
                // Show typing indicator before each message
                setIsTyping(true);

                // Wait to simulate typing
                await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));

                // Add message with timestamp
                const riyaMsg: MessageWithTimestamp = {
                    text: data.messages[i].text,
                    isUser: false,
                    timestamp: new Date().toISOString(),
                };

                setMessages(prev => [...prev, riyaMsg]);

                // Brief pause to hide typing indicator
                setIsTyping(false);

                // Small gap between messages (except after the last one)
                if (i < data.messages.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }
        } catch (error) {
            console.error('Chat error:', error);
            toast({
                title: 'Error',
                description: 'Failed to send message. Please try again.',
                variant: 'destructive',
            });
            // Remove user message on error
            setMessages(prev => prev.slice(0, -1));
        } finally {
            setIsTyping(false);
        }
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('riya_user_id');
        navigate('/riya');
    };

    const formatTime = (timestamp: string) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* WhatsApp-style background pattern */}
            <div
                className="fixed inset-0 opacity-5 pointer-events-none"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300d4aa' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            />

            {/* Header */}
            <div className="relative z-10 glass-card rounded-none border-x-0 border-t-0 px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate('/riya')}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>

                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neon-cyan to-neon-magenta flex items-center justify-center text-lg">
                            R
                        </div>

                        <div className="flex flex-col">
                            <h2 className="font-display font-semibold text-foreground text-base leading-tight">
                                Riya
                            </h2>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                {isTyping ? 'typing...' : 'Online'}
                            </p>
                        </div>
                    </div>

                    <Button
                        variant="outline"
                        size="icon"
                        className="text-destructive border-destructive/50 hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => setShowLogoutDialog(true)}
                        title="Logout"
                    >
                        <LogOut className="w-5 h-5" />
                    </Button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 relative z-10">
                <AnimatePresence>
                    {messages.map((message, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.3 }}
                            className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`max-w-[80%] ${message.isUser ? 'chat-bubble-user' : 'chat-bubble-bot'
                                    }`}
                            >
                                <p className="text-sm text-foreground whitespace-pre-wrap">
                                    {message.text}
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-1 text-right">
                                    {formatTime(message.timestamp)}
                                </p>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {/* Typing indicator */}
                <AnimatePresence>
                    {isTyping && (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="flex justify-start"
                        >
                            <div className="chat-bubble-bot">
                                <div className="flex gap-1">
                                    {[0, 1, 2].map((i) => (
                                        <motion.div
                                            key={i}
                                            animate={{
                                                y: [0, -5, 0],
                                            }}
                                            transition={{
                                                duration: 0.5,
                                                repeat: Infinity,
                                                delay: i * 0.15,
                                            }}
                                            className="w-2 h-2 rounded-full bg-muted-foreground"
                                        />
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                }}
                className="relative z-10 glass-card rounded-none border-x-0 border-b-0 px-4 py-3"
            >
                <div className="flex items-center gap-2">
                    <Input
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1 bg-muted/30 border-0 focus-visible:ring-1"
                        disabled={isTyping}
                    />

                    <Button
                        type="submit"
                        variant="glow"
                        size="icon"
                        disabled={!inputMessage.trim() || isTyping}
                        className="shrink-0"
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
            </form>

            {/* Logout Confirmation Dialog */}
            <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Logout Confirmation</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to logout? You can always come back by signing in with Google.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSignOut} className="bg-destructive hover:bg-destructive/90">
                            Logout
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default RiyaChat;
