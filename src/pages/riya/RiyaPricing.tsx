import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, Crown, Check, Sparkles, Star, Zap } from 'lucide-react';

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

// Plan configurations
const PLANS = [
    {
        id: 'trial',
        name: 'Trial',
        price: 29,
        originalPrice: 89,
        duration: '1 month',
        perMonth: 29,
        badge: '🎉 First Month Special',
        badgeColor: 'from-green-400 to-emerald-500',
        description: 'Perfect to try Pro features',
        features: ['Unlimited messages', 'No daily limits', 'Priority support'],
        highlight: false,
        savings: null
    },
    {
        id: 'quarterly',
        name: '3 Months',
        price: 229,
        originalPrice: 267,
        duration: '3 months',
        perMonth: 76,
        badge: '⭐ Most Popular',
        badgeColor: 'from-purple-400 to-pink-500',
        description: 'Best for regular users',
        features: ['Unlimited messages', 'No daily limits', 'Priority support'],
        highlight: true,
        savings: '15%'
    },
    {
        id: 'half_yearly',
        name: '6 Months',
        price: 399,
        originalPrice: 534,
        duration: '6 months',
        perMonth: 67,
        badge: '💎 Best Value',
        badgeColor: 'from-yellow-400 to-orange-500',
        description: 'Maximum savings',
        features: ['Unlimited messages', 'No daily limits', 'Priority support'],
        highlight: false,
        savings: '25%'
    }
];

/**
 * Riya Pro Pricing Page
 * Displays subscription plans with Razorpay integration
 */
