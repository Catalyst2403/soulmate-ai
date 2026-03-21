import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
    Heart, Sparkles, Check, Shield, Crown, Leaf,
    Search, ChevronRight, ArrowLeft, Loader2,
} from 'lucide-react';

// ─── Razorpay types ────────────────────────────────────────────────────────────
declare global {
    interface Window {
        Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
    }
}
interface RazorpayOptions {
    key: string;
    amount: number;
    currency: string;
    name: string;
    description: string;
    order_id: string;
    handler: (response: RazorpayResponse) => void;
    prefill: { name: string; contact: string };
    theme: { color: string };
    config?: object;
    modal?: { ondismiss?: () => void };
}
interface RazorpayInstance { open: () => void; }
interface RazorpayResponse {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'plans' | 'username' | 'payment' | 'success';
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

// ─── Pack definitions ──────────────────────────────────────────────────────────

const PACKS: Pack[] = [
    {
        id: 'basic',
        icon: <Leaf className="w-5 h-5 text-emerald-400" />,
        name: 'Basic',     nameHi: 'बेसिक',
        price: 99,         originalPrice: 199,
        messages: '600 msgs',   messagesHi: '600 संदेश',
        validity: '30 days',    validityHi: '30 दिन',
        highlight: false,
    },
    {
        id: 'romantic',
        icon: <Heart className="w-5 h-5 text-pink-400 fill-pink-400" />,
        name: 'Romantic',  nameHi: 'रोमांटिक',
        price: 199,        originalPrice: 399,
        messages: '1,500 msgs', messagesHi: '1,500 संदेश',
        validity: '30 days',    validityHi: '30 दिन',
        tag: '💖 Most Popular', tagHi: '💖 सबसे लोकप्रिय',
        highlight: true,
    },
    {
        id: 'soulmate',
        icon: <Crown className="w-5 h-5 text-yellow-400" />,
        name: 'Soulmate',  nameHi: 'सोलमेट',
        price: 349,        originalPrice: 699,
        messages: '3,000 msgs', messagesHi: '3,000 संदेश',
        validity: '30 days',    validityHi: '30 दिन',
        tag: '👑 Best Value',   tagHi: '👑 सबसे अच्छा',
        highlight: false,
    },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

const logEvent = (igUserId: string, eventType: string, metadata?: object) => {
    (supabase as any)
        .from('riya_payment_events')
        .insert({ instagram_user_id: igUserId, event_type: eventType, ...(metadata ? { metadata } : {}) })
        .then(({ error }: { error: any }) => {
            if (error) console.warn(`⚠️ logEvent failed (${eventType}):`, error);
        });
};

// ─── Shared UI — defined at module level so React sees stable component types ──

const LangToggle = ({ lang, setLang }: { lang: 'en' | 'hi'; setLang: (l: 'en' | 'hi') => void }) => (
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
    <div className="flex justify-center mb-5">
        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
            <div className="w-full h-full rounded-full overflow-hidden border-2 border-black">
                <img src="/riya-payment-dp.jpg" alt="Riya" className="w-full h-full object-cover" />
            </div>
        </div>
    </div>
);

const FooterTrust = ({ lang, igUserId }: { lang: 'en' | 'hi'; igUserId?: string }) => (
    <div className="space-y-2 mt-auto pt-6">
        <div className="flex items-center justify-center gap-1.5 text-gray-500">
            <Shield className="w-3 h-3" />
            <p className="text-xs">
                {lang === 'hi' ? 'Razorpay द्वारा सुरक्षित · कोई auto-renewal नहीं' : 'Secured by Razorpay · No auto-renewal'}
            </p>
        </div>
        {igUserId && (
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

// ─── Component ─────────────────────────────────────────────────────────────────

const InstagramPayment = () => {
    const [searchParams] = useSearchParams();
    // ?id= param: pre-identified user (backward-compat with old DM links)
    const prefilledId = searchParams.get('id');

    const [step, setStep]                  = useState<Step>('plans');
    const [lang, setLang]                  = useState<'en' | 'hi'>('en');
    const [selectedPack, setSelectedPack]  = useState<Pack | null>(null);
    const [igUser, setIgUser]              = useState<IgUser | null>(
        prefilledId
            ? { instagram_user_id: prefilledId, instagram_username: null, instagram_name: null }
            : null
    );

    // Username search state
    const [query, setQuery]        = useState('');
    const [results, setResults]    = useState<IgUser[]>([]);
    const [searching, setSearching] = useState(false);
    const [confirmed, setConfirmed] = useState<IgUser | null>(null);
    const debounceRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Payment state
    const [paying, setPaying]       = useState(false);
    const [successPack, setSuccessPack] = useState<Pack | null>(null);

    // ── Load Razorpay script once ──────────────────────────────────────────────
    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);

        if (prefilledId) logEvent(prefilledId, 'page_visit', { source: 'dm_link' });
        else             logEvent('anonymous',  'page_visit', { source: 'bio_link' });

        return () => { try { document.body.removeChild(script); } catch { } };
    }, []);

    // ── Debounced username search ──────────────────────────────────────────────
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (query.trim().length < 2) { setResults([]); return; }

        debounceRef.current = setTimeout(async () => {
            setSearching(true);
            try {
                const { data, error } = await supabase.rpc('search_ig_users_by_username', { p_query: query.trim() });
                if (!error && data) setResults(data as IgUser[]);
            } catch (e) {
                console.error('Username search error:', e);
            } finally {
                setSearching(false);
            }
        }, 300);

        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query]);

