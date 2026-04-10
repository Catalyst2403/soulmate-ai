import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Legacy plan durations (non-credit plans)
const PLAN_DURATIONS: Record<string, number> = {
    trial: 30,
    monthly: 30,
    quarterly: 90,
    half_yearly: 180,
    instagram_monthly: 30
};

// Credit pack names (must match pack_name in riya_recharge_packs)
const CREDIT_PACK_NAMES = ['basic', 'romantic', 'soulmate'];

interface VerifyPaymentRequest {
    userId?: string;
    instagramUserId?: string;
    telegramUserId?: string;
    orderId: string;
    paymentId: string;
    signature: string;
    planType: string;
    packName?: string; // For new credit system: 'basic' | 'romantic' | 'soulmate'
}

function stringToBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str);
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function hmacSha256(data: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        stringToBytes(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signatureBytes = await crypto.subtle.sign("HMAC", key, stringToBytes(data));
    return bytesToHex(new Uint8Array(signatureBytes));
}

Deno.serve(async (req) => {
    console.log("🚀 Function invoked: verify-razorpay-payment");

    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const bodyText = await req.text();
        let body: VerifyPaymentRequest;
        try {
            body = JSON.parse(bodyText);
        } catch {
            throw new Error("Invalid JSON body");
        }

        const { userId, instagramUserId, telegramUserId, orderId, paymentId, signature, planType, packName } = body;

        console.log(`🔐 Verifying: User=${userId || 'IG:' + instagramUserId || 'TG:' + telegramUserId}, Order=${orderId}, Pack=${packName || planType}`);

        if (!orderId || !paymentId || !signature || (!planType && !packName)) {
            throw new Error("Missing required payment details");
        }

        if (!userId && !instagramUserId && !telegramUserId) {
            return new Response(
                JSON.stringify({ error: "User ID is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
        if (!razorpayKeySecret) {
            return new Response(
                JSON.stringify({ error: "Payment system not configured" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verify signature
        const expectedSig = await hmacSha256(`${orderId}|${paymentId}`, razorpayKeySecret);

        if (expectedSig !== signature) {
            console.error("❌ Signature mismatch");
            await supabase
                .from('riya_payments')
                .update({ status: 'failed', failure_reason: 'Signature verification failed', updated_at: new Date().toISOString() })
                .eq('razorpay_order_id', orderId);

            return new Response(
                JSON.stringify({ error: "Payment verification failed" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ──────────────────────────────────────────────────────────────────────
        // ATOMIC RACE-SAFE CLAIM
        // Flip status from 'pending' → 'processing' in ONE conditional UPDATE.
        // Only the instance that wins (gets data back) proceeds.
        // Any concurrent duplicate call gets null back and exits immediately.
        // This prevents double-credits + double system messages.
        // ──────────────────────────────────────────────────────────────────────
        const { data: claimed } = await supabase
            .from('riya_payments')
            .update({ status: 'processing', updated_at: new Date().toISOString() })
            .eq('razorpay_order_id', orderId)
            .eq('status', 'pending')   // ← only matches if still pending
            .select('id')
            .maybeSingle();

        if (!claimed) {
            // Either: (a) already processing by another concurrent call,
            //         (b) already succeeded (retry from frontend), or
            //         (c) record not found.
            // Re-fetch to decide what to return.
            const { data: current } = await supabase
                .from('riya_payments')
                .select('status')
                .eq('razorpay_order_id', orderId)
                .maybeSingle();

            console.warn(`⚠️ Order ${orderId} already claimed (status=${current?.status}). Returning success without re-processing.`);
            return new Response(
                JSON.stringify({ success: true, message: "Already processed", alreadyProcessed: true }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log(`🔒 Order ${orderId} claimed for processing.`);

        // Fetch full payment record now that we've claimed it
        const { data: paymentRecord } = await supabase
            .from('riya_payments')
            .select('*')
            .eq('razorpay_order_id', orderId)
            .single();

        const now = new Date();
        const isCreditPack = packName && CREDIT_PACK_NAMES.includes(packName);

        // ============================================================
        // CREDIT PACK ACTIVATION (new system)
        // ============================================================
        if (isCreditPack && instagramUserId) {
            console.log(`💳 Credit pack: ${packName}`);

            const { data: pack, error: packErr } = await supabase
                .from('riya_recharge_packs')
                .select('id, message_credits, validity_days, display_name')
                .eq('pack_name', packName)
                .eq('is_active', true)
                .single();

            if (packErr || !pack) {
                throw new Error(`Pack not found: ${packName}`);
            }

            const { data: newBalance, error: rpcErr } = await supabase.rpc('add_message_credits', {
                p_ig_user_id: instagramUserId,
                p_pack_id: pack.id,
                p_credits: pack.message_credits,
                p_validity_days: pack.validity_days,
            });

            if (rpcErr) throw rpcErr;

            console.log(`✅ Credits added: ${newBalance} remaining for ${instagramUserId}`);

            await supabase
                .from('riya_payments')
                .update({
                    razorpay_payment_id: paymentId,
                    status: 'success',
                    updated_at: now.toISOString()
                })
                .eq('razorpay_order_id', orderId);

            // Inject system message for Riya
            await supabase.from('riya_conversations').insert({
                user_id: userId || null,
                instagram_user_id: instagramUserId,
                source: 'instagram',
                role: 'user',
                content: JSON.stringify([{
                    text: `[SYSTEM EVENT: User just purchased the ${pack.display_name} pack (${pack.message_credits} messages). Warmly acknowledge — keep it brief, real, not salesy. Then pick up the conversation naturally.]`
                }]),
                model_used: 'system',
                metadata: { type: 'system_event', event: 'credit_purchase', pack: packName }
            });

            // Analytics
            try {
                await supabase.from('riya_payment_events').insert({
                    instagram_user_id: instagramUserId,
                    event_type: 'payment_success',
                    metadata: { orderId, paymentId, packName, credits: pack.message_credits, source: 'verify-razorpay-payment' },
                });
            } catch (e) {
                console.warn('⚠️ analytics log failed:', e);
            }

            return new Response(
                JSON.stringify({
                    success: true,
                    message: "Credits added successfully!",
                    credits: { added: pack.message_credits, balance: newBalance, validityDays: pack.validity_days }
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ============================================================
        // TELEGRAM CREDIT PACK ACTIVATION
        // ============================================================
        if (isCreditPack && telegramUserId) {
            console.log(`💳 Telegram credit pack: ${packName}`);

            const { data: pack, error: packErr } = await supabase
                .from('riya_recharge_packs')
                .select('id, message_credits, validity_days, display_name')
                .eq('pack_name', packName)
                .eq('is_active', true)
                .single();

            if (packErr || !pack) {
                throw new Error(`Pack not found: ${packName}`);
            }

            const { data: newBalance, error: rpcErr } = await supabase.rpc('add_telegram_message_credits', {
                p_tg_user_id:    telegramUserId,
                p_pack_id:       pack.id,
                p_credits:       pack.message_credits,
                p_validity_days: pack.validity_days,
            });

            if (rpcErr) throw rpcErr;

            console.log(`✅ Telegram credits added: ${newBalance} remaining for ${telegramUserId}`);

            await supabase
                .from('riya_payments')
                .update({
                    razorpay_payment_id: paymentId,
                    status: 'success',
                    updated_at: now.toISOString()
                })
                .eq('razorpay_order_id', orderId);

            // Inject hidden system message so Riya reacts warmly on next message
            await supabase.from('riya_conversations').insert({
                telegram_user_id: telegramUserId,
                source: 'telegram',
                role: 'user',
                content: JSON.stringify([{
                    text: `[SYSTEM EVENT: User just purchased the ${pack.display_name} pack (${pack.message_credits} messages). React warmly but briefly on the next reply — natural, not salesy. Then continue normally.]`
                }]),
                model_used: 'system',
                metadata: { type: 'system_event', event: 'credit_purchase', pack: packName, platform: 'telegram' }
            });

            // Analytics
            try {
                await supabase.from('riya_payment_events').insert({
                    event_type: 'payment_success',
                    metadata: {
                        telegram_user_id: telegramUserId,
                        orderId, paymentId, packName,
                        credits: pack.message_credits,
                        platform: 'telegram',
                        source: 'verify-razorpay-payment'
                    },
                });
            } catch (e) {
                console.warn('⚠️ analytics log failed:', e);
            }

            return new Response(
                JSON.stringify({
                    success: true,
                    message: "Credits added successfully!",
                    credits: { added: pack.message_credits, balance: newBalance, validityDays: pack.validity_days }
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ============================================================
        // LEGACY SUBSCRIPTION ACTIVATION (is_pro=true flow)
        // ============================================================
        console.log(`📋 Legacy plan: ${planType}`);
        const durationDays = PLAN_DURATIONS[planType] || 30;
        const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

        let existingSub: any = null;
        if (userId) {
            const { data } = await supabase.from('riya_subscriptions').select('*').eq('user_id', userId).single();
            existingSub = data;
        } else if (instagramUserId) {
            const { data } = await supabase.from('riya_subscriptions').select('*').eq('instagram_user_id', instagramUserId).single();
            existingSub = data;
        }

        let subscriptionId: string;

        if (existingSub) {
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
                    updated_at: now.toISOString()
                })
                .eq('id', existingSub.id)
                .select().single();

            if (updateError) throw new Error("Failed to update subscription");
            subscriptionId = updatedSub.id;
        } else {
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
                .select().single();

            if (createError) throw new Error("Failed to create subscription");
            subscriptionId = newSub.id;
        }

        await supabase
            .from('riya_payments')
            .update({
                subscription_id: subscriptionId,
                razorpay_payment_id: paymentId,
                status: 'success',
                updated_at: now.toISOString()
            })
            .eq('razorpay_order_id', orderId);

        if (instagramUserId) {
            const finalExpiry = existingSub
                ? (new Date(existingSub.expires_at) > now
                    ? new Date(new Date(existingSub.expires_at).getTime() + durationDays * 24 * 60 * 60 * 1000)
                    : expiresAt)
                : expiresAt;

            await supabase
                .from('riya_instagram_users')
                .update({
                    is_pro: true,
                    subscription_end_date: finalExpiry.toISOString(),
                    subscription_start_date: existingSub ? existingSub.starts_at : now.toISOString()
                })
                .eq('instagram_user_id', instagramUserId);

            await supabase.from('riya_conversations').insert({
                user_id: userId || null,
                instagram_user_id: instagramUserId,
                source: 'instagram',
                role: 'user',
                content: JSON.stringify([{ text: "[SYSTEM EVENT: User has successfully upgraded to PRO plan. React excitedly and thank them for supporting you! You can now send unlimited images and messages.]" }]),
                model_used: 'system',
                metadata: { type: 'system_event', event: 'upgrade_success' }
            });

            try {
                await supabase.from('riya_payment_events').insert({
                    instagram_user_id: instagramUserId,
                    event_type: 'payment_success',
                    metadata: { orderId, paymentId, planType, source: 'verify-razorpay-payment' },
                });
            } catch (e) {
                console.warn('⚠️ analytics log failed:', e);
            }

            return new Response(
                JSON.stringify({
                    success: true,
                    message: "Subscription activated successfully!",
                    subscription: { id: subscriptionId, planType, expiresAt: finalExpiry.toISOString() }
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({ success: true, message: "Subscription activated!", subscription: { id: subscriptionId } }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("❌ Error:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
