import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Camera } from 'lucide-react';
import GuestLoginModal from '@/components/riya/GuestLoginModal';
import QuickReplyButtons from '@/components/riya/QuickReplyButtons';
import { getGreetingByTime } from '@/utils/riyaGreetings';
import { ThemeToggle } from '@/components/ThemeToggle';

interface MessageWithTimestamp {
    text: string;
    isUser: boolean;
    timestamp: string;
}

const GUEST_MESSAGE_LIMIT = 25;

/**
 * Calculate realistic typing delay based on message length
 * ~50ms per character + base delay + random variance (±25%)
 */
const calculateTypingDelay = (message: string): number => {
    const BASE_DELAY = 800; // Minimum delay in ms (increased from 400)
    const MS_PER_CHAR = 50; // ~50ms per character (increased from 35)
    const VARIANCE = 0.25; // ±25% random variance

    const charDelay = message.length * MS_PER_CHAR;
    const baseTotal = BASE_DELAY + charDelay;
    const variance = baseTotal * VARIANCE * (Math.random() * 2 - 1);

    // Clamp between 1000ms and 6000ms (increased from 500-4000)
    return Math.min(6000, Math.max(1000, baseTotal + variance));
};

/**
 * Guest Chat Interface
 * Allows unauthenticated users to chat with Riya (10 message limit)
 * Shows login wall after limit is reached
 */
