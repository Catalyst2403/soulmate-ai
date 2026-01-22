import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Riya Analytics Edge Function
 * Returns comprehensive analytics data for the dashboard
 */

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const url = new URL(req.url);
        const activeUsersInterval = url.searchParams.get('interval') || '7 days';

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        console.log('🔍 Fetching analytics data...');

        // ============================================
        // 1. USER METRICS
        // ============================================

        // Manual query for user metrics
        const { data: users } = await supabase
            .from('riya_users')
            .select('id, last_active, created_at');

        const totalUsers = users?.length || 0;
        const activeUsers = users?.filter((u: any) => {
            const lastActive = new Date(u.last_active);
            const cutoff = new Date();
            cutoff.setTime(cutoff.getTime() - parseInterval(activeUsersInterval));
            return lastActive >= cutoff;
        }).length || 0;

        const dau = users?.filter((u: any) => {
            const lastActive = new Date(u.last_active);
            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);
            return lastActive >= oneDayAgo;
        }).length || 0;

        // ============================================
        // 2. USER CLASSIFICATION
        // ============================================
        const { data: userClassification } = await supabase
            .from('riya_sessions')
            .select('message_count');

        const tiers = {
            '0-10': 0,
            '11-50': 0,
            '51-100': 0,
            '100+': 0
        };

        userClassification?.forEach(session => {
            const count = session.message_count || 0;
            if (count <= 10) tiers['0-10']++;
            else if (count <= 50) tiers['11-50']++;
            else if (count <= 100) tiers['51-100']++;
            else tiers['100+']++;
        });

        // ============================================
        // 3. DAILY ACTIVITY (Active Users + User Messages)
        // ============================================

        // Direct manual query (RPC function doesn't exist)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        console.log('🔍 Fetching user messages from:', thirtyDaysAgo.toISOString());

        const { data: userMessages, error: convError } = await supabase
            .from('riya_conversations')
            .select('created_at, user_id, role')
            .gte('created_at', thirtyDaysAgo.toISOString())
            .eq('role', 'user')
            .order('created_at', { ascending: false }) // Newest first to avoid old data truncation
            .limit(50000); // Override default 1000 row limit

        if (convError) {
            console.error('Error fetching user messages for daily activity:', convError);
        }

        console.log(`📊 Total user messages fetched: ${userMessages?.length || 0}`);

        // Debug: Log first few records
        if (userMessages && userMessages.length > 0) {
            console.log('First 5 records:', userMessages.slice(0, 5));
        }

        const activityMap = new Map();

        userMessages?.forEach(msg => {
            const date = new Date(msg.created_at).toISOString().split('T')[0];
            if (!activityMap.has(date)) {
                activityMap.set(date, { date, users: new Set(), user_messages: 0, guest_sessions: 0 });
            }
            activityMap.get(date).users.add(msg.user_id);
            activityMap.get(date).user_messages++;
        });

        // Fetch guest sessions for last 30 days (only those with messages)
        console.log('👤 Fetching guest sessions from:', thirtyDaysAgo.toISOString());
        const { data: guestSessions, error: guestError } = await supabase
            .from('riya_guest_sessions')
            .select('created_at')
            .gte('created_at', thirtyDaysAgo.toISOString())
            .gt('message_count', 0);

        if (guestError) {
            console.error('Error fetching guest sessions:', guestError);
        }

        console.log(`👤 Total guest sessions fetched: ${guestSessions?.length || 0}`);

        // Add guest sessions to activity map
        guestSessions?.forEach(session => {
            const date = new Date(session.created_at).toISOString().split('T')[0];
            if (!activityMap.has(date)) {
                activityMap.set(date, { date, users: new Set(), user_messages: 0, guest_sessions: 0 });
            }
            activityMap.get(date).guest_sessions++;
        });

        console.log('📅 Daily activity map size:', activityMap.size);

        // Debug: Log today's data specifically
        const today = new Date().toISOString().split('T')[0];
        const todayData = activityMap.get(today);
        if (todayData) {
            console.log(`📌 Today (${today}):`, {
                users: Array.from(todayData.users),
                uniqueUsers: todayData.users.size,
                user_messages: todayData.user_messages
            });
        }

        const dailyActivityData = Array.from(activityMap.values()).map(d => ({
            date: d.date,
            active_users: d.users.size,
            user_messages: d.user_messages,
            guest_sessions: d.guest_sessions
        })).sort((a, b) => b.date.localeCompare(a.date));

        console.log('✅ Daily activity data prepared:', dailyActivityData.slice(0, 3));

        // ============================================
        // 4. ENGAGEMENT METRICS
        // ============================================
        const { data: sessions } = await supabase
            .from('riya_sessions')
            .select('message_count');

        const totalMessages = sessions?.reduce((sum, s) => sum + (s.message_count || 0), 0) || 0;
        const avgMessagesPerUser = sessions && sessions.length > 0
            ? (totalMessages / sessions.length).toFixed(2)
            : '0';

        // ============================================
        // 5. COST METRICS
        // ============================================
        console.log('💰 Fetching cost data from riya_conversations...');

        const { data: costData } = await supabase
            .from('riya_conversations')
            .select('cost_inr, input_tokens, output_tokens, user_id')
            .order('created_at', { ascending: false })
            .limit(50000); // Override default 1000 row limit

        console.log(`💵 Total cost records fetched: ${costData?.length || 0}`);

        const totalCostINR = costData?.reduce((sum, c) => sum + (parseFloat(c.cost_inr) || 0), 0) || 0;
        const totalTokens = costData?.reduce((sum, c) => sum + (c.input_tokens || 0) + (c.output_tokens || 0), 0) || 0;

        const uniqueUsers = new Set(costData?.map(c => c.user_id) || []).size;
        const costPerUser = uniqueUsers > 0 ? (totalCostINR / uniqueUsers).toFixed(4) : '0';

        console.log(`💰 Total cost calculated: ₹${totalCostINR.toFixed(2)} from ${costData?.length || 0} records`);

        // ============================================
        // 6. REVENUE METRICS
        // ============================================
        const { data: subscriptions } = await supabase
            .from('riya_subscriptions')
            .select('*');

        const payingUsers = subscriptions?.filter((s: any) =>
            s.status === 'active' && new Date(s.expires_at) > new Date()
        ).length || 0;

        const totalUsersCount = totalUsers;
        const freeUsers = totalUsersCount - payingUsers;

        const conversionRate = totalUsersCount > 0
            ? ((payingUsers / totalUsersCount) * 100).toFixed(2)
            : '0';

        const totalRevenue = subscriptions
            ?.filter(s => s.status === 'active')
            .reduce((sum, s) => sum + (s.amount_paid || 0), 0) || 0;

        const arpu = payingUsers > 0
            ? ((totalRevenue / 100) / payingUsers).toFixed(2)
            : '0';

        const churnedSubscriptions = subscriptions?.filter(s =>
            s.status === 'expired' || s.status === 'cancelled'
        ).length || 0;

        const churnRate = subscriptions && subscriptions.length > 0
            ? ((churnedSubscriptions / subscriptions.length) * 100).toFixed(2)
            : '0';

        // ============================================
        // 7. RETENTION METRICS
        // ============================================
        const { data: allUsers } = await supabase
            .from('riya_users')
            .select('created_at, last_active');

        const calculateRetention = (days: number) => {
            const eligible = allUsers?.filter(u => {
                const created = new Date(u.created_at);
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - days);
                return created <= cutoff;
            }) || [];

            if (eligible.length === 0) return '0';

            const retained = eligible.filter(u => {
                const created = new Date(u.created_at);
                const lastActive = new Date(u.last_active);
                const targetDate = new Date(created);
                targetDate.setDate(targetDate.getDate() + days);
                return lastActive >= targetDate;
            }).length;

            return ((retained / eligible.length) * 100).toFixed(2);
        };

        const d1Retention = calculateRetention(1);
        const d7Retention = calculateRetention(7);
        const d30Retention = calculateRetention(30);

        // ============================================
        // 8. EXTERNAL INTEGRATIONS (Optional)
        // ============================================
        let googleCloudBilling = null;
        let vercelAnalytics = null;

        try {
            // Google Cloud Billing (if configured)
            console.log('🔍 Checking Google Cloud Billing configuration...');
            const serviceAccount = Deno.env.get('GOOGLE_CLOUD_SERVICE_ACCOUNT');
            const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');
            const billingAccountId = Deno.env.get('GOOGLE_CLOUD_BILLING_ACCOUNT_ID');

            console.log(`  - Service Account: ${serviceAccount ? 'SET' : 'NOT SET'}`);
            console.log(`  - Project ID: ${projectId ? 'SET' : 'NOT SET'}`);
            console.log(`  - Billing Account ID: ${billingAccountId ? 'SET' : 'NOT SET'}`);

            if (serviceAccount && projectId && billingAccountId) {
                console.log('✅ All credentials found, fetching Google Cloud billing...');
                googleCloudBilling = await fetchGoogleCloudBilling();
            } else {
                console.log('⚠️ Google Cloud Billing not configured - missing credentials');
            }
        } catch (error) {
            console.error('❌ Google Cloud Billing API error:', error);
        }

        try {
            // Web Analytics (from Supabase)
            vercelAnalytics = await fetchWebAnalytics(supabase);
        } catch (error) {
            console.warn('Vercel Analytics API not configured or failed:', error);
        }

        // ============================================
        // RETURN COMPREHENSIVE ANALYTICS
        // ============================================
        const analytics = {
            userMetrics: {
                total: totalUsers,
                active: activeUsers,
                dau: dau,
                classification: [
                    { tier: '0-10 msgs', count: tiers['0-10'] },
                    { tier: '11-50 msgs', count: tiers['11-50'] },
                    { tier: '51-100 msgs', count: tiers['51-100'] },
                    { tier: '100+ msgs', count: tiers['100+'] }
                ]
            },
            dailyActivity: dailyActivityData,
            engagement: {
                avgMessagesPerUser,
                totalMessages,
                totalSessions: sessions?.length || 0
            },
            costs: (() => {
                console.log('💰 Cost Metrics Debug:');
                console.log('  - totalCostINR (raw):', totalCostINR);
                console.log('  - totalCostINR (formatted):', totalCostINR.toFixed(4));
                console.log('  - costPerUser:', costPerUser);
                console.log('  - totalTokens:', totalTokens);
                console.log('  - googleCloudBilling:', googleCloudBilling);

                const costsObject = {
                    // Calculated estimate (from token-based calculations)
                    calculatedCostINR: totalCostINR.toFixed(4),
                    costPerUser,
                    totalTokens,

                    // Actual from Google Cloud (when available)
                    actualCostUSD: googleCloudBilling?.monthlyBill || null,
                    actualCostINR: googleCloudBilling?.monthlyBillINR?.toFixed(4) || null,
                    actualCurrency: googleCloudBilling?.currency || null,
                    billingPeriod: googleCloudBilling?.period || null,

                    // Metadata
                    dataSource: googleCloudBilling ? 'google_cloud' : 'calculated',
                    lastUpdated: googleCloudBilling?.lastUpdated || new Date().toISOString()
                };

                console.log('  - Final costs object:', JSON.stringify(costsObject, null, 2));
                return costsObject;
            })(),
            revenue: {
                payingUsers,
                freeUsers,
                conversionRate,
                arpu,
                churnRate,
                totalRevenue: (totalRevenue / 100).toFixed(2)
            },
            retention: {
                d1: d1Retention,
                d7: d7Retention,
                d30: d30Retention
            },
            vercelAnalytics
        };

        console.log('✅ Analytics data fetched successfully');

        return new Response(JSON.stringify(analytics), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Analytics Error:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseInterval(interval: string): number {
    const match = interval.match(/(\d+)\s*(hour|day|week)s?/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
        case 'hour': return value * 60 * 60 * 1000;
        case 'day': return value * 24 * 60 * 60 * 1000;
        case 'week': return value * 7 * 24 * 60 * 60 * 1000;
        default: return 7 * 24 * 60 * 60 * 1000;
    }
}

async function fetchGoogleCloudBilling() {
    try {
        // Check if credentials are configured
        const serviceAccountBase64 = Deno.env.get('GOOGLE_CLOUD_SERVICE_ACCOUNT');
        const billingAccountId = Deno.env.get('GOOGLE_CLOUD_BILLING_ACCOUNT_ID');
        const projectId = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID');

        if (!serviceAccountBase64 || !billingAccountId || !projectId) {
            console.log('⚠️ Google Cloud Billing not configured - using calculated costs');
            return null;
        }

        console.log('☁️ Google Cloud Billing credentials found');
        console.log('⚠️ Note: Google Cloud Billing API integration requires BigQuery export setup');
        console.log('   For now, using calculated costs. See documentation for export setup.');

        // TODO: Implement proper billing data fetch using BigQuery
        // The Cloud Billing API doesn't directly provide cost data
        // You need to export billing data to BigQuery first
        // See: https://cloud.google.com/billing/docs/how-to/export-data-bigquery

        return null; // Fall back to calculated costs for now
    } catch (error) {
        console.error('❌ Google Cloud Billing API error:', error instanceof Error ? error.message : 'Unknown error');
        return null; // Fallback to calculated costs
    }
}


async function fetchWebAnalytics(supabaseClient: any) {
    try {
        // Get analytics data from last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: events, error } = await supabaseClient
            .from('web_analytics')
            .select('*')
            .gte('created_at', sevenDaysAgo.toISOString());

        if (error) {
            console.error('Error fetching web analytics:', error);
            return null;
        }

        if (!events || events.length === 0) {
            // No data yet - return zeros instead of null
            return {
                visitors: 0,
                pageViews: 0,
                bounceRate: 0,
                topPages: [],
                referrers: [],
                countries: [],
                devices: [],
                note: 'No analytics data yet - start browsing your site!'
            };
        }

        // 1. VISITORS & PAGE VIEWS
        const uniqueSessions = new Set(events.map(e => e.session_id));
        const totalVisitors = uniqueSessions.size;
        const totalPageViews = events.length;

        // 2. BOUNCE RATE (sessions with only 1 page view)
        const sessionCounts = new Map<string, number>();
        events.forEach(e => {
            sessionCounts.set(e.session_id, (sessionCounts.get(e.session_id) || 0) + 1);
        });

        const bouncedSessions = Array.from(sessionCounts.values()).filter(count => count === 1).length;
        const bounceRate = totalVisitors > 0 ? Math.round((bouncedSessions / totalVisitors) * 100) : 0;

        // 3. TOP PAGES (by unique visitor count)
        const pageVisitors = new Map<string, Set<string>>();
        events.forEach(e => {
            if (!pageVisitors.has(e.page_path)) {
                pageVisitors.set(e.page_path, new Set());
            }
            pageVisitors.get(e.page_path)!.add(e.session_id);
        });

        const topPages = Array.from(pageVisitors.entries())
            .map(([path, sessions]) => ({
                path,
                visitors: sessions.size
            }))
            .sort((a, b) => b.visitors - a.visitors)
            .slice(0, 10);

        // 4. TOP REFERRERS
        const referrerVisitors = new Map<string, Set<string>>();
        events.forEach(e => {
            if (e.referrer_source && e.referrer_source !== '') {
                if (!referrerVisitors.has(e.referrer_source)) {
                    referrerVisitors.set(e.referrer_source, new Set());
                }
                referrerVisitors.get(e.referrer_source)!.add(e.session_id);
            }
        });

        const referrers = Array.from(referrerVisitors.entries())
            .map(([source, sessions]) => ({
                source,
                visitors: sessions.size
            }))
            .sort((a, b) => b.visitors - a.visitors)
            .slice(0, 10);

        // 5. COUNTRIES (percentage breakdown)
        const countryCounts = new Map<string, number>();
        events.forEach(e => {
            if (e.country && e.country !== '') {
                countryCounts.set(e.country, (countryCounts.get(e.country) || 0) + 1);
            }
        });

        const totalEventsWithCountry = Array.from(countryCounts.values()).reduce((a, b) => a + b, 0);
        const countries = Array.from(countryCounts.entries())
            .map(([country, count]) => ({
                country,
                percentage: totalEventsWithCountry > 0
                    ? Math.round((count / totalEventsWithCountry) * 100)
                    : 0
            }))
            .sort((a, b) => b.percentage - a.percentage)
            .slice(0, 10);

        // 6. DEVICES & OS (percentage breakdown)
        const deviceCounts = new Map<string, number>();
        const osCounts = new Map<string, number>();

        events.forEach(e => {
            if (e.device_type && e.device_type !== '') {
                deviceCounts.set(e.device_type, (deviceCounts.get(e.device_type) || 0) + 1);
            }
            if (e.os && e.os !== '') {
                osCounts.set(e.os, (osCounts.get(e.os) || 0) + 1);
            }
        });

        const devices = [
            // Add device types
            ...Array.from(deviceCounts.entries()).map(([device, count]) => ({
                device,
                percentage: totalPageViews > 0 ? Math.round((count / totalPageViews) * 100) : 0
            })),
            // Add operating systems
            ...Array.from(osCounts.entries()).map(([os, count]) => ({
                device: os,
                percentage: totalPageViews > 0 ? Math.round((count / totalPageViews) * 100) : 0
            }))
        ].sort((a, b) => b.percentage - a.percentage);

        return {
            visitors: totalVisitors,
            pageViews: totalPageViews,
            bounceRate,
            topPages,
            referrers,
            countries,
            devices,
            note: 'Live data from Supabase'
        };
    } catch (error) {
        console.error('Web Analytics error:', error);
        return null;
    }
}
