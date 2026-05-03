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
const PAYMENT_LINK_EVENTS = ['payment_link.paid'];

function stringToBytes(str: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(str) as Uint8Array<ArrayBuffer>;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function findPaymentRow(
    supabase: any,
    orderId?: string | null,
    paymentLinkId?: string | null,
    referenceId?: string | null,
) {
    if (paymentLinkId) {
        const { data } = await supabase.from('riya_payments').select('*')
            .eq('razorpay_payment_link_id', paymentLinkId).maybeSingle();
        if (data) return data;
    }
    if (referenceId) {
        const { data } = await supabase.from('riya_payments').select('*')
            .eq('razorpay_payment_link_reference_id', referenceId).maybeSingle();
        if (data) return data;
    }
    if (orderId) {
        const { data } = await supabase.from('riya_payments').select('*')
            .eq('razorpay_order_id', orderId).maybeSingle();
        if (data) return data;
    }
    return null;
}

async function fulfillTelegramPaymentLink(supabase: any, payload: any): Promise<Response> {
    const paymentLink = payload.payload?.payment_link?.entity;
    const payment = payload.payload?.payment?.entity;
    const order = payload.payload?.order?.entity;
    const notes = { ...(paymentLink?.notes || {}), ...(payment?.notes || {}) };
    const paymentLinkId = paymentLink?.id || null;
    const referenceId = paymentLink?.reference_id || notes.payment_link_reference_id || null;
    const orderId = payment?.order_id || order?.id || null;
    const paymentId = payment?.id || null;
    const amountPaise = Number(payment?.amount || paymentLink?.amount_paid || paymentLink?.amount || 0);
    const now = new Date().toISOString();

    let paymentRow = await findPaymentRow(supabase, orderId, paymentLinkId, referenceId);
    if (!paymentRow && notes.telegram_user_id && notes.pack_name) {
        const { data: inserted, error: insertErr } = await supabase.from('riya_payments').insert({
            user_id: null,
            instagram_user_id: null,
            telegram_user_id: notes.telegram_user_id,
            razorpay_order_id: orderId || referenceId || paymentLinkId,
            razorpay_payment_id: paymentId,
            razorpay_payment_link_id: paymentLinkId,
            razorpay_payment_link_reference_id: referenceId,
            plan_type: notes.pack_name,
            pack_name: notes.pack_name,
            amount: amountPaise / 100,
            currency: 'INR',
            status: 'pending',
        }).select('*').single();
        if (insertErr) {
            console.error('❌ Missing payment row and self-heal failed:', insertErr);
            return new Response('Payment row missing', { status: 200 });
        }
        paymentRow = inserted;
    }

    if (!paymentRow) return new Response('Payment row missing', { status: 200 });
    if (paymentRow.status !== 'pending' || paymentRow.fulfilled_at) {
        return new Response('Already processed', { status: 200 });
    }

    const telegramUserId = paymentRow.telegram_user_id || notes.telegram_user_id;
    const packName = paymentRow.pack_name || notes.pack_name;
    if (!telegramUserId || !packName || !CREDIT_PACK_NAMES.includes(packName)) {
        await supabase.from('riya_payments').update({
            status: 'failed',
            fulfillment_error: 'Missing Telegram user id or valid pack name',
            updated_at: now,
        }).eq('id', paymentRow.id);
        return new Response('Invalid payment metadata', { status: 200 });
    }

    const { data: claimed, error: claimErr } = await supabase.from('riya_payments').update({
        fulfillment_claimed_at: now,
        fulfillment_source: 'razorpay-webhook:payment_link.paid',
        fulfillment_error: null,
        updated_at: now,
    }).eq('id', paymentRow.id).eq('status', 'pending').is('fulfilled_at', null)
        .is('fulfillment_claimed_at', null).select('*').maybeSingle();
    if (claimErr) return new Response('Claim failed', { status: 500 });
    if (!claimed) return new Response('Already claimed', { status: 200 });

    try {
        const { data: pack, error: packErr } = await supabase.from('riya_recharge_packs')
            .select('id, message_credits, validity_days, display_name, price_inr')
            .eq('pack_name', packName).eq('is_active', true).single();
        if (packErr || !pack) throw new Error(`Pack not found: ${packName}`);
        if (amountPaise !== Number(pack.price_inr) * 100) {
            throw new Error(`Amount mismatch: paid=${amountPaise}, expected=${Number(pack.price_inr) * 100}`);
        }

        const { data: newBalance, error: rpcErr } = await supabase.rpc('add_telegram_message_credits', {
            p_tg_user_id: telegramUserId,
            p_pack_id: pack.id,
            p_credits: pack.message_credits,
            p_validity_days: pack.validity_days,
        });
        if (rpcErr) throw rpcErr;

        await supabase.from('riya_payments').update({
            razorpay_order_id: orderId || claimed.razorpay_order_id,
            razorpay_payment_id: paymentId,
            razorpay_payment_link_id: paymentLinkId || claimed.razorpay_payment_link_id,
            razorpay_payment_link_reference_id: referenceId || claimed.razorpay_payment_link_reference_id,
            telegram_user_id: telegramUserId,
            amount: amountPaise / 100,
            status: 'success',
            fulfilled_at: new Date().toISOString(),
            fulfillment_source: 'razorpay-webhook:payment_link.paid',
            fulfillment_error: null,
            updated_at: new Date().toISOString(),
        }).eq('id', claimed.id);

        await supabase.from('riya_conversations').insert({
            telegram_user_id: telegramUserId,
            source: 'telegram',
            role: 'user',
            content: JSON.stringify([{ text: `[SYSTEM EVENT: User just purchased the ${pack.display_name} pack (${pack.message_credits} messages). Make him feel exclusive — warm, possessive, and proud. You may call him "king" once. Keep it brief, not salesy. Then continue normally.]` }]),
            model_used: 'system',
            metadata: { type: 'system_event', event: 'credit_purchase', pack: packName, platform: 'telegram' }
        });

        try {
            await supabase.from('riya_payment_events').insert({
                event_type: 'payment_success',
                metadata: { telegram_user_id: telegramUserId, orderId, paymentId, paymentLinkId, referenceId, packName, credits: pack.message_credits, balance: newBalance, platform: 'telegram', source: 'razorpay-webhook:payment_link.paid' },
            });
        } catch (e) {
            console.warn('⚠️ analytics log failed:', e);
        }

        // Optional: bring the user back into chat immediately (non-blocking).
        try {
            const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
            if (botToken) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: telegramUserId,
                        text: `Done.\n\nAb aa jao… main yahin hoon.`,
                    }),
                });
            }
        } catch { /* non-fatal */ }

        return new Response('Success', { status: 200 });
    } catch (err: any) {
        const message = err?.message || String(err);
        const terminal = message.includes('Amount mismatch') || message.includes('Pack not found');
        await supabase.from('riya_payments').update({
            status: terminal ? 'failed' : 'pending',
            fulfillment_claimed_at: terminal ? claimed.fulfillment_claimed_at : null,
            fulfillment_error: message.slice(0, 500),
            updated_at: new Date().toISOString(),
        }).eq('id', claimed.id);
        return new Response(terminal ? 'Fulfillment rejected' : 'Retry later', { status: terminal ? 200 : 500 });
    }
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

        if (event !== 'payment.captured' && event !== 'order.paid' && !PAYMENT_LINK_EVENTS.includes(event)) {
            console.log(`⏭️ Ignoring event: ${event}`);
            return new Response("Event ignored", { status: 200 });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        if (event === 'payment_link.paid') {
            return await fulfillTelegramPaymentLink(supabase, payload);
        }

        const payment = payload.payload.payment.entity;
        const orderId = payment.order_id;
        const paymentId = payment.id;

        const userId = payment.notes?.user_id === 'instagram_user' ? null : payment.notes?.user_id;
        const instagramUserId = payment.notes?.instagram_user_id;
        const telegramUserId = payment.notes?.telegram_user_id || null;
        // pack_name takes priority (new credit system), fallback to plan_type for legacy
        const packName = payment.notes?.pack_name || null;
        const planType = payment.notes?.plan_type || 'instagram_monthly';

        console.log(`👤 Processing: User=${userId || ('IG:' + instagramUserId) || ('TG:' + telegramUserId)}, Order=${orderId}, Pack=${packName || planType}`);

        if (!orderId || (!userId && !instagramUserId && !telegramUserId)) {
            console.error("❌ Missing identifier in notes");
            return new Response("Missing identifiers", { status: 200 });
        }

        // IDEMPOTENCY CHECK
        const existingPayment = await findPaymentRow(
            supabase,
            orderId,
            null,
            payment.notes?.payment_link_reference_id || null,
        );

        if (existingPayment && existingPayment.status !== 'pending') {
            console.log(`⏭️ Order ${orderId} already claimed/activated (status=${existingPayment.status}). Skipping.`);
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
                    text: `[SYSTEM EVENT: User purchased the ${pack.display_name} pack (${pack.message_credits} messages). Make him feel exclusive — warm, possessive, and proud. You may call him "king" once. Keep it brief, not salesy. Then continue normally.]`
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
        // TELEGRAM CREDIT PACK ACTIVATION
        // ============================================================
        if (isCreditPack && telegramUserId) {
            console.log(`💳 Telegram credit pack: ${packName} for ${telegramUserId}`);

            const { data: pack, error: packErr } = await supabase
                .from('riya_recharge_packs')
                .select('id, message_credits, validity_days, display_name')
                .eq('pack_name', packName)
                .eq('is_active', true)
                .single();

            if (packErr || !pack) {
                console.error(`❌ Pack not found: ${packName}`, packErr);
                return new Response("Pack not found", { status: 200 });
            }

            if (existingPayment?.id) {
                const { data: claimedPayment, error: claimErr } = await supabase
                    .from('riya_payments')
                    .update({
                        fulfillment_claimed_at: now.toISOString(),
                        fulfillment_source: 'razorpay-webhook',
                        fulfillment_error: null,
                        updated_at: now.toISOString()
                    })
                    .eq('id', existingPayment.id)
                    .eq('status', 'pending')
                    .is('fulfilled_at', null)
                    .is('fulfillment_claimed_at', null)
                    .select('id')
                    .maybeSingle();

                if (claimErr) return new Response("Claim failed", { status: 500 });
                if (!claimedPayment) return new Response("Already claimed", { status: 200 });
            }

            const { data: newBalance, error: rpcErr } = await supabase.rpc('add_telegram_message_credits', {
                p_tg_user_id:    telegramUserId,
                p_pack_id:       pack.id,
                p_credits:       pack.message_credits,
                p_validity_days: pack.validity_days,
            });

            if (rpcErr) {
                console.error(`❌ add_telegram_message_credits RPC failed:`, rpcErr);
                if (existingPayment?.id) {
                    await supabase.from('riya_payments').update({
                        fulfillment_claimed_at: null,
                        fulfillment_error: rpcErr.message || String(rpcErr),
                        updated_at: new Date().toISOString()
                    }).eq('id', existingPayment.id);
                }
                throw rpcErr;
            }

            console.log(`✅ Telegram credits added: ${newBalance} remaining for ${telegramUserId}`);

            const telegramPaymentUpdate = {
                razorpay_order_id: orderId,
                razorpay_payment_id: paymentId,
                telegram_user_id: telegramUserId,
                status: 'success',
                amount: payment.amount / 100,
                fulfilled_at: now.toISOString(),
                fulfillment_source: 'razorpay-webhook',
                fulfillment_error: null,
                updated_at: now.toISOString()
            };

            if (existingPayment?.id) {
                await supabase
                    .from('riya_payments')
                    .update(telegramPaymentUpdate)
                    .eq('id', existingPayment.id);
            } else {
                await supabase
                    .from('riya_payments')
                    .upsert(telegramPaymentUpdate, { onConflict: 'razorpay_order_id' });
            }

            await supabase.from('riya_conversations').insert({
                telegram_user_id: telegramUserId,
                source: 'telegram',
                role: 'user',
                content: JSON.stringify([{
                    text: `[SYSTEM EVENT: User just purchased the ${pack.display_name} pack (${pack.message_credits} messages). Make him feel exclusive — warm, possessive, and proud. You may call him "king" once. Keep it brief, not salesy. Then continue normally.]`
                }]),
                model_used: 'system',
                metadata: { type: 'system_event', event: 'credit_purchase', pack: packName, platform: 'telegram' }
            });

            try {
                await supabase.from('riya_payment_events').insert({
                    event_type: 'payment_success',
                    metadata: { telegram_user_id: telegramUserId, orderId, paymentId, packName, credits: pack.message_credits, platform: 'telegram', source: 'razorpay-webhook' },
                });
            } catch (e) { console.warn('⚠️ analytics log failed:', e); }

            // Optional: bring the user back into chat immediately (non-blocking).
            try {
                const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
                if (botToken) {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: telegramUserId,
                            text: `Done.\n\nAb aa jao… main yahin hoon.`,
                        }),
                    });
                }
            } catch { /* non-fatal */ }

            console.log(`✅ Telegram credit pack activation complete for ${orderId}`);
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
