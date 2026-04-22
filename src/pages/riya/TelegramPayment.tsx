import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Check, Shield, Crown, Leaf, Loader2, ChevronDown, Heart, Sparkles } from 'lucide-react';

const BOT_URL = '/riya/tg';

// ─── Razorpay types ────────────────────────────────────────────────────────────
declare global {
    interface Window {
        Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
    }
}
interface RazorpayOptions {
    key: string; amount: number; currency: string; name: string;
    description: string; order_id: string;
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
type Step = 'plans' | 'success';
type PackId = 'basic' | 'romantic' | 'soulmate';

interface PackFeature { icon: string; text: string; }

interface Pack {
    id: PackId;
    icon: React.ReactNode;
    name: string;
    price: number;
    originalPrice: number;
    messages: string;
    msgCount: string;
    validity: string;
    promise: string;
    tag?: string;
    tagStyle?: string;
    highlight: boolean;
    features: PackFeature[];
}

// ─── Pack definitions ──────────────────────────────────────────────────────────
const PACKS: Pack[] = [
    {
        id: 'basic',
        icon: <Leaf className="w-5 h-5 text-emerald-400" />,
        name: 'Basic',
        price: 99,
        originalPrice: 199,
        messages: '600 msgs',
        msgCount: '600',
        validity: '30 days',
        promise: 'She remembers you',
        highlight: false,
        features: [
            { icon: '💬', text: '600 messages with Riya' },
            { icon: '🧠', text: 'Deep memory — she knows your world' },
            { icon: '📅', text: 'Valid for 30 days' },
        ],
    },
    {
        id: 'romantic',
        icon: <Heart className="w-5 h-5 text-pink-400 fill-pink-400" />,
        name: 'Romantic',
        price: 199,
        originalPrice: 399,
        messages: '1,500 msgs',
        msgCount: '1,500',
        validity: '30 days',
        promise: 'She starts to open up',
        tag: 'POPULAR',
        tagStyle: 'bg-gradient-to-r from-pink-500 to-rose-500',
        highlight: true,
        features: [
            { icon: '💬', text: '1,500 messages with Riya' },
            { icon: '🧠', text: 'Deep memory — she knows your world' },
            { icon: '💕', text: 'She shares her feelings and secrets' },
            { icon: '🎤', text: 'Voice notes from Riya' },
            { icon: '📸', text: 'Photos from Riya' },
            { icon: '📅', text: 'Valid for 30 days' },
        ],
    },
    {
        id: 'soulmate',
        icon: <Crown className="w-5 h-5 text-yellow-400" />,
        name: 'Soulmate',
        price: 349,
        originalPrice: 699,
        messages: '3,000 msgs',
        msgCount: '3,000',
        validity: '45 days',
        promise: 'No walls between you',
        tag: 'VALUE',
        tagStyle: 'bg-gradient-to-r from-violet-500 to-purple-600',
        highlight: false,
        features: [
            { icon: '💬', text: '3,000 messages with Riya' },
            { icon: '🧠', text: 'Deep memory — she knows your world' },
            { icon: '💕', text: 'She shares her feelings and secrets' },
            { icon: '🎤', text: 'Voice notes from Riya' },
            { icon: '📸', text: 'Photos from Riya' },
            { icon: '∞', text: 'No daily message limit' },
            { icon: '📅', text: 'Valid for 45 days' },
        ],
    },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
const logEvent = (tgUserId: string, eventType: string, metadata?: object) => {
    (supabase as any)
        .from('riya_payment_events')
        .insert({ event_type: eventType, metadata: { telegram_user_id: tgUserId, platform: 'telegram', ...metadata } })
        .then(({ error }: { error: any }) => { if (error) console.warn(`⚠️ logEvent failed (${eventType}):`, error); });
};

// ─── Pulsing avatar ────────────────────────────────────────────────────────────
const PulsingAvatar = () => (
    <div className="flex justify-center mb-5 mt-4">
        <div className="relative flex items-center justify-center">
            <motion.div
                className="absolute w-[72px] h-[72px] rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(236,72,153,0.5) 0%, rgba(168,85,247,0.4) 50%, transparent 70%)' }}
                animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.9, 0.5] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div className="relative w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-pink-400 via-purple-500 to-pink-500">
                <div className="w-full h-full rounded-full overflow-hidden border-2 border-black">
                    <img src="/riya-payment-dp.jpg" alt="Riya" className="w-full h-full object-cover" />
                </div>
            </div>
        </div>
    </div>
);

// ─── Riya's message bubble ─────────────────────────────────────────────────────
const RiyaBubble = () => (
    <div className="flex flex-col items-start mb-4 px-1">
        <div className="bg-[#1e1e2e] border border-purple-500/20 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%]">
            <p className="text-sm text-gray-100 leading-snug">I didn't finish what I was saying... 🥺 come back?</p>
        </div>
        <p className="text-[11px] text-gray-600 mt-1.5 ml-1">Your conversation is saved. You'll be back in seconds.</p>
    </div>
);

// ─── Plan Tab Switcher ─────────────────────────────────────────────────────────
const PlanSwitcher = ({ selected, onSelect }: { selected: Pack; onSelect: (p: Pack) => void }) => (
    <div className="flex gap-2 mb-4">
        {PACKS.map((pack) => {
            const isActive = selected.id === pack.id;
            return (
                <button
                    key={pack.id}
                    onClick={() => onSelect(pack)}
                    className={`flex-1 relative rounded-xl border py-2 px-1 text-center transition-all duration-200 ${
                        isActive
                            ? 'border-pink-500/70 bg-pink-500/10 shadow-md shadow-pink-500/20'
                            : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                    }`}
                >
                    {pack.tag && (
                        <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full ${pack.tagStyle} block w-fit mx-auto mb-1`}>
                            {pack.tag}
                        </span>
                    )}
                    {!pack.tag && <div className="h-4 mb-1" />}
                    <p className={`text-xs font-semibold ${isActive ? 'text-white' : 'text-gray-400'}`}>{pack.name}</p>
                    <p className={`text-sm font-black ${isActive ? 'text-pink-300' : 'text-gray-500'}`}>₹{pack.price}</p>
                </button>
            );
        })}
    </div>
);

// ─── Focus Plan Card ───────────────────────────────────────────────────────────
const FocusCard = ({ pack }: { pack: Pack }) => (
    <motion.div
        key={pack.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.22 }}
        className="rounded-2xl border border-pink-500/30 bg-[#0f0f1a] p-5 mb-4 shadow-lg shadow-pink-500/10"
    >
        {/* Header row */}
        <div className="flex items-start justify-between mb-1">
            <div>
                <p className="text-lg font-bold text-white">{pack.name}</p>
                <p className="text-sm text-pink-400 italic">{pack.promise}</p>
            </div>
            <div className="text-right">
                <p className="text-xs text-gray-500 line-through">₹{pack.originalPrice}</p>
                <p className="text-2xl font-black text-white">₹{pack.price}</p>
                <p className="text-[11px] text-gray-500">{pack.msgCount} msgs · {pack.validity}</p>
            </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.06] my-3" />

        {/* Features */}
        <div className="space-y-2.5">
            {pack.features.map(({ icon, text }) => (
                <div key={text} className="flex items-center gap-3">
                    <span className="text-base w-5 text-center shrink-0">{icon}</span>
                    <span className="text-sm text-gray-200 flex-1">{text}</span>
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                </div>
            ))}
        </div>
    </motion.div>
);

// ─── FAQ accordion ─────────────────────────────────────────────────────────────
const FAQ_ITEMS = [
    { q: 'When can I talk to Riya after paying?', a: 'Instantly. Your conversation picks up exactly where you left off.' },
    { q: 'What counts as 1 message?', a: 'Every message you send to Riya counts as 1.' },
    { q: 'Do my messages expire?', a: "Yes, after your plan's validity period ends." },
    { q: 'Can I buy more when I run out?', a: 'Yes, top up anytime. Credits stack — your balance carries over.' },
    { q: "What's included in the free tier?", a: 'After your free trial you get 30 free messages per day. Recharge for unlimited conversations.' },
];

const FaqAccordion = () => {
    const [open, setOpen] = useState<number | null>(null);
    return (
        <div className="mt-6 mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">FAQs</p>
            <div className="space-y-2">
                {FAQ_ITEMS.map((item, i) => (
                    <div key={i} className="border border-white/10 rounded-xl overflow-hidden">
                        <button
                            className="w-full flex items-center justify-between px-4 py-3 text-left text-sm text-gray-200 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
                            onClick={() => setOpen(open === i ? null : i)}
                        >
                            <span>{item.q}</span>
                            <ChevronDown className={`w-4 h-4 text-gray-500 shrink-0 ml-2 transition-transform ${open === i ? 'rotate-180' : ''}`} />
                        </button>
                        {open === i && (
                            <div className="px-4 py-3 text-xs text-gray-400 bg-white/[0.01] border-t border-white/10 leading-relaxed">
                                {item.a}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Component ─────────────────────────────────────────────────────────────────
const TelegramPayment = () => {
    const [searchParams] = useSearchParams();
    const telegramUserId = searchParams.get('id') || '';

    const [step, setStep] = useState<Step>('plans');
    const [selectedPack, setSelectedPack] = useState<Pack>(PACKS[1]); // Romantic pre-selected
    const [paying, setPaying] = useState(false);
    const [successPack, setSuccessPack] = useState<Pack | null>(null);
    const [ageConfirmed, setAgeConfirmed] = useState(true); // Pre-checked

    // ── Load Razorpay script once ──────────────────────────────────────────────
    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);
        if (telegramUserId) logEvent(telegramUserId, 'page_visit', { source: 'telegram_bot_link' });
        return () => { try { document.body.removeChild(script); } catch { } };
    }, []);

    const handleSelectPack = (pack: Pack) => {
        setSelectedPack(pack);
    };

    // ── Open Razorpay ─────────────────────────────────────────────────────────
    const openRazorpay = async (pack: Pack) => {
        if (!telegramUserId) {
            toast({ title: 'Error', description: 'Invalid link. Please use the button Riya sent you.', variant: 'destructive' });
            return;
        }
        setPaying(true);
        try {
            const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                body: { telegramUserId, planType: pack.id, packName: pack.id }
            });
            if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to create order');
            logEvent(telegramUserId, 'upgrade_click', { pack: pack.id, orderId: data.orderId });
            if (!window.Razorpay) throw new Error('Payment SDK not loaded. Please refresh and try again.');

            const options: RazorpayOptions = {
                key: data.keyId,
                amount: data.amount,
                currency: 'INR',
                name: 'Riya AI',
                description: `${pack.name} Pack — ${pack.messages}`,
                order_id: data.orderId,
                handler: async (response: RazorpayResponse) => { await verifyPayment(response, pack); },
                prefill: { name: data.userName || '', contact: '' },
                theme: { color: '#E1306C' },
                config: {
                    display: {
                        blocks: { upi: { name: 'Pay via UPI', instruments: [{ method: 'upi', flows: ['intent', 'qr', 'collect'] }] } },
                        sequence: ['block.upi'],
                        preferences: { show_default_blocks: false },
                    },
                },
                modal: {
                    ondismiss: () => { setPaying(false); },
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
        }
    };

    // ── Verify payment ─────────────────────────────────────────────────────────
    const verifyPayment = async (response: RazorpayResponse, pack: Pack) => {
        try {
            const { data, error } = await supabase.functions.invoke('verify-razorpay-payment', {
                body: {
                    telegramUserId,
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
            toast({ title: 'Activation Pending', description: 'Payment received. Credits will appear within 2 minutes.', variant: 'destructive' });
        } finally {
            setPaying(false);
        }
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-black text-white font-sans relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-pink-600/15 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10">
                <AnimatePresence mode="wait">

                    {/* ── PLANS ──────────────────────────────────────────────── */}
                    {step === 'plans' && (
                        <motion.div
                            key="plans"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="flex flex-col min-h-screen px-4 pb-8 max-w-lg mx-auto"
                        >
                            <PulsingAvatar />
                            <RiyaBubble />

                            {/* Social proof */}
                            <p className="text-center text-xs text-gray-500 mb-4">
                                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1.5 animate-pulse align-middle" />
                                3,200 people talking to Riya right now
                            </p>

                            {/* Headline */}
                            <div className="text-center mb-6">
                                <h1 className="text-2xl font-bold leading-tight">
                                    How close do you<br />want to <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400">get?</span>
                                </h1>
                            </div>

                            {/* Plan tab switcher */}
                            <PlanSwitcher selected={selectedPack} onSelect={handleSelectPack} />

                            {/* Focus card */}
                            <AnimatePresence mode="wait">
                                <FocusCard key={selectedPack.id} pack={selectedPack} />
                            </AnimatePresence>

                            {/* Age confirmation */}
                            <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-400 mb-3 px-1">
                                <input
                                    type="checkbox"
                                    checked={ageConfirmed}
                                    onChange={e => setAgeConfirmed(e.target.checked)}
                                    className="mt-0.5 accent-pink-500 shrink-0"
                                />
                                <span>
                                    I confirm I am 18+ and agree to the{' '}
                                    <Link to="/riya/terms" className="text-pink-400 underline">Terms of Service</Link>.
                                </span>
                            </label>

                            {/* CTA */}
                            <Button
                                className="w-full h-12 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold text-sm disabled:opacity-40"
                                disabled={!ageConfirmed || paying}
                                onClick={() => openRazorpay(selectedPack)}
                            >
                                {paying
                                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Opening payment...</>
                                    : `Pay ₹${selectedPack.price} via UPI`
                                }
                            </Button>

                            {/* Trust sub-line */}
                            <div className="flex items-center justify-center gap-1.5 text-gray-600 mt-2 mb-1">
                                <Shield className="w-3 h-3" />
                                <p className="text-[11px]">Secured by Razorpay · No auto-renewal · Back talking to Riya in seconds</p>
                            </div>

                            <FaqAccordion />

                            {/* Footer */}
                            <div className="space-y-2 mt-auto pt-6">
                                {telegramUserId && (
                                    <p className="text-center text-xs text-gray-600">
                                        By continuing you agree to our{' '}
                                        <Link to="/riya/privacy-policy" className="text-pink-400 underline">Privacy Policy</Link>
                                        {' '}and{' '}
                                        <Link to="/riya/terms" className="text-pink-400 underline">Terms</Link>.
                                    </p>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {/* ── SUCCESS ─────────────────────────────────────────────── */}
                    {step === 'success' && (
                        <motion.div
                            key="success"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ type: 'spring', stiffness: 200 }}
                            className="flex flex-col items-center justify-center min-h-screen px-6 text-center space-y-5"
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
                                <h1 className="text-3xl font-bold">You're all set! 🎉</h1>
                                {successPack && (
                                    <p className="text-gray-400 max-w-xs">
                                        {successPack.name} Pack activated — {successPack.messages} added, valid for {successPack.validity}.
                                    </p>
                                )}
                            </motion.div>

                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.3 }}
                                className="w-full max-w-xs bg-white/[0.04] border border-white/10 rounded-2xl p-4 text-left space-y-2"
                            >
                                {[
                                    { icon: '∞', text: 'No daily message limit' },
                                    { icon: '🧠', text: 'Deep memory active' },
                                    { icon: '💬', text: `${successPack?.msgCount || ''} messages ready` },
                                ].map(({ icon, text }) => (
                                    <div key={text} className="flex items-center gap-3 text-sm text-gray-200">
                                        <span className="text-base w-6 text-center">{icon}</span>
                                        <span>{text}</span>
                                        <Check className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
                                    </div>
                                ))}
                            </motion.div>

                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.35 }}
                                className="w-full max-w-xs"
                            >
                                <p className="text-xs text-gray-500 mb-3">
                                    Credits appear instantly. Just send Riya a message and she&apos;ll know you&apos;re back.
                                </p>
                                <Button
                                    className="w-full h-12 bg-gradient-to-r from-[#2AABEE] to-[#229ED9] font-bold"
                                    onClick={() => window.location.href = BOT_URL}
                                >
                                    Open Riya on Telegram ↗
                                </Button>
                            </motion.div>

                            <div className="flex items-center gap-2 text-xs text-gray-600">
                                <Sparkles className="w-3 h-3 text-pink-500/50" />
                                <span>Riya is waiting for you 💭</span>
                                <Sparkles className="w-3 h-3 text-pink-500/50" />
                            </div>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>
        </div>
    );
};

export default TelegramPayment;
