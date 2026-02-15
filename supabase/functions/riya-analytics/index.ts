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
        // Uses server-side RPC to aggregate data in SQL
        // This avoids PostgREST max-rows limit (default 1000) which was
        // silently truncating results and causing days to show 0

        console.log('🔍 Fetching daily activity via RPC...');

        const { data: dailyActivityRpc, error: dailyError } = await supabase
            .rpc('get_daily_activity', { p_days: 30 });

        if (dailyError) {
            console.error('Error fetching daily activity via RPC:', dailyError);
        }

        console.log(`📊 Daily activity rows returned: ${dailyActivityRpc?.length || 0}`);

        const dailyActivityData = (dailyActivityRpc || []).map((d: any) => ({
            date: d.activity_date,
            active_users: Number(d.active_users) || 0,
            user_messages: Number(d.user_messages) || 0,
            guest_sessions: Number(d.guest_sessions) || 0
        })).sort((a: any, b: any) => b.date.localeCompare(a.date));

        console.log('✅ Daily activity data prepared:', dailyActivityData.slice(0, 5));

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
        // 5. COST METRICS (via server-side RPC to avoid row limits)
        // ============================================
        console.log('💰 Fetching cost data via RPC...');

        const { data: costSummary, error: costError } = await supabase
            .rpc('get_cost_summary');

        if (costError) {
            console.error('Error fetching cost summary via RPC:', costError);
        }

        const costRow = costSummary?.[0] || {};
        const totalCostINR = Number(costRow.total_cost_inr) || 0;
        const totalTokens = (Number(costRow.total_input_tokens) || 0) + (Number(costRow.total_output_tokens) || 0);
        const uniqueUsers = Number(costRow.unique_users) || 0;
        const costPerUser = uniqueUsers > 0 ? (totalCostINR / uniqueUsers).toFixed(4) : '0';

        console.log(`💰 Total cost calculated: ₹${totalCostINR.toFixed(2)} (via RPC, no row truncation)`);

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
        // 8. INSTAGRAM METRICS
        // ============================================
        console.log('📸 Fetching Instagram metrics...');



        const { data: igUsers } = await supabase
            .from('riya_instagram_users')
            .select('id, instagram_user_id, message_count, last_message_at, created_at, trial_ends_at');

        const totalIgUsers = igUsers?.length || 0;

        const now = new Date();



        // IG DAU (always last 24h)
        const oneDayAgoIg = new Date();
        oneDayAgoIg.setDate(oneDayAgoIg.getDate() - 1);
        const igDau = igUsers?.filter((u: any) => {
            if (!u.last_message_at) return false;
            return new Date(u.last_message_at) >= oneDayAgoIg;
        }).length || 0;

        const totalIgMessages = igUsers?.reduce((sum: number, u: any) => sum + (u.message_count || 0), 0) || 0;
        const avgIgMsgsPerUser = totalIgUsers > 0
            ? (totalIgMessages / totalIgUsers).toFixed(2)
            : '0';

        const igInTrial = igUsers?.filter((u: any) =>
            u.trial_ends_at && new Date(u.trial_ends_at) > now
        ).length || 0;

        const igTrialExpired = igUsers?.filter((u: any) =>
            u.trial_ends_at && new Date(u.trial_ends_at) <= now
        ).length || 0;

        // IG MAU (active is last 30 days)
        const thirtyDaysAgoIg = new Date();
        thirtyDaysAgoIg.setDate(thirtyDaysAgoIg.getDate() - 30);
        const igMau = igUsers?.filter((u: any) => {
            if (!u.last_message_at) return false;
            return new Date(u.last_message_at) >= thirtyDaysAgoIg;
        }).length || 0;

        const igDauMauRatio = igMau > 0 ? ((igDau / igMau) * 100).toFixed(1) : '0';

        // IG User Classification by message count
        const igTiers = { '0-10': 0, '11-50': 0, '51-100': 0, '101-200': 0, '201-500': 0, '500+': 0 };
        igUsers?.forEach((u: any) => {
            const count = u.message_count || 0;
            if (count <= 10) igTiers['0-10']++;
            else if (count <= 50) igTiers['11-50']++;
            else if (count <= 100) igTiers['51-100']++;
            else if (count <= 200) igTiers['101-200']++;
            else if (count <= 500) igTiers['201-500']++;
            else igTiers['500+']++;
        });

        // IG Retention (D1, D3, D7, D30)
        const calculateIgRetention = (days: number) => {
            const eligible = igUsers?.filter((u: any) => {
                const created = new Date(u.created_at);
                const cutoff = new Date();
                cutoff.setDate(cutoff.getDate() - days);
                return created <= cutoff;
            }) || [];

            if (eligible.length === 0) return '0';

            const retained = eligible.filter((u: any) => {
                if (!u.last_message_at) return false;
                const created = new Date(u.created_at);
                const lastMsg = new Date(u.last_message_at);
                const targetDate = new Date(created);
                targetDate.setDate(targetDate.getDate() + days);
                return lastMsg >= targetDate;
            }).length;

            return ((retained / eligible.length) * 100).toFixed(2);
        };

        const igD1 = calculateIgRetention(1);
        const igD3 = calculateIgRetention(3);
        const igD7 = calculateIgRetention(7);
        const igD30 = calculateIgRetention(30);

        // IG Approx Cost (messages × ₹0.08)
        const igApproxCostINR = (totalIgMessages * 0.08).toFixed(2);

        // New IG Users Per Day (last 30 days)
        const igNewUsersPerDay: Record<string, number> = {};
        igUsers?.forEach((u: any) => {
            const date = new Date(u.created_at).toISOString().split('T')[0];
            igNewUsersPerDay[date] = (igNewUsersPerDay[date] || 0) + 1;
        });

        const igNewUsersTrend = Object.entries(igNewUsersPerDay)
            .map(([date, count]) => ({ date, new_users: count }))
            .sort((a, b) => b.date.localeCompare(a.date));

        // Daily IG Activity (active users + USER messages per day from riya_conversations)
        // Daily IG Activity (active users + USER messages per day from riya_conversations)
        // Uses RPC to avoid 1000-row limit that was hiding recent data
        const { data: igDailyActivityRpc, error: igDailyError } = await supabase
            .rpc('get_instagram_daily_activity', { days_lookback: 30 });

        if (igDailyError) {
            console.error('Error fetching IG daily activity:', igDailyError);
        }

        const igDailyActivity = (igDailyActivityRpc || []).map((d: any) => ({
            date: d.activity_date,
            active_users: Number(d.active_users) || 0,
            messages: Number(d.message_count) || 0,
            approx_cost: parseFloat((Number(d.message_count) * 0.06).toFixed(2))
        }));

        console.log(`📸 IG: ${totalIgUsers} users, ${igDau} DAU, ${totalIgMessages} msgs, cost≈₹${igApproxCostINR}`);

        // ============================================
        // 9. PMF SCORECARD (Combined Web + IG)
        // ============================================
        const totalAllUsers = totalUsers + totalIgUsers;
        const totalAllDau = dau + igDau;
        const dauPercentage = totalAllUsers > 0
            ? ((totalAllDau / totalAllUsers) * 100).toFixed(2)
            : '0';

        // Weighted combined D7 retention
        const webD7Num = parseFloat(d7Retention as string) || 0;
        const igD7Num = parseFloat(igD7) || 0;
        const combinedD7 = totalAllUsers > 0
            ? ((webD7Num * totalUsers + igD7Num * totalIgUsers) / totalAllUsers).toFixed(2)
            : '0';

        // PMF verdict
        const dauPct = parseFloat(dauPercentage);
        const d7Pct = parseFloat(combinedD7);
        let pmfVerdict: 'pre-pmf' | 'approaching' | 'pmf' = 'pre-pmf';
        if (d7Pct > 20 && dauPct > 15) {
            pmfVerdict = 'pmf';
        } else if (d7Pct > 10 || dauPct > 10) {
            pmfVerdict = 'approaching';
        }

        console.log(`🎯 PMF: ${totalAllUsers} total, ${dauPercentage}% DAU, D7=${combinedD7}%, verdict=${pmfVerdict}`);

        // ============================================
        // 10. EXTERNAL INTEGRATIONS (Optional)
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
            instagramMetrics: {
                total: totalIgUsers,

                dau: igDau,
                mau: igMau,
                dauMauRatio: igDauMauRatio,
                totalMessages: totalIgMessages,
                avgMsgsPerUser: avgIgMsgsPerUser,
                inTrial: igInTrial,
                trialExpired: igTrialExpired,
                approxCostINR: igApproxCostINR,
                classification: [
                    { tier: '0-10 msgs', count: igTiers['0-10'] },
                    { tier: '11-50 msgs', count: igTiers['11-50'] },
                    { tier: '51-100 msgs', count: igTiers['51-100'] },
                    { tier: '101-200 msgs', count: igTiers['101-200'] },
                    { tier: '201-500 msgs', count: igTiers['201-500'] },
                    { tier: '500+ msgs', count: igTiers['500+'] }
                ],
                retention: {
                    d1: igD1,
                    d3: igD3,
                    d7: igD7,
                    d30: igD30
                },
                newUsersTrend: igNewUsersTrend,
                dailyActivity: igDailyActivity
            },
            pmfScore: {
                totalAllUsers: totalAllUsers,
                totalAllDau: totalAllDau,
                dauPercentage,
                combinedD7Retention: combinedD7,
                verdict: pmfVerdict
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
