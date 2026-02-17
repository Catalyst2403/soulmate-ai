import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Razorpay Payment Verification Edge Function
 * Verifies payment signature and activates subscription
 */

// Plan durations
const PLAN_DURATIONS: Record<string, number> = {
    trial: 30,
    monthly: 30,
    quarterly: 90,
    half_yearly: 180,
    instagram_monthly: 30
};

interface VerifyPaymentRequest {
    userId?: string;
    instagramUserId?: string;
    orderId: string;
    paymentId: string;
    signature: string;
    planType: string;
}

// Convert string to Uint8Array for crypto operations
function stringToBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str);
}

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// HMAC SHA256 function
async function hmacSha256(data: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        stringToBytes(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signatureBytes = await crypto.subtle.sign(
        "HMAC",
        key,
        stringToBytes(data)
    );

    return bytesToHex(new Uint8Array(signatureBytes));
}

Deno.serve(async (req) => {
    console.log("🚀 Function invoked: verify-razorpay-payment");

    if (req.method === "OPTIONS") {
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

        const { userId, instagramUserId, orderId, paymentId, signature, planType }: VerifyPaymentRequest = body;

        console.log(`🔐 Verifying payment: User=${userId || 'IG:' + instagramUserId}, Order=${orderId}, Payment=${paymentId}, Plan=${planType}`);

        if (!orderId || !paymentId || !signature || !planType) {
            console.error("❌ Missing required payment details");
            throw new Error("Missing required payment details");
        }

        if (!userId && !instagramUserId) {
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

        const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');

        if (!razorpayKeySecret) {
            console.error("Razorpay secret not configured");
            return new Response(
                JSON.stringify({ error: "Payment system not configured" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verify signature using HMAC SHA256
        // Razorpay signature = HMAC_SHA256(order_id + "|" + payment_id, secret)
        const messageBody = `${orderId}|${paymentId}`;

        const key = await crypto.subtle.importKey(
            "raw",
            stringToBytes(razorpayKeySecret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );

        const signatureBytes = await crypto.subtle.sign(
            "HMAC",
            key,
            stringToBytes(messageBody)
        );

        const expectedSignature = bytesToHex(new Uint8Array(signatureBytes));

        if (expectedSignature !== signature) {
            console.error("❌ Signature verification failed");
            console.error(`Expected: ${expectedSignature}`);
            console.error(`Received: ${signature}`);

            // Update payment as failed
            await supabase
                .from('riya_payments')
                .update({
                    status: 'failed',
                    failure_reason: 'Signature verification failed',
                    updated_at: new Date().toISOString()
                })
                .eq('razorpay_order_id', orderId);

            return new Response(
                JSON.stringify({ error: "Payment verification failed" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log("✅ Signature verified successfully");

        // Get payment record
        const { data: paymentRecord } = await supabase
            .from('riya_payments')
            .select('*')
            .eq('razorpay_order_id', orderId)
            .single();

        if (!paymentRecord) {
            console.error("Payment record not found for order:", orderId);
            return new Response(
                JSON.stringify({ error: "Payment record not found" }),
                { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Calculate subscription dates
        const now = new Date();
        const durationDays = PLAN_DURATIONS[planType] || 30;
        const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

        // Check for existing subscription
        let existingSub: any = null;

        if (userId) {
            const { data } = await supabase
                .from('riya_subscriptions')
                .select('*')
                .eq('user_id', userId)
                .single();
            existingSub = data;
        } else if (instagramUserId) {
            const { data } = await supabase
                .from('riya_subscriptions')
                .select('*')
                .eq('instagram_user_id', instagramUserId)
                .single();
            existingSub = data;
        }

        let subscriptionId: string;

        if (existingSub) {
            // Extend existing subscription
            const currentExpiry = new Date(existingSub.expires_at);
            const newExpiry = currentExpiry > now
                ? new Date(currentExpiry.getTime() + durationDays * 24 * 60 * 60 * 1000)
                : expiresAt;

            const { data: updatedSub, error: updateError } = await supabase
                .from('riya_subscriptions')
                .update({
                    plan_type: planType,
                    status: 'active',
                    amount_paid: paymentRecord.amount,
                    razorpay_order_id: orderId,
                    razorpay_payment_id: paymentId,
                    razorpay_signature: signature,
                    expires_at: newExpiry.toISOString(),
                    is_first_subscription: false,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existingSub.id)
                .select()
                .single();

            if (updateError) {
                console.error("Error updating subscription:", updateError);
                throw new Error("Failed to update subscription");
            }

            subscriptionId = updatedSub.id;
            console.log(`✅ Extended subscription ${subscriptionId} until ${newExpiry.toISOString()}`);
        } else {
            // Create new subscription
            const { data: newSub, error: createError } = await supabase
                .from('riya_subscriptions')
                .insert({
                    user_id: userId || null,
                    instagram_user_id: instagramUserId || null,
                    plan_type: planType,
                    status: 'active',
                    amount_paid: paymentRecord.amount,
                    razorpay_order_id: orderId,
                    razorpay_payment_id: paymentId,
                    razorpay_signature: signature,
                    starts_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                    is_first_subscription: planType === 'trial'
                })
                .select()
                .single();

            if (createError) {
                console.error("Error creating subscription:", createError);
                throw new Error("Failed to create subscription");
            }

            subscriptionId = newSub.id;
            console.log(`✅ Created new subscription ${subscriptionId} until ${expiresAt.toISOString()}`);
        }

        // Update payment record
        await supabase
            .from('riya_payments')
            .update({
                subscription_id: subscriptionId,
                razorpay_payment_id: paymentId,
                status: 'success',
                updated_at: new Date().toISOString()
            })
            .eq('razorpay_order_id', orderId);

        // If Instagram user, update the riya_instagram_users table flags
        if (instagramUserId) {
            await supabase
                .from('riya_instagram_users')
                .update({
                    is_pro: true,
                    subscription_end_date: existingSub
                        ? (new Date(new Date(existingSub.expires_at) > now
                            ? new Date(existingSub.expires_at).getTime() + durationDays * 24 * 60 * 60 * 1000
                            : expiresAt.getTime()).toISOString())
                        : expiresAt.toISOString()
                })
                .eq('instagram_user_id', instagramUserId);

            console.log(`✅ Updated Instagram user ${instagramUserId} status to PRO`);

            // Inject SYSTEM message into conversation history so Riya knows immediately
            console.log(`📝 Injecting 'User Upgraded' system message for ${instagramUserId}`);
            const { error: msgError } = await supabase
                .from('riya_conversations')
                .insert({
                    user_id: userId || null,
                    instagram_user_id: instagramUserId,
                    source: 'instagram',
                    role: 'system', // Changed from 'sender'
                    content: JSON.stringify([{ text: "[SYSTEM EVENT: User has successfully upgraded to PRO plan. React excitedly and thank them for supporting you! You can now send unlimited images and messages.]" }]), // Changed from 'message'
                    model_used: 'system',
                    metadata: { type: 'system_event', event: 'upgrade_success' }
                });

            if (msgError) {
                console.error("⚠️ Failed to inject system message:", msgError);
            } else {
                console.log("✅ System message injected successfully");
            }
        }

        console.log(`✅ Payment ${paymentId} verified and subscription activated for user ${userId || instagramUserId}`);

        return new Response(
            JSON.stringify({
                success: true,
                message: "Subscription activated successfully!",
                subscription: {
                    id: subscriptionId,
                    planType,
                    expiresAt: existingSub
                        ? new Date(new Date(existingSub.expires_at) > now
                            ? new Date(existingSub.expires_at).getTime() + durationDays * 24 * 60 * 60 * 1000
                            : expiresAt.getTime()).toISOString()
                        : expiresAt.toISOString()
                }
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Error verifying payment:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