    // ── Plan selected ──────────────────────────────────────────────────────────
    const handleSelectPlan = (pack: Pack) => {
        setSelectedPack(pack);
        if (prefilledId) {
            // Old DM link — user already identified, go straight to payment
            openRazorpay(pack, { instagram_user_id: prefilledId, instagram_username: null, instagram_name: null });
        } else {
            setStep('username');
        }
    };

    // ── Username confirmed → open payment ──────────────────────────────────────
    const handleConfirmUser = () => {
        if (!confirmed || !selectedPack) return;
        const user = confirmed;
        setIgUser(user);
        openRazorpay(selectedPack, user);
    };

    // ── Open Razorpay checkout (UPI-only config) ───────────────────────────────
    const openRazorpay = async (pack: Pack, user: IgUser) => {
        setPaying(true);
        setStep('payment');

        try {
            const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                body: { instagramUserId: user.instagram_user_id, planType: pack.id, packName: pack.id }
            });

            if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to create order');

            logEvent(user.instagram_user_id, 'upgrade_click', { pack: pack.id, orderId: data.orderId });

            if (!window.Razorpay) throw new Error('Payment SDK not loaded. Please refresh and try again.');

            const options: RazorpayOptions = {
                key: data.keyId,
                amount: data.amount,
                currency: 'INR',
                name: 'Riya AI',
                description: `${pack.name} Pack — ${pack.messages}`,
                order_id: data.orderId,
                handler: async (response: RazorpayResponse) => {
                    await verifyPayment(response, pack, user);
                },
                prefill: {
                    name: user.instagram_name || user.instagram_username || '',
                    contact: '',
                },
                theme: { color: '#E1306C' },
                // Show only UPI — no cards, net banking, wallets.
                // Razorpay natively renders intent buttons (PhonePe/GPay) on Android
                // and QR code + UPI ID entry on iOS/desktop.
                config: {
                    display: {
                        blocks: {
                            upi: {
                                name: 'Pay via UPI',
                                instruments: [
                                    { method: 'upi', flows: ['intent', 'qr', 'collect'] }
                                ],
                            },
                        },
                        sequence: ['block.upi'],
                        preferences: { show_default_blocks: false },
                    },
                },
                modal: {
                    ondismiss: () => {
                        setPaying(false);
                        // Don't reset step — let user retry without going back through username
                    },
                },
            };

