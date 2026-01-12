import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/hooks/use-toast';
import { Send, ArrowLeft, MoreVertical, Settings, LogOut, Crown, Zap } from 'lucide-react';
import PaywallModal from '@/components/riya/PaywallModal';
import SoftPaywallBanner from '@/components/riya/SoftPaywallBanner';
import RiyaProfile from './RiyaProfile';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

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
    const [userAge, setUserAge] = useState(22);
    const [userGender, setUserGender] = useState<'male' | 'female' | 'other'>('male');
    const [showLogoutDialog, setShowLogoutDialog] = useState(false);
    const [showSettingsDialog, setShowSettingsDialog] = useState(false);
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
    const [showProfile, setShowProfile] = useState(false);

    // Subscription & limits state
    const [isPro, setIsPro] = useState(false);
    const [remainingProMessages, setRemainingProMessages] = useState(20);  // Pro-quality messages remaining
    const [usingFreeModel, setUsingFreeModel] = useState(false);           // True after 20 msgs
    const [showPaywall, setShowPaywall] = useState(false);                 // Hard limit paywall (200 msgs)
    const [showSoftPaywall, setShowSoftPaywall] = useState(false);         // Soft paywall (after 20 msgs)
    const [paywallResetTime, setPaywallResetTime] = useState<string | undefined>();

    // Settings form state
    const [editUsername, setEditUsername] = useState('');
    const [editAge, setEditAge] = useState(22);
    const [editGender, setEditGender] = useState<'male' | 'female' | 'other'>('male');

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
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
                .select('username, user_age, user_gender')
                .eq('id', userId)
                .single();

            if (user) {
                setUserName(user.username);
                setUserAge(user.user_age);
                setUserGender(user.user_gender as 'male' | 'female' | 'other');

                // Initialize edit form with current values
                setEditUsername(user.username);
                setEditAge(user.user_age);
                setEditGender(user.user_gender as 'male' | 'female' | 'other');
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

            // Check subscription status
            // @ts-ignore - Table exists after migration
            const { data: subscription } = await supabase
                .from('riya_subscriptions')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'active')
                .gte('expires_at', new Date().toISOString())
                .single();

            if (subscription) {
                setIsPro(true);
                setRemainingProMessages(-1); // Unlimited for Pro
            } else {
                // Get today's message usage
                const today = new Date().toISOString().split('T')[0];
                // @ts-ignore - Table exists after migration
                const { data: usage } = await supabase
                    .from('riya_daily_usage')
                    .select('message_count')
                    .eq('user_id', userId)
                    .eq('usage_date', today)
                    .single();

                const used = usage?.message_count || 0;
                // Calculate remaining Pro-quality messages (first 20)
                setRemainingProMessages(Math.max(0, 20 - used));
                // Check if already using free model
                if (used >= 20) {
                    setUsingFreeModel(true);
                }
            }
        };

        init();
    }, [navigate]);

    useEffect(() => {
        // Scroll to bottom when messages change
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    useEffect(() => {
        // Auto-focus input when user starts typing anywhere on the page
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't focus if already focused, or if it's a special key
            if (document.activeElement === inputRef.current) return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            if (e.key === 'Escape' || e.key === 'Tab' || e.key === 'Enter') return;

            // Focus the input for any printable character
            if (e.key.length === 1) {
                inputRef.current?.focus();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleSend = async () => {
        if (!inputMessage.trim()) return;

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
            console.log('🚀 [Tiered Model] Sending message...', { userId, isPro, remainingProMessages, usingFreeModel });

            // Use direct fetch to handle 429 responses properly
            // supabase.functions.invoke doesn't expose response body on error
            const session = (await supabase.auth.getSession()).data.session;
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

            const response = await fetch(`${supabaseUrl}/functions/v1/riya-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token || ''}`,
                },
                body: JSON.stringify({
                    userId,
                    message: userMessage,
                }),
            });

            const data = await response.json();
            console.log('📥 [Tiered Model Debug] Response received:', {
                isPro: data.isPro,
                remainingProMessages: data.remainingProMessages,
                usingFreeModel: data.usingFreeModel,
                modelUsed: data.modelUsed,
                hasError: !!data.error
            });

            // Handle SOFT_LIMIT_REACHED (200 msgs/day cap)
            if (data?.error === 'SOFT_LIMIT_REACHED') {
                console.warn('❌ Soft daily limit reached! Showing paywall');
                setPaywallResetTime(data.resetsAt);
                setShowPaywall(true);
                setRemainingProMessages(0);
                setMessages(prev => prev.slice(0, -1));
                setIsTyping(false);
                return;
            }

            // Handle rate limiting
            if (data?.error === 'RATE_LIMITED') {
                console.warn('🚫 Rate limited! Slow down');
                toast({
                    title: 'Slow down!',
                    description: 'You\'re sending messages too fast. Please wait a moment.',
                    variant: 'destructive',
                });
                setMessages(prev => prev.slice(0, -1));
                setIsTyping(false);
                return;
            }

            // Handle other errors
            if (!response.ok || data?.error) {
                console.error('API error:', data?.error || response.statusText);
                throw new Error(data?.error || 'Failed to get response');
            }

            if (!data?.messages || !Array.isArray(data.messages)) {
                console.error('Invalid response format:', data);
                throw new Error('Invalid response from server');
            }

            // Update Pro messages remaining and free model status
            if (typeof data.remainingProMessages === 'number') {
                setRemainingProMessages(data.remainingProMessages);
            }
            if (typeof data.isPro === 'boolean') {
                setIsPro(data.isPro);
            }

            // Check if switched to free model for first time - show soft paywall
            if (data.usingFreeModel && !usingFreeModel && !isPro) {
                console.log('📉 Switched to free model - showing soft paywall');
                setUsingFreeModel(true);
                setShowSoftPaywall(true);
            }

            // ============================================
            // FRONTEND FALLBACK PARSER
            // Handle cases where backend sends a single message containing raw JSON text
            // ============================================
            let processedMessages = data.messages;

            // Check if we got a single message that looks like raw JSON
            if (processedMessages.length === 1) {
                const singleMsg = processedMessages[0].text;

                // Check if it looks like JSON objects (starts with {" and contains "text":)
                if (singleMsg.includes('{"text":') || singleMsg.includes("{\"text\":")) {
                    console.log('🔍 Frontend: Detected raw JSON in message, attempting to parse...');

                    try {
                        // Try multiple parsing strategies
                        let parsedMessages = [];

                        // Strategy 1: Direct JSON.parse (in case it's valid)
                        try {
                            const parsed = JSON.parse(singleMsg);
                            if (Array.isArray(parsed) && parsed.every(m => m.text)) {
                                parsedMessages = parsed;
                                console.log('✅ Frontend: Parsed as valid JSON array');
                            }
                        } catch (e) {
                            // Continue to fallback strategies
                        }

                        // Strategy 2: Regex extraction (for malformed JSON with escaped quotes, etc.)
                        if (parsedMessages.length === 0) {
                            // Extract all {"text":"..."} patterns, handling escaped quotes
                            // This regex captures the text content even if there are escaped quotes inside
                            const messageRegex = /\{"text"\s*:\s*"((?:[^"\\]|\\.)*)"\}/g;
                            let match;
                            const extracted = [];

                            while ((match = messageRegex.exec(singleMsg)) !== null) {
                                // Unescape the content: \" -> "
                                const unescapedText = match[1]
                                    .replace(/\\"/g, '"')
                                    .replace(/\\\\/g, '\\')
                                    .replace(/\\n/g, '\n')
                                    .replace(/\\t/g, '\t');

                                extracted.push({ text: unescapedText });
                            }

                            if (extracted.length > 0) {
                                parsedMessages = extracted;
                                console.log(`✅ Frontend: Extracted ${extracted.length} messages using regex`);
                            }
                        }

                        // If we successfully extracted messages, use them
                        if (parsedMessages.length > 0) {
                            processedMessages = parsedMessages;
                            console.log('🎉 Frontend fallback parsing succeeded!');
                        }
                    } catch (parseError) {
                        console.log('⚠️ Frontend: Fallback parsing failed, using original message');
                    }
                }
            }

            // Configurable delay between burst messages (in milliseconds)
            const MESSAGE_DELAY_MS = 1500;

            // Display each message sequentially with typing animation
            for (let i = 0; i < processedMessages.length; i++) {
                // Show typing indicator before each message
                setIsTyping(true);

                // Wait to simulate typing
                await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));

                // Add message with timestamp
                const riyaMsg: MessageWithTimestamp = {
                    text: processedMessages[i].text,
                    isUser: false,
                    timestamp: new Date().toISOString(),
                };

                setMessages(prev => [...prev, riyaMsg]);

                // Brief pause to hide typing indicator
                setIsTyping(false);

                // Small gap between messages (except after the last one)
                if (i < processedMessages.length - 1) {
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

    const handleUpdateProfile = async () => {
        // Validation
        if (!editUsername.trim()) {
            toast({
                title: 'Username required',
                description: 'Please enter your username',
                variant: 'destructive',
            });
            return;
        }

        if (editAge < 1 || editAge > 70) {
            toast({
                title: 'Invalid age',
                description: 'Please select an age between 1 and 70',
                variant: 'destructive',
            });
            return;
        }

        setIsUpdatingProfile(true);

        try {
            const userId = localStorage.getItem('riya_user_id');
            if (!userId) {
                throw new Error('User ID not found');
            }

            // Update profile in database
            const { error } = await supabase
                .from('riya_users')
                .update({
                    username: editUsername.trim(),
                    user_age: editAge,
                    user_gender: editGender,
                })
                .eq('id', userId);

            if (error) {
                console.error('Error updating profile:', error);
                throw new Error('Failed to update profile');
            }

            // Update local state
            setUserName(editUsername.trim());
            setUserAge(editAge);
            setUserGender(editGender);

            toast({
                title: 'Profile updated! ✨',
            });

            setShowSettingsDialog(false);
        } catch (error) {
            console.error('Profile update error:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to update profile',
                variant: 'destructive',
            });
        } finally {
            setIsUpdatingProfile(false);
        }
    };

    const formatTime = (timestamp: string) => {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <div className="flex flex-col h-[100dvh] bg-background">
            {/* WhatsApp-style background pattern */}
            <div
                className="fixed inset-0 opacity-5 pointer-events-none"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300d4aa' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            />

            {/* Fixed Header */}
            <header className="fixed top-0 left-0 right-0 z-50 glass-card rounded-none border-x-0 border-t-0 px-4 py-3">
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

                        {/* Clickable Profile Section */}
                        <div
                            className="flex items-center gap-3 cursor-pointer hover:bg-muted/30 rounded-lg px-2 py-1 -ml-2 transition-colors"
                            onClick={() => setShowProfile(true)}
                        >
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
                                    {isPro && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-yellow-500 to-orange-500 text-[10px] font-bold text-white">
                                            <Crown className="w-3 h-3" />
                                            PRO
                                        </span>
                                    )}
                                    {!isPro && usingFreeModel && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                                            <Zap className="w-3 h-3" />
                                            Lite
                                        </span>
                                    )}
                                </h2>
                                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                    {isTyping ? 'typing...' : 'online'}
                                    {isPro && !isTyping && (
                                        <span className="text-yellow-400 ml-1">• ∞ Unlimited</span>
                                    )}
                                    {!isPro && !isTyping && remainingProMessages > 0 && (
                                        <span className="text-muted-foreground ml-1">• {remainingProMessages} Pro left</span>
                                    )}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Pro upgrade button - only show for free users */}
                        {!isPro && (
                            <Button
                                onClick={() => navigate('/riya/pricing')}
                                variant="outline"
                                size="sm"
                                className="h-8 px-3 border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10"
                            >
                                <Crown className="w-4 h-4 mr-1" />
                                Buy Pro
                            </Button>
                        )}

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <MoreVertical className="w-5 h-5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    onClick={() => setShowSettingsDialog(true)}
                                    className="cursor-pointer"
                                >
                                    <Settings className="w-4 h-4 mr-2" />
                                    Settings
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => setShowLogoutDialog(true)}
                                    className="cursor-pointer text-destructive focus:text-destructive"
                                >
                                    <LogOut className="w-4 h-4 mr-2" />
                                    Logout
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </header>

            {/* Messages - with padding for fixed header and input */}
            <div className="flex-1 overflow-y-auto px-4 pt-20 pb-24 space-y-4 relative z-10">
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

            {/* Fixed Input at bottom */}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                }}
                className="fixed bottom-0 left-0 right-0 z-50 glass-card rounded-none border-x-0 border-b-0 px-4 py-3 safe-area-bottom"
            >
                <div className="flex items-center gap-2">
                    <Input
                        ref={inputRef}
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1 bg-muted/30 border-0 focus-visible:ring-1"
                    />

                    <Button
                        type="submit"
                        variant="glow"
                        size="icon"
                        disabled={!inputMessage.trim()}
                        className="shrink-0"
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                </div>
            </form>

            {/* Settings Dialog */}
            <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Profile Settings</DialogTitle>
                        <DialogDescription>
                            Update your profile. These changes will affect how Riya interacts with you.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5 py-4">
                        {/* Username */}
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                                Name
                            </label>
                            <Input
                                placeholder="Your name"
                                value={editUsername}
                                onChange={(e) => setEditUsername(e.target.value)}
                                className="w-full bg-muted/30 border-border"
                                disabled={isUpdatingProfile}
                            />
                        </div>

                        {/* Age */}
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                                Age
                            </label>
                            <div className="space-y-4">
                                <div className="text-center">
                                    <span className="text-4xl font-bold text-primary">{editAge}</span>
                                    <span className="text-lg text-muted-foreground ml-1">years</span>
                                </div>
                                <Slider
                                    value={[editAge]}
                                    onValueChange={(values) => setEditAge(values[0])}
                                    min={0}
                                    max={70}
                                    step={1}
                                    className="w-full"
                                    disabled={isUpdatingProfile}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>0</span>
                                    <span>70</span>
                                </div>
                            </div>
                        </div>

                        {/* Gender */}
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-2">
                                Gender
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                <Button
                                    type="button"
                                    variant={editGender === 'male' ? 'glow' : 'outline'}
                                    onClick={() => setEditGender('male')}
                                    disabled={isUpdatingProfile}
                                    className="w-full"
                                >
                                    Male
                                </Button>
                                <Button
                                    type="button"
                                    variant={editGender === 'female' ? 'glow' : 'outline'}
                                    onClick={() => setEditGender('female')}
                                    disabled={isUpdatingProfile}
                                    className="w-full"
                                >
                                    Female
                                </Button>
                                <Button
                                    type="button"
                                    variant={editGender === 'other' ? 'glow' : 'outline'}
                                    onClick={() => setEditGender('other')}
                                    disabled={isUpdatingProfile}
                                    className="w-full"
                                >
                                    Other
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setShowSettingsDialog(false)}
                            disabled={isUpdatingProfile}
                            className="flex-1"
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="glow"
                            onClick={handleUpdateProfile}
                            disabled={isUpdatingProfile}
                            className="flex-1"
                        >
                            {isUpdatingProfile ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Logout Confirmation Dialog */}
            <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Logout Confirmation</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to logout? You can always come back by signing in.
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

            {/* Hard Paywall Modal (200 msgs limit) */}
            <PaywallModal
                isOpen={showPaywall}
                onClose={() => setShowPaywall(false)}
            />

            {/* Soft Paywall Banner (after 20 Pro msgs) */}
            <SoftPaywallBanner
                isOpen={showSoftPaywall}
                onClose={() => setShowSoftPaywall(false)}
            />

            {/* Profile Page */}
            {showProfile && (
                <RiyaProfile
                    age={userAge}
                    onClose={() => setShowProfile(false)}
                />
            )}
        </div>
    );
};

export default RiyaChat;

