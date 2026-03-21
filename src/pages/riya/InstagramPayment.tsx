import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'react-qr-code';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
    Heart, Sparkles, Check, Shield, Crown, Leaf,
    Search, ChevronRight, ArrowLeft, Loader2, Smartphone
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const MERCHANT_VPA = import.meta.env.VITE_MERCHANT_UPI_VPA as string | undefined;

// Poll Razorpay order status every N ms, give up after TIMEOUT ms
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS  = 5 * 60_000; // 5 minutes

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'plans' | 'username' | 'payment' | 'waiting' | 'success';
type PackId = 'basic' | 'romantic' | 'soulmate';

interface Pack {
    id: PackId;
    icon: React.ReactNode;
    name: string;
    nameHi: string;
    price: number;
    originalPrice: number;
    messages: string;
    messagesHi: string;
    validity: string;
    validityHi: string;
    tag?: string;
    tagHi?: string;
    highlight: boolean;
}

interface IgUser {
    instagram_user_id: string;
    instagram_username: string | null;
    instagram_name: string | null;
}

// ─── Pack Definitions ─────────────────────────────────────────────────────────

const PACKS: Pack[] = [
    {
        id: 'basic',
        icon: <Leaf className="w-5 h-5 text-emerald-400" />,
        name: 'Basic', nameHi: 'बेसिक',
        price: 79, originalPrice: 149,
        messages: '600 msgs', messagesHi: '600 संदेश',
        validity: '30 days', validityHi: '30 दिन',
        highlight: false,
    },
    {
        id: 'romantic',
        icon: <Heart className="w-5 h-5 text-pink-400 fill-pink-400" />,
        name: 'Romantic', nameHi: 'रोमांटिक',
        price: 149, originalPrice: 299,
        messages: '1,500 msgs', messagesHi: '1,500 संदेश',
        validity: '30 days', validityHi: '30 दिन',
        tag: '💖 Most Popular', tagHi: '💖 सबसे लोकप्रिय',
        highlight: true,
    },
    {
        id: 'soulmate',
        icon: <Crown className="w-5 h-5 text-yellow-400" />,
        name: 'Soulmate', nameHi: 'सोलमेट',
        price: 249, originalPrice: 499,
        messages: '3,000 msgs', messagesHi: '3,000 संदेश',
        validity: '30 days', validityHi: '30 दिन',
        tag: '👑 Best Value', tagHi: '👑 सबसे अच्छा',
        highlight: false,
    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const logEvent = (igUserId: string, eventType: string, metadata?: object) => {
    (supabase as any)
        .from('riya_payment_events')
        .insert({ instagram_user_id: igUserId, event_type: eventType, ...(metadata ? { metadata } : {}) })
        .then(({ error }: { error: any }) => {
            if (error) console.warn(`⚠️ Failed to log ${eventType}:`, error);
        });
};

const isAndroid = () => /android/i.test(navigator.userAgent);

const buildUpiUrl = (vpa: string, amount: number, description: string, orderId: string) => {
    const amountRupees = (amount / 100).toFixed(2); // Razorpay stores in paise
    const params = new URLSearchParams({
        pa: vpa,
        pn: 'Riya AI',
        am: amountRupees,
        cu: 'INR',
        tn: description,
        tr: orderId,
    });
    return `upi://pay?${params.toString()}`;
};

// ─── Component ────────────────────────────────────────────────────────────────

const InstagramPayment = () => {
    const [searchParams] = useSearchParams();
    // ?id param: pre-identified user (backward-compat with old DM links)
    const prefilledId = searchParams.get('id');

    const [step, setStep]                 = useState<Step>('plans');
    const [lang, setLang]                 = useState<'en' | 'hi'>('en');
    const [selectedPack, setSelectedPack] = useState<Pack | null>(null);
    const [igUser, setIgUser]             = useState<IgUser | null>(
        prefilledId ? { instagram_user_id: prefilledId, instagram_username: null, instagram_name: null } : null
    );

    // Username search
    const [query, setQuery]               = useState('');
    const [results, setResults]           = useState<IgUser[]>([]);
    const [searching, setSearching]       = useState(false);
    const [confirmed, setConfirmed]       = useState<IgUser | null>(null);
    const debounceRef                     = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Payment
    const [orderData, setOrderData]       = useState<{ orderId: string; amount: number; upiUrl: string } | null>(null);
    const [creatingOrder, setCreatingOrder] = useState(false);
    const pollRef                         = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollStartRef                    = useRef<number>(0);

    // Success
    const [successPack, setSuccessPack]   = useState<Pack | null>(null);

    // ── Effects ─────────────────────────────────────────────────────────────

    useEffect(() => {
        if (prefilledId) logEvent(prefilledId, 'page_visit', { page: 'recharge', source: 'dm_link' });
        else             logEvent('anonymous', 'page_visit', { page: 'recharge', source: 'bio_link' });
    }, []);

    // Debounced username search
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (query.trim().length < 2) { setResults([]); return; }

        debounceRef.current = setTimeout(async () => {
            setSearching(true);
            try {
                const { data, error } = await supabase.rpc('search_ig_users_by_username', { p_query: query.trim() });
                if (!error && data) setResults(data as IgUser[]);
            } catch { /* silently ignore */ }
            finally { setSearching(false); }
        }, 300);

        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query]);

    // Stop polling on unmount
    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleSelectPlan = (pack: Pack) => {
        setSelectedPack(pack);
        if (prefilledId) {
            // Pre-identified user (old DM link) — skip username step
            startPayment(pack, { instagram_user_id: prefilledId, instagram_username: null, instagram_name: null });
        } else {
            setStep('username');
        }
    };

    const handleSelectUser = (user: IgUser) => {
        setConfirmed(user);
        setResults([]);
    };

    const handleConfirmUser = () => {
        if (!confirmed || !selectedPack) return;
        setIgUser(confirmed);
        startPayment(selectedPack, confirmed);
    };

    const startPayment = async (pack: Pack, user: IgUser) => {
        setCreatingOrder(true);
        setStep('payment');

        try {
            const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                body: { instagramUserId: user.instagram_user_id, planType: pack.id, packName: pack.id }
            });

            if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to create order');

            if (!MERCHANT_VPA) {
                throw new Error('Payment not configured. Please contact support.');
            }

            const upiUrl = buildUpiUrl(MERCHANT_VPA, data.amount, `${pack.name} Pack`, data.orderId);

            setOrderData({ orderId: data.orderId, amount: data.amount, upiUrl });
            logEvent(user.instagram_user_id, 'upgrade_click', { pack: pack.id, orderId: data.orderId });
        } catch (err) {
            console.error('Order creation error:', err);
            toast({
                title: 'Error',
                description: err instanceof Error ? err.message : 'Could not start payment. Try again.',
                variant: 'destructive',
            });
            setStep(prefilledId ? 'plans' : 'username');
        } finally {
            setCreatingOrder(false);
        }
    };

    const startPolling = useCallback((orderId: string, pack: Pack, userId: string) => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollStartRef.current = Date.now();
        setStep('waiting');

        pollRef.current = setInterval(async () => {
            // Timeout guard
            if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
                clearInterval(pollRef.current!);
                pollRef.current = null;
                toast({
                    title: 'Payment not detected',
                    description: 'If you paid, credits will appear within 2 minutes. Otherwise try again.',
                    variant: 'destructive',
                });
                setStep('payment');
                return;
            }

            try {
                const { data, error } = await supabase.functions.invoke('check-razorpay-order', {
                    body: { orderId }
                });

                if (!error && data?.paid) {
                    clearInterval(pollRef.current!);
                    pollRef.current = null;
                    logEvent(userId, 'payment_success', { pack: pack.id, orderId, source: 'polling' });
                    setSuccessPack(pack);
                    setStep('success');
                }
            } catch { /* keep polling on transient errors */ }
        }, POLL_INTERVAL_MS);
    }, []);

    const handleUpiTap = () => {
        if (!orderData || !selectedPack || !igUser) return;
        startPolling(orderData.orderId, selectedPack, igUser.instagram_user_id);
        // Open UPI intent (Android) — opens app chooser
        window.location.href = orderData.upiUrl;
    };

    // ── Language helpers ──────────────────────────────────────────────────────
    const t = {
        messages: (p: Pack) => lang === 'hi' ? p.messagesHi : p.messages,
        validity:  (p: Pack) => lang === 'hi' ? p.validityHi : p.validity,
        name:      (p: Pack) => lang === 'hi' ? p.nameHi     : p.name,
        tag:       (p: Pack) => lang === 'hi' ? (p.tagHi || p.tag) : p.tag,
    };

    // ── Shared UI Fragments ───────────────────────────────────────────────────

    const LangToggle = () => (
        <div className="flex justify-end mb-2">
            <div className="bg-white/5 border border-white/10 rounded-full p-1 flex text-xs">
                {(['en', 'hi'] as const).map(l => (
                    <button
                        key={l}
                        onClick={() => setLang(l)}
                        className={`px-3 py-1 rounded-full transition-all font-medium ${
                            lang === l ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        {l === 'en' ? 'EN' : 'हि'}
                    </button>
                ))}
            </div>
        </div>
    );

    const ProfileHeader = () => (
        <div className="text-center mb-6 space-y-3">
            <div className="mx-auto w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
                <div className="w-full h-full rounded-full overflow-hidden border-2 border-black">
                    <img src="/riya-payment-dp.jpg" alt="Riya" className="w-full h-full object-cover" />
                </div>
            </div>
        </div>
    );

    const FooterTrust = () => (
        <div className="space-y-2 mt-auto pt-6">
            <div className="flex items-center justify-center gap-1.5 text-gray-500">
                <Shield className="w-3 h-3" />
                <p className="text-xs">
                    {lang === 'hi' ? 'Razorpay द्वारा सुरक्षित · कोई auto-renewal नहीं' : 'Secured by Razorpay · No auto-renewal'}
                </p>
            </div>
            {igUser && (
                <p className="text-center text-xs text-gray-600">
                    {lang === 'hi' ? 'जारी रखकर आप हमारी' : 'By continuing you agree to our'}{' '}
                    <Link to="/riya/privacy-policy" className="text-pink-400 underline">
                        {lang === 'hi' ? 'गोपनीयता नीति' : 'Privacy Policy'}
                    </Link>{' '}
                    {lang === 'hi' ? 'और' : 'and'}{' '}
                    <Link to="/riya/terms" className="text-pink-400 underline">
                        {lang === 'hi' ? 'शर्तें' : 'Terms'}
                    </Link>.
                </p>
            )}
        </div>
    );

    // ── Step: Plans ───────────────────────────────────────────────────────────

    const StepPlans = () => (
        <motion.div
            key="plans"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col min-h-screen px-4 py-8 max-w-lg mx-auto"
        >
            <LangToggle />
            <ProfileHeader />

            <div className="text-center mb-6">
                <h1 className="text-xl font-bold">
                    {lang === 'hi' ? 'बातचीत जारी रखें 💬' : 'Continue the Conversation 💬'}
                </h1>
                <p className="text-sm text-gray-400 mt-1">
                    {lang === 'hi'
                        ? 'रिया कुछ बताने वाली थी... 👀 plan चुनो'
                        : 'Riya was mid-story... 👀 Choose a plan to continue'}
                </p>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
                {PACKS.map((pack, i) => (
                    <motion.div
                        key={pack.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.07 }}
                        className="flex flex-col"
                    >
                        {/* Tag row — fixed height so cards align */}
                        <div className="h-6 mb-1 flex items-center justify-center">
                            {t.tag(pack) && (
                                <span className="text-[10px] font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                                    {t.tag(pack)}
                                </span>
                            )}
                        </div>

                        {/* Card */}
                        <div
                            className={`flex-1 rounded-2xl border p-3 cursor-pointer transition-all active:scale-95 ${
                                pack.highlight
                                    ? 'border-pink-500 bg-pink-500/10 shadow-lg shadow-pink-500/20'
                                    : 'border-white/10 bg-white/[0.02]'
                            }`}
                            onClick={() => handleSelectPlan(pack)}
                        >
                            <div className="flex justify-center mb-2">{pack.icon}</div>
                            <p className="text-center font-bold text-sm mb-2">{t.name(pack)}</p>
                            <div className="text-center mb-2">
                                <p className="text-[10px] text-gray-500 line-through">₹{pack.originalPrice}</p>
                                <p className="text-2xl font-black">₹{pack.price}</p>
                            </div>
                            <ul className="space-y-1 mt-2">
                                {[t.messages(pack), t.validity(pack)].map((f, fi) => (
                                    <li key={fi} className="flex items-center gap-1 text-[10px] text-gray-300">
                                        <Check className={`w-2.5 h-2.5 shrink-0 ${pack.highlight ? 'text-pink-400' : 'text-emerald-400'}`} />
                                        {f}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <Button
                            className={`mt-2 w-full h-10 text-xs font-bold rounded-xl transition-all ${
                                pack.highlight
                                    ? 'bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90'
                                    : 'bg-white/10 border border-white/20 hover:bg-white/20'
                            }`}
                            onClick={() => handleSelectPlan(pack)}
                        >
                            {lang === 'hi' ? `${t.name(pack)} लो` : `Get ${pack.name}`}
                        </Button>
                    </motion.div>
                ))}
            </div>

            <p className="text-center text-xs text-gray-600 mb-2">
                📸 {lang === 'hi' ? 'सभी plans में unlimited photos शामिल' : 'Unlimited photos included in all plans'}
            </p>

            <FooterTrust />
        </motion.div>
    );

    // ── Step: Username ─────────────────────────────────────────────────────────

    const StepUsername = () => (
        <motion.div
            key="username"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col min-h-screen px-4 py-8 max-w-lg mx-auto"
        >
            <LangToggle />

            {/* Back */}
            <button
                onClick={() => { setStep('plans'); setConfirmed(null); setQuery(''); setResults([]); }}
                className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-6 self-start"
            >
                <ArrowLeft className="w-4 h-4" />
                {lang === 'hi' ? 'वापस' : 'Back'}
            </button>

            <ProfileHeader />

            {/* Selected plan badge */}
            {selectedPack && (
                <div className="flex justify-center mb-4">
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm">
                        {selectedPack.icon}
                        <span className="font-semibold">{t.name(selectedPack)} Pack</span>
                        <span className="text-gray-400">·</span>
                        <span className="font-bold">₹{selectedPack.price}</span>
                    </div>
                </div>
            )}

            <div className="space-y-4">
                <div>
                    <h2 className="text-lg font-bold text-center mb-1">
                        {lang === 'hi' ? 'आप Instagram पर कौन हैं?' : 'Who are you on Instagram?'}
                    </h2>
                    <p className="text-xs text-gray-400 text-center mb-4">
                        {lang === 'hi'
                            ? 'अपना username type करें — हम आपका account खोज लेंगे'
                            : 'Type your username — we\'ll find your account'}
                    </p>

                    {/* Search input */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => { setQuery(e.target.value); setConfirmed(null); }}
                            placeholder={lang === 'hi' ? 'username लिखें...' : 'Type your username...'}
                            className="w-full bg-white/5 border border-white/15 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-pink-500 transition-colors"
                            autoFocus
                            autoCapitalize="none"
                            autoCorrect="off"
                        />
                        {searching && (
                            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
                        )}
                    </div>

                    {/* Results */}
                    <AnimatePresence>
                        {results.length > 0 && !confirmed && (
                            <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden"
                            >
                                {results.map(u => (
                                    <button
                                        key={u.instagram_user_id}
                                        onClick={() => handleSelectUser(u)}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors text-left border-b border-white/5 last:border-0"
                                    >
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500/30 to-purple-500/30 border border-white/10 flex items-center justify-center text-xs font-bold text-pink-300 shrink-0">
                                            {(u.instagram_username?.[0] || '?').toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold truncate">@{u.instagram_username}</p>
                                            {u.instagram_name && (
                                                <p className="text-xs text-gray-400 truncate">{u.instagram_name}</p>
                                            )}
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-gray-600 ml-auto shrink-0" />
                                    </button>
                                ))}
                            </motion.div>
                        )}

                        {/* No results hint */}
                        {query.trim().length >= 2 && !searching && results.length === 0 && !confirmed && (
                            <motion.p
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="mt-3 text-center text-xs text-gray-500"
                            >
                                {lang === 'hi'
                                    ? 'कोई account नहीं मिला। पहले Riya को DM करें, फिर यहाँ आएं!'
                                    : "No account found. DM Riya first, then come back here!"}
                            </motion.p>
                        )}
                    </AnimatePresence>

                    {/* Confirmed user card */}
                    <AnimatePresence>
                        {confirmed && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.97 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="mt-3 rounded-xl border border-pink-500/40 bg-pink-500/10 p-4"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500/40 to-purple-500/40 border border-pink-500/30 flex items-center justify-center text-sm font-bold text-pink-300 shrink-0">
                                        {(confirmed.instagram_username?.[0] || '?').toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold">@{confirmed.instagram_username}</p>
                                        {confirmed.instagram_name && (
                                            <p className="text-xs text-gray-400">{confirmed.instagram_name}</p>
                                        )}
                                    </div>
                                    <Check className="w-5 h-5 text-pink-400 ml-auto shrink-0" />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Proceed button */}
                <Button
                    className="w-full h-12 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold text-sm disabled:opacity-40"
                    disabled={!confirmed || creatingOrder}
                    onClick={handleConfirmUser}
                >
                    {creatingOrder ? (
                        <span className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {lang === 'hi' ? 'तैयारी हो रही है...' : 'Setting up...'}
                        </span>
                    ) : (
                        lang === 'hi' ? 'आगे बढ़ें →' : 'Continue →'
                    )}
                </Button>
            </div>

            <FooterTrust />
        </motion.div>
    );

    // ── Step: Payment ─────────────────────────────────────────────────────────

    const StepPayment = () => {
        const android = isAndroid();

        if (creatingOrder || !orderData) {
            return (
                <div className="flex flex-col items-center justify-center min-h-screen gap-4">
                    <Loader2 className="w-8 h-8 text-pink-400 animate-spin" />
                    <p className="text-sm text-gray-400">
                        {lang === 'hi' ? 'Payment तैयार हो रही है...' : 'Setting up payment...'}
                    </p>
                </div>
            );
        }

        return (
            <motion.div
                key="payment"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex flex-col min-h-screen px-4 py-8 max-w-lg mx-auto"
            >
                <LangToggle />

                <button
                    onClick={() => { setStep(prefilledId ? 'plans' : 'username'); setOrderData(null); }}
                    className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-6 self-start"
                >
                    <ArrowLeft className="w-4 h-4" />
                    {lang === 'hi' ? 'वापस' : 'Back'}
                </button>

                <ProfileHeader />

                {/* Order summary */}
                {selectedPack && (
                    <div className="text-center mb-6">
                        <div className="flex items-center justify-center gap-2 mb-1">
                            {selectedPack.icon}
                            <span className="text-lg font-bold">{t.name(selectedPack)} Pack</span>
                        </div>
                        <p className="text-3xl font-black text-white">₹{selectedPack.price}</p>
                        <p className="text-xs text-gray-400 mt-1">
                            {t.messages(selectedPack)} · {t.validity(selectedPack)}
                        </p>
                        {igUser?.instagram_username && (
                            <p className="text-xs text-gray-500 mt-1">@{igUser.instagram_username}</p>
                        )}
                    </div>
                )}

                {android ? (
                    /* ── Android: UPI intent button ── */
                    <div className="space-y-4">
                        <p className="text-center text-sm text-gray-400">
                            {lang === 'hi' ? 'नीचे tap करें और अपने UPI app में pay करें' : 'Tap below and pay in your UPI app'}
                        </p>

                        <button
                            onClick={handleUpiTap}
                            className="w-full h-14 rounded-2xl bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold text-base flex items-center justify-center gap-3 active:scale-95 transition-all"
                        >
                            <Smartphone className="w-5 h-5" />
                            {lang === 'hi' ? 'UPI से Pay करें' : 'Pay via UPI'}
                        </button>

                        <p className="text-center text-xs text-gray-500">
                            {lang === 'hi'
                                ? 'PhonePe, Google Pay, Paytm — कोई भी UPI app'
                                : 'PhonePe, Google Pay, Paytm — any UPI app'}
                        </p>
                    </div>
                ) : (
                    /* ── iOS / Desktop: QR code ── */
                    <div className="space-y-4">
                        <p className="text-center text-sm text-gray-400">
                            {lang === 'hi'
                                ? 'अपने phone से QR scan करें'
                                : 'Scan the QR code with your UPI app'}
                        </p>

                        <div className="flex justify-center">
                            <div className="bg-white p-4 rounded-2xl">
                                <QRCode
                                    value={orderData.upiUrl}
                                    size={220}
                                    bgColor="#ffffff"
                                    fgColor="#000000"
                                    level="M"
                                />
                            </div>
                        </div>

                        <p className="text-center text-xs text-gray-500">
                            {lang === 'hi'
                                ? 'PhonePe / Google Pay → Scan & Pay'
                                : 'PhonePe / Google Pay → Scan & Pay'}
                        </p>

                        <Button
                            className="w-full h-11 bg-white/10 border border-white/20 hover:bg-white/20 text-sm font-semibold"
                            onClick={() => startPolling(orderData.orderId, selectedPack!, igUser!.instagram_user_id)}
                        >
                            {lang === 'hi' ? "मैंने pay कर दिया ✓" : "I've paid ✓"}
                        </Button>
                    </div>
                )}

                <FooterTrust />
            </motion.div>
        );
    };

    // ── Step: Waiting ─────────────────────────────────────────────────────────

    const StepWaiting = () => (
        <motion.div
            key="waiting"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center min-h-screen px-4 gap-6 text-center"
        >
            <div className="w-20 h-20 rounded-full bg-pink-500/20 border border-pink-500/40 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-pink-400 animate-spin" />
            </div>
            <div className="space-y-2">
                <h2 className="text-2xl font-bold">
                    {lang === 'hi' ? 'Payment का इंतज़ार...' : 'Waiting for payment...'}
                </h2>
                <p className="text-gray-400 text-sm max-w-xs">
                    {lang === 'hi'
                        ? 'अपने UPI app में payment complete करें — यह page अपने आप update हो जाएगा'
                        : 'Complete the payment in your UPI app — this page will update automatically'}
                </p>
                <p className="text-xs text-yellow-400 animate-pulse mt-2">
                    {lang === 'hi' ? '⚠️ यह window बंद मत करें' : '⚠️ Do not close this window'}
                </p>
            </div>

            {/* Manual "I've paid" fallback for iOS after QR scan */}
            {!isAndroid() && (
                <button
                    onClick={() => {
                        if (orderData && selectedPack && igUser) {
                            // Already polling; just a re-assurance tap — nothing needed
                        }
                    }}
                    className="text-xs text-gray-600 underline mt-2"
                >
                    {lang === 'hi' ? 'Payment अटकी हुई है? Support से संपर्क करें' : 'Payment stuck? Contact support'}
                </button>
            )}
        </motion.div>
    );

    // ── Step: Success ─────────────────────────────────────────────────────────

    const StepSuccess = () => (
        <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="flex flex-col items-center justify-center min-h-screen px-6 text-center space-y-6"
        >
            <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
                className="w-24 h-24 rounded-full bg-pink-500/20 border border-pink-500/40 flex items-center justify-center"
            >
                <Check className="w-12 h-12 text-pink-400" />
            </motion.div>

            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="space-y-2"
            >
                <h1 className="text-3xl font-bold">
                    {lang === 'hi' ? 'Credits मिल गए! 🎉' : 'Credits Added! 🎉'}
                </h1>
                {successPack && (
                    <p className="text-gray-400 max-w-xs">
                        <span className="text-white font-semibold">{t.messages(successPack)}</span>{' '}
                        {lang === 'hi' ? 'जोड़ दिए गए।' : 'unlocked.'}{' '}
                        {lang === 'hi' ? 'Instagram पर वापस जाओ — Riya इंतज़ार कर रही है 💖' : "Go back to Instagram — Riya's waiting 💖"}
                    </p>
                )}
            </motion.div>

            <Button
                className="w-full max-w-xs h-12 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold"
                onClick={() => window.location.href = 'https://instagram.com/'}
            >
                {lang === 'hi' ? 'Instagram खोलें ↗' : 'Open Instagram ↗'}
            </Button>

            <div className="flex items-center gap-2 text-xs text-gray-600">
                <Sparkles className="w-3 h-3 text-pink-500/50" />
                <span>{lang === 'hi' ? 'रिया तुम्हारा इंतज़ार कर रही है 💭' : 'Riya is waiting for you 💭'}</span>
                <Sparkles className="w-3 h-3 text-pink-500/50" />
            </div>
        </motion.div>
    );

    // ── Root render ───────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-black text-white font-sans relative overflow-hidden">
            {/* Background glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-pink-600/15 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10">
                <AnimatePresence mode="wait">
                    {step === 'plans'    && <StepPlans    key="plans" />}
                    {step === 'username' && <StepUsername  key="username" />}
                    {step === 'payment'  && <StepPayment   key="payment" />}
                    {step === 'waiting'  && <StepWaiting   key="waiting" />}
                    {step === 'success'  && <StepSuccess   key="success" />}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default InstagramPayment;