            new window.Razorpay(options).open();
        } catch (err) {
            console.error('Payment initiation error:', err);
            toast({
                title: 'Error',
                description: err instanceof Error ? err.message : 'Could not start payment. Please try again.',
                variant: 'destructive',
            });
            setPaying(false);
            setStep(prefilledId ? 'plans' : 'username');
        }
    };

    // ── Called by Razorpay handler after successful payment ────────────────────
    const verifyPayment = async (response: RazorpayResponse, pack: Pack, user: IgUser) => {
        try {
            const { data, error } = await supabase.functions.invoke('verify-razorpay-payment', {
                body: {
                    instagramUserId: user.instagram_user_id,
                    orderId: response.razorpay_order_id,
                    paymentId: response.razorpay_payment_id,
                    signature: response.razorpay_signature,
                    planType: pack.id,
                    packName: pack.id,
                },
            });

            if (error || !data?.success) throw new Error(data?.error || 'Verification failed');

            setSuccessPack(pack);
            setStep('success');
        } catch (err) {
            console.error('Verify error:', err);
            toast({
                title: 'Activation Pending',
                description: 'Payment received. Credits will appear within 2 minutes.',
                variant: 'destructive',
            });
        } finally {
            setPaying(false);
        }
    };

    // ── Language helpers ───────────────────────────────────────────────────────
    const t = {
        name:     (p: Pack) => lang === 'hi' ? p.nameHi     : p.name,
        messages: (p: Pack) => lang === 'hi' ? p.messagesHi : p.messages,
        validity: (p: Pack) => lang === 'hi' ? p.validityHi : p.validity,
        tag:      (p: Pack) => lang === 'hi' ? (p.tagHi || p.tag) : p.tag,
    };

    // ── Root ───────────────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-black text-white font-sans relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-pink-600/15 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10">
                <AnimatePresence mode="wait">

                    {/* ── STEP: PLANS ────────────────────────────────────────── */}
                    {step === 'plans' && (
                        <motion.div
                            key="plans"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="flex flex-col min-h-screen px-4 py-8 max-w-lg mx-auto"
                        >
                            <LangToggle lang={lang} setLang={setLang} />
                            <ProfileHeader />

                            <div className="text-center mb-6">
                                <h1 className="text-xl font-bold">
                                    {lang === 'hi' ? 'बातचीत जारी रखें 💬' : 'Continue the Conversation 💬'}
                                </h1>
                                <p className="text-sm text-gray-400 mt-1">
                                    {lang === 'hi'
                                        ? 'रिया कुछ बताने वाली थी... 👀 plan चुनो'
                                        : "Riya was mid-story... 👀 Choose a plan to continue"}
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
                                        {/* Fixed-height tag row so all cards align */}
                                        <div className="h-6 mb-1 flex items-center justify-center">
                                            {t.tag(pack) && (
                                                <span className="text-[10px] font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                                                    {t.tag(pack)}
                                                </span>
                                            )}
                                        </div>

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

                            <FooterTrust lang={lang} />
                        </motion.div>
                    )}

                    {/* ── STEP: USERNAME SEARCH ──────────────────────────────── */}
                    {step === 'username' && (
                        <motion.div
                            key="username"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="flex flex-col min-h-screen px-4 py-8 max-w-lg mx-auto"
                        >
                            <LangToggle lang={lang} setLang={setLang} />

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
                                <div className="flex justify-center mb-5">
                                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm">
                                        {selectedPack.icon}
                                        <span className="font-semibold">{t.name(selectedPack)} Pack</span>
                                        <span className="text-gray-400">·</span>
                                        <span className="font-bold">₹{selectedPack.price}</span>
                                    </div>
                                </div>
                            )}

                            <h2 className="text-lg font-bold text-center mb-1">
                                {lang === 'hi' ? 'आप Instagram पर कौन हैं?' : 'Who are you on Instagram?'}
                            </h2>
                            <p className="text-xs text-gray-400 text-center mb-5">
                                {lang === 'hi'
                                    ? 'अपना username type करें — हम आपका account खोज लेंगे'
                                    : "Type your username — we'll find your account"}
                            </p>

                            {/* Search input */}
                            <div className="relative mb-2">
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

                            {/* Search results */}
                            <AnimatePresence>
                                {results.length > 0 && !confirmed && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                        className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden mb-4"
                                    >
                                        {results.map(u => (
                                            <button
                                                key={u.instagram_user_id}
                                                onClick={() => { setConfirmed(u); setResults([]); }}
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

                                {/* No results */}
                                {query.trim().length >= 2 && !searching && results.length === 0 && !confirmed && (
                                    <motion.p
                                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                        className="text-center text-xs text-gray-500 mt-2 mb-4"
                                    >
                                        {lang === 'hi'
                                            ? 'कोई account नहीं मिला। पहले Riya को DM करें, फिर यहाँ आएं!'
                                            : "No account found. DM Riya first on Instagram, then come back!"}
                                    </motion.p>
                                )}
                            </AnimatePresence>

                            {/* Confirmed user card */}
                            <AnimatePresence>
                                {confirmed && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.97 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="rounded-xl border border-pink-500/40 bg-pink-500/10 p-4 mb-4"
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

                            <Button
                                className="w-full h-12 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold text-sm disabled:opacity-40"
                                disabled={!confirmed || paying}
                                onClick={handleConfirmUser}
                            >
                                {lang === 'hi' ? 'आगे बढ़ें →' : 'Continue →'}
                            </Button>

                            <FooterTrust lang={lang} />
                        </motion.div>
                    )}

                    {/* ── STEP: PAYMENT ──────────────────────────────────────── */}
                    {step === 'payment' && (
                        paying ? (
                            <div key="payment-loading" className="flex flex-col items-center justify-center min-h-screen gap-4">
                                <Loader2 className="w-8 h-8 text-pink-400 animate-spin" />
                                <p className="text-sm text-gray-400">
                                    {lang === 'hi' ? 'Payment खुल रही है...' : 'Opening payment...'}
                                </p>
                            </div>
                        ) : (
                            <motion.div
                                key="payment-retry"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex flex-col items-center justify-center min-h-screen px-6 gap-6 text-center"
                            >
                                <ProfileHeader />
                                {selectedPack && igUser && (
                                    <>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-center gap-2">
                                                {selectedPack.icon}
                                                <span className="text-lg font-bold">{t.name(selectedPack)} Pack — ₹{selectedPack.price}</span>
                                            </div>
                                            {igUser.instagram_username && (
                                                <p className="text-xs text-gray-400">@{igUser.instagram_username}</p>
                                            )}
                                        </div>

                                        <Button
                                            className="w-full max-w-xs h-12 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold"
                                            onClick={() => openRazorpay(selectedPack, igUser)}
                                        >
                                            {lang === 'hi' ? 'UPI से Pay करें' : 'Pay via UPI'}
                                        </Button>

                                        <button
                                            onClick={() => setStep(prefilledId ? 'plans' : 'username')}
                                            className="text-xs text-gray-500 hover:text-gray-300 underline"
                                        >
                                            {lang === 'hi' ? 'वापस जाएं' : 'Go back'}
                                        </button>
                                    </>
                                )}
                                <FooterTrust lang={lang} igUserId={igUser?.instagram_user_id} />
                            </motion.div>
                        )
                    )}

                    {/* ── STEP: SUCCESS ───────────────────────────────────────── */}
                    {step === 'success' && (
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
                    )}

                </AnimatePresence>
            </div>
        </div>
    );
};

export default InstagramPayment;
