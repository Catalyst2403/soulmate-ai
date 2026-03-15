import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

// Kept for legacy subscription plans (non-credit plans)
const PLAN_DURATIONS: Record<string, number> = {
    trial: 30,
    monthly: 30,
    quarterly: 90,
    half_yearly: 180,
    instagram_monthly: 30
};

// Credit pack names (must match pack_name in riya_recharge_packs)
const CREDIT_PACK_NAMES = ['basic', 'romantic', 'soulmate'];

function stringToBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str);
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

serve(async (req) => {
    console.log("🚀 Webhook received: razorpay-webhook");

    const signature = req.headers.get("X-Razorpay-Signature");
    const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");

    if (!signature || !secret) {
        console.error("❌ Missing signature or webhook secret");
        return new Response("Missing signature or secret", { status: 400 });
    }

    const bodyText = await req.text();

    // Verify Webhook Signature
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
        stringToBytes(bodyText)
    );

    const expectedSignature = bytesToHex(new Uint8Array(signatureBytes));

    if (expectedSignature !== signature) {
        console.error("❌ Invalid webhook signature");
        return new Response("Invalid signature", { status: 400 });
    }

    console.log("✅ Webhook signature verified");

    try {
        const payload = JSON.parse(bodyText);
        const event = payload.event;
        console.log(`📡 Event: ${event}`);

        if (event !== 'payment.captured' && event !== 'order.paid') {
            console.log(`⏭️ Ignoring event: ${event}`);
            return new Response("Event ignored", { status: 200 });
        }

        const payment = payload.payload.payment.entity;
        const orderId = payment.order_id;
        const paymentId = payment.id;

        const userId = payment.notes?.user_id === 'instagram_user' ? null : payment.notes?.user_id;
        const instagramUserId = payment.notes?.instagram_user_id;
        // pack_name takes priority (new credit system), fallback to plan_type for legacy
        const packName = payment.notes?.pack_name || null;
        const planType = payment.notes?.plan_type || 'instagram_monthly';

        console.log(`👤 Processing: User=${userId || 'IG:' + instagramUserId}, Order=${orderId}, Pack=${packName || planType}`);

        if (!orderId || (!userId && !instagramUserId)) {
            console.error("❌ Missing identifier in notes");
            return new Response("Missing identifiers", { status: 200 });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        // IDEMPOTENCY CHECK
        const { data: existingPayment } = await supabase
            .from('riya_payments')
            .select('status, subscription_id')
            .eq('razorpay_order_id', orderId)
            .single();

        if (existingPayment?.status === 'success') {
            console.log(`⏭️ Order ${orderId} already activated. Skipping.`);
            return new Response("Already processed", { status: 200 });
        }

        const now = new Date();

        // ============================================================
        // CREDIT PACK ACTIVATION (new system)
        // ============================================================
        const isCreditPack = packName && CREDIT_PACK_NAMES.includes(packName);

        if (isCreditPack && instagramUserId) {
            console.log(`💳 Credit pack detected: ${packName}`);

            // Fetch pack details from DB
            const { data: pack, error: packErr } = await supabase
                .from('riya_recharge_packs')
                .select('id, message_credits, validity_days, display_name')
                .eq('pack_name', packName)
                .eq('is_active', true)
                .single();

            if (packErr || !pack) {
                console.error(`❌ Pack not found: ${packName}`, packErr);
                return new Response("Pack not found", { status: 200 }); // 200 to Razorpay, log error
            }

            console.log(`📦 Pack: ${pack.display_name} — ${pack.message_credits} credits, ${pack.validity_days} days`);

            // Call atomic RPC to add credits (handles rollover)
            const { data: newBalance, error: rpcErr } = await supabase.rpc('add_message_credits', {
                p_ig_user_id: instagramUserId,
                p_pack_id: pack.id,
                p_credits: pack.message_credits,
                p_validity_days: pack.validity_days,
            });

            if (rpcErr) {
                console.error(`❌ add_message_credits RPC failed:`, rpcErr);
                throw rpcErr;
            }

            console.log(`✅ Credits added for ${instagramUserId}. New balance: ${newBalance}`);

            // Record payment
            await supabase
                .from('riya_payments')
                .upsert({
                    razorpay_order_id: orderId,
                    razorpay_payment_id: paymentId,
                    status: 'success',
                    amount: payment.amount / 100,
                    updated_at: now.toISOString()
                }, { onConflict: 'razorpay_order_id' });

            // Inject system message so Riya reacts naturally on next message
            await supabase.from('riya_conversations').insert({
                user_id: userId || null,
                instagram_user_id: instagramUserId,
                source: 'instagram',
                role: 'user',
                content: JSON.stringify([{
                    text: `[SYSTEM EVENT: User purchased the ${pack.display_name} pack (${pack.message_credits} messages). React warmly and naturally — thank them briefly, then continue the conversation. Do NOT list features or sound like a bot.]`
                }]),
                model_used: 'system',
                metadata: { type: 'system_event', event: 'credit_purchase', pack: packName }
            });

            // Analytics
            try {
                await supabase.from('riya_payment_events').insert({
                    instagram_user_id: instagramUserId,
                    event_type: 'payment_success',
                    metadata: { orderId, paymentId, packName, credits: pack.message_credits, source: 'razorpay-webhook' },
                });
            } catch (e) {
                console.warn('⚠️ payment_success event log failed (non-critical):', e);
            }

            console.log(`✅ Credit pack activation complete for ${orderId}`);
            return new Response("Success", { status: 200 });
        }

        // ============================================================
        // LEGACY SUBSCRIPTION ACTIVATION (is_pro=true flow)
        // ============================================================
        console.log(`📋 Legacy plan activation: ${planType}`);
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
                    amount_paid: payment.amount / 100,
                    razorpay_order_id: orderId,
                    razorpay_payment_id: paymentId,
                    expires_at: newExpiry.toISOString(),
                    is_first_subscription: false,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existingSub.id)
                .select().single();

            if (updateError) throw updateError;
            subscriptionId = updatedSub.id;
        } else {
            const { data: newSub, error: createError } = await supabase
                .from('riya_subscriptions')
                .insert({
                    user_id: userId || null,
                    instagram_user_id: instagramUserId || null,
                    plan_type: planType,
                    status: 'active',
                    amount_paid: payment.amount / 100,
                    razorpay_order_id: orderId,
                    razorpay_payment_id: paymentId,
                    starts_at: now.toISOString(),
                    expires_at: expiresAt.toISOString(),
                    is_first_subscription: planType === 'trial'
                })
                .select().single();

            if (createError) throw createError;
            subscriptionId = newSub.id;
        }

        await supabase
            .from('riya_payments')
            .upsert({
                razorpay_order_id: orderId,
                subscription_id: subscriptionId,
                razorpay_payment_id: paymentId,
                status: 'success',
                amount: payment.amount / 100,
                updated_at: new Date().toISOString()
            }, { onConflict: 'razorpay_order_id' });

        if (instagramUserId) {
            await supabase
                .from('riya_instagram_users')
                .update({
                    is_pro: true,
                    subscription_end_date: expiresAt.toISOString(),
                    subscription_start_date: now.toISOString()
                })
                .eq('instagram_user_id', instagramUserId);

            await supabase.from('riya_conversations').insert({
                user_id: userId || null,
                instagram_user_id: instagramUserId,
                source: 'instagram',
                role: 'user',
                content: JSON.stringify([{ text: "[SYSTEM EVENT: User has successfully upgraded to PRO plan via async webhook. React excitedly!]" }]),
                model_used: 'system',
                metadata: { type: 'system_event', event: 'upgrade_success_webhook' }
            });
        }

        console.log(`✅ Legacy webhook activation successful for ${orderId}`);

        try {
            const igId = instagramUserId || null;
            if (igId) {
                await supabase.from('riya_payment_events').insert({
                    instagram_user_id: igId,
                    event_type: 'payment_success',
                    metadata: { orderId, paymentId, planType, source: 'razorpay-webhook' },
                });
            }
        } catch (e) {
            console.warn('⚠️ payment_success event log failed (non-critical):', e);
        }

        return new Response("Success", { status: 200 });

    } catch (error) {
        console.error("❌ Webhook processing error:", error);
        return new Response("Internal error", { status: 500 });
    }
});
