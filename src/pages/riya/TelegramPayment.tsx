import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import {
    Heart, Sparkles, Check, Shield, Crown, Leaf, Loader2, ChevronDown,
} from 'lucide-react';

const BOT_URL = '/riya/tg';

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

type Step = 'plans' | 'confirm' | 'payment' | 'success';

// ─── FAQ ──────────────────────────────────────────────────────────────────────

const FAQ_ITEMS = [
    {
        q: 'When do credits appear?',
        a: 'Instantly after payment. Send Riya any message and she\'ll have your credits — no need to restart the chat.',
    },
    {
        q: 'What counts as 1 message?',
        a: 'Each reply from Riya uses 1 credit — whether it\'s text, a voice note, or a photo. Your message to her doesn\'t count.',
    },
    {
        q: 'Do credits expire?',
        a: 'Basic and Romantic packs are valid for 30 days. Soulmate is valid for 45 days. Unused credits at expiry are forfeited, but you can buy again anytime.',
    },
    {
        q: 'What if my payment fails?',
        a: 'If you were charged but credits didn\'t appear after 5 minutes, send a message to @thisisriya_bot with "recharge issue" and your UPI transaction ID.',
    },
    {
        q: 'Can I buy more when credits run out?',
        a: 'Yes — credits stack. If you have 50 credits left and buy a Basic pack, you\'ll have 650 credits. The validity resets to the new pack\'s duration from today.',
    },
    {
        q: 'What\'s included in free tier?',
        a: 'After your 100-message free trial, you get 30 free messages per day (text only). Voice notes and photos require a paid pack.',
    },
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
type PackId = 'basic' | 'romantic' | 'soulmate';

interface Pack {
    id: PackId;
    icon: React.ReactNode;
    name: string;
    price: number;
    originalPrice: number;
    messages: string;
    validity: string;
    tag?: string;
    highlight: boolean;
    btnClass: string;
}

// ─── Pack definitions ──────────────────────────────────────────────────────────

const PACKS: Pack[] = [
    {
        id: 'basic',
        icon: <Leaf className="w-5 h-5 text-emerald-400" />,
        name: 'Basic',
        price: 99, originalPrice: 199,
        messages: '600 msgs',
        validity: '30 days',
        highlight: false,
        btnClass: 'bg-emerald-700 hover:bg-emerald-600 border border-emerald-500/60',
    },
    {
        id: 'romantic',
        icon: <Heart className="w-5 h-5 text-pink-400 fill-pink-400" />,
        name: 'Romantic',
        price: 199, originalPrice: 399,
        messages: '1,500 msgs',
        validity: '30 days',
        tag: '💖 Most Popular',
        highlight: true,
        btnClass: 'bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90',
    },
    {
        id: 'soulmate',
        icon: <Crown className="w-5 h-5 text-yellow-400" />,
        name: 'Soulmate',
        price: 349, originalPrice: 699,
        messages: '3,000 msgs',
        validity: '45 days',
        tag: '👑 Best Value',
        highlight: false,
        btnClass: 'bg-amber-700 hover:bg-amber-600 border border-amber-500/60',
    },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

const logEvent = (tgUserId: string, eventType: string, metadata?: object) => {
    (supabase as any)
        .from('riya_payment_events')
        .insert({
            event_type: eventType,
            metadata: { telegram_user_id: tgUserId, platform: 'telegram', ...metadata }
        })
        .then(({ error }: { error: any }) => {
            if (error) console.warn(`⚠️ logEvent failed (${eventType}):`, error);
        });
};

// ─── Shared UI ─────────────────────────────────────────────────────────────────

const ProfileHeader = () => (
    <div className="flex justify-center mb-5">
        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
            <div className="w-full h-full rounded-full overflow-hidden border-2 border-black">
                <img src="/riya-payment-dp.jpg" alt="Riya" className="w-full h-full object-cover" />
            </div>
        </div>
    </div>
);

const FooterTrust = ({ tgUserId }: { tgUserId?: string }) => (
    <div className="space-y-2 mt-auto pt-6">
        <p className="text-center text-xs text-gray-500">
            By using this service you confirm you are 18 years of age or older.
        </p>
        <div className="flex items-center justify-center gap-1.5 text-gray-500">
            <Shield className="w-3 h-3" />
            <p className="text-xs">Secured by Razorpay · No auto-renewal</p>
        </div>
        {tgUserId && (
            <p className="text-center text-xs text-gray-600">
                By continuing you agree to our{' '}
                <Link to="/riya/privacy-policy" className="text-pink-400 underline">Privacy Policy</Link>
                {' '}and{' '}
                <Link to="/riya/terms" className="text-pink-400 underline">Terms</Link>.
            </p>
        )}
    </div>
);

// ─── Component ─────────────────────────────────────────────────────────────────

const TelegramPayment = () => {
    const [searchParams] = useSearchParams();
    // ?id=<telegramUserId> — always present (sent by the bot in the recharge link)
    const telegramUserId = searchParams.get('id') || '';

    const [step, setStep] = useState<Step>('plans');
    const [selectedPack, setSelectedPack] = useState<Pack | null>(null);
    const [paying, setPaying] = useState(false);
    const [successPack, setSuccessPack] = useState<Pack | null>(null);
    const [ageConfirmed, setAgeConfirmed] = useState(false);

    // ── Load Razorpay script once ──────────────────────────────────────────────
    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);

        if (telegramUserId) logEvent(telegramUserId, 'page_visit', { source: 'telegram_bot_link' });

        return () => { try { document.body.removeChild(script); } catch { } };
    }, []);

    // ── Plan selected → go to confirm (age gate) ──────────────────────────────
    const handleSelectPlan = (pack: Pack) => {
        setSelectedPack(pack);
        setAgeConfirmed(false);
        setStep('confirm');
    };

    // ── Open Razorpay checkout ─────────────────────────────────────────────────
    const openRazorpay = async (pack: Pack) => {
        if (!telegramUserId) {
            toast({ title: 'Error', description: 'Invalid link. Please use the button Riya sent you.', variant: 'destructive' });
            return;
        }

        setPaying(true);
        setStep('payment');

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
                handler: async (response: RazorpayResponse) => {
                    await verifyPayment(response, pack);
                },
                prefill: { name: data.userName || '', contact: '' },
                theme: { color: '#E1306C' },
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
                        setStep('confirm');
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
            setStep('confirm');
        }
    };

    // ── Verify after Razorpay handler fires ───────────────────────────────────
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
            toast({
                title: 'Activation Pending',
                description: 'Payment received. Credits will appear within 2 minutes.',
                variant: 'destructive',
            });
        } finally {
            setPaying(false);
        }
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
                            <ProfileHeader />

                            <div className="text-center mb-6">
                                <h1 className="text-xl font-bold">Unlock the full experience 💬</h1>
                                <p className="text-sm text-gray-400 mt-1">Voice notes, photos & unlimited daily messages</p>
                            </div>

                            {/* Feature highlights */}
                            <div className="grid grid-cols-3 gap-2 mb-6 text-center text-xs text-gray-400">
                                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
                                    <div className="text-lg mb-1">🎤</div>
                                    <p>Voice notes</p>
                                </div>
                                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
                                    <div className="text-lg mb-1">📸</div>
                                    <p>Photos from Riya</p>
                                </div>
                                <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
                                    <div className="text-lg mb-1">∞</div>
                                    <p>No daily limit</p>
                                </div>
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
                                        <div className="h-6 mb-1 flex items-center justify-center">
                                            {pack.tag && (
                                                <span className="text-[10px] font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                                                    {pack.tag}
                                                </span>
                                            )}
                                        </div>

                                        <div
                                            className={`flex-1 rounded-2xl border p-3 cursor-pointer transition-all active:scale-95 ${pack.highlight
                                                ? 'border-pink-500 bg-pink-500/10 shadow-lg shadow-pink-500/20'
                                                : 'border-white/10 bg-white/[0.02]'
                                                }`}
                                            onClick={() => handleSelectPlan(pack)}
                                        >
                                            <div className="flex justify-center mb-2">{pack.icon}</div>
                                            <p className="text-center font-bold text-sm mb-2">{pack.name}</p>
                                            <div className="text-center mb-2">
                                                <p className="text-[10px] text-gray-500 line-through">₹{pack.originalPrice}</p>
                                                <p className="text-2xl font-black">₹{pack.price}</p>
                                            </div>
                                            <ul className="space-y-1 mt-2">
                                                {[pack.messages, pack.validity].map((f, fi) => (
                                                    <li key={fi} className="flex items-center gap-1 text-[10px] text-gray-300">
                                                        <Check className={`w-2.5 h-2.5 shrink-0 ${pack.highlight ? 'text-pink-400' : 'text-emerald-400'}`} />
                                                        {f}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>

                                        <Button
                                            className={`mt-2 w-full h-10 text-xs font-bold rounded-xl transition-all ${pack.btnClass}`}
                                            onClick={() => handleSelectPlan(pack)}
                                        >
                                            Get {pack.name}
                                        </Button>
                                    </motion.div>
                                ))}
                            </div>

                            <p className="text-center text-xs text-gray-600 mb-2">
                                🎤 Voice notes + 📸 Photos included in all plans
                            </p>

                            <FaqAccordion />

                            <FooterTrust tgUserId={telegramUserId} />
                        </motion.div>
                    )}

                    {/* ── STEP: CONFIRM (age gate + pay button) ─────────────── */}
                    {step === 'confirm' && selectedPack && (
                        <motion.div
                            key="confirm"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="flex flex-col min-h-screen px-4 py-8 max-w-lg mx-auto"
                        >
                            <ProfileHeader />

                            <div className="flex justify-center mb-6">
                                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm">
                                    {selectedPack.icon}
                                    <span className="font-semibold">{selectedPack.name} Pack</span>
                                    <span className="text-gray-400">·</span>
                                    <span className="font-bold">₹{selectedPack.price}</span>
                                </div>
                            </div>

                            <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 mb-6 space-y-2">
                                {[
                                    { icon: '💬', text: `${selectedPack.messages} messages` },
                                    { icon: '🎤', text: 'Voice notes unlocked' },
                                    { icon: '📸', text: 'Photos from Riya' },
                                    { icon: '📅', text: `Valid for ${selectedPack.validity}` },
                                ].map(({ icon, text }) => (
                                    <div key={text} className="flex items-center gap-3 text-sm text-gray-300">
                                        <span className="text-base">{icon}</span>
                                        <span>{text}</span>
                                        <Check className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
                                    </div>
                                ))}
                            </div>

                            <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-400 mb-6">
                                <input
                                    type="checkbox"
                                    checked={ageConfirmed}
                                    onChange={e => setAgeConfirmed(e.target.checked)}
                                    className="mt-0.5 accent-pink-500"
                                />
                                <span>I am 18 or older and agree to the Terms of Service.</span>
                            </label>

                            <Button
                                className="w-full h-12 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold text-sm disabled:opacity-40 mb-3"
                                disabled={!ageConfirmed || paying}
                                onClick={() => openRazorpay(selectedPack)}
                            >
                                Pay ₹{selectedPack.price} via UPI
                            </Button>

                            <button
                                onClick={() => setStep('plans')}
                                className="text-xs text-gray-500 hover:text-gray-300 underline text-center w-full"
                            >
                                Go back
                            </button>

                            <FooterTrust tgUserId={telegramUserId} />
                        </motion.div>
                    )}

                    {/* ── STEP: PAYMENT (loading) ────────────────────────────── */}
                    {step === 'payment' && paying && (
                        <div key="payment-loading" className="flex flex-col items-center justify-center min-h-screen gap-4">
                            <Loader2 className="w-8 h-8 text-pink-400 animate-spin" />
                            <p className="text-sm text-gray-400">Opening payment...</p>
                        </div>
                    )}

                    {/* ── STEP: SUCCESS ───────────────────────────────────────── */}
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
                                <h1 className="text-3xl font-bold">You&apos;re all set! 🎉</h1>
                                {successPack && (
                                    <p className="text-gray-400 max-w-xs">
                                        <span className="text-white font-semibold">{successPack.name} Pack</span> activated —{' '}
                                        {successPack.messages} added, valid for {successPack.validity}.
                                    </p>
                                )}
                            </motion.div>

                            {/* What's unlocked */}
                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                transition={{ delay: 0.3 }}
                                className="w-full max-w-xs bg-white/[0.04] border border-white/10 rounded-2xl p-4 text-left space-y-2"
                            >
                                {[
                                    { icon: '🎤', text: 'Voice notes from Riya' },
                                    { icon: '📸', text: 'Photos from Riya' },
                                    { icon: '∞', text: 'No daily message limit' },
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
