import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Heart, Sparkles, Check, Shield, X, Crown, Leaf, Zap } from 'lucide-react';

// ─── Razorpay Types ───────────────────────────────────────────────────────────
declare global {
    interface Window {
        Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
    }
}
interface RazorpayOptions {
    key: string; amount: number; currency: string; name: string;
    description: string; order_id: string;
    handler: (response: RazorpayResponse) => void;
    prefill: { name: string; email: string };
    theme: { color: string };
    modal?: { ondismiss?: () => void };
}
interface RazorpayInstance { open: () => void; on: (event: string, handler: () => void) => void; }
interface RazorpayResponse { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Safe fire-and-forget analytics event. Uses .then() because Supabase
// returns a PromiseLike, not a full Promise (no .catch on it directly).
const logEvent = (igUserId: string, eventType: string, metadata?: object) => {
    (supabase as any)
        .from('riya_payment_events')
        .insert({ instagram_user_id: igUserId, event_type: eventType, ...(metadata ? { metadata } : {}) })
        .then(({ error }: { error: any }) => {
            if (error) console.warn(`⚠️ Failed to log ${eventType}:`, error);
        });
};

// ─── Pack Definitions ─────────────────────────────────────────────────────────
type PackName = 'basic' | 'romantic' | 'soulmate';

interface Pack {
    id: PackName;
    planType: PackName;
    icon: React.ReactNode;
    name: string;
    price: number;
    originalPrice: number;
    messages: string;
    validity: string;
    tag?: string;
    highlight: boolean;
    features: string[];
}

const PACKS: Pack[] = [
    {
        id: 'basic', planType: 'basic',
        icon: <Leaf className="w-5 h-5 text-emerald-400" />,
        name: 'Basic', price: 79, originalPrice: 149,
        messages: '600 msgs', validity: '30 days',
        highlight: false,
        features: ['600 messages', 'Unlimited photos', '30 days'],
    },
    {
        id: 'romantic', planType: 'romantic',
        icon: <Heart className="w-5 h-5 text-pink-400 fill-pink-400" />,
        name: 'Romantic', price: 149, originalPrice: 299,
        messages: '1,500 msgs', validity: '30 days',
        tag: '💖 Most Popular',
        highlight: true,
        features: ['1,500 messages', 'Unlimited photos', '30 days'],
    },
    {
        id: 'soulmate', planType: 'soulmate',
        icon: <Crown className="w-5 h-5 text-yellow-400" />,
        name: 'Soulmate', price: 249, originalPrice: 499,
        messages: '3,000 msgs', validity: '45 days',
        highlight: false,
        features: ['3,000 messages', 'Unlimited photos', '45 days'],
    },
];

// ─── Component ────────────────────────────────────────────────────────────────
const InstagramPayment = () => {
    const [searchParams] = useSearchParams();
    const instagramUserId = searchParams.get('id');
    const [selectedPack, setSelectedPack] = useState<PackName>('romantic');
    const [loadingPack, setLoadingPack] = useState<PackName | null>(null);
    const [isSuccess, setIsSuccess] = useState<{ pack: Pack } | null>(null);
    const [showFullImage, setShowFullImage] = useState(false);

    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);

        if (instagramUserId) logEvent(instagramUserId, 'page_visit', { page: 'recharge' });

