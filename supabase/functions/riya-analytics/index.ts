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

        // "since" filter — show only data after this date (e.g. "2026-03-03")
        const sinceParam = url.searchParams.get('since'); // YYYY-MM-DD or null
        const sinceISO = sinceParam ? new Date(sinceParam).toISOString() : null;
        // Compute dynamic lookback in days for RPCs that accept days_lookback / p_days
        const daysLookback = sinceParam
            ? Math.max(1, Math.ceil((Date.now() - new Date(sinceParam).getTime()) / 86_400_000))
            : 30;

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        console.log('🔍 Fetching analytics data...');

        // ============================================
        // 1. USER METRICS
        // ============================================

        // Manual query for user metrics
        let usersQuery = supabase.from('riya_users').select('id, last_active, created_at');
        if (sinceISO) usersQuery = usersQuery.gte('created_at', sinceISO);
        const { data: users } = await usersQuery;

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
            .rpc('get_daily_activity', { p_days: daysLookback });

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
        let subsQuery = supabase.from('riya_subscriptions').select('*');
        if (sinceISO) subsQuery = subsQuery.gte('starts_at', sinceISO);
        const { data: subscriptions } = await subsQuery;

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
        let allUsersQuery = supabase.from('riya_users').select('created_at, last_active');
        if (sinceISO) allUsersQuery = allUsersQuery.gte('created_at', sinceISO);
        const { data: allUsers } = await allUsersQuery;

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
        const d2Retention = calculateRetention(2);
        const d7Retention = calculateRetention(7);
        const d30Retention = calculateRetention(30);

        // ============================================
        // 8. INSTAGRAM METRICS
        // ============================================
        console.log('📸 Fetching Instagram metrics...');



        let igUsersQuery = supabase
            .from('riya_instagram_users')
            .select('id, instagram_user_id, instagram_username, instagram_name, message_count, last_message_at, created_at, trial_ends_at, is_pro, subscription_end_date, subscription_start_date');
        if (sinceISO) igUsersQuery = igUsersQuery.gte('created_at', sinceISO);
        const { data: igUsers } = await igUsersQuery;

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

        // Pro Users List
        const proUsers = igUsers?.filter((u: any) => u.is_pro)
            .map((u: any) => ({
                username: u.instagram_username || 'Unknown',
                name: u.instagram_name || 'Unknown',
                messageCount: u.message_count || 0,
                expiry: u.subscription_end_date
            }))
            .sort((a: any, b: any) => b.messageCount - a.messageCount) || [];

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

        // NOTE: these use last_message_at which only stores the LATEST activity.
        // For true cohort retention, use the cohortRetention block below (RPC-based).
        const igD1 = calculateIgRetention(1);
        const igD2 = calculateIgRetention(2);
        const igD3 = calculateIgRetention(3);
        const igD7 = calculateIgRetention(7);
        const igD30 = calculateIgRetention(30);

        // IG Approx Cost (messages × ₹0.08)
        const igApproxCostINR = (totalIgMessages * 0.08).toFixed(2);

        // IG Session Time Metrics
        console.log('⏱️ Fetching IG session metrics...');
        const { data: sessionMetricsRpc, error: sessionError } = await supabase
            .rpc('get_instagram_session_metrics', { days_lookback: daysLookback });

        if (sessionError) {
            console.error('Error fetching session metrics:', sessionError);
        }

        const sessionRow = sessionMetricsRpc?.[0] || {};
        const sessionMetrics = {
            avgSessionMinutes: Number(sessionRow.avg_session_minutes) || 0,
            medianSessionMinutes: Number(sessionRow.median_session_minutes) || 0,
            maxSessionMinutes: Number(sessionRow.max_session_minutes) || 0,
            totalSessions: Number(sessionRow.total_sessions) || 0,
            avgSessionsPerUser: Number(sessionRow.avg_sessions_per_user) || 0,
            distribution: [
                { bucket: '0-5 min', count: Number(sessionRow.bucket_0_5) || 0 },
                { bucket: '5-15 min', count: Number(sessionRow.bucket_5_15) || 0 },
                { bucket: '15-30 min', count: Number(sessionRow.bucket_15_30) || 0 },
                { bucket: '30-60 min', count: Number(sessionRow.bucket_30_60) || 0 },
                { bucket: '60+ min', count: Number(sessionRow.bucket_60_plus) || 0 },
            ],
            dailyTrend: sessionRow.daily_data || [],
            topSessions: sessionRow.top_sessions || [],
        };

        console.log(`⏱️ Sessions: ${sessionMetrics.totalSessions} total, avg=${sessionMetrics.avgSessionMinutes}min, median=${sessionMetrics.medianSessionMinutes}min`);

        // ============================================
        // 8c. COHORT-BASED RETENTION (D1/D2/D7/D30)
        // ============================================
        // Uses riya_conversations to accurately check if a user was active
        // on the exact day N after signup (±1 day window).
        // This is the industry-standard Amplitude/Mixpanel-style cohort retention.
        console.log('🔄 Fetching cohort retention data...');
        const { data: cohortRetentionRpc, error: cohortError } = await supabase
            .rpc('get_instagram_cohort_retention');

        if (cohortError) {
            console.error('Error fetching cohort retention:', cohortError);
        }

        const cohortRow = cohortRetentionRpc?.[0] || {};
        const cohortRetention = cohortRow && Object.keys(cohortRow).length > 0 ? {
            d1Rate: (Number(cohortRow.d1_rate) || 0).toFixed(1),
            d1Eligible: Number(cohortRow.d1_eligible) || 0,
            d1Retained: Number(cohortRow.d1_retained) || 0,
            d2Rate: (Number(cohortRow.d2_rate) || 0).toFixed(1),
            d2Eligible: Number(cohortRow.d2_eligible) || 0,
            d2Retained: Number(cohortRow.d2_retained) || 0,
            d7Rate: (Number(cohortRow.d7_rate) || 0).toFixed(1),
            d7Eligible: Number(cohortRow.d7_eligible) || 0,
            d7Retained: Number(cohortRow.d7_retained) || 0,
            d30Rate: (Number(cohortRow.d30_rate) || 0).toFixed(1),
            d30Eligible: Number(cohortRow.d30_eligible) || 0,
            d30Retained: Number(cohortRow.d30_retained) || 0,
        } : null;
        console.log(`🔄 Cohort retention: D1=${cohortRow.d1_rate || 0}%, D2=${cohortRow.d2_rate || 0}%, D7=${cohortRow.d7_rate || 0}%, D30=${cohortRow.d30_rate || 0}%`);

        // ============================================
        // 8d. AGGREGATE / ROLLING METRICS (Avg DAU, MAU, Stickiness)
        // ============================================
        console.log('📈 Fetching aggregate metrics...');
        const { data: aggMetricsRpc, error: aggError } = await supabase
            .rpc('get_instagram_aggregate_metrics', { p_days: daysLookback });

        if (aggError) {
            console.error('Error fetching aggregate metrics:', aggError);
        }

        const aggRow = aggMetricsRpc?.[0] || {};
        const aggregateMetrics = aggRow && Object.keys(aggRow).length > 0 ? {
            period: 30,
            avgDau: Math.round(Number(aggRow.avg_dau) || 0),
            mau: Number(aggRow.mau) || igMau,
            dauMauRatio: Number(aggRow.avg_dau_mau_ratio) > 0
                ? Number(aggRow.avg_dau_mau_ratio).toFixed(1)
                : igMau > 0 ? ((igDau / igMau) * 100).toFixed(1) : '0',
            avgNewUsersPerDay: Math.round(Number(aggRow.avg_new_users_per_day) || 0),
            totalNewUsers: Number(aggRow.total_new_users_period) || 0,
            avgMsgsPerActiveDay: Math.round(Number(aggRow.avg_msgs_per_active_day) || 0),
            totalRevenueINR: ((Number(aggRow.total_revenue_period) || 0) / 100).toFixed(0),
            avgDailyRevenueINR: (Number(aggRow.avg_revenue_per_day) || 0) / 100,
            dailyBreakdown: (aggRow.daily_breakdown || []).map((d: any) => ({
                date: d.date,
                dau: Number(d.dau) || 0,
                messages: Number(d.messages) || 0,
                new_users: Number(d.new_users) || 0,
                revenue: ((Number(d.revenue) || 0) / 100),
            })),
        } : null;
        console.log(`📈 Aggregate: avgDAU=${aggregateMetrics?.avgDau}, MAU=${aggregateMetrics?.mau}, stickiness=${aggregateMetrics?.dauMauRatio}%`);

        // ============================================
        // 8b. PAYMENT FUNNEL METRICS
        // ============================================
        console.log('💰 Fetching payment funnel metrics...');

        // Use whichever date is later: the since filter or the default 30-day window
        const paymentSinceISO = sinceISO
            ? (new Date(sinceISO) > thirtyDaysAgoIg ? sinceISO : thirtyDaysAgoIg.toISOString())
            : thirtyDaysAgoIg.toISOString();
        const { data: paymentEvents, error: paymentError } = await supabase
            .from('riya_payment_events')
            .select('event_type, created_at')
            .gte('created_at', paymentSinceISO);

        if (paymentError) {
            console.error('Error fetching payment events:', paymentError);
        }

        const limitHits = paymentEvents?.filter((e: any) => e.event_type === 'limit_hit').length || 0;
        const linksSent = paymentEvents?.filter((e: any) => e.event_type === 'link_sent').length || 0;
        const pageVisits = paymentEvents?.filter((e: any) => e.event_type === 'page_visit').length || 0;
        const upgradeClicks = paymentEvents?.filter((e: any) => e.event_type === 'upgrade_click').length || 0;
        const paymentSuccesses = paymentEvents?.filter((e: any) => e.event_type === 'payment_success').length || 0;

        // How many IG users have 200+ lifetime messages
        const usersExhaustedFree = igUsers?.filter((u: any) => (u.message_count || 0) >= 200).length || 0;

        const visitRate = linksSent > 0 ? ((pageVisits / linksSent) * 100).toFixed(1) : '0';
        const clickRate = pageVisits > 0 ? ((upgradeClicks / pageVisits) * 100).toFixed(1) : '0';
        const paymentConvRate = upgradeClicks > 0 ? ((paymentSuccesses / upgradeClicks) * 100).toFixed(1) : '0';

        const paymentFunnel = {
            usersExhaustedFree,
            limitHits,
            linksSent,
            pageVisits,
            upgradeClicks,
            payments: paymentSuccesses,
            visitRate,
            clickRate,
            conversionRate: paymentConvRate,
        };

        console.log(`💰 Payment Funnel: ${usersExhaustedFree} exhausted → ${limitHits} hits → ${linksSent} sent → ${pageVisits} visits → ${upgradeClicks} clicks → ${paymentSuccesses} payments`);

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
            .rpc('get_instagram_daily_activity', { days_lookback: daysLookback });

        if (igDailyError) {
            console.error('Error fetching IG daily activity:', igDailyError);
        }

        const igDailyActivity = (igDailyActivityRpc || []).map((d: any) => ({
            date: d.activity_date,
            active_users: Number(d.active_users) || 0,
            messages: Number(d.message_count) || 0,
            approx_cost: parseFloat((Number(d.message_count) * 0.06).toFixed(2))
        }));

        // IG Revenue & MRR Logic
        // Calculate Daily Revenue from riya_subscriptions (Actual amount paid)
        const revenueByDate: Record<string, number> = {};
        const activeIgSubscriptions = subscriptions?.filter((s: any) =>
            s.instagram_user_id && s.status === 'active'
        ) || [];

        // Daily revenue aggregation
        subscriptions?.filter(s => s.instagram_user_id).forEach((s: any) => {
            if (s.starts_at) {
                const date = new Date(s.starts_at).toISOString().split('T')[0];
                revenueByDate[date] = (revenueByDate[date] || 0) + (s.amount_paid || 0);
            }
        });

        // MRR Calculation: Sum of actual amount_paid for active IG subscriptions
        const mrr = activeIgSubscriptions.reduce((sum, s) => sum + (s.amount_paid || 0), 0);

        // Merge Revenue into Daily Activity
        const igDailyActivityWithRevenue = igDailyActivity.map((day: any) => ({
            ...day,
            daily_revenue: revenueByDate[day.date] || 0
        }));

        // Add days that have revenue but no activity (edge case, but good to handle)
        Object.keys(revenueByDate).forEach(date => {
            if (!igDailyActivityWithRevenue.find((d: any) => d.date === date)) {
                igDailyActivityWithRevenue.push({
                    date,
                    active_users: 0,
                    messages: 0,
                    approx_cost: 0,
                    daily_revenue: revenueByDate[date]
                });
            }
        });

        igDailyActivityWithRevenue.sort((a: any, b: any) => b.date.localeCompare(a.date));

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
        // 9b. INSTAGRAM PAYMENT FUNNEL
        // ============================================
        const todayStartISO = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        const sevenDaysAgoISO = new Date(Date.now() - 7 * 86_400_000).toISOString();

        const { data: igPaymentEvents } = await supabase
            .from('riya_payment_events')
            .select('event_type, instagram_user_id, metadata, created_at')
            .not('instagram_user_id', 'is', null)
            .neq('instagram_user_id', 'anonymous');

        const { data: igPaymentVisitEvents7d } = await supabase
            .from('riya_payment_events')
            .select('instagram_user_id, created_at')
            .eq('event_type', 'page_visit')
            .gte('created_at', sevenDaysAgoISO)
            .not('instagram_user_id', 'is', null)
            .neq('instagram_user_id', 'anonymous');

        const igPageVisitsTotal = igPaymentEvents?.filter((e: any) => e.event_type === 'page_visit').length || 0;
        const igUpgradeClicksTotal = igPaymentEvents?.filter((e: any) => e.event_type === 'upgrade_click').length || 0;
        const igPaymentSuccessTotal = igPaymentEvents?.filter((e: any) => e.event_type === 'payment_success').length || 0;

        // Build map of ig users we already have loaded
        const igUserMap = new Map<string, { username: string; name: string }>(
            (igUsers || []).map((u: any) => [
                u.instagram_user_id,
                { username: u.instagram_username || '', name: u.instagram_name || 'Instagram User' }
            ])
        );

        // Today's unique visitors — all, not capped
        const igVisitorMapAll = new Map<string, { id: string; username: string; name: string; visitedAt: string }>();
        (igPaymentEvents || [])
            .filter((e: any) => e.event_type === 'page_visit')
            .sort((a: any, b: any) => b.created_at?.localeCompare(a.created_at))
            .forEach((e: any) => {
                const id = e.instagram_user_id;
                if (!id) return;
                if (!igVisitorMapAll.has(id)) {
                    const info = igUserMap.get(id) || { username: '', name: 'Instagram User' };
                    igVisitorMapAll.set(id, { id, username: info.username, name: info.name, visitedAt: e.created_at });
                }
            });

        // Today-only slice
        const igVisitorsToday = [...igVisitorMapAll.values()].filter(v => v.visitedAt >= todayStartISO);

        const igVisitorMap7d = new Map<string, { id: string; username: string; name: string; visitedAt: string; visits: number }>();
        (igPaymentVisitEvents7d || [])
            .sort((a: any, b: any) => b.created_at?.localeCompare(a.created_at))
            .forEach((e: any) => {
                const id = e.instagram_user_id;
                if (!id) return;
                const existing = igVisitorMap7d.get(id);
                if (existing) {
                    existing.visits += 1;
                    return;
                }
                const info = igUserMap.get(id) || { username: '', name: 'Instagram User' };
                igVisitorMap7d.set(id, { id, username: info.username, name: info.name, visitedAt: e.created_at, visits: 1 });
            });
        const igVisitorsLast7Days = [...igVisitorMap7d.values()];

        const igPaymentFunnel = {
            pageVisits: igPageVisitsTotal,
            uniqueVisitors: igVisitorMapAll.size,
            upgradeClicks: igUpgradeClicksTotal,
            payments: igPaymentSuccessTotal,
            clickRate: igPageVisitsTotal > 0 ? ((igUpgradeClicksTotal / igPageVisitsTotal) * 100).toFixed(1) : '0',
            conversionRate: igUpgradeClicksTotal > 0 ? ((igPaymentSuccessTotal / igUpgradeClicksTotal) * 100).toFixed(1) : '0',
            visitorsToday: igVisitorsToday,
            visitorsLast7Days: igVisitorsLast7Days,
        };

        console.log(`📸 IG Payment Funnel: ${igPageVisitsTotal} visits, ${igVisitorMapAll.size} unique, ${igVisitorsToday.length} today`);

        // ============================================
        // 11. TELEGRAM METRICS
        // ============================================
        console.log('📱 Fetching Telegram metrics...');

        let tgUsersQuery = supabase
            .from('telegram_users')
            .select('id, telegram_user_id, telegram_username, first_name, message_count, message_credits, total_credits_purchased, last_message_at, created_at, chat_streak_days');
        if (sinceISO) tgUsersQuery = tgUsersQuery.gte('created_at', sinceISO);
        const { data: tgUsers } = await tgUsersQuery;

        const totalTgUsers = tgUsers?.length || 0;

        const oneDayAgoTg = new Date();
        oneDayAgoTg.setDate(oneDayAgoTg.getDate() - 1);
        const tgDau = tgUsers?.filter((u: any) => {
            if (!u.last_message_at) return false;
            return new Date(u.last_message_at) >= oneDayAgoTg;
        }).length || 0;

        const thirtyDaysAgoTg = new Date();
        thirtyDaysAgoTg.setDate(thirtyDaysAgoTg.getDate() - 30);
        const tgMau = tgUsers?.filter((u: any) => {
            if (!u.last_message_at) return false;
            return new Date(u.last_message_at) >= thirtyDaysAgoTg;
        }).length || 0;

        const tgDauMauRatio = tgMau > 0 ? ((tgDau / tgMau) * 100).toFixed(1) : '0';

        // Total messages from riya_conversations (source of truth — avoids drift in message_count counter)
        const { count: tgConvCount } = await supabase
            .from('riya_conversations')
            .select('*', { count: 'exact', head: true })
            .eq('source', 'telegram')
            .eq('role', 'user');
        const totalTgMessages = tgConvCount || 0;
        const avgTgMsgsPerUser = totalTgUsers > 0 ? (totalTgMessages / totalTgUsers).toFixed(2) : '0';
        const tgApproxCostINR = (totalTgMessages * 0.08).toFixed(2);

        // Tiers: trial (<50 msgs), paid (credits > 0), free (post-trial, no credits)
        const TG_TRIAL_LIMIT = 50;
        const tgInTrial = tgUsers?.filter((u: any) => (u.message_count || 0) < TG_TRIAL_LIMIT).length || 0;
        const tgPaidUsers = tgUsers?.filter((u: any) => (u.message_credits || 0) > 0).length || 0;
        const tgFreeUsers = totalTgUsers - tgInTrial - tgPaidUsers;

        // User classification tiers
        const tgTiers = { '0-10': 0, '11-50': 0, '51-100': 0, '101-200': 0, '201-500': 0, '500+': 0 };
        tgUsers?.forEach((u: any) => {
            const count = u.message_count || 0;
            if (count <= 10) tgTiers['0-10']++;
            else if (count <= 50) tgTiers['11-50']++;
            else if (count <= 100) tgTiers['51-100']++;
            else if (count <= 200) tgTiers['101-200']++;
            else if (count <= 500) tgTiers['201-500']++;
            else tgTiers['500+']++;
        });

        // Retention (D1, D3, D7, D30) based on last_message_at vs created_at
        const calculateTgRetention = (days: number) => {
            const eligible = tgUsers?.filter((u: any) => {
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
        const tgD1 = calculateTgRetention(1);
        const tgD3 = calculateTgRetention(3);
        const tgD7 = calculateTgRetention(7);
        const tgD30 = calculateTgRetention(30);

        // New users per day
        const tgNewUsersPerDay: Record<string, number> = {};
        tgUsers?.forEach((u: any) => {
            const date = new Date(u.created_at).toISOString().split('T')[0];
            tgNewUsersPerDay[date] = (tgNewUsersPerDay[date] || 0) + 1;
        });
        const tgNewUsersTrend = Object.entries(tgNewUsersPerDay)
            .map(([date, count]) => ({ date, new_users: count }))
            .sort((a, b) => b.date.localeCompare(a.date));

        // MRR from riya_payments (Telegram)
        const { data: tgPayments } = await supabase
            .from('riya_payments')
            .select('amount, status, created_at, telegram_user_id')
            .not('telegram_user_id', 'is', null)
            .eq('status', 'captured');

        const tgMrr = tgPayments?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0;

        // Revenue by date
        const tgRevenueByDate: Record<string, number> = {};
        tgPayments?.forEach((p: any) => {
            if (p.created_at) {
                const date = new Date(p.created_at).toISOString().split('T')[0];
                tgRevenueByDate[date] = (tgRevenueByDate[date] || 0) + (p.amount || 0);
            }
        });

        // Pro users list (paid users with credits)
        const tgProUsers = tgUsers?.filter((u: any) => (u.message_credits || 0) > 0)
            .map((u: any) => ({
                name: u.first_name || 'Telegram User',
                username: u.telegram_username || u.telegram_user_id,
                messageCount: u.message_count || 0,
                credits: u.message_credits || 0,
            }))
            .sort((a: any, b: any) => b.messageCount - a.messageCount) || [];

        // Daily activity via RPC
        const { data: tgDailyActivityRpc, error: tgDailyError } = await supabase
            .rpc('get_telegram_daily_activity', { days_lookback: daysLookback });
        if (tgDailyError) console.error('Error fetching TG daily activity:', tgDailyError);

        const tgDailyActivity = (tgDailyActivityRpc || []).map((d: any) => ({
            date: d.activity_date,
            active_users: Number(d.active_users) || 0,
            messages: Number(d.message_count) || 0,
            approx_cost: parseFloat((Number(d.message_count) * 0.08).toFixed(2)),
            daily_revenue: tgRevenueByDate[d.activity_date] || 0,
        }));

        // Aggregate metrics via RPC
        const { data: tgAggRpc, error: tgAggError } = await supabase
            .rpc('get_telegram_aggregate_metrics', { p_days: daysLookback });
        if (tgAggError) console.error('Error fetching TG aggregate metrics:', tgAggError);

        const tgAggRow = tgAggRpc?.[0] || {};
        const tgAggregateMetrics = tgAggRow && Object.keys(tgAggRow).length > 0 ? {
            period: daysLookback,
            avgDau: Math.round(Number(tgAggRow.avg_dau) || 0),
            mau: Number(tgAggRow.mau) || tgMau,
            dauMauRatio: Number(tgAggRow.avg_dau_mau_ratio) > 0
                ? Number(tgAggRow.avg_dau_mau_ratio).toFixed(1)
                : tgMau > 0 ? ((tgDau / tgMau) * 100).toFixed(1) : '0',
            avgNewUsersPerDay: Math.round(Number(tgAggRow.avg_new_users_per_day) || 0),
            totalNewUsers: Number(tgAggRow.total_new_users_period) || 0,
            avgMsgsPerActiveDay: Math.round(Number(tgAggRow.avg_msgs_per_active_day) || 0),
            totalRevenueINR: Math.round((Number(tgAggRow.total_revenue_period) || 0) / 100).toString(),
            avgDailyRevenueINR: (Number(tgAggRow.avg_revenue_per_day) || 0) / 100,
            dailyBreakdown: (tgAggRow.daily_breakdown || []).map((d: any) => ({
                date: d.date,
                dau: Number(d.dau) || 0,
                messages: Number(d.messages) || 0,
                new_users: Number(d.new_users) || 0,
                revenue: (Number(d.revenue) || 0) / 100,
            })),
        } : null;

        // TG Session Metrics via RPC
        console.log('⏱️ Fetching TG session metrics...');
        const { data: tgSessionRpc, error: tgSessionError } = await supabase
            .rpc('get_telegram_session_metrics', { days_lookback: daysLookback });
        if (tgSessionError) console.error('Error fetching TG session metrics:', tgSessionError);

        const tgSessionRow = tgSessionRpc?.[0] || {};
        const tgSessionMetrics = {
            avgSessionMinutes: Number(tgSessionRow.avg_session_minutes) || 0,
            medianSessionMinutes: Number(tgSessionRow.median_session_minutes) || 0,
            maxSessionMinutes: Number(tgSessionRow.max_session_minutes) || 0,
            totalSessions: Number(tgSessionRow.total_sessions) || 0,
            avgSessionsPerUser: Number(tgSessionRow.avg_sessions_per_user) || 0,
            distribution: [
                { bucket: '0-5 min',  count: Number(tgSessionRow.bucket_0_5) || 0 },
                { bucket: '5-15 min', count: Number(tgSessionRow.bucket_5_15) || 0 },
                { bucket: '15-30 min',count: Number(tgSessionRow.bucket_15_30) || 0 },
                { bucket: '30-60 min',count: Number(tgSessionRow.bucket_30_60) || 0 },
                { bucket: '60+ min',  count: Number(tgSessionRow.bucket_60_plus) || 0 },
            ],
            dailyTrend: tgSessionRow.daily_data || [],
            topSessions: tgSessionRow.top_sessions || [],
        };
        console.log(`⏱️ TG Sessions: ${tgSessionMetrics.totalSessions} total, avg=${tgSessionMetrics.avgSessionMinutes}min`);

        // Payment funnel for Telegram (from riya_payment_events.metadata.telegram_user_id)
        const tgPaymentSinceISO = sinceISO
            ? (new Date(sinceISO) > thirtyDaysAgoTg ? sinceISO : thirtyDaysAgoTg.toISOString())
            : thirtyDaysAgoTg.toISOString();
        const { data: tgPaymentEvents } = await supabase
            .from('riya_payment_events')
            .select('event_type, metadata, created_at')
            .gte('created_at', tgPaymentSinceISO)
            .or('metadata->>platform.eq.telegram,metadata->>telegram_user_id.neq.');

        const { data: tgPayButtonEvents7d } = await supabase
            .from('riya_payment_events')
            .select('metadata, created_at')
            .eq('event_type', 'upgrade_click')
            .gte('created_at', sevenDaysAgoISO)
            .or('metadata->>platform.eq.telegram,metadata->>telegram_user_id.neq.');

        // For Telegram, "page visits" is a bad proxy (many users never open the web page).
        // Use paywall-shown events logged by telegram-webhook as the top-of-funnel metric.
        const tgPaywallShown = tgPaymentEvents?.filter((e: any) =>
            e.event_type === 'link_sent' &&
            (e.metadata?.platform === 'telegram' || e.metadata?.telegram_user_id)
        ).length || 0;
        const tgUpgradeClicks = tgPaymentEvents?.filter((e: any) =>
            e.event_type === 'upgrade_click' &&
            (e.metadata?.platform === 'telegram' || e.metadata?.telegram_user_id)
        ).length || 0;
        const tgPaymentSuccesses = tgPaymentEvents?.filter((e: any) =>
            e.event_type === 'payment_success' &&
            (e.metadata?.platform === 'telegram' || e.metadata?.telegram_user_id)
        ).length || 0;

        // Unique Telegram users who visited the payment page (last 30 days)
        // Build a map of telegram_user_id -> { username, name } from already-fetched tgUsers
        const tgUserMap = new Map<string, { username: string; name: string }>(
            (tgUsers || []).map((u: any) => [
                u.telegram_user_id,
                { username: u.telegram_username || '', name: u.first_name || 'Telegram User' }
            ])
        );

        // Deduplicate "pay button pressers", preserving most-recent first (events are unsorted)
        const tgVisitorMap = new Map<string, { id: string; username: string; name: string; visitedAt: string }>();
        (tgPaymentEvents || [])
            .filter((e: any) =>
                e.event_type === 'upgrade_click' &&
                (e.metadata?.platform === 'telegram' || e.metadata?.telegram_user_id)
            )
            .sort((a: any, b: any) => b.created_at?.localeCompare(a.created_at))
            .forEach((e: any) => {
                const id = e.metadata?.telegram_user_id;
                if (!id) return;
                if (!tgVisitorMap.has(id)) {
                    const info = tgUserMap.get(id) || { username: '', name: 'Telegram User' };
                    const username = e.metadata?.username || info.username || '';
                    const name = e.metadata?.name || info.name || 'Telegram User';
                    tgVisitorMap.set(id, { id, username, name, visitedAt: e.created_at });
                }
            });

        // Today-only unique visitors (all, not capped)
        const tgVisitorsToday = [...tgVisitorMap.values()].filter(v => v.visitedAt >= todayStartISO);
        const tgRecentVisitors = [...tgVisitorMap.values()]; // all unique, sorted newest first

        const tgVisitorMap7d = new Map<string, { id: string; username: string; name: string; visitedAt: string; visits: number }>();
        (tgPayButtonEvents7d || [])
            .filter((e: any) => e.metadata?.platform === 'telegram' || e.metadata?.telegram_user_id)
            .sort((a: any, b: any) => b.created_at?.localeCompare(a.created_at))
            .forEach((e: any) => {
                const id = e.metadata?.telegram_user_id;
                if (!id) return;
                const existing = tgVisitorMap7d.get(id);
                if (existing) {
                    existing.visits += 1;
                    return;
                }
                const info = tgUserMap.get(id) || { username: '', name: 'Telegram User' };
                const username = e.metadata?.username || info.username || '';
                const name = e.metadata?.name || info.name || 'Telegram User';
                tgVisitorMap7d.set(id, { id, username, name, visitedAt: e.created_at, visits: 1 });
            });
        const tgVisitorsLast7Days = [...tgVisitorMap7d.values()];

        const tgPaymentFunnel = {
            pageVisits: tgPaywallShown,
            uniqueVisitors: tgVisitorMap.size,
            upgradeClicks: tgUpgradeClicks,
            payments: tgPaymentSuccesses,
            clickRate: tgPaywallShown > 0 ? ((tgUpgradeClicks / tgPaywallShown) * 100).toFixed(1) : '0',
            conversionRate: tgUpgradeClicks > 0 ? ((tgPaymentSuccesses / tgUpgradeClicks) * 100).toFixed(1) : '0',
            recentVisitors: tgRecentVisitors,
            visitorsToday: tgVisitorsToday,
            visitorsLast7Days: tgVisitorsLast7Days,
        };

        console.log(`📱 TG: ${totalTgUsers} users, ${tgDau} DAU, ${totalTgMessages} msgs, cost≈₹${tgApproxCostINR}, paywallShown=${tgPaywallShown}`);

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
            sinceFilter: sinceParam ?? null, // echoed back so UI can display it
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
                d2: d2Retention,
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
                // Approximate retention (based on last_message_at — only shows latest activity)
                retention: {
                    d1: igD1,
                    d2: igD2,
                    d3: igD3,
                    d7: igD7,
                    d30: igD30
                },
                // Cohort retention (industry-standard: checks if user was active on exact day N)
                cohortRetention,
                // Rolling aggregate metrics
                aggregateMetrics,
                newUsersTrend: igNewUsersTrend,
                dailyActivity: igDailyActivityWithRevenue,
                proUsers: proUsers,
                mrr: mrr.toFixed(2),
                sessionMetrics: sessionMetrics,
                paymentFunnel: paymentFunnel,
                igPaymentFunnel: igPaymentFunnel,
            },
            telegramMetrics: {
                total: totalTgUsers,
                dau: tgDau,
                mau: tgMau,
                dauMauRatio: tgDauMauRatio,
                totalMessages: totalTgMessages,
                avgMsgsPerUser: avgTgMsgsPerUser,
                inTrial: tgInTrial,
                paidUsers: tgPaidUsers,
                freeUsers: tgFreeUsers,
                approxCostINR: tgApproxCostINR,
                mrr: tgMrr.toFixed(2),
                classification: [
                    { tier: '0-10 msgs', count: tgTiers['0-10'] },
                    { tier: '11-50 msgs', count: tgTiers['11-50'] },
                    { tier: '51-100 msgs', count: tgTiers['51-100'] },
                    { tier: '101-200 msgs', count: tgTiers['101-200'] },
                    { tier: '201-500 msgs', count: tgTiers['201-500'] },
                    { tier: '500+ msgs', count: tgTiers['500+'] },
                ],
                retention: { d1: tgD1, d3: tgD3, d7: tgD7, d30: tgD30 },
                newUsersTrend: tgNewUsersTrend,
                dailyActivity: tgDailyActivity,
                proUsers: tgProUsers,
                aggregateMetrics: tgAggregateMetrics,
                sessionMetrics: tgSessionMetrics,
                paymentFunnel: tgPaymentFunnel,
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

interface BillingData {
    monthlyBill: number;
    monthlyBillINR: number;
    currency: string;
    period: string;
    lastUpdated: string;
}

async function fetchGoogleCloudBilling(): Promise<BillingData | null> {
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
        const uniqueSessions = new Set(events.map((e: any) => e.session_id));
        const totalVisitors = uniqueSessions.size;
        const totalPageViews = events.length;

        // 2. BOUNCE RATE (sessions with only 1 page view)
        const sessionCounts = new Map<string, number>();
        events.forEach((e: any) => {
            sessionCounts.set(e.session_id, (sessionCounts.get(e.session_id) || 0) + 1);
        });

        const bouncedSessions = Array.from(sessionCounts.values()).filter(count => count === 1).length;
        const bounceRate = totalVisitors > 0 ? Math.round((bouncedSessions / totalVisitors) * 100) : 0;

        // 3. TOP PAGES (by unique visitor count)
        const pageVisitors = new Map<string, Set<string>>();
        events.forEach((e: any) => {
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
        events.forEach((e: any) => {
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
        events.forEach((e: any) => {
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

        events.forEach((e: any) => {
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
