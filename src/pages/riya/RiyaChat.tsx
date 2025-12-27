import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { Send, LogOut } from 'lucide-react';

interface Message {
    text: string;
    isUser: boolean;
}

/**
 * Riya Chat Interface
 * Main chat page for conversations with Riya
 */
const RiyaChat = () => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [userName, setUserName] = useState('');
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
                }));
                setMessages(formattedMessages);
            } else {
                // Add initial greeting if no history
                setMessages([
                    {
                        text: `hey ${user?.username || 'there'}! 👋\n\nkaise ho? ready to chat?`,
                        isUser: false,
                    },
                ]);
            }
        };

        init();
    }, [navigate]);

    useEffect(() => {
        // Scroll to bottom when messages change
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async () => {
        if (!inputMessage.trim() || isLoading) return;

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
        setIsLoading(true);

        // Add user message to UI
        setMessages(prev => [...prev, { text: userMessage, isUser: true }]);

        try {
            // Call Riya chat edge function
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const response = await fetch(`${supabaseUrl}/functions/v1/riya-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                },
                body: JSON.stringify({
                    userId,
                    message: userMessage,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to get response');
            }

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            // Add Riya's messages to UI
            const riyaMessages = data.messages.map((msg: { text: string }) => ({
                text: msg.text,
                isUser: false,
            }));

            setMessages(prev => [...prev, ...riyaMessages]);
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
            setIsLoading(false);
        }
    };

    const handleSignOut = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('riya_user_id');
        navigate('/riya');
    };

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-br from-purple-50 to-pink-50 dark:from-gray-900 dark:to-purple-900">
            {/* Header */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold">
                            R
                        </div>
                        <div>
                            <h1 className="font-semibold text-gray-900 dark:text-white">Riya</h1>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Online</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={handleSignOut}>
                        <LogOut className="h-5 w-5" />
                    </Button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="max-w-4xl mx-auto space-y-4">
                    {messages.map((message, index) => (
                        <div
                            key={index}
                            className={`flex ${message.isUser ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`max-w-[70%] rounded-2xl px-4 py-2 ${message.isUser
                                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                                    }`}
                            >
                                <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white dark:bg-gray-800 rounded-2xl px-4 py-3 shadow-sm">
                                <div className="flex gap-1">
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input */}
            <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
                <div className="max-w-4xl mx-auto flex gap-2">
                    <Input
                        placeholder="Type your message..."
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                        disabled={isLoading}
                        className="flex-1"
                    />
                    <Button
                        onClick={handleSend}
                        disabled={isLoading || !inputMessage.trim()}
                        className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    >
                        <Send className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default RiyaChat;
