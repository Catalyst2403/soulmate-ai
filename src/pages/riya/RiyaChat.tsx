import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/hooks/use-toast';
import { Send, ArrowLeft, MoreVertical, Settings, LogOut, Crown, Zap, Camera, Lock, X } from 'lucide-react';
import PaywallModal from '@/components/riya/PaywallModal';
import SoftPaywallBanner from '@/components/riya/SoftPaywallBanner';
import QuickReplyButtons from '@/components/riya/QuickReplyButtons';
import { getGreetingByTime } from '@/utils/riyaGreetings';
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
    image?: {
        url: string;
        description: string;
        category: string;
        is_blurred: boolean;
        is_premium: boolean;
    };
}

/**
 * Riya Chat Interface
 * Main chat page for conversations with Riya
 * Matches core soulmate product UI with dark theme and WhatsApp-style bubbles
 */
/**
 * Calculate realistic typing delay based on message length
 * ~40ms per character + base delay + random variance (±20%)
 */
const calculateTypingDelay = (message: string): number => {
    const BASE_DELAY = 400; // Minimum delay in ms
    const MS_PER_CHAR = 35; // ~35ms per character (realistic typing)
    const VARIANCE = 0.2; // ±20% random variance

    const charDelay = message.length * MS_PER_CHAR;
    const baseTotal = BASE_DELAY + charDelay;

    // Add random variance for human feel
    const variance = baseTotal * VARIANCE * (Math.random() * 2 - 1);

    // Clamp between 500ms and 4000ms
    return Math.min(4000, Math.max(500, baseTotal + variance));
};

