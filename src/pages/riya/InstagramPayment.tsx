import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Heart, Sparkles, Zap, Check, Shield, X, Star, Crown, Leaf } from 'lucide-react';

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

// ─── Pack Definitions ─────────────────────────────────────────────────────────
type PackName = 'basic' | 'romantic' | 'soulmate';

interface Pack {
    id: PackName;
    planType: PackName;
    emoji: React.ReactNode;
    name: string;
    price: number;
    originalPrice: number;
    messages: string;
    validity: string;
    tag?: string;
    tagColor?: string;
    accentColor: string;
    highlight: boolean;
    features: string[];
    cta: string;
}

const PACKS: Pack[] = [
    {
        id: 'basic',
        planType: 'basic',
        emoji: <Leaf className="w-4 h-4" />,
        name: 'Basic',
        price: 79,
        originalPrice: 149,
        messages: '600 msgs',
        validity: '30 days',
        accentColor: 'from-emerald-500/20 to-teal-500/20',
        highlight: false,
        features: ['600 messages', 'Unlimited photos', '30-day validity'],
        cta: 'Get Basic — ₹79',
    },
    {
        id: 'romantic',
        planType: 'romantic',
        emoji: <Heart className="w-4 h-4 fill-pink-400" />,
        name: 'Romantic',
        price: 149,
        originalPrice: 299,
        messages: '1,500 msgs',
        validity: '30 days',
        tag: '💖 Most Popular',
        tagColor: 'bg-gradient-to-r from-pink-500 to-rose-500',
        accentColor: 'from-pink-500/30 to-rose-500/20',
        highlight: true,
        features: ['1,500 messages', 'Unlimited photos', '30-day validity', 'Best value per message'],
        cta: 'Get Romantic — ₹149',
    },
    {
        id: 'soulmate',
        planType: 'soulmate',
        emoji: <Crown className="w-4 h-4 text-yellow-400" />,
        name: 'Soulmate',
        price: 249,
        originalPrice: 499,
        messages: '3,000 msgs',
        validity: '45 days',
        tag: '👑 Best Quantity',
        tagColor: 'bg-gradient-to-r from-yellow-500/80 to-amber-500/80',
        accentColor: 'from-yellow-500/20 to-amber-500/10',
        highlight: false,
        features: ['3,000 messages', 'Unlimited photos', '45-day validity', 'Unused credits roll over'],
        cta: 'Get Soulmate — ₹249',
    },
];