        return () => { try { document.body.removeChild(script); } catch { } };
    }, []);

    const handlePayment = async (pack: Pack) => {
        if (!instagramUserId) {
            toast({ title: 'Error', description: 'Invalid link. Open from Instagram DM again.', variant: 'destructive' });
            return;
        }

        logEvent(instagramUserId, 'upgrade_click', { pack: pack.id });
        setLoadingPack(pack.id);

        try {
            const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                body: { instagramUserId, planType: pack.planType, packName: pack.id }
            });

            if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to create order');

            const options: RazorpayOptions = {
                key: data.keyId, amount: data.amount, currency: data.currency,
                name: 'Riya Singh',
                description: `${pack.name} Pack — ${pack.messages}`,
                order_id: data.orderId,
                handler: async (response: RazorpayResponse) => { await verifyPayment(response, pack); },
                prefill: { name: 'Instagram User', email: '' },
                theme: { color: '#E1306C' },
                modal: { ondismiss: () => setLoadingPack(null) }
            };

            new window.Razorpay(options).open();

        } catch (err) {
            console.error('Payment error:', err);
            toast({ title: 'Payment Failed', description: 'Could not start payment. Please try again.', variant: 'destructive' });
            setLoadingPack(null);
        }
    };

    const verifyPayment = async (response: RazorpayResponse, pack: Pack) => {
        try {
            const { data, error } = await supabase.functions.invoke('verify-razorpay-payment', {
                body: {
                    instagramUserId,
                    orderId: response.razorpay_order_id,
                    paymentId: response.razorpay_payment_id,
                    signature: response.razorpay_signature,
                    planType: pack.planType,
                    packName: pack.id,
                }
            });

            if (error || !data?.success) throw new Error(data?.error || 'Verification failed');

            setIsSuccess({ pack });
            toast({ title: '🎉 Credits Added!', description: `${pack.messages} unlocked. Go back to Instagram!` });
        } catch (err) {
            console.error('Verify error:', err);
            toast({
                title: 'Activation Pending',
                description: 'Payment received. Credits appear in 1-2 min.',
                variant: 'destructive'
            });
        } finally {
            setLoadingPack(null);
        }
    };

    // ── Invalid Link ───────────────────────────────────────────────────────────
    if (!instagramUserId) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-black text-white p-4 text-center">
                <div className="space-y-3">
                    <p className="text-4xl">🔗</p>
                    <p className="font-semibold">Invalid link</p>
                    <p className="text-sm text-gray-400">Open the link sent by Riya in your Instagram DM.</p>
                </div>
            </div>
        );
    }

    // ── Success Screen ─────────────────────────────────────────────────────────
    if (isSuccess) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white p-6 text-center space-y-6">
                <motion.div
                    initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
                    className="w-24 h-24 rounded-full bg-pink-500/20 border border-pink-500/40 flex items-center justify-center"
                >
                    <Check className="w-12 h-12 text-pink-400" />
                </motion.div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="space-y-2">
                    <h1 className="text-3xl font-bold">Credits Added! 🎉</h1>
                    <p className="text-gray-400 max-w-xs">
                        <span className="text-white font-semibold">{isSuccess.pack.messages}</span> added.
                        Go back to Instagram — Riya's waiting 💖
                    </p>
                </motion.div>
                <Button
                    className="w-full max-w-xs h-12 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold"
                    onClick={() => window.location.href = 'https://instagram.com/'}
                >
                    Open Instagram ↗
                </Button>
            </div>
        );
    }

    // ── Main Page ──────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-black text-white font-sans relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-pink-600/15 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 max-w-lg mx-auto min-h-screen flex flex-col px-4 py-8">

                {/* Header */}
                <div className="text-center mb-6 space-y-3">
                    <div
                        className="mx-auto w-20 h-20 rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 cursor-pointer"
                        onClick={() => setShowFullImage(true)}
                    >
                        <div className="w-full h-full rounded-full overflow-hidden border-2 border-black">
                            <img src="/riya-payment-dp.jpg" alt="Riya" className="w-full h-full object-cover" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-xl font-bold">Continue the Conversation 💬</h1>
                        <p className="text-sm text-gray-400 mt-1">
                            Riya was mid-story... 👀 Top up to hear the ending
                        </p>
                    </div>
                </div>

                {/* Horizontal Pack Cards */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                    {PACKS.map((pack, i) => {
                        const isSelected = selectedPack === pack.id;
                        const isLoadingThis = loadingPack === pack.id;
                        return (
                            <motion.div
                                key={pack.id}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.07 }}
                                className="flex flex-col"
                            >
                                {/* Tag above card */}
                                <div className="h-6 mb-1 flex items-center justify-center">
                                    {pack.tag && (
                                        <span className="text-[10px] font-bold bg-gradient-to-r from-pink-500 to-rose-500 text-white px-2 py-0.5 rounded-full">
                                            {pack.tag}
                                        </span>
                                    )}
                                </div>

                                {/* Card */}
                                <button
                                    onClick={() => setSelectedPack(pack.id)}
                                    className={`flex-1 rounded-2xl border p-3 text-left transition-all duration-200 ${isSelected
                                        ? pack.highlight
                                            ? 'border-pink-500 bg-pink-500/10 shadow-lg shadow-pink-500/20'
                                            : 'border-white/50 bg-white/5'
                                        : 'border-white/10 bg-white/2 hover:border-white/25'
                                        }`}
                                >
                                    <div className="flex justify-center mb-2">{pack.icon}</div>
                                    <p className="text-center font-bold text-sm mb-2">{pack.name}</p>
                                    <div className="text-center mb-2">
                                        <p className="text-[10px] text-gray-500 line-through">₹{pack.originalPrice}</p>
                                        <p className="text-2xl font-black">₹{pack.price}</p>
                                    </div>
                                    <ul className="space-y-1 mt-2">
                                        {pack.features.map((f, fi) => (
                                            <li key={fi} className="flex items-center gap-1 text-[10px] text-gray-300">
                                                <Check className={`w-2.5 h-2.5 shrink-0 ${pack.highlight ? 'text-pink-400' : 'text-emerald-400'}`} />
                                                {f}
                                            </li>
                                        ))}
                                    </ul>
                                </button>

                                {/* Per-card CTA */}
                                <Button
                                    className={`mt-2 w-full h-10 text-xs font-bold rounded-xl transition-all disabled:opacity-50
                                        ${pack.highlight
                                            ? 'bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90'
                                            : 'bg-white/10 border border-white/20 hover:bg-white/20'
                                        }`}
                                    onClick={() => handlePayment(pack)}
                                    disabled={loadingPack !== null}
                                >
                                    {isLoadingThis ? (
                                        <span className="flex items-center justify-center gap-1">
                                            <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                                        </span>
                                    ) : (
                                        `Get ${pack.name}`
                                    )}
                                </Button>
                            </motion.div>
                        );
                    })}
                </div>

                {loadingPack && (
                    <p className="text-center text-xs text-yellow-400 animate-pulse mb-3">
                        ⚠️ Do not close this window
                    </p>
                )}

                {/* Footer trust */}
                <div className="space-y-2 mt-auto">
                    <div className="flex items-center justify-center gap-1.5 text-gray-500">
                        <Shield className="w-3 h-3" />
                        <p className="text-xs">Secured by Razorpay · No auto-renewal</p>
                    </div>
                    <p className="text-center text-xs text-gray-600">
                        By continuing you agree to our{' '}
                        <Link to={`/riya/privacy-policy?returnPath=${encodeURIComponent(`/riya/pay/instagram?id=${instagramUserId}`)}`}
                            className="text-pink-400 underline">Privacy Policy</Link>
                        {' '}and{' '}
                        <Link to={`/riya/terms?returnPath=${encodeURIComponent(`/riya/pay/instagram?id=${instagramUserId}`)}`}
                            className="text-pink-400 underline">Terms</Link>.
                    </p>
                    <div className="flex items-center justify-center gap-2 pt-2">
                        <Sparkles className="w-3 h-3 text-pink-500/50" />
                        <p className="text-xs text-gray-600">Riya is waiting for you 💭</p>
                        <Sparkles className="w-3 h-3 text-pink-500/50" />
                    </div>
                </div>
            </div>

            {/* Full Image Modal */}
            <AnimatePresence>
                {showFullImage && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4"
                        onClick={() => setShowFullImage(false)}
                    >
                        <button className="absolute top-4 right-4 p-2 text-white/50 hover:text-white rounded-full">
                            <X className="w-6 h-6" />
                        </button>
                        <motion.img
                            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                            src="/riya-payment-dp.jpg" alt="Riya"
                            className="max-w-[85vw] max-h-[80vh] object-contain rounded-2xl border border-white/10"
                            onClick={e => e.stopPropagation()}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default InstagramPayment;
