import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * check-razorpay-order
 *
 * Lightweight read-only status check for UPI intent payments.
 * After the user pays via PhonePe / GPay / any UPI app, the frontend
 * polls this endpoint every 3 s to detect when the order flips to "paid".
 *
 * Credits are added by the razorpay-webhook — this function only tells
 * the frontend whether payment is confirmed so it can show the success screen.
 *
 * Input:  { orderId: string }
 * Output: { status: "created" | "attempted" | "paid", paid: boolean }
 */
serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { orderId } = await req.json();

        if (!orderId || typeof orderId !== "string") {
            return new Response(
                JSON.stringify({ error: "orderId is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
        const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

        if (!razorpayKeyId || !razorpayKeySecret) {
            return new Response(
                JSON.stringify({ error: "Payment system not configured" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const authHeader = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);

        const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
            headers: { Authorization: `Basic ${authHeader}` },
        });

        if (!res.ok) {
            const text = await res.text();
            console.error(`Razorpay order fetch failed (${res.status}):`, text);
            return new Response(
                JSON.stringify({ error: "Failed to fetch order status" }),
                { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const order = await res.json();
        const paid = order.status === "paid";

        console.log(`📋 Order ${orderId} status: ${order.status}`);

        return new Response(
            JSON.stringify({ status: order.status, paid }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (err) {
        console.error("check-razorpay-order error:", err);
        return new Response(
            JSON.stringify({ error: "Internal error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