const RiyaChat = () => {
    const [messages, setMessages] = useState<MessageWithTimestamp[]>([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [userName, setUserName] = useState('');
    const [userEmail, setUserEmail] = useState('');
    const [userAge, setUserAge] = useState(22);
    const [userGender, setUserGender] = useState<'male' | 'female' | 'other'>('male');
    const [showLogoutDialog, setShowLogoutDialog] = useState(false);
    const [showSettingsDialog, setShowSettingsDialog] = useState(false);
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
    const [showProfile, setShowProfile] = useState(false);

    // Subscription & limits state
    const [isPro, setIsPro] = useState(false);
    const [isSubscriptionLoaded, setIsSubscriptionLoaded] = useState(false); // Prevents flash of wrong state
    const [remainingProMessages, setRemainingProMessages] = useState(20);  // Pro-quality messages remaining
    const [usingFreeModel, setUsingFreeModel] = useState(false);           // True after 20 msgs
    const [showPaywall, setShowPaywall] = useState(false);                 // Hard limit paywall (200 msgs)
    const [showSoftPaywall, setShowSoftPaywall] = useState(false);         // Soft paywall (after 20 msgs)
    const [paywallResetTime, setPaywallResetTime] = useState<string | undefined>();

    // Settings form state
    const [editUsername, setEditUsername] = useState('');
    const [editAge, setEditAge] = useState(22);
    const [editGender, setEditGender] = useState<'male' | 'female' | 'other'>('male');

    // Quick reply state for time-based greetings
    const [showQuickReplies, setShowQuickReplies] = useState(false);
    const [quickReplyOptions, setQuickReplyOptions] = useState<string[] | undefined>(undefined);

    // Image feature state
    const [showImagePaywall, setShowImagePaywall] = useState(false);
    const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

    // Message batching state (3.5s debounce for rapid messages)
    const [pendingMessages, setPendingMessages] = useState<string[]>([]);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isProcessingBatchRef = useRef(false);
    const DEBOUNCE_DELAY = 5000; // 5 seconds

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

            // Fetch user email from auth session
            const { data: { user: authUser } } = await supabase.auth.getUser();
            if (authUser?.email) {
                setUserEmail(authUser.email);
            }

            // Load conversation history (including linked guest messages)
            // First check if user has a linked guest session
            // @ts-ignore - Table exists after migration
            const { data: linkedGuestSession } = await supabase
                .from('riya_guest_sessions')
                .select('session_id')
                .eq('converted_user_id', userId)
                .maybeSingle();

            let allHistory: any[] = [];

            // Fetch user's own messages
            const { data: userHistory } = await supabase
                .from('riya_conversations')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: true });

            if (userHistory) {
                allHistory = [...userHistory];
            }

            // Fetch linked guest messages if exists
            if (linkedGuestSession?.session_id) {
                const { data: guestHistory } = await supabase
                    .from('riya_conversations')
                    .select('*')
                    .eq('guest_session_id', linkedGuestSession.session_id)
                    .order('created_at', { ascending: true });

                if (guestHistory && guestHistory.length > 0) {
                    // Merge and sort by timestamp
                    allHistory = [...guestHistory, ...allHistory].sort(
                        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                    );
                }
            }

            if (allHistory.length > 0) {
                const formattedMessages = allHistory.map(msg => ({
                    text: msg.content,
                    isUser: msg.role === 'user',
                    timestamp: msg.created_at,
                    // Load image data from DB for reload persistence
                    image: msg.image_data ? {
                        url: msg.image_data.url,
                        description: msg.image_data.description,
                        category: msg.image_data.category,
                        is_premium: msg.image_data.is_premium,
                        is_blurred: msg.image_data.is_blurred,
                    } : undefined,
                }));
                setMessages(formattedMessages);
                setShowQuickReplies(false);
            } else {
                // Add initial time-based greeting if no history
                const greeting = getGreetingByTime();

                // Add tiny delay for "typing" feel
                await new Promise(resolve => setTimeout(resolve, 500));

                setMessages([
                    {
                        text: greeting.text,
                        isUser: false,
                        timestamp: new Date().toISOString(),
                    },
                ]);

                // Set custom options for quick reply buttons
                setQuickReplyOptions(greeting.options);
                setShowQuickReplies(true);
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
                // Use CURRENT_DATE from database to ensure timezone consistency
                // @ts-ignore - Table exists after migration
                const { data: usage, error: usageError } = await supabase
                    .from('riya_daily_usage')
                    .select('message_count, usage_date')
                    .eq('user_id', userId)
                    .order('usage_date', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                console.log('📊 [Init] Daily usage query result:', { usage, usageError });

                // Check if usage is from today (compare dates)
                // IMPORTANT: Use UTC date to match database CURRENT_DATE (Supabase uses UTC)
                const todayUTC = new Date().toISOString().split('T')[0];

                // Normalize database date (could be 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss')
                const dbDate = usage?.usage_date ? usage.usage_date.split('T')[0] : null;
                const usageIsToday = dbDate === todayUTC;
                const used = usageIsToday ? (usage?.message_count || 0) : 0;

                console.log(`📊 [Init] Today (UTC): ${todayUTC}, DB date: ${dbDate}, Is today: ${usageIsToday}, Used: ${used}`);

                // Calculate remaining Pro-quality messages (first 20)
                setRemainingProMessages(Math.max(0, 20 - used));
                // Check if already using free model
                if (used >= 20) {
                    setUsingFreeModel(true);
                }
            }

            // Mark subscription as loaded (prevents flash of wrong UI)
            setIsSubscriptionLoaded(true);
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

    // Queue message and start/reset debounce timer
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

        // Add user message to UI immediately (for responsiveness)
        const userMsgWithTimestamp: MessageWithTimestamp = {
            text: userMessage,
            isUser: true,
            timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, userMsgWithTimestamp]);

        // Add to pending queue
        setPendingMessages(prev => [...prev, userMessage]);
        console.log(`� Queued message: "${userMessage.substring(0, 30)}..." (pending: ${pendingMessages.length + 1})`);

        // Clear existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Start new debounce timer
        debounceTimerRef.current = setTimeout(() => {
            processBatchedMessages(userId);
        }, DEBOUNCE_DELAY);
    };

    // Process all queued messages as a batch
    const processBatchedMessages = async (userId: string) => {
        // Prevent concurrent processing
        if (isProcessingBatchRef.current) {
            console.log('⏳ Already processing batch, skipping...');
            return;
        }

        // Get and clear pending messages atomically
        const messagesToSend: string[] = [];
        setPendingMessages(prev => {
            messagesToSend.push(...prev);
            return [];
        });

        // Wait a tick for state to update
        await new Promise(r => setTimeout(r, 10));

        if (messagesToSend.length === 0) {
            console.log('⚠️ No messages to process');
            return;
        }

        isProcessingBatchRef.current = true;
        setIsTyping(true);

        console.log(`🚀 Processing batch of ${messagesToSend.length} message(s):`, messagesToSend);

        try {
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
                    messages: messagesToSend,  // Array of messages
                    isBatch: messagesToSend.length > 1,
                }),
            });

            const data = await response.json();

            // Prominent logging for model verification
            console.log(`🤖 MODEL USED: ${data.modelUsed} | Pro remaining: ${data.remainingProMessages} | Free model: ${data.usingFreeModel}`);

            console.log('📥 [Tiered Model Debug] Full response:', {
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
                // Remove queued user messages from UI
                setMessages(prev => prev.slice(0, -messagesToSend.length));
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
                setMessages(prev => prev.slice(0, -messagesToSend.length));
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

            // Check if switched to free model for first time today - show soft paywall
            if (data.usingFreeModel) {
                setUsingFreeModel(true);

                const today = new Date().toISOString().split('T')[0];
                const softPaywallShownDate = localStorage.getItem('riya_soft_paywall_shown');

                if (softPaywallShownDate !== today && !data.isPro) {
                    console.log('📉 First time hitting 20 msgs today - showing soft paywall');
                    localStorage.setItem('riya_soft_paywall_shown', today);
                    setShowSoftPaywall(true);
                }
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
                            const messageRegex = /\{"text"\s*:\s*"((?:[^"\\]|\\.)*)"\}/g;
                            let match;
                            const extracted = [];

                            while ((match = messageRegex.exec(singleMsg)) !== null) {
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

            // DEBUG: Log processed messages to see image data
            console.log('========== 📸 FRONTEND IMAGE DEBUG ==========');
            console.log('Processed messages from API:', JSON.stringify(processedMessages, null, 2));
            processedMessages.forEach((msg: any, idx: number) => {
                console.log(`Message ${idx}: text="${msg.text?.substring(0, 50)}...", has image=${!!msg.image}`);
                if (msg.image) {
                    console.log(`  Image URL: ${msg.image.url}`);
                    console.log(`  Image category: ${msg.image.category}`);
                    console.log(`  Is blurred: ${msg.image.is_blurred}`);
                }
            });
            console.log('========== END FRONTEND DEBUG ==========');

            // Display each message sequentially with dynamic typing animation
            for (let i = 0; i < processedMessages.length; i++) {
                // Show typing indicator before each message
                setIsTyping(true);

                // Calculate dynamic delay based on message length
                const typingDelay = calculateTypingDelay(processedMessages[i].text || '');
                console.log(`⏱️ Message ${i}: ${processedMessages[i].text?.length} chars → ${typingDelay}ms delay`);

                // Wait to simulate realistic typing
                await new Promise(resolve => setTimeout(resolve, typingDelay));

                // Add message with timestamp (including image if present)
                const riyaMsg: MessageWithTimestamp = {
                    text: processedMessages[i].text,
                    isUser: false,
                    timestamp: new Date().toISOString(),
                    image: processedMessages[i].image,
                };

                console.log(`📸 Adding message ${i}:`, { text: riyaMsg.text?.substring(0, 30), image: riyaMsg.image });

                setMessages(prev => [...prev, riyaMsg]);

                // Brief pause to hide typing indicator
                setIsTyping(false);

                // Small gap between messages (except after the last one)
                if (i < processedMessages.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }

            // Show image paywall if limit exhausted
            if (data.showUpgradePaywall || data.imageLimitExhausted) {
                setTimeout(() => setShowImagePaywall(true), 500);
            }
        } catch (error) {
            console.error('Chat error:', error);
            toast({
                title: 'Error',
                description: 'Failed to send message. Please try again.',
                variant: 'destructive',
            });
            // Remove queued user messages on error
            setMessages(prev => prev.slice(0, -messagesToSend.length));
        } finally {
            setIsTyping(false);
            isProcessingBatchRef.current = false;

            // Check if new messages were queued during processing - process them!
            // We need to access the latest state, so use a callback
            setPendingMessages(currentPending => {
                if (currentPending.length > 0) {
                    console.log(`📬 Found ${currentPending.length} message(s) queued during processing, triggering new batch...`);
                    // Use setTimeout to ensure state update completes first
                    setTimeout(() => processBatchedMessages(userId), 50);
                }
                return currentPending; // Don't modify, just read
            });
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
                                    {isSubscriptionLoaded && isPro && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-yellow-500 to-orange-500 text-[10px] font-bold text-white">
                                            <Crown className="w-3 h-3" />
                                            PRO
                                        </span>
                                    )}
                                    {isSubscriptionLoaded && !isPro && usingFreeModel && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                                            <Zap className="w-3 h-3" />
                                            Lite
                                        </span>
                                    )}
                                </h2>
                                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                    {isTyping ? 'typing...' : 'online'}
                                    {isSubscriptionLoaded && isPro && !isTyping && (
                                        <span className="text-yellow-400 ml-1">• ∞ Unlimited</span>
                                    )}
                                    {isSubscriptionLoaded && !isPro && !isTyping && remainingProMessages > 0 && (
                                        <span className="text-muted-foreground ml-1">• {remainingProMessages} Pro left</span>
                                    )}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Pro upgrade button - only show for free users */}
                        {isSubscriptionLoaded && !isPro && (
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
                    {messages.map((message, index) => {
                        // Strip [Sent photo: ...] from display - it's for LLM context only
                        const displayText = message.text.replace(/\n?\[Sent photo:.*?\]$/s, '').trim();

                        return (
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
                                        {displayText}
                                    </p>

                                    {/* Image display */}
                                    {message.image && (
                                        <div
                                            className={`mt-2 relative rounded-xl overflow-hidden cursor-pointer
                                                    ${message.image.is_blurred ? 'ring-2 ring-pink-500/50' : ''}`}
                                            onClick={() => {
                                                if (message.image?.is_blurred) {
                                                    setShowImagePaywall(true);
                                                } else if (message.image) {
                                                    setFullscreenImage(message.image.url);
                                                }
                                            }}
                                        >
                                            <img
                                                src={message.image.url}
                                                alt="Riya"
                                                className={`max-w-[200px] w-full rounded-xl
                                                       ${message.image.is_blurred ? 'blur-lg' : ''}`}
                                            />

                                            {/* Lock overlay for blurred images */}
                                            {message.image.is_blurred && (
                                                <div className="absolute inset-0 flex flex-col items-center justify-center 
                                                            bg-black/40 rounded-xl">
                                                    <Lock className="w-8 h-8 text-pink-400 mb-1" />
                                                    <span className="text-white text-sm font-medium">Private Snap 🔒</span>
                                                    <span className="text-pink-300 text-xs mt-0.5">Tap to unlock</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <p className="text-[10px] text-muted-foreground mt-1 text-right">
                                        {formatTime(message.timestamp)}
                                    </p>
                                </div>
                            </motion.div>
                        );
                    })}
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

            {/* Quick Reply Buttons */}
            <AnimatePresence>
                {showQuickReplies && !isTyping && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="fixed bottom-20 left-0 right-0 z-40"
                    >
                        <QuickReplyButtons
                            onSelect={(text) => {
                                setInputMessage(text);
                                setShowQuickReplies(false);
                                // Use setTimeout to allow state to update before sending
                                setTimeout(() => {
                                    const form = document.querySelector('form');
                                    if (form) {
                                        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                                    }
                                }, 50);
                            }}
                            options={quickReplyOptions}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Fixed Input at bottom */}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                }}
                className="fixed bottom-0 left-0 right-0 z-50 glass-card rounded-none border-x-0 border-b-0 px-4 py-3 safe-area-bottom"
            >
                <div className="flex items-center gap-2">
                    {/* Camera button for photo requests */}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-pink-400 hover:text-pink-300 hover:bg-pink-500/10"
                        onClick={() => {
                            // Track click for analytics
                            const userId = localStorage.getItem('riya_user_id');
                            // @ts-ignore - Table exists after migration
                            supabase.from('riya_image_clicks').insert({
                                user_type: isPro ? 'pro' : 'free',
                                user_id: userId,
                            }).then(() => { }); // Fire and forget

                            setInputMessage("send a pic 📸");
                            setTimeout(() => {
                                const form = document.querySelector('form');
                                if (form) {
                                    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                                }
                            }, 50);
                        }}
                    >
                        <Camera className="w-5 h-5" />
                    </Button>

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
                        {/* Email (read-only) */}
                        {userEmail && (
                            <div>
                                <label className="block text-sm font-medium text-muted-foreground mb-2">
                                    Email
                                </label>
                                <div className="w-full px-3 py-2 rounded-md bg-muted/20 border border-border/50 text-sm text-muted-foreground">
                                    {userEmail}
                                </div>
                            </div>
                        )}

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

            {/* Image Upgrade Paywall */}
            <AnimatePresence>
                {showImagePaywall && (
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 50 }}
                        className="fixed inset-x-4 bottom-24 z-50 p-5 rounded-2xl
                                   bg-gradient-to-br from-pink-900/95 to-purple-900/95
                                   border border-pink-500/30 backdrop-blur-xl"
                    >
                        <button
                            onClick={() => setShowImagePaywall(false)}
                            className="absolute top-3 right-3 text-white/60 hover:text-white"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="text-center">
                            <div className="text-3xl mb-2">🔥</div>
                            <h3 className="text-lg font-bold text-white mb-1">
                                Unlock Riya's Private Photos
                            </h3>
                            <p className="text-sm text-pink-200/80 mb-4">
                                Get unlimited access to all her exclusive pics
                            </p>

                            <Button
                                onClick={() => navigate('/riya/pricing')}
                                className="w-full bg-gradient-to-r from-pink-500 to-purple-500 font-bold"
                            >
                                <Crown className="w-4 h-4 mr-2" />
                                Upgrade to Pro
                            </Button>

                            <p className="text-xs text-white/40 mt-3">
                                Free: 3 pics/day • Pro: Unlimited 📸
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Fullscreen Image Viewer */}
            <AnimatePresence>
                {fullscreenImage && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center"
                        onClick={() => setFullscreenImage(null)}
                    >
                        <button
                            className="absolute top-4 right-4 text-white/80 hover:text-white"
                            onClick={() => setFullscreenImage(null)}
                        >
                            <X className="w-8 h-8" />
                        </button>
                        <img
                            src={fullscreenImage}
                            alt="Riya"
                            className="max-w-full max-h-full object-contain p-4"
                        />
                    </motion.div>
                )}
            </AnimatePresence>

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