const RiyaGuestChat = () => {
    const [messages, setMessages] = useState<MessageWithTimestamp[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [guestSessionId, setGuestSessionId] = useState<string | null>(null);
    const [messageCount, setMessageCount] = useState(0);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [canCloseModal, setCanCloseModal] = useState(true); // Can close if triggered by camera, not if 10 msgs exhausted
    const [isInitialized, setIsInitialized] = useState(false);
    const [quickReplyOptions, setQuickReplyOptions] = useState<string[] | undefined>(undefined);
    const [pendingGreeting, setPendingGreeting] = useState<string | null>(null); // Greeting to save on first interaction

    // Message batching state (3.5s debounce for rapid messages)
    const [pendingMessages, setPendingMessages] = useState<string[]>([]);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isProcessingBatchRef = useRef(false);
    const DEBOUNCE_DELAY = 5000; // 5 seconds

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const navigate = useNavigate();

    // Scroll to bottom when input is focused (mobile keyboard opens)
    useEffect(() => {
        const inputEl = inputRef.current;
        if (!inputEl) return;

        const handleFocus = () => {
            // Scroll to bottom after keyboard opens
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 300);
        };

        inputEl.addEventListener('focus', handleFocus);
        return () => inputEl.removeEventListener('focus', handleFocus);
    }, []);

    // Scroll to bottom when messages change
    useEffect(() => {
        if (messages.length > 0) {
            requestAnimationFrame(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            });
        }
    }, [messages]);

    useEffect(() => {
        const init = async () => {
            // Check if already logged in
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                // Check if user has profile
                const { data: riyaUser } = await supabase
                    .from('riya_users')
                    .select('id')
                    .eq('google_id', session.user.id)
                    .maybeSingle();

                if (riyaUser) {
                    localStorage.setItem('riya_user_id', riyaUser.id);
                    navigate('/riya/chat');
                    return;
                }
            }

            // Get or create guest session
            let sessionId = localStorage.getItem('riya_guest_session_id');

            if (!sessionId) {
                // New guest - create session
                sessionId = crypto.randomUUID();
                localStorage.setItem('riya_guest_session_id', sessionId);

                // Create guest session record
                // @ts-ignore - Table exists after migration
                await supabase.from('riya_guest_sessions').insert({
                    session_id: sessionId,
                    message_count: 0,
                    user_agent: navigator.userAgent,
                });

                // Get time-based greeting
                const greeting = getGreetingByTime();

                // Don't save greeting to DB yet - wait for user interaction
                // Store it so we can save when user sends first message
                setPendingGreeting(greeting.text);

                // Show greeting in UI with dynamic typing delay
                setIsTyping(true);
                const greetingDelay = calculateTypingDelay(greeting.text);
                setTimeout(() => {
                    setMessages([{
                        text: greeting.text,
                        isUser: false,
                        timestamp: new Date().toISOString(),
                    }]);
                    setQuickReplyOptions(greeting.options);
                    setIsTyping(false);
                }, greetingDelay);
            } else {
                // Returning guest - load history
                const { data: history } = await supabase
                    .from('riya_conversations')
                    .select('*')
                    .eq('guest_session_id', sessionId)
                    .order('created_at', { ascending: true });

                if (history && history.length > 0) {
                    const formattedMessages = history.map(msg => ({
                        text: msg.content,
                        isUser: msg.role === 'user',
                        timestamp: msg.created_at,
                    }));
                    setMessages(formattedMessages);
                    setQuickReplyOptions(undefined); // Clear quick replies for returning users

                    // Count user messages
                    const userMsgCount = history.filter(m => m.role === 'user').length;
                    setMessageCount(userMsgCount);

                    // Check if already at limit
                    if (userMsgCount >= GUEST_MESSAGE_LIMIT) {
                        setCanCloseModal(false); // 10 msgs exhausted - must login
                        setShowLoginModal(true);
                    }
                } else {
                    // Session exists but no history (edge case) - show greeting
                    const greeting = getGreetingByTime();
                    // Don't save to DB yet - wait for user interaction
                    setPendingGreeting(greeting.text);

                    setMessages([{
                        text: greeting.text,
                        isUser: false,
                        timestamp: new Date().toISOString(),
                    }]);
                    setQuickReplyOptions(greeting.options);
                }
            }

            setGuestSessionId(sessionId);
            setIsInitialized(true);
        };

        init();
    }, [navigate]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    // Queue message and start/reset debounce timer
    const handleSend = async (messageText?: string) => {
        const text = messageText || inputMessage.trim();
        if (!text || !guestSessionId) return;

        // Check message limit
        if (messageCount >= GUEST_MESSAGE_LIMIT) {
            setCanCloseModal(false);
            setShowLoginModal(true);
            return;
        }

        setInputMessage('');

        // Add user message to UI immediately
        const userMsg: MessageWithTimestamp = {
            text,
            isUser: true,
            timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, userMsg]);

        // Add to pending queue
        setPendingMessages(prev => [...prev, text]);
        console.log(`📝 [Guest] Queued message: "${text.substring(0, 30)}..." (pending: ${pendingMessages.length + 1})`);

        // Clear existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Start new debounce timer
        debounceTimerRef.current = setTimeout(() => {
            processBatchedMessages();
        }, DEBOUNCE_DELAY);
    };

    // Process all queued messages as a batch
    const processBatchedMessages = async () => {
        if (isProcessingBatchRef.current || !guestSessionId) return;

        const messagesToSend: string[] = [];
        setPendingMessages(prev => {
            messagesToSend.push(...prev);
            return [];
        });

        await new Promise(r => setTimeout(r, 10));

        if (messagesToSend.length === 0) return;

        isProcessingBatchRef.current = true;
        setIsTyping(true);

        console.log(`🚀 [Guest] Processing batch of ${messagesToSend.length} message(s):`, messagesToSend);

        try {
            // Save pending greeting first if exists
            if (pendingGreeting) {
                // @ts-ignore
                await supabase.from('riya_conversations').insert({
                    guest_session_id: guestSessionId,
                    role: 'assistant',
                    content: pendingGreeting,
                });
                setPendingGreeting(null);
            }

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/riya-chat`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                    },
                    body: JSON.stringify({
                        guestSessionId,
                        messages: messagesToSend,
                        isBatch: messagesToSend.length > 1,
                        isGuest: true,
                    }),
                }
            );

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            if (!data.messages || !Array.isArray(data.messages)) {
                throw new Error('Invalid response from server');
            }

            // Update message count (count each message in batch)
            const newCount = messageCount + messagesToSend.length;
            setMessageCount(newCount);

            // Check if limit reached
            if (newCount >= GUEST_MESSAGE_LIMIT) {
                for (const msg of data.messages) {
                    const riyaMsg: MessageWithTimestamp = {
                        text: msg.text,
                        isUser: false,
                        timestamp: new Date().toISOString(),
                    };
                    setMessages(prev => [...prev, riyaMsg]);
                }
                setIsTyping(false);

                setTimeout(() => {
                    setCanCloseModal(false);
                    setShowLoginModal(true);
                }, 1500);
                return;
            }

            // Display responses with dynamic typing animation
            for (let i = 0; i < data.messages.length; i++) {
                setIsTyping(true);
                const typingDelay = calculateTypingDelay(data.messages[i].text || '');
                await new Promise(r => setTimeout(r, typingDelay));

                const riyaMsg: MessageWithTimestamp = {
                    text: data.messages[i].text,
                    isUser: false,
                    timestamp: new Date().toISOString(),
                };
                setMessages(prev => [...prev, riyaMsg]);
                setIsTyping(false);

                if (i < data.messages.length - 1) {
                    await new Promise(r => setTimeout(r, 200));
                }
            }
        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => prev.slice(0, -messagesToSend.length));
        } finally {
            setIsTyping(false);
            isProcessingBatchRef.current = false;
        }
    };

    const formatTime = (timestamp: string) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    if (!isInitialized) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="animate-pulse text-muted-foreground">Loading...</div>
            </div>
        );
    }

    return (
        <div className="mobile-chat-container">
            {/* Background pattern */}
            <div
                className="fixed inset-0 opacity-5 pointer-events-none"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300d4aa' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            />

            {/* Header */}
            <header className="chat-header glass-card rounded-none border-x-0 border-t-0 px-4 py-3 safe-area-top">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-neon-cyan/50">
                            <img
                                src="/riya-avatar.jpg"
                                alt="Riya"
                                className="w-full h-full object-cover"
                            />
                        </div>

                        <div className="flex flex-col">
                            <h2 className="font-display font-semibold text-foreground text-base leading-tight flex items-center gap-2">
                                Riya
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                                    Guest Mode
                                </span>
                            </h2>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                {isTyping ? 'typing...' : 'online'}
                                {/* Commented out: msgs left count
                                <span className="ml-1">• {GUEST_MESSAGE_LIMIT - messageCount} msgs left</span>
                                */}
                            </p>
                        </div>
                    </div>

                    {/* Theme Toggle + Login Button */}
                    <div className="flex items-center gap-2">
                        <ThemeToggle />
                        <button
                            onClick={() => {
                                setCanCloseModal(true);
                                setShowLoginModal(true);
                            }}
                            className="relative group flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-primary/20 to-green-500/20 border border-primary/40 hover:border-primary/60 transition-all duration-300 hover:shadow-[0_0_15px_rgba(0,212,170,0.3)]"
                        >
                            <span className="text-sm font-medium text-primary">Login</span>
                            <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-[10px] font-semibold text-green-400 border border-green-500/30">
                                FREE
                            </span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Messages */}
            <div className="chat-messages-area px-4 py-4 space-y-4 relative z-10">
                {/* Persistent Intro Card - Always visible at top of chat */}
                <div className="flex flex-col items-center justify-center py-6 mb-4">
                    <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-primary/30 shadow-lg mb-3">
                        <img
                            src="/riya-avatar.jpg"
                            alt="Riya"
                            className="w-full h-full object-cover"
                        />
                    </div>
                    <h3 className="text-base font-semibold text-foreground mb-1">Riya</h3>
                    <p className="text-xs text-muted-foreground text-center max-w-xs leading-relaxed">
                        Cute. Clingy. Yours. The girlfriend experience you actually deserve. 💕
                    </p>
                </div>


                {/* Chat Messages */}
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
                                className={`max-w-[80%] ${message.isUser ? 'chat-bubble-user' : 'chat-bubble-bot'}`}
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
                                            animate={{ y: [0, -5, 0] }}
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

            {/* Quick Reply Buttons (show only before user sends first message) */}
            {messages.length > 0 && messageCount === 0 && !isTyping && (
                <div className="px-4 py-2 z-40">
                    <QuickReplyButtons
                        onSelect={handleSend}
                        disabled={messageCount >= GUEST_MESSAGE_LIMIT}
                        options={quickReplyOptions}
                    />
                </div>
            )}

            {/* Input */}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                }}
                className="chat-input-area glass-card rounded-none border-x-0 border-b-0 px-4 py-3"
            >
                <div className="flex items-center gap-2">
                    {/* Camera button - shows login wall for guests */}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-pink-400 hover:text-pink-300 hover:bg-pink-500/10"
                        onClick={async () => {
                            // Track click for analytics
                            // @ts-ignore - Table exists after migration
                            const { error } = await supabase.from('riya_image_clicks').insert({
                                user_type: 'guest',
                                guest_session_id: guestSessionId,
                            });
                            if (error) {
                                console.error('📸 Image click tracking error:', error);
                            } else {
                                console.log('📸 Guest camera click tracked');
                            }

                            setCanCloseModal(true);
                            setShowLoginModal(true);
                        }}
                        title="Login to unlock photos 📸"
                    >
                        <Camera className="w-5 h-5" />
                    </Button>

                    <textarea
                        ref={inputRef}
                        value={inputMessage}
                        onChange={(e) => {
                            setInputMessage(e.target.value);
                            // Auto-resize textarea
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        placeholder={messageCount >= GUEST_MESSAGE_LIMIT ? "Login to continue..." : "Type a message..."}
                        className="flex-1 bg-muted/30 border-0 focus-visible:ring-1 focus-visible:ring-ring rounded-md px-3 py-2 text-sm resize-none overflow-hidden min-h-[40px] max-h-[100px]"
                        disabled={messageCount >= GUEST_MESSAGE_LIMIT}
                        rows={1}
                    />

                    <Button
                        type="submit"
                        variant="glow"
                        size="icon"
                        disabled={!inputMessage.trim() || messageCount >= GUEST_MESSAGE_LIMIT}
                        className="shrink-0"
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
            </form>

            {/* Login Modal */}
            <GuestLoginModal
                isOpen={showLoginModal}
                onClose={() => setShowLoginModal(false)}
                guestSessionId={guestSessionId || ''}
                canClose={canCloseModal}
            />
        </div>
    );
};

export default RiyaGuestChat;
