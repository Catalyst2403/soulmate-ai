import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Heart, Sparkles, Zap, Check, Lock } from 'lucide-react';

// Razorpay types
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

    useEffect(() => {
        // Load Razorpay script
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);

        return () => {
            document.body.removeChild(script);
        };
    }, []);

    const handlePayment = async () => {
        if (!instagramUserId) {
            toast({
                title: 'Error',
                description: 'Invalid user link. Please try opening the link from Instagram again.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);

        try {
            // Create Razorpay order via Edge Function
            const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                body: {
                    instagramUserId: instagramUserId,
                    planType: 'instagram_monthly' // New special plan
                }
            });

            if (error || data.error) {
                throw new Error(data?.error || error?.message || 'Failed to create order');
            }

            // Open Razorpay checkout
            const options: RazorpayOptions = {
                key: data.keyId,
                amount: data.amount,
                currency: data.currency,
                name: 'Riya Singh (Pro)',
                description: 'Unlimited Instagram access',
                order_id: data.orderId,
                handler: async (response: RazorpayResponse) => {
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
                    ondismiss: () => setIsLoading(false)
                }
            };

            const razorpay = new window.Razorpay(options);
            razorpay.open();

        } catch (error) {
            console.error('Payment initiation error:', error);
            toast({
                title: 'Payment Failed',
                description: 'Could not start payment. Please try again.',
                variant: 'destructive'
            });
            setIsLoading(false);
        }
    };

    const verifyPayment = async (response: RazorpayResponse) => {
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
                throw new Error(data?.error || 'Payment verification failed');
            }

            setIsSuccess(true);
            toast({
                title: 'Pro Activated! 🎉',
                description: 'Go back to Instagram to continue chatting!',
            });

        } catch (error) {
            console.error('Verify error:', error);
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
                        onClick={() => window.location.href = 'instagram://'}
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

                {/* Header */}
                <div className="pt-8 pb-6 text-center space-y-2">
                    <div className="mx-auto w-24 h-24 rounded-full p-1 bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600">
                        <div className="w-full h-full rounded-full bg-black flex items-center justify-center overflow-hidden border-4 border-black">
                            <img src="/riya-avatar.jpg" alt="Riya" className="w-full h-full object-cover" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold font-display">Upgrade Riya</h1>
                    <p className="text-sm text-gray-400">Unlock user's full potential</p>
                </div>

                {/* Card */}
                <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-6 space-y-6 flex-1 flex flex-col"
                >
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold">Riya Pro (Instagram)</h2>
                            <span className="bg-white/10 px-3 py-1 rounded-full text-xs font-medium">
                                Most Popular
                            </span>
                        </div>

                        <div className="flex items-baseline gap-1">
                            <span className="text-4xl font-bold">₹49</span>
                            <span className="text-gray-400">/month</span>
                        </div>

                        <div className="h-px bg-white/10 my-4" />

                        <ul className="space-y-4">
                            <li className="flex items-start gap-3">
                                <div className="mt-1 w-5 h-5 rounded-full bg-pink-500/20 flex items-center justify-center shrink-0">
                                    <Zap className="w-3 h-3 text-pink-500" />
                                </div>
                                <div>
                                    <p className="font-medium">Unlimited Messages</p>
                                    <p className="text-xs text-gray-400">Chat all day & night without stopping</p>
                                </div>
                            </li>
                            <li className="flex items-start gap-3">
                                <div className="mt-1 w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                                    <Sparkles className="w-3 h-3 text-purple-500" />
                                </div>
                                <div>
                                    <p className="font-medium">Unlimited Photos</p>
                                    <p className="text-xs text-gray-400">Request as many selfies as you want</p>
                                </div>
                            </li>
                            <li className="flex items-start gap-3">
                                <div className="mt-1 w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                                    <Lock className="w-3 h-3 text-red-500" />
                                </div>
                                <div>
                                    <p className="font-medium">Uncensored Access</p>
                                    <p className="text-xs text-gray-400">See private snaps & spicy chats</p>
                                </div>
                            </li>
                        </ul>
                    </div>

                    <div className="mt-auto pt-6">
                        <Button
                            className="w-full h-14 text-lg font-bold bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90 transition-opacity rounded-xl"
                            onClick={handlePayment}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <span className="flex items-center gap-2">
                                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                                    Processing...
                                </span>
                            ) : (
                                <span className="flex items-center gap-2">
                                    <Heart className="w-5 h-5 fill-white" />
                                    Unlock for ₹49
                                </span>
                            )}
                        </Button>
                        <p className="text-center text-xs text-gray-500 mt-4">
                            Secured by Razorpay • Cancel anytime
                        </p>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default InstagramPayment;
