import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Heart, Sparkles, Zap, Check, Lock, X } from 'lucide-react';

// ... (existing helper types)
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
    prefill: {
        name: string;
        email: string;
        contact?: string;
    };
    theme: {
        color: string;
    };
    modal?: {
        ondismiss?: () => void;
    };
}

interface RazorpayInstance {
    open: () => void;
    on: (event: string, handler: () => void) => void;
}

interface RazorpayResponse {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
}

const InstagramPayment = () => {
    const [searchParams] = useSearchParams();
    const instagramUserId = searchParams.get('id');
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [language, setLanguage] = useState<'en' | 'hi'>('en'); // Default to English
    const [showFullImage, setShowFullImage] = useState(false);
    const [hasAgreedToTerms, setHasAgreedToTerms] = useState(false);

    // ... (rest of the component logic remains the same until the return statement)
    const content = {
        en: {
            header: "Upgrade Riya",
            tagline: "Don't let the conversation die... 💔",
            planName: "Riya Pro (Instagram)",
            badge: "Most Popular",
            price: "₹99",
            period: "/month",
            limitedTime: "Limited Time Offer ⏳",
            unlimitedMessages: "Unlimited Messages",
            unlimitedMessagesSub: "Chat all day & night without stopping",
            unlimitedPhotos: "Unlimited Photos",
            unlimitedPhotosSub: "Unlock Her Private Gallery",
            unfilteredAccess: "Unfiltered Access",
            unfilteredAccessSub: "See private snaps & unfiltered chats",
            cta: "Unlock for ₹99",
            footer: "Secured by Razorpay • Cancel anytime",
            privacy: "Privacy Policy",
            terms: "Terms of Service",
            agreeText: "I have read and agree to the ",
            and: " and "
        },
        hi: {
            header: "रिया को अपग्रेड करें",
            tagline: "बातचीत रुकने न दें... 💔",
            planName: "रिया प्रो (Instagram)",
            badge: "सबसे लोकप्रिय",
            price: "₹99",
            period: "/महीना",
            limitedTime: "सीमित समय के लिए ऑफ़र ⏳",
            unlimitedMessages: "अनगिनत मैसेज",
            unlimitedMessagesSub: "दिन-रात बिना रुके बातें करें",
            unlimitedPhotos: "अनगिनत तस्वीरें",
            unlimitedPhotosSub: "उसकी प्राइवेट गैलरी अनलॉक करें",
            unfilteredAccess: "बिना किसी रोक-टोक के",
            unfilteredAccessSub: "प्राइवेट स्नैप्स देखें और खुल के बातें करें",
            cta: "सिर्फ ₹99 में अनलॉक करें",
            footer: "Razorpay द्वारा सुरक्षित • कभी भी कैंसिल करें",
            privacy: "गोपनीयता नीति",
            terms: "सेवा की शर्तें",
            agreeText: "मैंने पढ़ लिया है और मैं सहमत हूँ ",
            and: " और "
        }
    };

    const t = content[language];

    useEffect(() => {
        // Load Razorpay script
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);

        // Track page visit
        if (instagramUserId) {
            (supabase as any).from('riya_payment_events').insert({
                instagram_user_id: instagramUserId,
                event_type: 'page_visit',
            }).then(({ error }: { error: any }) => {
                if (error) console.warn('⚠️ Failed to log page_visit:', error);
                else console.log('📊 page_visit logged for', instagramUserId);
            });
        }

        return () => {
            document.body.removeChild(script);
        };
    }, []);

    const handlePayment = async () => {
        console.log("💳 Start Payment Clicked");

        // Track upgrade button click
        if (instagramUserId) {
            (supabase as any).from('riya_payment_events').insert({
                instagram_user_id: instagramUserId,
                event_type: 'upgrade_click',
            }).then(({ error }: { error: any }) => {
                if (error) console.warn('⚠️ Failed to log upgrade_click:', error);
                else console.log('📊 upgrade_click logged for', instagramUserId);
            });
        }
        if (!instagramUserId) {
            console.error("❌ No Instagram User ID found");
            toast({
                title: 'Error',
                description: 'Invalid user link. Please try opening the link from Instagram again.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);

        try {
            console.log(`🔄 Creating order for ${instagramUserId}...`);
            // Create Razorpay order via Edge Function
            const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                body: {
                    instagramUserId: instagramUserId,
                    planType: 'instagram_monthly' // New special plan
                }
            });

            if (error || data.error) {
                console.error("❌ Order Creation Failed:", data?.error || error);
                throw new Error(data?.error || error?.message || 'Failed to create order');
            }

            console.log("✅ Order Created:", data);

            // Open Razorpay checkout
            const options: RazorpayOptions = {
                key: data.keyId,
                amount: data.amount,
                currency: data.currency,
                name: 'Riya Singh (Pro)',
                description: 'Unlimited Instagram access',
                order_id: data.orderId,
                handler: async (response: RazorpayResponse) => {
                    console.log("✅ Payment Completed at Razorpay. Verifying...", response);
                    await verifyPayment(response);
                },
                prefill: {
                    name: 'Instagram User', // We might not have their real name
                    email: '', // Let them fill it
                },
                theme: {
                    color: '#E1306C' // Instagram pink-ish
                },
                modal: {
                    ondismiss: () => {
                        console.log("⚠️ Payment Modal Dismissed");
                        setIsLoading(false);
                    }
                }
            };

            const razorpay = new window.Razorpay(options);
            razorpay.open();
            console.log("🟢 Razorpay Modal Opened");

        } catch (error) {
            console.error('❌ Payment initiation error:', error);
            toast({
                title: 'Payment Failed',
                description: 'Could not start payment. Please try again.',
                variant: 'destructive'
            });
            setIsLoading(false);
        }
    };

    const verifyPayment = async (response: RazorpayResponse) => {
        console.log("🔐 Verifying payment server-side...");
        try {
            const { data, error } = await supabase.functions.invoke('verify-razorpay-payment', {
                body: {
                    instagramUserId: instagramUserId,
                    orderId: response.razorpay_order_id,
                    paymentId: response.razorpay_payment_id,
                    signature: response.razorpay_signature,
                    planType: 'instagram_monthly'
                }
            });

            if (error || !data.success) {
                console.error("❌ Verification Failed:", data?.error || error);
                throw new Error(data?.error || 'Payment verification failed');
            }

            console.log("✅ Payment Verified & Subscription Active!", data);
            setIsSuccess(true);
            toast({
                title: 'Pro Activated! 🎉',
                description: 'Go back to Instagram to continue chatting!',
            });

        } catch (error) {
            console.error('❌ Verify loop error:', error);
            toast({
                title: 'Verification Issue',
                description: 'Payment successful but activation pending. Contact support if not active in 5 mins.',
                variant: 'destructive'
            });
        } finally {
            setIsLoading(false);
        }
    };

    if (!instagramUserId) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-black text-white p-4">
                <p>Invalid Link</p>
            </div>
        );
    }

    if (isSuccess) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white p-6 text-center space-y-6">
                <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Check className="w-10 h-10 text-green-500" />
                </div>
                <h1 className="text-3xl font-bold font-display">You're All Set! 🎉</h1>
                <p className="text-gray-400 max-w-xs">
                    Riya Pro has been activated for your Instagram. You can close this window and go back to chat.
                </p>
                <div className="pt-4">
                    <Button
                        variant="outline"
                        onClick={() => window.location.href = 'https://instagram.com/'}
                        className="w-full"
                    >
                        Open Instagram
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white font-sans relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-[#E1306C]/20 to-transparent pointer-events-none" />

            <div className="relative z-10 max-w-md mx-auto min-h-screen flex flex-col p-6">

                {/* Language Toggle */}
                <div className="absolute top-4 right-4 z-50">
                    <div className="bg-gray-900/80 backdrop-blur-md rounded-full p-1 flex border border-white/10">
                        <button
                            onClick={() => setLanguage('en')}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${language === 'en'
                                ? 'bg-white text-black'
                                : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            English
                        </button>
                        <button
                            onClick={() => setLanguage('hi')}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${language === 'hi'
                                ? 'bg-[#E1306C] text-white'
                                : 'text-gray-400 hover:text-white'
                                }`}
                        >
                            हिंदी
                        </button>
                    </div>
                </div>

                {/* Header */}
                <div className="pt-8 pb-6 text-center space-y-2">
                    <div
                        className="mx-auto w-24 h-24 rounded-full p-1 bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 cursor-pointer hover:scale-105 transition-transform"
                        onClick={() => setShowFullImage(true)}
                    >
                        <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden border-4 border-black">
                            <img src="/riya-payment-dp.jpg" alt="Riya" className="w-full h-full object-cover" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold font-display">{t.header}</h1>
                    <p className="text-sm text-gray-400">{t.tagline}</p>
                </div>

                {/* Card */}
                <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-6 space-y-6 flex-1 flex flex-col"
                >
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold">{t.planName}</h2>
                            <span className="bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/30 text-pink-200 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0">
                                {t.badge}
                            </span>
                        </div>

                        <div className="flex flex-col">
                            <div className="flex items-baseline gap-2">
                                <span className="text-lg text-gray-500 line-through decoration-gray-500">₹199</span>
                                <span className="text-4xl font-bold">{t.price}</span>
                                <span className="text-gray-400">{t.period}</span>
                            </div>
                            <p className="text-xs text-red-500 font-semibold mt-1">{t.limitedTime}</p>
                        </div>

                        <div className="h-px bg-white/10 my-4" />

                        <ul className="space-y-4">
                            <li className="flex items-start gap-3">
                                <div className="mt-1 w-5 h-5 rounded-full bg-pink-500/20 flex items-center justify-center shrink-0">
                                    <Zap className="w-3 h-3 text-pink-500" />
                                </div>
                                <div>
                                    <p className="font-medium">{t.unlimitedMessages}</p>
                                    <p className="text-xs text-gray-400">{t.unlimitedMessagesSub}</p>
                                </div>
                            </li>
                            <li className="flex items-start gap-3">
                                <div className="mt-1 w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                                    <Sparkles className="w-3 h-3 text-purple-500" />
                                </div>
                                <div>
                                    <p className="font-medium">{t.unlimitedPhotos}</p>
                                    <p className="text-xs text-gray-400">{t.unlimitedPhotosSub}</p>
                                </div>
                            </li>
                            <li className="flex items-start gap-3">
                                <div className="mt-1 w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                                    <Lock className="w-3 h-3 text-red-500" />
                                </div>
                                <div>
                                    <p className="font-medium">{t.unfilteredAccess}</p>
                                    <p className="text-xs text-gray-400">{t.unfilteredAccessSub}</p>
                                </div>
                            </li>
                        </ul>
                    </div>

                    <div className="mt-auto pt-6">
                        <div className="flex items-start gap-3 mb-6 group cursor-pointer" onClick={() => setHasAgreedToTerms(!hasAgreedToTerms)}>
                            <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${hasAgreedToTerms ? 'bg-[#E1306C] border-[#E1306C]' : 'bg-gray-800 border-white/20'}`}>
                                {hasAgreedToTerms && <Check className="w-3.5 h-3.5 text-white" />}
                            </div>
                            <p className="text-xs text-gray-400 leading-relaxed select-none">
                                {t.agreeText}
                                <Link
                                    to={`/riya/privacy-policy?returnPath=${encodeURIComponent(`/riya/pay/instagram?id=${instagramUserId}`)}`}
                                    className="text-pink-400 hover:text-pink-300 transition-colors underline"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {t.privacy}
                                </Link>
                                {t.and}
                                <Link
                                    to={`/riya/terms?returnPath=${encodeURIComponent(`/riya/pay/instagram?id=${instagramUserId}`)}`}
                                    className="text-pink-400 hover:text-pink-300 transition-colors underline"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {t.terms}
                                </Link>
                            </p>
                        </div>

                        <Button
                            className="w-full h-14 text-lg font-bold bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90 disabled:opacity-40 disabled:grayscale transition-all rounded-xl"
                            onClick={handlePayment}
                            disabled={isLoading || !hasAgreedToTerms}
                        >
                            {isLoading ? (
                                <span className="flex items-center gap-2">
                                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                                    Processing...
                                </span>
                            ) : (
                                <span className="flex items-center gap-2">
                                    <Heart className="w-5 h-5 fill-white" />
                                    {t.cta}
                                </span>
                            )}
                        </Button>
                        {isLoading && (
                            <p className="text-center text-sm text-yellow-400 font-medium mt-2 animate-pulse">
                                ⚠️ Please do not close or refresh this window until verification is complete!
                            </p>
                        )}
                        <div className="text-center mt-4">
                            <p className="text-xs text-gray-500">
                                {t.footer}
                            </p>
                        </div>
                    </div>
                </motion.div >
            </div>

            {/* Full Screen Image Modal */}
            <AnimatePresence>
                {showFullImage && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 backdrop-blur-sm"
                        onClick={() => setShowFullImage(false)}
                    >
                        <motion.button
                            onClick={() => setShowFullImage(false)}
                            className="absolute top-4 right-4 p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                        >
                            <X className="w-8 h-8" />
                        </motion.button>

                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            transition={{ type: "spring", damping: 25, stiffness: 300 }}
                            className="relative max-w-full max-h-screen flex items-center justify-center pointer-events-none"
                        >
                            <img
                                src="/riya-payment-dp.jpg"
                                alt="Riya Full Screen"
                                className="max-w-[90vw] max-h-[80vh] object-contain rounded-2xl shadow-2xl border border-white/10 pointer-events-auto"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default InstagramPayment;