// ─── Component ────────────────────────────────────────────────────────────────
const InstagramPayment = () => {
    const [searchParams] = useSearchParams();
    const instagramUserId = searchParams.get('id');
    const [selectedPack, setSelectedPack] = useState<PackName>('romantic');
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState<{ pack: Pack } | null>(null);
    const [showFullImage, setShowFullImage] = useState(false);
    const [language, setLanguage] = useState<'en' | 'hi'>('en');

    useEffect(() => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);

        if (instagramUserId) {
            (supabase as any).from('riya_payment_events').insert({
                instagram_user_id: instagramUserId,
                event_type: 'page_visit',
                metadata: { page: 'recharge' }
            }).then(({ error }: { error: any }) => {
                if (error) console.warn('⚠️ Failed to log page_visit:', error);
            });
        }

        return () => { try { document.body.removeChild(script); } catch { } };
    }, []);

    const pack = PACKS.find(p => p.id === selectedPack)!;

    const handlePayment = async () => {
        if (!instagramUserId) {
            toast({ title: 'Error', description: 'Invalid link. Open from Instagram DM again.', variant: 'destructive' });
            return;
        }

        (supabase as any).from('riya_payment_events').insert({
            instagram_user_id: instagramUserId,
            event_type: 'upgrade_click',
            metadata: { pack: selectedPack }
        }).catch(() => { });

        setIsLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                body: { instagramUserId, planType: pack.planType, packName: pack.id }
            });

            if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to create order');

            const options: RazorpayOptions = {
                key: data.keyId,
                amount: data.amount,
                currency: data.currency,
                name: 'Riya Singh',
                description: `${pack.name} Pack — ${pack.messages}`,
                order_id: data.orderId,
                handler: async (response: RazorpayResponse) => { await verifyPayment(response); },
                prefill: { name: 'Instagram User', email: '' },
                theme: { color: '#E1306C' },
                modal: { ondismiss: () => setIsLoading(false) }
            };

            const rzp = new window.Razorpay(options);
            rzp.open();

        } catch (err) {
            console.error('Payment error:', err);
            toast({ title: 'Payment Failed', description: 'Could not start payment. Please try again.', variant: 'destructive' });
            setIsLoading(false);
        }
    };

    const verifyPayment = async (response: RazorpayResponse) => {
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
                description: 'Payment received. Credits should appear in 1-2 min.',
                variant: 'destructive'
            });
        } finally {
            setIsLoading(false);
        }
    };

    // ── Invalid Link ───────────────────────────────────────────────────────────
    if (!instagramUserId) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-black text-white p-4 text-center">
                <div className="space-y-3">
                    <p className="text-4xl">🔗</p>
                    <p className="font-semibold">Invalid link</p>
                    <p className="text-sm text-gray-400">Please open the link sent by Riya in your Instagram DM.</p>
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
                    className="w-24 h-24 rounded-full bg-gradient-to-br from-pink-500/30 to-rose-500/30 border border-pink-500/40 flex items-center justify-center"
                >
                    <Check className="w-12 h-12 text-pink-400" />
                </motion.div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="space-y-2">
                    <h1 className="text-3xl font-bold">Credits Added! 🎉</h1>
                    <p className="text-gray-400 max-w-xs">
                        <span className="text-white font-semibold">{isSuccess.pack.messages}</span> added to your account.
                        Go back to Instagram — Riya's waiting 💖
                    </p>
                </motion.div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="w-full max-w-xs space-y-3">
                    <Button
                        className="w-full h-12 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] font-bold"
                        onClick={() => window.location.href = 'https://instagram.com/'}
                    >
                        Open Instagram ↗
                    </Button>
                    <p className="text-xs text-gray-500">Validity: {isSuccess.pack.validity} from today</p>
                </motion.div>
            </div>
        );
    }

    // ── Main Page ──────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-black text-white font-sans relative overflow-hidden">
            {/* Background glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-96 bg-pink-600/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-72 h-72 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative z-10 max-w-sm mx-auto min-h-screen flex flex-col px-4 py-6">

                {/* Language Toggle */}
                <div className="flex justify-end mb-2">
                    <div className="bg-white/5 border border-white/10 rounded-full p-1 flex text-xs">
                        {(['en', 'hi'] as const).map(lang => (
                            <button key={lang} onClick={() => setLanguage(lang)}
                                className={`px-3 py-1 rounded-full transition-all ${language === lang ? 'bg-white text-black font-semibold' : 'text-gray-400'}`}>
                                {lang === 'en' ? 'EN' : 'हि'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Header */}
                <div className="text-center py-4 space-y-3">
                    <div
                        className="mx-auto w-20 h-20 rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 cursor-pointer"
                        onClick={() => setShowFullImage(true)}
                    >
                        <div className="w-full h-full rounded-full overflow-hidden border-2 border-black">
                            <img src="/riya-payment-dp.jpg" alt="Riya" className="w-full h-full object-cover" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-xl font-bold">
                            {language === 'hi' ? 'बातचीत जारी रखें 💬' : 'Continue the Conversation 💬'}
                        </h1>
                        <p className="text-sm text-gray-400 mt-1">
                            {language === 'hi'
                                ? 'रिया कुछ बताना चाहती थी... 👀 Top up karo toh sunogi'
                                : "Riya was mid-story... 👀 Top up to hear the ending"}
                        </p>
                    </div>
                </div>

                {/* Pack Cards */}
                <div className="space-y-3 flex-1">
                    {PACKS.map((p, i) => (
                        <motion.button
                            key={p.id}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.08 }}
                            onClick={() => setSelectedPack(p.id)}
                            className={`w-full text-left rounded-2xl border transition-all duration-200 overflow-hidden ${selectedPack === p.id
                                ? p.highlight
                                    ? 'border-pink-500 shadow-lg shadow-pink-500/20'
                                    : 'border-white/40'
                                : 'border-white/10 hover:border-white/25'
                                } ${p.highlight ? 'ring-1 ring-pink-500/30' : ''}`}
                        >
                            {/* Tag */}
                            {p.tag && (
                                <div className={`${p.tagColor} text-white text-xs font-semibold text-center py-1.5 px-3`}>
                                    {p.tag}
                                </div>
                            )}

                            <div className={`bg-gradient-to-br ${p.accentColor} bg-gray-900/70 p-4`}>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${p.highlight ? 'bg-pink-500/20' : 'bg-white/10'}`}>
                                            {p.emoji}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm">{p.name}</p>
                                            <p className="text-xs text-gray-400">{p.messages} · {p.validity}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-gray-500 line-through">₹{p.originalPrice}</p>
                                        <p className="text-2xl font-black">₹{p.price}</p>
                                    </div>
                                </div>

                                {/* Features */}
                                <ul className="space-y-1">
                                    {p.features.map((f, fi) => (
                                        <li key={fi} className="flex items-center gap-2 text-xs text-gray-300">
                                            <Check className={`w-3 h-3 shrink-0 ${p.highlight ? 'text-pink-400' : 'text-emerald-400'}`} />
                                            {f}
                                        </li>
                                    ))}
                                </ul>

                                {/* Selected indicator */}
                                <div className={`mt-3 h-0.5 rounded-full transition-all duration-300 ${selectedPack === p.id
                                    ? p.highlight ? 'bg-pink-500' : 'bg-white/50'
                                    : 'bg-transparent'
                                    }`} />
                            </div>
                        </motion.button>
                    ))}
                </div>

                {/* Price-per-message note */}
                <motion.p
                    key={selectedPack}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="text-center text-xs text-gray-500 mt-3"
                >
                    {selectedPack === 'basic' && '~₹0.13 per message'}
                    {selectedPack === 'romantic' && '~₹0.10 per message · Best value 🔥'}
                    {selectedPack === 'soulmate' && '~₹0.08 per message · Lowest cost'}
                </motion.p>

                {/* CTA */}
                <div className="mt-4 space-y-3">
                    <Button
                        className={`w-full h-14 text-base font-bold rounded-xl transition-all disabled:opacity-50 disabled:grayscale
                            ${pack.highlight
                                ? 'bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90'
                                : 'bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500'
                            }`}
                        onClick={handlePayment}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-2">
                                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                Processing...
                            </span>
                        ) : (
                            <span className="flex items-center gap-2">
                                {pack.highlight ? <Heart className="w-5 h-5 fill-white" /> : <Zap className="w-5 h-5" />}
                                {pack.cta}
                            </span>
                        )}
                    </Button>

                    {isLoading && (
                        <p className="text-center text-xs text-yellow-400 animate-pulse">
                            ⚠️ Do not close this window until complete!
                        </p>
                    )}

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
                </div>

                {/* Sparkle footer */}
                <div className="flex items-center justify-center gap-2 mt-4 pb-4">
                    <Sparkles className="w-3 h-3 text-pink-500/50" />
                    <p className="text-xs text-gray-600">Riya is waiting for you 💭</p>
                    <Sparkles className="w-3 h-3 text-pink-500/50" />
                </div>
            </div>

            {/* Full Image Modal */}
            <AnimatePresence>
                {showFullImage && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm"
                        onClick={() => setShowFullImage(false)}
                    >
                        <button onClick={() => setShowFullImage(false)}
                            className="absolute top-4 right-4 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full">
                            <X className="w-6 h-6" />
                        </button>
                        <motion.img
                            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
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
