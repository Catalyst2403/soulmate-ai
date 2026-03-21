import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Razorpay Order Creation Edge Function
 * Creates a Razorpay order for subscription purchase
 */

// Pricing plans (amounts in paise)
const PLANS = {
    // ---- Legacy subscription plans ----
    trial: {
        amount: 2900,        // ₹29
        duration_days: 30,
        name: "Pro Trial - 1 Month",
        description: "First month trial at special price"
    },
    monthly: {
        amount: 8900,        // ₹89
        duration_days: 30,
        name: "Pro Monthly",
        description: "Monthly subscription"
    },
    quarterly: {
        amount: 22900,       // ₹229
        duration_days: 90,
        name: "Pro Quarterly",
        description: "3 months - Save 15%"
    },
    half_yearly: {
        amount: 39900,       // ₹399
        duration_days: 180,
        name: "Pro Half-Yearly",
        description: "6 months - Best Value!"
    },
    instagram_monthly: {
        amount: 14900,       // ₹149
        duration_days: 30,
        name: "Pro Monthly (Instagram)",
        description: "Unlimited Access on Instagram"
    },
    // ---- New credit recharge packs ----
    basic: {
        amount: 9900,        // ₹99
        duration_days: 30,
        name: "🌿 Basic Pack",
        description: "600 messages · 30 days · Unlimited photos",
        pack_name: 'basic'
    },
    romantic: {
        amount: 19900,       // ₹199
        duration_days: 30,
        name: "💖 Romantic Pack",
        description: "1,500 messages · 30 days · Unlimited photos",
        pack_name: 'romantic'
    },
    soulmate: {
        amount: 34900,       // ₹349
        duration_days: 30,
        name: "👑 Soulmate Pack",
        description: "3,000 messages · 30 days · Unlimited photos",
        pack_name: 'soulmate'
    }
};

type PlanType = keyof typeof PLANS;

interface CreateOrderRequest {
    userId?: string;
    instagramUserId?: string;
    planType: PlanType;
    packName?: string; // Optional: 'basic' | 'romantic' | 'soulmate'
}


Deno.serve(async (req) => {
    console.log("🚀 Function invoked: create-razorpay-order");

    if (req.method === "OPTIONS") {
        console.log("OPTIONS request handled");
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const bodyText = await req.text();
        console.log("📦 Raw request body:", bodyText);

        let body;
        try {
            body = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ Failed to parse JSON body");
            throw new Error("Invalid JSON body");
        }

        const { userId, instagramUserId, planType, packName } = body;
        console.log(`👤 Request for: User=${userId}, IG=${instagramUserId}, Plan=${planType}, Pack=${packName || 'N/A'}`);

        // Validate plan type
        if (!PLANS[planType]) {
            console.error("❌ Invalid plan type:", planType);
            return new Response(
                JSON.stringify({ error: "Invalid plan type" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!userId && !instagramUserId) {
            console.error("❌ Missing User ID");
            return new Response(
                JSON.stringify({ error: "User ID is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Initialize Supabase client
        console.log("🔌 Initializing Supabase client...");
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        let userEmail = '';
        let userName = '';

        if (userId) {
            // Verify WEB user exists
            const { data: user, error: userError } = await supabase
                .from('riya_users')
                .select('id, email, username')
                .eq('id', userId)
                .single();

            if (userError || !user) {
                return new Response(
                    JSON.stringify({ error: "User not found" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            userEmail = user.email;
            userName = user.username;

            // Check trial eligibility (only first subscription can be trial)
            if (planType === 'trial') {
                const { data: existingSub } = await supabase
                    .from('riya_subscriptions')
                    .select('id')
                    .eq('user_id', userId)
                    .limit(1);

                if (existingSub && existingSub.length > 0) {
                    return new Response(
                        JSON.stringify({
                            error: "Trial already used",
                            message: "You've already used your trial. Please choose a regular plan."
                        }),
                        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }
            }
        } else if (instagramUserId) {
            // Verify INSTAGRAM user exists
            const { data: igUser, error: igError } = await supabase
                .from('riya_instagram_users')
                .select('instagram_user_id, instagram_username')
                .eq('instagram_user_id', instagramUserId)
                .single();

            if (igError || !igUser) {
                return new Response(
                    JSON.stringify({ error: "Instagram User not found" }),
                    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            userName = igUser.instagram_username || 'Instagram User';
            // Instagram users don't strictly technically have email, we can leave empty or placeholder
        }

        const plan = PLANS[planType];
        // Determine pack_name: explicit packName arg, or from plan definition
        const resolvedPackName = packName || (plan as any).pack_name || null;

        const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
        const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');

        if (!razorpayKeyId || !razorpayKeySecret) {
            console.error("Razorpay credentials not configured");
            return new Response(
                JSON.stringify({ error: "Payment system not configured" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const receiptId = userId
            ? `riya_${userId.slice(0, 8)}_${Date.now()}`
            : `riya_ig_${instagramUserId?.slice(0, 8)}_${Date.now()}`;

        const orderPayload = {
            amount: plan.amount,
            currency: "INR",
            receipt: receiptId,
            notes: {
                user_id: userId || 'instagram_user',
                instagram_user_id: instagramUserId,
                plan_type: planType,
                ...(resolvedPackName ? { pack_name: resolvedPackName } : {}),
                user_email: userEmail,
                username: userName
            }
        };

        const authHeader = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);

        const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${authHeader}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderPayload)
        });

        if (!razorpayResponse.ok) {
            const errorText = await razorpayResponse.text();
            console.error("Razorpay order creation failed:", errorText);
            return new Response(
                JSON.stringify({ error: "Failed to create payment order" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const order = await razorpayResponse.json();

        // Create pending payment record (convert paise to rupees for storage)
        // IMPORTANT: pack_name column must exist in riya_payments (migration: 20260317_add_pack_name_to_payments.sql)
        const insertPayload: Record<string, any> = {
            user_id: userId || null,
            instagram_user_id: instagramUserId || null,
            razorpay_order_id: order.id,
            plan_type: planType,
            amount: plan.amount / 100,
            currency: 'INR',
            status: 'pending',
        };
        if (resolvedPackName) insertPayload.pack_name = resolvedPackName;

        const { error: paymentError } = await supabase
            .from('riya_payments')
            .insert(insertPayload);

        if (paymentError) {
            console.error("Error creating payment record:", paymentError);
            // Throw so the frontend knows the order is broken before even opening Razorpay checkout.
            // Without a payment record, verify-razorpay-payment will return 404 and credits will never be credited.
            throw new Error(`Failed to save payment record: ${paymentError.message}`);
        }

        console.log(`✅ Created Razorpay order ${order.id} for user ${userId}, plan: ${planType}`);

        return new Response(
            JSON.stringify({
                orderId: order.id,
                amount: plan.amount,
                currency: 'INR',
                keyId: razorpayKeyId,
                planName: plan.name,
                planDescription: plan.description,
                durationDays: plan.duration_days,
                userEmail: userEmail,
                userName: userName
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Error creating order:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