const RiyaPricing = () => {
    const navigate = useNavigate();
    const [selectedPlan, setSelectedPlan] = useState('quarterly');
    const [isLoading, setIsLoading] = useState(false);
    const [isTrialEligible, setIsTrialEligible] = useState(true);
    const [userName, setUserName] = useState('');
    const [userEmail, setUserEmail] = useState('');

    useEffect(() => {
        // Load Razorpay script
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        document.body.appendChild(script);

        // Check user info and trial eligibility
        const checkUser = async () => {
            const userId = localStorage.getItem('riya_user_id');
            if (!userId) {
                navigate('/riya');
                return;
            }

            // Get user info
            const { data: user } = await supabase
                .from('riya_users')
                .select('username, email')
                .eq('id', userId)
                .single();

            if (user) {
                setUserName(user.username);
                setUserEmail(user.email);
            }

            // Check if user already has a subscription (not trial eligible)
            const { data: subscription } = await supabase
                .from('riya_subscriptions')
                .select('id')
                .eq('user_id', userId)
                .limit(1);

            if (subscription && subscription.length > 0) {
                setIsTrialEligible(false);
                setSelectedPlan('quarterly'); // Default to quarterly if not trial eligible
            }
        };

        checkUser();

        return () => {
            document.body.removeChild(script);
        };
    }, [navigate]);

    const handleSelectPlan = async (planId: string) => {
        // Don't allow trial if not eligible
        if (planId === 'trial' && !isTrialEligible) {
            toast({
                title: 'Trial already used',
                description: 'Choose a regular plan to continue your Pro experience.',
                variant: 'destructive'
            });
            return;
        }

        setSelectedPlan(planId);
        setIsLoading(true);

        try {
            const userId = localStorage.getItem('riya_user_id');
            if (!userId) {
                navigate('/riya');
                return;
            }

            // Create Razorpay order via Edge Function
            const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
                body: {
                    userId,
                    planType: planId
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
                name: 'Riya AI Pro',
                description: data.planDescription,
                order_id: data.orderId,
                handler: async (response: RazorpayResponse) => {
                    // Verify payment
                    await handlePaymentSuccess(
                        response.razorpay_order_id,
                        response.razorpay_payment_id,
                        response.razorpay_signature,
                        planId
                    );
                },
                prefill: {
                    name: userName,
                    email: userEmail
                },
                theme: {
                    color: '#00d4aa' // neon-cyan
                },
                modal: {
                    ondismiss: () => {
                        setIsLoading(false);
                    }
                }
            };

            const razorpay = new window.Razorpay(options);
            razorpay.open();
        } catch (error) {
            console.error('Payment initiation error:', error);
            toast({
                title: 'Payment Error',
                description: error instanceof Error ? error.message : 'Failed to initiate payment',
                variant: 'destructive'
            });
            setIsLoading(false);
        }
    };

    const handlePaymentSuccess = async (
        orderId: string,
        paymentId: string,
        signature: string,
        planType: string
    ) => {
        try {
            const userId = localStorage.getItem('riya_user_id');

            const { data, error } = await supabase.functions.invoke('verify-razorpay-payment', {
                body: {
                    userId,
                    orderId,
                    paymentId,
                    signature,
                    planType
                }
            });

            if (error || !data.success) {
                throw new Error(data?.error || 'Payment verification failed');
            }

            toast({
                title: '🎉 Welcome to Pro!',
                description: 'Your subscription is now active. Enjoy unlimited messages!'
            });

            // Navigate back to chat
            setTimeout(() => navigate('/riya/chat'), 1500);
        } catch (error) {
            console.error('Payment verification error:', error);
            toast({
                title: 'Verification Error',
                description: 'Payment received but verification failed. Please contact support.',
                variant: 'destructive'
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Filter plans based on trial eligibility
    const displayPlans = isTrialEligible ? PLANS : PLANS.filter(p => p.id !== 'trial');

    return (
        <div className="min-h-screen bg-background">
            {/* Background */}
            <div
                className="fixed inset-0 opacity-5 pointer-events-none"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300d4aa' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
            />

            {/* Header */}
            <div className="relative z-10 glass-card rounded-none border-x-0 border-t-0 px-4 py-3">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate('/riya/chat')}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <h1 className="font-display text-xl font-bold text-foreground">
                        Upgrade to Pro
                    </h1>
                </div>
            </div>

            {/* Content */}
            <div className="relative z-10 p-4 space-y-6 max-w-lg mx-auto">
                {/* Hero */}
                <div className="text-center space-y-3 py-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500">
                        <Crown className="w-8 h-8 text-white" />
                    </div>
                    <h2 className="font-display text-3xl font-bold text-foreground">
                        Unlimited AI Sessions
                    </h2>
                    <p className="text-muted-foreground">
                        Full access to AI wellness features.
                    </p>
                </div>

                {/* Plans */}
                <div className="space-y-4">
                    {displayPlans.map((plan) => (
                        <motion.div
                            key={plan.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => !isLoading && handleSelectPlan(plan.id)}
                            className={`relative cursor-pointer rounded-2xl p-4 transition-all ${plan.highlight
                                ? 'glass-card border-primary/50 ring-2 ring-primary/30'
                                : 'glass-card'
                                } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
                        >
                            {/* Badge */}
                            {plan.badge && (
                                <div className={`absolute -top-3 left-4 px-3 py-1 rounded-full text-xs font-semibold text-white bg-gradient-to-r ${plan.badgeColor}`}>
                                    {plan.badge}
                                </div>
                            )}

                            <div className="flex items-center justify-between pt-2">
                                <div className="space-y-1">
                                    <h3 className="font-display text-lg font-bold text-foreground">
                                        {plan.name}
                                    </h3>
                                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                                </div>

                                <div className="text-right">
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-3xl font-bold text-foreground">₹{plan.price}</span>
                                    </div>
                                    {plan.savings && (
                                        <div className="flex items-center gap-1 text-sm">
                                            <span className="line-through text-muted-foreground">₹{plan.originalPrice}</span>
                                            <span className="text-primary font-semibold">Save {plan.savings}</span>
                                        </div>
                                    )}
                                    <p className="text-xs text-muted-foreground mt-1">
                                        ₹{plan.perMonth}/month
                                    </p>
                                </div>
                            </div>

                            {/* Selected indicator */}
                            {selectedPlan === plan.id && (
                                <div className="absolute top-4 right-4">
                                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                                        <Check className="w-4 h-4 text-background" />
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    ))}
                </div>

                {/* Features */}
                <div className="glass-card p-4 space-y-3">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        What you get with Pro
                    </h3>
                    <ul className="space-y-2">
                        {[
                            'Unlimited AI sessions every day',
                            'No daily usage limits',
                            'Priority response times',
                            'Session history always saved',
                        ].map((feature, i) => (
                            <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Check className="w-4 h-4 text-primary" />
                                {feature}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* After Trial Note */}
                {isTrialEligible && (
                    <p className="text-center text-sm text-muted-foreground">
                        After trial: <span className="text-foreground">₹89/month</span> for monthly plan
                    </p>
                )}

                {/* Trust badges */}
                <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground py-2">
                    <div className="flex items-center gap-1">
                        <Zap className="w-4 h-4" />
                        Instant Activation
                    </div>
                    <div className="flex items-center gap-1">
                        <Star className="w-4 h-4" />
                        Secure Payment
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RiyaPricing;
