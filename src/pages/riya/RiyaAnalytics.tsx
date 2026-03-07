import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Users, MessageSquare, TrendingUp, Lock, DollarSign, Activity, RefreshCw, Instagram, Target, Crown, Clock, AlertCircle, Terminal, Search, Filter, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { createClient } from '@supabase/supabase-js';

interface AnalyticsData {
    userMetrics: {
        total: number;
        active: number;
        dau: number;
        classification: Array<{ tier: string; count: number }>;
    };
    dailyActivity: Array<{
        date: string;
        active_users: number;
        user_messages: number;
        guest_sessions: number;
    }>;
    engagement: {
        avgMessagesPerUser: string;
        totalMessages: number;
        totalSessions: number;
    };
    costs: {
        calculatedCostINR: string;
        costPerUser: string;
        totalTokens: number;
        actualCostUSD: number | null;
        actualCostINR: string | null;
        actualCurrency: string | null;
        billingPeriod: string | null;
        dataSource: 'google_cloud' | 'calculated';
        lastUpdated: string;
    };
    revenue: {
        payingUsers: number;
        freeUsers: number;
        conversionRate: string;
        arpu: string;
        churnRate: string;
        totalRevenue: string;
    };
    retention: {
        d1: string;
        d2?: string;
        d7: string;
        d30: string;
    };
    cohortRetention?: {
        d1Rate: string; d1Eligible: number; d1Retained: number;
        d2Rate: string; d2Eligible: number; d2Retained: number;
        d7Rate: string; d7Eligible: number; d7Retained: number;
        d30Rate: string; d30Eligible: number; d30Retained: number;
    };
    aggregateMetrics?: {
        period: number;
        avgDau: number;
        mau: number;
        dauMauRatio: string;
        avgNewUsersPerDay: number;
        totalNewUsers: number;
        avgMsgsPerActiveDay: number;
        totalRevenueINR: number;
        avgDailyRevenueINR: number;
        sameDayLastWeekDau?: number;
        sevenDayAvgDau?: number;
        dailyBreakdown: Array<{ date: string; dau: number; messages: number; new_users: number; revenue: number }>;
    };
    instagramMetrics: {
        total: number;

        dau: number;
        mau: number;
        dauMauRatio: string;
        totalMessages: number;
        avgMsgsPerUser: string;
        inTrial: number;
        trialExpired: number;
        approxCostINR: string;
        classification: Array<{ tier: string; count: number }>;
        retention: { d1: string; d3: string; d7: string; d30: string };
        newUsersTrend: Array<{ date: string; new_users: number }>;
        dailyActivity: Array<{ date: string; active_users: number; messages: number; approx_cost: number; daily_revenue: number }>;
        proUsers: Array<{ username: string; name: string; messageCount: number; expiry: string }>;
        mrr: string;
        sessionMetrics?: {
            avgSessionMinutes: number;
            medianSessionMinutes: number;
            totalSessions: number;
            avgSessionsPerUser: number;
            distribution: Array<{ bucket: string; count: number }>;
            dailyTrend: Array<{ date: string; avg_session_minutes: number; sessions: number }>;
        };
        paymentFunnel?: {
            usersExhaustedFree: number;
            limitHits: number;
            linksSent: number;
            pageVisits: number;
            upgradeClicks: number;
            payments: number;
            visitRate: string;
            clickRate: string;
            conversionRate: string;
        };
    } | null;
    pmfScore: {
        totalAllUsers: number;
        totalAllDau: number;
        dauPercentage: string;
        combinedD7Retention: string;
        verdict: 'pre-pmf' | 'approaching' | 'pmf';
    } | null;
    vercelAnalytics: {
        visitors: number;
        pageViews: number;
        bounceRate: number;
        topPages: Array<{ path: string; visitors: number }>;
        referrers: Array<{ source: string; visitors: number }>;
        countries: Array<{ country: string; percentage: number }>;
        devices: Array<{ device: string; percentage: number }>;
        note: string;
    } | null;
}

// Lazy initialization singleton to avoid multiple instances and render crashes
let supabaseClient: any = null;

const getSupabase = () => {
    if (supabaseClient) return supabaseClient;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error('Supabase keys are missing!');
        return null;
    }

    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    return supabaseClient;
};

const RiyaAnalytics = () => {
    const navigate = useNavigate();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [pin, setPin] = useState('');
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [activeUsersInterval, setActiveUsersInterval] = useState('7 days');
    const [analyticsView, setAnalyticsView] = useState<'combined' | 'web' | 'instagram' | 'logs'>('instagram');

    // Log viewer state
    const [logs, setLogs] = useState<any[]>([]);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);
    const [logFilter, setLogFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
    const [logSearch, setLogSearch] = useState('');
    const [logDateFrom, setLogDateFrom] = useState(() => {
        const d = new Date();
        d.setHours(d.getHours() - 3);
        return d.toISOString().slice(0, 16); // datetime-local format
    });
    const [logDateTo, setLogDateTo] = useState(() => new Date().toISOString().slice(0, 16));
    const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
    const [logFunction, setLogFunction] = useState<'instagram-webhook' | 'riya-chat' | 'riya-analytics'>('instagram-webhook');

    // -------------------------------------------------------
    // LOG FETCHER — queries riya_conversations for error analysis
    // since Supabase Management API requires mgmt token.
    // We pull recent conversations with model_used='silent' or
    // look for users who got no response (dropped messages).
    // -------------------------------------------------------
    const fetchLogs = async () => {
        setIsLoadingLogs(true);
        setLogs([]);
        try {
            const supabase = getSupabase();
            if (!supabase) { alert('Supabase config missing'); return; }

            const fromTs = new Date(logDateFrom).toISOString();
            const toTs = new Date(logDateTo).toISOString();

            // Query: find user messages with NO assistant reply within 90 seconds
            // These are the "dropped" / failed requests
            let query = supabase
                .from('riya_conversations')
                .select('id, instagram_user_id, role, content, model_used, created_at')
                .eq('source', 'instagram')
                .gte('created_at', fromTs)
                .lte('created_at', toTs)
                .order('created_at', { ascending: false })
                .limit(500);

            if (logFilter === 'error') {
                // model_used = 'silent' means dropped/blocked, or look for no follow-up
                query = query.in('model_used', ['silent', 'manual']);
            }

            const { data, error } = await query;
            if (error) throw error;

            // Group into pseudo-log lines with severity
            const enriched = (data || []).map((row: any) => {
                let level: 'info' | 'warn' | 'error' = 'info';
                let summary = '';

                if (row.model_used === 'silent') { level = 'warn'; summary = '🔇 Message during silent treatment (no reply sent)'; }
                else if (row.role === 'user') { level = 'info'; summary = `📨 User message`; }
                else if (row.role === 'assistant') { level = 'info'; summary = `🤖 AI reply via ${row.model_used}`; }

                return { ...row, level, summary };
            });

            // Client-side search filter
            const search = logSearch.toLowerCase();
            const filtered = enriched.filter((l: any) => {
                const matchLevel = logFilter === 'all' || l.level === logFilter;
                const matchSearch = !search || l.content?.toLowerCase().includes(search)
                    || l.instagram_user_id?.includes(search)
                    || l.summary?.toLowerCase().includes(search);
                return matchLevel && matchSearch;
            });

            // Also fetch failed exchanges: user msgs with no assistant reply within 2 min
            if (logFilter === 'error' || logFilter === 'all') {
                const { data: userMsgs } = await supabase
                    .from('riya_conversations')
                    .select('id, instagram_user_id, content, created_at')
                    .eq('source', 'instagram')
                    .eq('role', 'user')
                    .gte('created_at', fromTs)
                    .lte('created_at', toTs)
                    .order('created_at', { ascending: false })
                    .limit(200);

                // For each user msg, check if there's an assistant reply within 2 min
                const allMsgs = data || [];
                const failedExchanges = (userMsgs || []).filter((umsg: any) => {
                    const cutoff = new Date(new Date(umsg.created_at).getTime() + 120_000).toISOString();
                    return !allMsgs.some((m: any) =>
                        m.role === 'assistant'
                        && m.instagram_user_id === umsg.instagram_user_id
                        && m.created_at > umsg.created_at
                        && m.created_at <= cutoff
                    );
                }).map((umsg: any) => ({
                    ...umsg,
                    role: 'user',
                    model_used: null,
                    level: 'error' as const,
                    summary: '❌ No AI reply within 2 min — possible crash/drop',
                }));

                filtered.unshift(...failedExchanges);
                filtered.sort((a: any, b: any) => b.created_at.localeCompare(a.created_at));
            }

            setLogs(filtered);
        } catch (err: any) {
            console.error('Log fetch error:', err);
            alert('Failed to fetch logs: ' + err.message);
        } finally {
            setIsLoadingLogs(false);
        }
    };

    // Drill-down state
    const [selectedTier, setSelectedTier] = useState<string | null>(null);
    const [tierUsers, setTierUsers] = useState<Array<{ instagram_username: string; instagram_name: string; message_count: number }>>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const handleTierClick = async (tier: string) => {
        setSelectedTier(tier);
        setIsLoadingUsers(true);
        setIsDialogOpen(true);
        setTierUsers([]);

        try {
            let min = 0;
            let max = 1000000;

            if (tier.includes('+')) {
                min = parseInt(tier.replace(/\D/g, ''));
            } else {
                const parts = tier.split('-');
                if (parts.length === 2) {
                    min = parseInt(parts[0].replace(/\D/g, ''));
                    max = parseInt(parts[1].replace(/\D/g, ''));
                }
            }

            console.log(`Fetching users for tier: ${tier} (Min: ${min}, Max: ${max})`);

            const supabase = getSupabase();
            if (!supabase) {
                alert('Supabase configuration missing');
                return;
            }

            const { data, error } = await supabase
                .from('riya_instagram_users')
                .select('instagram_username, instagram_name, message_count')
                .gte('message_count', min)
                .lte('message_count', max)
                .order('message_count', { ascending: false })
                .limit(100);

            if (error) throw error;
            setTierUsers(data || []);
        } catch (error) {
            console.error('Error fetching tier users:', error);
        } finally {
            setIsLoadingUsers(false);
        }
    };

    const handlePinSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (pin === '235876') {
            setIsAuthenticated(true);
            loadAnalytics();
        } else {
            alert('Invalid PIN');
        }
    };

    const loadAnalytics = async () => {
        setIsLoading(true);
        try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

            const response = await fetch(
                `${supabaseUrl}/functions/v1/riya-analytics?interval=${encodeURIComponent(activeUsersInterval)}`,
                {
                    headers: {
                        'apikey': supabaseAnonKey,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.ok) {
                throw new Error('Failed to fetch analytics');
            }

            const data = await response.json();
            console.log('📊 Analytics Data Received:', data);
            console.log('💰 Costs Object:', data.costs);
            console.log('  - calculatedCostINR:', data.costs?.calculatedCostINR);
            console.log('  - actualCostINR:', data.costs?.actualCostINR);
            console.log('  - dataSource:', data.costs?.dataSource);
            setAnalytics(data);
        } catch (error) {
            console.error('Error loading analytics:', error);
            alert('Failed to load analytics data');
        } finally {
            setIsLoading(false);
        }
    };

    // Reload when interval changes
    useEffect(() => {
        if (isAuthenticated) {
            loadAnalytics();
        }
    }, [activeUsersInterval]);

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center px-6">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="glass-card p-8 max-w-sm w-full text-center"
                >
                    <Lock className="w-12 h-12 text-primary mx-auto mb-4" />
                    <h1 className="font-display text-2xl font-bold text-foreground mb-6">
                        Analytics
                    </h1>

                    <form onSubmit={handlePinSubmit} className="space-y-4">
                        <Input
                            type="password"
                            placeholder="Enter PIN"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            className="text-center text-xl tracking-widest"
                            maxLength={6}
                        />
                        <Button type="submit" variant="neon" className="w-full">
                            Unlock
                        </Button>
                    </form>

                    <Button
                        variant="ghost"
                        className="mt-4 text-muted-foreground"
                        onClick={() => navigate('/riya')}
                    >
                        Back to Home
                    </Button>
                </motion.div>
            </div>
        );
    }

    if (!analytics) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="text-center">
                    <RefreshCw className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
                    <p className="text-muted-foreground">Loading analytics...</p>
                </div>
            </div>
        );
    }

    const retentionData = [
        { period: 'Day 1', percentage: parseFloat(analytics.retention.d1) },
        { period: 'Day 7', percentage: parseFloat(analytics.retention.d7) },
        { period: 'Day 30', percentage: parseFloat(analytics.retention.d30) },
    ];

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="max-w-7xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8 flex justify-between items-center"
                >
                    <div>
                        <h1 className="font-display text-3xl font-bold neon-text">
                            Analytics Dashboard
                        </h1>
                        <p className="text-muted-foreground">Real-time insights and metrics</p>
                    </div>
                    <Button
                        onClick={loadAnalytics}
                        disabled={isLoading}
                        variant="neon"
                        size="sm"
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </motion.div>

                {/* View Toggle */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.02 }}
                    className="flex gap-2 mb-6"
                >
                    {(['combined', 'web', 'instagram', 'logs'] as const).map((view) => (
                        <button
                            key={view}
                            onClick={() => setAnalyticsView(view)}
                            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${analyticsView === view
                                ? view === 'instagram'
                                    ? 'bg-pink-500/20 text-pink-400 ring-1 ring-pink-500/40'
                                    : 'bg-primary/20 text-primary ring-1 ring-primary/40'
                                : 'bg-muted/10 text-muted-foreground hover:bg-muted/20'
                                }`}
                        >
                            {view === 'combined' ? '📊 Combined' : view === 'web' ? '🌐 Web' : view === 'instagram' ? '📸 Instagram' : '🔍 Logs'}
                        </button>
                    ))}
                </motion.div>

                {/* ===== LOG VIEWER PANEL ===== */}
                {analyticsView === 'logs' && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="glass-card p-6 mb-6"
                    >
                        <div className="flex items-center gap-2 mb-5">
                            <Terminal className="w-5 h-5 text-amber-400" />
                            <h2 className="font-display text-xl font-semibold text-foreground">Log Viewer</h2>
                            <span className="ml-auto text-xs text-muted-foreground">
                                {logs.length} entries
                            </span>
                        </div>

                        {/* Filters */}
                        <div className="flex flex-wrap gap-3 mb-4">
                            {/* Date From */}
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">From</label>
                                <input
                                    type="datetime-local"
                                    value={logDateFrom}
                                    onChange={e => setLogDateFrom(e.target.value)}
                                    className="text-sm bg-muted/20 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            {/* Date To */}
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">To</label>
                                <input
                                    type="datetime-local"
                                    value={logDateTo}
                                    onChange={e => setLogDateTo(e.target.value)}
                                    className="text-sm bg-muted/20 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            {/* Level Filter */}
                            <div className="flex flex-col gap-1">
                                <label className="text-xs text-muted-foreground">Status</label>
                                <select
                                    value={logFilter}
                                    onChange={e => setLogFilter(e.target.value as any)}
                                    className="text-sm bg-muted/20 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="all">All Messages</option>
                                    <option value="error">❌ Errors Only (no AI reply)</option>
                                    <option value="warn">⚠️ Silent Treatment</option>
                                    <option value="info">ℹ️ Info Only</option>
                                </select>
                            </div>
                            {/* Search */}
                            <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                                <label className="text-xs text-muted-foreground">Search</label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                    <input
                                        type="text"
                                        placeholder="User ID, content..."
                                        value={logSearch}
                                        onChange={e => setLogSearch(e.target.value)}
                                        className="w-full text-sm bg-muted/20 border border-border rounded-lg pl-8 pr-3 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            </div>
                            {/* Fetch Button */}
                            <div className="flex flex-col justify-end">
                                <button
                                    onClick={fetchLogs}
                                    disabled={isLoadingLogs}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors text-sm font-semibold disabled:opacity-50"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
                                    Fetch Logs
                                </button>
                            </div>
                        </div>

                        {/* Legend */}
                        <div className="flex gap-4 mb-4 text-xs">
                            <span className="flex items-center gap-1.5 text-red-400"><span className="w-2 h-2 rounded-full bg-red-400"></span>Error (no AI reply)</span>
                            <span className="flex items-center gap-1.5 text-yellow-400"><span className="w-2 h-2 rounded-full bg-yellow-400"></span>Silent treatment</span>
                            <span className="flex items-center gap-1.5 text-blue-400"><span className="w-2 h-2 rounded-full bg-blue-400"></span>Info</span>
                        </div>

                        {/* Log Table */}
                        {isLoadingLogs ? (
                            <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
                                <RefreshCw className="w-5 h-5 animate-spin" />
                                Fetching logs...
                            </div>
                        ) : logs.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <Filter className="w-8 h-8 mx-auto mb-3 opacity-40" />
                                <p>No logs fetched yet — click "Fetch Logs" to load</p>
                            </div>
                        ) : (
                            <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
                                {logs.map((log, idx) => {
                                    const isExpanded = expandedLogs.has(idx);
                                    const levelColor = log.level === 'error'
                                        ? 'border-l-red-500 bg-red-500/5 hover:bg-red-500/10'
                                        : log.level === 'warn'
                                            ? 'border-l-yellow-500 bg-yellow-500/5 hover:bg-yellow-500/10'
                                            : 'border-l-blue-500/40 bg-muted/5 hover:bg-muted/10';
                                    const dotColor = log.level === 'error' ? 'bg-red-400' : log.level === 'warn' ? 'bg-yellow-400' : 'bg-blue-400';
                                    const ts = new Date(log.created_at).toLocaleTimeString('en-IN', {
                                        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata'
                                    });
                                    const dateStr = new Date(log.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });

                                    return (
                                        <div
                                            key={idx}
                                            className={`border-l-2 rounded-r-lg px-3 py-2 cursor-pointer transition-colors ${levelColor}`}
                                            onClick={() => {
                                                const next = new Set(expandedLogs);
                                                isExpanded ? next.delete(idx) : next.add(idx);
                                                setExpandedLogs(next);
                                            }}
                                        >
                                            <div className="flex items-start gap-2">
                                                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`}></span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-xs text-muted-foreground font-mono">{dateStr} {ts} IST</span>
                                                        <span className="text-xs text-muted-foreground">·</span>
                                                        <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px]" title={log.instagram_user_id}>
                                                            {log.instagram_user_id ? `uid:${log.instagram_user_id.slice(-6)}` : '–'}
                                                        </span>
                                                        {log.model_used && (
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground font-mono">{log.model_used}</span>
                                                        )}
                                                        <span className="ml-auto text-xs text-muted-foreground">{isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</span>
                                                    </div>
                                                    <p className="text-sm text-foreground mt-0.5 truncate">
                                                        {log.summary} — <span className="text-muted-foreground">{log.content?.slice(0, 80)}{log.content?.length > 80 ? '…' : ''}</span>
                                                    </p>
                                                </div>
                                            </div>
                                            {isExpanded && (
                                                <div className="mt-2 ml-3.5 p-3 rounded-lg bg-muted/10 border border-border/30">
                                                    <p className="text-xs text-muted-foreground mb-1">Full User ID: <span className="font-mono text-foreground">{log.instagram_user_id}</span></p>
                                                    <p className="text-xs text-muted-foreground mb-1">Timestamp: <span className="font-mono text-foreground">{new Date(log.created_at).toISOString()}</span></p>
                                                    <p className="text-xs text-muted-foreground mb-1">Role: <span className="font-mono text-foreground">{log.role}</span></p>
                                                    <p className="text-xs text-muted-foreground">Message:</p>
                                                    <pre className="text-xs text-foreground mt-1 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{log.content}</pre>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Quick SQL hint */}
                        <div className="mt-4 p-3 rounded-lg bg-muted/10 border border-border/30">
                            <p className="text-xs text-muted-foreground font-semibold mb-1">🛠️ Advanced: Run in Supabase SQL Editor to find exact failure times:</p>
                            <pre className="text-xs text-amber-400 overflow-x-auto whitespace-pre">{`SELECT c1.instagram_user_id, c1.created_at AS msg_time, c1.content
FROM riya_conversations c1
WHERE c1.role = 'user' AND c1.source = 'instagram'
  AND c1.created_at >= NOW() - INTERVAL '24 hours'
  AND NOT EXISTS (
    SELECT 1 FROM riya_conversations c2
    WHERE c2.instagram_user_id = c1.instagram_user_id
      AND c2.role = 'assistant'
      AND c2.created_at BETWEEN c1.created_at AND c1.created_at + INTERVAL '2 minutes'
  )
ORDER BY c1.created_at DESC;`}</pre>
                        </div>
                    </motion.div>
                )}

                {/* PMF Scorecard - Combined view only */}
                {analyticsView === 'combined' && analytics.pmfScore && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.05 }}
                        className="glass-card p-6 mb-6"
                    >
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="font-display text-xl font-semibold text-foreground flex items-center gap-2">
                                <Target className="w-5 h-5 text-primary" />
                                PMF Scorecard
                            </h2>
                            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${analytics.pmfScore.verdict === 'pmf'
                                ? 'bg-green-500/20 text-green-400'
                                : analytics.pmfScore.verdict === 'approaching'
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : 'bg-red-500/20 text-red-400'
                                }`}>
                                {analytics.pmfScore.verdict === 'pmf' ? '🟢 PMF Achieved'
                                    : analytics.pmfScore.verdict === 'approaching' ? '🟡 Approaching PMF'
                                        : '🔴 Pre-PMF'}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="p-4 rounded-xl bg-primary/10">
                                <p className="text-muted-foreground text-sm">Total Users (Web + IG)</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.pmfScore.totalAllUsers}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-secondary/10">
                                <p className="text-muted-foreground text-sm">Combined DAU</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.pmfScore.totalAllDau}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-accent/10">
                                <p className="text-muted-foreground text-sm">DAU / Total</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.pmfScore.dauPercentage}%
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">Target: &gt;15%</p>
                            </div>
                            <div className="p-4 rounded-xl bg-primary/10">
                                <p className="text-muted-foreground text-sm">Combined D7 Retention</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.pmfScore.combinedD7Retention}%
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">Target: &gt;20%</p>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* User Metrics (Web) - shown on combined + web */}
                {(analyticsView === 'combined' || analyticsView === 'web') && (
                    <>  {/* Web User Metrics */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="glass-card p-6 mb-6"
                        >
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="font-display text-xl font-semibold text-foreground flex items-center gap-2">
                                    <Users className="w-5 h-5 text-primary" />
                                    Web User Metrics
                                </h2>
                                <Select value={activeUsersInterval} onValueChange={setActiveUsersInterval}>
                                    <SelectTrigger className="w-[180px]">
                                        <SelectValue placeholder="Time range" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1 hour">Last 1 hour</SelectItem>
                                        <SelectItem value="3 hours">Last 3 hours</SelectItem>
                                        <SelectItem value="1 day">Last 24 hours</SelectItem>
                                        <SelectItem value="7 days">Last 7 days</SelectItem>
                                        <SelectItem value="30 days">Last 30 days</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                <div className="p-4 rounded-xl bg-primary/10">
                                    <p className="text-muted-foreground text-sm">Total Users</p>
                                    <p className="font-display text-3xl font-bold text-foreground">
                                        {analytics.userMetrics.total.toLocaleString()}
                                    </p>
                                </div>
                                <div className="p-4 rounded-xl bg-secondary/10">
                                    <p className="text-muted-foreground text-sm">Active Users ({activeUsersInterval})</p>
                                    <p className="font-display text-3xl font-bold text-foreground">
                                        {analytics.userMetrics.active.toLocaleString()}
                                    </p>
                                </div>
                                <div className="p-4 rounded-xl bg-accent/10">
                                    <p className="text-muted-foreground text-sm">Daily Active Users</p>
                                    <p className="font-display text-3xl font-bold text-foreground">
                                        {analytics.userMetrics.dau.toLocaleString()}
                                    </p>
                                </div>
                            </div>

                            {/* User Classification Table */}
                            <div className="mb-6">
                                <h3 className="font-semibold text-foreground mb-3">User Classification by Messages</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Tier</th>
                                                <th className="text-right py-3 px-4 text-muted-foreground font-medium">User Count</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analytics.userMetrics.classification.map((tier, index) => (
                                                <tr key={index} className="border-b border-border/50">
                                                    <td className="py-3 px-4 text-foreground">{tier.tier}</td>
                                                    <td className="py-3 px-4 text-foreground text-right font-semibold">
                                                        {tier.count.toLocaleString()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Daily Activity Chart */}
                            <div>
                                <h3 className="font-semibold text-foreground mb-3">Daily Activity (Last 30 Days)</h3>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={analytics.dailyActivity.slice(0, 30)}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 10%, 20%)" />
                                            <XAxis
                                                dataKey="date"
                                                stroke="hsl(240, 5%, 65%)"
                                                tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                            />
                                            <YAxis stroke="hsl(240, 5%, 65%)" />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: 'hsl(240, 10%, 8%)',
                                                    border: '1px solid hsl(240, 10%, 20%)',
                                                    borderRadius: '8px',
                                                }}
                                            />
                                            <Legend />
                                            <Bar dataKey="active_users" fill="hsl(174, 100%, 50%)" name="Active Users" radius={[8, 8, 0, 0]} />
                                            <Bar dataKey="user_messages" fill="hsl(280, 100%, 70%)" name="User Messages" radius={[8, 8, 0, 0]} />
                                            <Bar dataKey="guest_sessions" fill="hsl(30, 100%, 60%)" name="Guest Sessions" radius={[8, 8, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </motion.div>
                    </>)}

                {/* Engagement Metrics - shown on combined + web */}
                {(analyticsView === 'combined' || analyticsView === 'web') && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="glass-card p-6 mb-6"
                    >
                        <h2 className="font-display text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                            <MessageSquare className="w-5 h-5 text-primary" />
                            Engagement Metrics
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="p-4 rounded-xl bg-primary/10">
                                <p className="text-muted-foreground text-sm">Avg Messages/User</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.engagement.avgMessagesPerUser}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-secondary/10">
                                <p className="text-muted-foreground text-sm">Total Messages</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.engagement.totalMessages.toLocaleString()}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-accent/10">
                                <p className="text-muted-foreground text-sm">Total Sessions</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.engagement.totalSessions.toLocaleString()}
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Cost Metrics - shown on combined + web */}
                {(analyticsView === 'combined' || analyticsView === 'web') && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="glass-card p-6 mb-6"
                    >
                        <h2 className="font-display text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-primary" />
                            Cost Metrics
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="p-4 rounded-xl bg-primary/10">
                                <p className="text-muted-foreground text-sm flex items-center gap-2">
                                    Total API Cost
                                    {analytics.costs.dataSource === 'google_cloud' && (
                                        <span className="text-xs text-green-400 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                            Live
                                        </span>
                                    )}
                                    {analytics.costs.dataSource === 'calculated' && (
                                        <span className="text-xs text-yellow-400">Est.</span>
                                    )}
                                </p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    ₹{analytics.costs.actualCostINR
                                        ? parseFloat(analytics.costs.actualCostINR).toFixed(2)
                                        : parseFloat(analytics.costs.calculatedCostINR).toFixed(2)}
                                </p>
                                {analytics.costs.billingPeriod && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {analytics.costs.billingPeriod}
                                    </p>
                                )}
                            </div>
                            <div className="p-4 rounded-xl bg-secondary/10">
                                <p className="text-muted-foreground text-sm">Cost Per User</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    ₹{parseFloat(analytics.costs.costPerUser).toFixed(2)}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-accent/10">
                                <p className="text-muted-foreground text-sm">Total Tokens</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {(analytics.costs.totalTokens / 1_000_000).toFixed(2)}M
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Revenue Metrics - shown on combined + web */}
                {(analyticsView === 'combined' || analyticsView === 'web') && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="glass-card p-6 mb-6"
                    >
                        <h2 className="font-display text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                            <DollarSign className="w-5 h-5 text-primary" />
                            Revenue Metrics
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            <div className="p-4 rounded-xl bg-primary/10">
                                <p className="text-muted-foreground text-sm">Paying Users</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.revenue.payingUsers}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-secondary/10">
                                <p className="text-muted-foreground text-sm">Free Users</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.revenue.freeUsers}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-accent/10">
                                <p className="text-muted-foreground text-sm">Conversion Rate</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.revenue.conversionRate}%
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-primary/10">
                                <p className="text-muted-foreground text-sm">ARPU</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    ₹{analytics.revenue.arpu}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-secondary/10">
                                <p className="text-muted-foreground text-sm">Churn Rate</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.revenue.churnRate}%
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Retention Chart */}
                {/* User Retention - Commented out until retention calculation is fixed */}
                {/* <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    className="glass-card p-6 mb-6"
                >
                    <h2 className="font-display text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-primary" />
                        User Retention
                    </h2>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={retentionData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 10%, 20%)" />
                                <XAxis dataKey="period" stroke="hsl(240, 5%, 65%)" />
                                <YAxis stroke="hsl(240, 5%, 65%)" />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: 'hsl(240, 10%, 8%)',
                                        border: '1px solid hsl(240, 10%, 20%)',
                                        borderRadius: '8px',
                                    }}
                                    formatter={(value: number) => `${value.toFixed(2)}%`}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="percentage"
                                    stroke="hsl(174, 100%, 50%)"
                                    strokeWidth={3}
                                    dot={{ fill: 'hsl(174, 100%, 50%)', r: 6 }}
                                    activeDot={{ r: 8 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </motion.div> */}

                {/* Instagram Metrics - shown on combined + instagram */}
                {(analyticsView === 'combined' || analyticsView === 'instagram') && analytics.instagramMetrics && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.55 }}
                        className="glass-card p-6 mb-6"
                    >
                        <h2 className="font-display text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                            <Instagram className="w-5 h-5 text-pink-400" />
                            Instagram Metrics
                        </h2>

                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                            <div className="p-4 rounded-xl bg-pink-500/10">
                                <p className="text-muted-foreground text-sm">IG Users</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.instagramMetrics.total}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-pink-500/10">
                                <p className="text-muted-foreground text-sm">IG DAU</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.instagramMetrics.dau}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-pink-500/10">
                                <p className="text-muted-foreground text-sm">IG MAU</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.instagramMetrics.mau}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-pink-500/10">
                                <p className="text-muted-foreground text-sm">DAU / MAU</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.instagramMetrics.dauMauRatio}%
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-pink-500/10">
                                <p className="text-muted-foreground text-sm">Total IG Msgs</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.instagramMetrics.totalMessages.toLocaleString()}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-pink-500/10">
                                <p className="text-muted-foreground text-sm">Avg Msgs/User</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.instagramMetrics.avgMsgsPerUser}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-pink-500/10">
                                <p className="text-muted-foreground text-sm">In Trial / Expired</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    {analytics.instagramMetrics.inTrial}
                                    <span className="text-sm text-muted-foreground"> / {analytics.instagramMetrics.trialExpired}</span>
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-pink-500/10">
                                <p className="text-muted-foreground text-sm">Approx Cost</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    ₹{analytics.instagramMetrics.approxCostINR || (analytics.instagramMetrics.totalMessages * 0.08).toFixed(2)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">msgs × ₹0.08</p>
                            </div>
                            <div className="p-4 rounded-xl bg-pink-500/10">
                                <p className="text-muted-foreground text-sm">MRR</p>
                                <p className="font-display text-2xl font-bold text-foreground">
                                    ₹{analytics.instagramMetrics.mrr}
                                </p>
                            </div>
                        </div>

                        {/* IG Combined Daily Chart (from Feb 12) */}
                        {(() => {
                            const dailyData = analytics.instagramMetrics?.dailyActivity || [];
                            const newUsersData = analytics.instagramMetrics?.newUsersTrend || [];

                            // Merge both datasets by date
                            const dateMap: Record<string, { messages: number; approx_cost: number; active_users: number; daily_revenue: number }> = {};

                            dailyData.forEach(d => {
                                dateMap[d.date] = {
                                    messages: d.messages,
                                    approx_cost: d.approx_cost || parseFloat((d.messages * 0.06).toFixed(2)),
                                    active_users: d.active_users || 0,
                                    daily_revenue: d.daily_revenue || 0,
                                };
                            });

                            // Ensure today is included
                            const today = new Date().toISOString().split('T')[0];
                            if (!dateMap[today]) {
                                dateMap[today] = { messages: 0, approx_cost: 0, active_users: 0, daily_revenue: 0 };
                            }

                            const combined = Object.entries(dateMap)
                                .map(([date, vals]) => ({ date, ...vals }))
                                .filter(d => d.date >= '2026-02-12')
                                .sort((a, b) => a.date.localeCompare(b.date));

                            if (combined.length === 0) return null;

                            return (
                                <div className="mb-6">
                                    <h3 className="font-display text-lg font-semibold text-foreground mb-3">
                                        IG Daily Overview
                                    </h3>
                                    <div className="h-72">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={combined}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 10%, 20%)" />
                                                <XAxis
                                                    dataKey="date"
                                                    stroke="hsl(240, 5%, 65%)"
                                                    tickFormatter={(value: string) => {
                                                        const d = new Date(value + 'T00:00:00');
                                                        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                                    }}
                                                />
                                                <YAxis stroke="hsl(240, 5%, 65%)" />
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: 'hsl(240, 10%, 8%)',
                                                        border: '1px solid hsl(240, 10%, 20%)',
                                                        borderRadius: '8px',
                                                    }}
                                                />
                                                <Legend />
                                                <Bar dataKey="messages" fill="hsl(280, 80%, 60%)" name="Messages" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="approx_cost" fill="hsl(45, 90%, 55%)" name="Approx Cost (₹)" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="daily_revenue" fill="hsl(150, 100%, 40%)" name="Revenue (₹)" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="active_users" fill="hsl(174, 100%, 50%)" name="Active Users" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Session Time Analytics */}
                        {analytics.instagramMetrics.sessionMetrics && (
                            <div className="mb-6">
                                <h3 className="font-display text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-pink-400" />
                                    Session Time Analytics
                                    <span className="text-xs text-muted-foreground font-normal">(30-min inactivity = new session)</span>
                                </h3>

                                {/* Session Summary Cards */}
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                                    <div className="p-4 rounded-xl bg-pink-500/10">
                                        <p className="text-muted-foreground text-sm">Avg Session</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.sessionMetrics.avgSessionMinutes} min
                                        </p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-pink-500/10">
                                        <p className="text-muted-foreground text-sm">Median Session</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.sessionMetrics.medianSessionMinutes} min
                                        </p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-yellow-500/10">
                                        <p className="text-muted-foreground text-sm">Longest Session 🔥</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.sessionMetrics.maxSessionMinutes || 0} min
                                        </p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-pink-500/10">
                                        <p className="text-muted-foreground text-sm">Total Sessions (30d)</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.sessionMetrics.totalSessions.toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-pink-500/10">
                                        <p className="text-muted-foreground text-sm">Sessions / User</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.sessionMetrics.avgSessionsPerUser}
                                        </p>
                                    </div>
                                </div>

                                {/* Session Distribution Chart */}
                                <div className="h-52">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={analytics.instagramMetrics.sessionMetrics.distribution}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 10%, 20%)" />
                                            <XAxis dataKey="bucket" stroke="hsl(240, 5%, 65%)" />
                                            <YAxis stroke="hsl(240, 5%, 65%)" />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: 'hsl(240, 10%, 8%)',
                                                    border: '1px solid hsl(240, 10%, 20%)',
                                                    borderRadius: '8px',
                                                }}
                                            />
                                            <Bar dataKey="count" fill="hsl(330, 80%, 60%)" name="Sessions" radius={[6, 6, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>

                                {/* Top 5 Session Users */}
                                {analytics.instagramMetrics.sessionMetrics.topSessions?.length > 0 && (
                                    <div className="mt-4">
                                        <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                                            🏆 Top Session Users
                                        </h4>
                                        <div className="space-y-2">
                                            {analytics.instagramMetrics.sessionMetrics.topSessions.map((user: any, i: number) => (
                                                <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-pink-500/5 hover:bg-pink-500/10 transition-colors">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-lg font-bold text-muted-foreground w-6">{i + 1}</span>
                                                        <div>
                                                            <p className="text-sm font-medium text-foreground">@{user.username}</p>
                                                            {user.name && <p className="text-xs text-muted-foreground">{user.name}</p>}
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-sm font-bold text-pink-400">{user.longest_session_min} min</p>
                                                        <p className="text-xs text-muted-foreground">{user.total_sessions} sessions · {user.total_messages} msgs</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Payment Funnel Analytics */}
                        {analytics.instagramMetrics.paymentFunnel && (
                            <div className="mb-6">
                                <h3 className="font-display text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                                    <DollarSign className="w-5 h-5 text-green-400" />
                                    Payment Funnel
                                    <span className="text-xs text-muted-foreground font-normal">(last 30 days)</span>
                                </h3>

                                <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-4">
                                    <div className="p-4 rounded-xl bg-slate-500/10 text-center">
                                        <p className="text-muted-foreground text-sm">Exhausted Free</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.paymentFunnel.usersExhaustedFree}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">200+ msgs</p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-orange-500/10 text-center">
                                        <p className="text-muted-foreground text-sm">Limit Hits</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.paymentFunnel.limitHits}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">hit the wall</p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-blue-500/10 text-center">
                                        <p className="text-muted-foreground text-sm">Links Sent</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.paymentFunnel.linksSent}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">auto-sent</p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-purple-500/10 text-center">
                                        <p className="text-muted-foreground text-sm">Page Visits</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.paymentFunnel.pageVisits}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">{analytics.instagramMetrics.paymentFunnel.visitRate}% of links</p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-pink-500/10 text-center">
                                        <p className="text-muted-foreground text-sm">Upgrade Clicks</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.paymentFunnel.upgradeClicks}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">{analytics.instagramMetrics.paymentFunnel.clickRate}% of visits</p>
                                    </div>
                                    <div className="p-4 rounded-xl bg-green-500/10 text-center">
                                        <p className="text-muted-foreground text-sm">Payments</p>
                                        <p className="font-display text-2xl font-bold text-foreground">
                                            {analytics.instagramMetrics.paymentFunnel.payments}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">{analytics.instagramMetrics.paymentFunnel.conversionRate}% of clicks</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ===== AGGREGATE METRICS (30-day rolling averages) ===== */}
                        {analytics.aggregateMetrics && (() => {
                            const ag = analytics.aggregateMetrics!;
                            // Compute 7-day avg and same-day-last-week from dailyBreakdown
                            const breakdown = [...(ag.dailyBreakdown || [])].sort((a, b) => a.date.localeCompare(b.date));
                            const todayStr = new Date().toISOString().split('T')[0];
                            const lastWeekStr = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
                            const lastWeekDay = breakdown.find(d => d.date === lastWeekStr);
                            const last7 = breakdown.slice(-7);
                            const avg7Dau = last7.length ? Math.round(last7.reduce((s, d) => s + d.dau, 0) / last7.length) : 0;
                            const todayEntry = breakdown.find(d => d.date === todayStr);
                            return (
                                <div className="mb-6">
                                    <h3 className="font-display text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                                        <TrendingUp className="w-5 h-5 text-pink-400" />
                                        Aggregate Metrics
                                        <span className="text-xs text-muted-foreground font-normal">({ag.period}d rolling)</span>
                                    </h3>

                                    {/* Key aggregate cards */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                        <div className="p-4 rounded-xl bg-pink-500/10 text-center">
                                            <p className="text-muted-foreground text-xs mb-1">Avg DAU</p>
                                            <p className="font-display text-2xl font-bold text-foreground">{ag.avgDau}</p>
                                            {avg7Dau > 0 && <p className="text-[10px] text-muted-foreground mt-1">7d avg: {avg7Dau}</p>}
                                        </div>
                                        <div className="p-4 rounded-xl bg-pink-500/10 text-center">
                                            <p className="text-muted-foreground text-xs mb-1">MAU (30d)</p>
                                            <p className="font-display text-2xl font-bold text-foreground">{ag.mau}</p>
                                        </div>
                                        <div className="p-4 rounded-xl bg-pink-500/10 text-center">
                                            <p className="text-muted-foreground text-xs mb-1">Stickiness</p>
                                            <p className={`font-display text-2xl font-bold ${parseFloat(ag.dauMauRatio) >= 20 ? 'text-green-400' :
                                                parseFloat(ag.dauMauRatio) >= 10 ? 'text-yellow-400' : 'text-foreground'
                                                }`}>{ag.dauMauRatio}%</p>
                                            <p className="text-[10px] text-muted-foreground mt-1">DAU/MAU</p>
                                        </div>
                                        <div className="p-4 rounded-xl bg-pink-500/10 text-center">
                                            <p className="text-muted-foreground text-xs mb-1">Avg New/Day</p>
                                            <p className="font-display text-2xl font-bold text-foreground">{ag.avgNewUsersPerDay}</p>
                                            <p className="text-[10px] text-muted-foreground mt-1">Total: {ag.totalNewUsers}</p>
                                        </div>
                                        <div className="p-4 rounded-xl bg-green-500/10 text-center">
                                            <p className="text-muted-foreground text-xs mb-1">Total Rev ({ag.period}d)</p>
                                            <p className="font-display text-2xl font-bold text-foreground">₹{ag.totalRevenueINR}</p>
                                        </div>
                                        <div className="p-4 rounded-xl bg-green-500/10 text-center">
                                            <p className="text-muted-foreground text-xs mb-1">Avg Daily Rev</p>
                                            <p className="font-display text-2xl font-bold text-foreground">₹{ag.avgDailyRevenueINR.toFixed(0)}</p>
                                        </div>
                                        <div className="p-4 rounded-xl bg-blue-500/10 text-center">
                                            <p className="text-muted-foreground text-xs mb-1">Today DAU</p>
                                            <p className="font-display text-2xl font-bold text-foreground">{todayEntry?.dau ?? '—'}</p>
                                            {lastWeekDay && <p className="text-[10px] text-muted-foreground mt-1">Last wk: {lastWeekDay.dau}</p>}
                                        </div>
                                        <div className="p-4 rounded-xl bg-blue-500/10 text-center">
                                            <p className="text-muted-foreground text-xs mb-1">7d Avg DAU</p>
                                            <p className="font-display text-2xl font-bold text-foreground">{avg7Dau}</p>
                                            {lastWeekDay && <p className="text-[10px] text-muted-foreground mt-1">Same wk DAU: {lastWeekDay.dau}</p>}
                                        </div>
                                    </div>

                                    {/* DAU trend with 7-day average line */}
                                    {breakdown.length > 0 && (() => {
                                        // Compute rolling 7-day avg for each point
                                        const chartData = breakdown.slice(-30).map((d, i, arr) => {
                                            const window = arr.slice(Math.max(0, i - 6), i + 1);
                                            const rolling7 = Math.round(window.reduce((s, x) => s + x.dau, 0) / window.length);
                                            return {
                                                date: d.date,
                                                dau: d.dau,
                                                '7d avg': rolling7,
                                                new_users: d.new_users,
                                            };
                                        });
                                        return (
                                            <div className="h-56">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <LineChart data={chartData}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 10%, 20%)" />
                                                        <XAxis
                                                            dataKey="date"
                                                            stroke="hsl(240, 5%, 65%)"
                                                            tickFormatter={(v: string) => {
                                                                const d = new Date(v + 'T00:00:00');
                                                                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                                            }}
                                                            tick={{ fontSize: 10 }}
                                                        />
                                                        <YAxis stroke="hsl(240, 5%, 65%)" tick={{ fontSize: 10 }} />
                                                        <Tooltip
                                                            contentStyle={{
                                                                backgroundColor: 'hsl(240, 10%, 8%)',
                                                                border: '1px solid hsl(240, 10%, 20%)',
                                                                borderRadius: '8px',
                                                            }}
                                                        />
                                                        <Legend />
                                                        <Line type="monotone" dataKey="dau" stroke="hsl(174, 100%, 50%)" strokeWidth={2} dot={false} name="DAU" />
                                                        <Line type="monotone" dataKey="7d avg" stroke="hsl(280, 80%, 65%)" strokeWidth={2} strokeDasharray="5 3" dot={false} name="7d Avg" />
                                                        <Line type="monotone" dataKey="new_users" stroke="hsl(45, 90%, 55%)" strokeWidth={1.5} dot={false} name="New Users" />
                                                    </LineChart>
                                                </ResponsiveContainer>
                                            </div>
                                        );
                                    })()}

                                    {/* Same day last week comparison table */}
                                    {breakdown.length >= 8 && (() => {
                                        const last7days = breakdown.slice(-7);
                                        const prev7days = breakdown.slice(-14, -7);
                                        const rows = last7days.map((day, i) => {
                                            const prev = prev7days[i];
                                            const diffDau = prev ? day.dau - prev.dau : null;
                                            return { date: day.date, dau: day.dau, prevDau: prev?.dau, diffDau, newUsers: day.new_users };
                                        }).reverse();
                                        return (
                                            <div className="mt-4 overflow-x-auto">
                                                <h4 className="text-sm font-semibold text-foreground mb-2">Day-over-Week Comparison (last 7 days)</h4>
                                                <table className="w-full text-sm">
                                                    <thead>
                                                        <tr className="border-b border-border">
                                                            <th className="text-left py-2 px-3 text-muted-foreground font-medium">Date</th>
                                                            <th className="text-right py-2 px-3 text-muted-foreground font-medium">DAU</th>
                                                            <th className="text-right py-2 px-3 text-muted-foreground font-medium">Same Day −7</th>
                                                            <th className="text-right py-2 px-3 text-muted-foreground font-medium">Δ</th>
                                                            <th className="text-right py-2 px-3 text-muted-foreground font-medium">New Users</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {rows.map((r, i) => (
                                                            <tr key={i} className="border-b border-border/40">
                                                                <td className="py-2 px-3 text-foreground">
                                                                    {new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                                                </td>
                                                                <td className="py-2 px-3 text-right font-bold text-foreground">{r.dau}</td>
                                                                <td className="py-2 px-3 text-right text-muted-foreground">{r.prevDau ?? '—'}</td>
                                                                <td className={`py-2 px-3 text-right font-semibold ${r.diffDau === null ? 'text-muted-foreground' :
                                                                    r.diffDau > 0 ? 'text-green-400' :
                                                                        r.diffDau < 0 ? 'text-red-400' : 'text-muted-foreground'
                                                                    }`}>
                                                                    {r.diffDau === null ? '—' : (r.diffDau > 0 ? '+' : '') + r.diffDau}
                                                                </td>
                                                                <td className="py-2 px-3 text-right text-foreground">{r.newUsers}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })()}

                        {/* IG Classification + Retention + Pro Users side by side */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* IG User Classification */}
                            <div>
                                <h3 className="font-display text-lg font-semibold text-foreground mb-3">
                                    IG User Classification
                                </h3>
                                <div className="space-y-2">
                                    {analytics.instagramMetrics.classification.map((item, i) => (
                                        <div
                                            key={i}
                                            onClick={() => handleTierClick(item.tier)}
                                            className="flex justify-between items-center p-3 rounded-lg bg-pink-500/5 hover:bg-pink-500/10 cursor-pointer transition-colors group"
                                        >
                                            <span className="text-muted-foreground group-hover:text-pink-400 transition-colors">{item.tier}</span>
                                            <span className="font-bold text-foreground group-hover:text-pink-400 transition-colors">{item.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Pro Users List */}
                            <div className="bg-pink-500/5 rounded-xl p-4 overflow-hidden flex flex-col h-full">
                                <h3 className="font-display text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                                    <Crown className="w-5 h-5 text-yellow-500" />
                                    Pro Users ({analytics.instagramMetrics.proUsers.length})
                                </h3>
                                <div className="space-y-3 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                                    {analytics.instagramMetrics.proUsers.length > 0 ? (
                                        analytics.instagramMetrics.proUsers.map((user, i) => (
                                            <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-background/50 border border-pink-500/20">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-foreground truncate">
                                                        @{user.username}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground truncate">
                                                        {user.name}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-bold text-foreground">
                                                        {user.messageCount} msgs
                                                    </p>
                                                    {user.expiry && (
                                                        <p className="text-[10px] text-muted-foreground">
                                                            Exp: {new Date(user.expiry).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-8 text-muted-foreground">
                                            <p>No active pro users found</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* IG Retention - Cohort-based */}
                            <div>
                                <h3 className="font-display text-lg font-semibold text-foreground mb-3">
                                    IG Retention
                                    {analytics.cohortRetention && <span className="text-xs text-green-400 ml-2 font-normal">cohort</span>}
                                </h3>
                                {/* Cohort retention if available */}
                                {analytics.cohortRetention ? (
                                    <div className="space-y-2">
                                        {[
                                            { label: 'D1', rate: analytics.cohortRetention.d1Rate, retained: analytics.cohortRetention.d1Retained, eligible: analytics.cohortRetention.d1Eligible },
                                            { label: 'D2', rate: analytics.cohortRetention.d2Rate, retained: analytics.cohortRetention.d2Retained, eligible: analytics.cohortRetention.d2Eligible },
                                            { label: 'D7', rate: analytics.cohortRetention.d7Rate, retained: analytics.cohortRetention.d7Retained, eligible: analytics.cohortRetention.d7Eligible },
                                            { label: 'D30', rate: analytics.cohortRetention.d30Rate, retained: analytics.cohortRetention.d30Retained, eligible: analytics.cohortRetention.d30Eligible },
                                        ].map(({ label, rate, retained, eligible }) => (
                                            <div key={label} className="flex justify-between items-center p-3 rounded-lg bg-pink-500/5">
                                                <div>
                                                    <span className="text-muted-foreground">{label} Retention</span>
                                                    <p className="text-[10px] text-muted-foreground">{retained}/{eligible} users</p>
                                                </div>
                                                <span className={`font-bold text-lg ${parseFloat(rate) >= 30 ? 'text-green-400' :
                                                    parseFloat(rate) >= 15 ? 'text-yellow-400' : 'text-foreground'
                                                    }`}>{rate}%</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    /* Fallback: approximate retention */
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center p-3 rounded-lg bg-pink-500/5">
                                            <span className="text-muted-foreground">D1</span>
                                            <span className="font-bold text-foreground">{analytics.instagramMetrics.retention.d1}%</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 rounded-lg bg-pink-500/5">
                                            <span className="text-muted-foreground">D3</span>
                                            <span className="font-bold text-foreground">{analytics.instagramMetrics.retention.d3 || '0'}%</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 rounded-lg bg-pink-500/5">
                                            <span className="text-muted-foreground">D7</span>
                                            <span className="font-bold text-foreground">{analytics.instagramMetrics.retention.d7}%</span>
                                        </div>
                                        <div className="flex justify-between items-center p-3 rounded-lg bg-pink-500/5">
                                            <span className="text-muted-foreground">D30</span>
                                            <span className="font-bold text-foreground">{analytics.instagramMetrics.retention.d30}%</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Vercel Analytics - shown on combined + web */}
                {(analyticsView === 'combined' || analyticsView === 'web') && analytics.vercelAnalytics && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                        className="glass-card p-6 mb-6"
                    >
                        <h2 className="font-display text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-primary" />
                            Vercel Web Analytics
                        </h2>

                        {/* Summary Metrics */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div className="p-4 rounded-xl bg-primary/10">
                                <p className="text-muted-foreground text-sm">Visitors</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.vercelAnalytics.visitors.toLocaleString()}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-secondary/10">
                                <p className="text-muted-foreground text-sm">Page Views</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.vercelAnalytics.pageViews.toLocaleString()}
                                </p>
                            </div>
                            <div className="p-4 rounded-xl bg-accent/10">
                                <p className="text-muted-foreground text-sm">Bounce Rate</p>
                                <p className="font-display text-3xl font-bold text-foreground">
                                    {analytics.vercelAnalytics.bounceRate}%
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Top Pages */}
                            <div>
                                <h3 className="font-semibold text-foreground mb-3">Top Pages</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Page</th>
                                                <th className="text-right py-3 px-4 text-muted-foreground font-medium">Visitors</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analytics.vercelAnalytics.topPages.slice(0, 6).map((page, index) => (
                                                <tr key={index} className="border-b border-border/50">
                                                    <td className="py-3 px-4 text-foreground font-mono text-sm">{page.path}</td>
                                                    <td className="py-3 px-4 text-foreground text-right font-semibold">
                                                        {page.visitors}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Referrers */}
                            <div>
                                <h3 className="font-semibold text-foreground mb-3">Top Referrers</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Source</th>
                                                <th className="text-right py-3 px-4 text-muted-foreground font-medium">Visitors</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analytics.vercelAnalytics.referrers.slice(0, 6).map((ref, index) => (
                                                <tr key={index} className="border-b border-border/50">
                                                    <td className="py-3 px-4 text-foreground">{ref.source}</td>
                                                    <td className="py-3 px-4 text-foreground text-right font-semibold">
                                                        {ref.visitors}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Countries */}
                            <div>
                                <h3 className="font-semibold text-foreground mb-3">Top Countries</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Country</th>
                                                <th className="text-right py-3 px-4 text-muted-foreground font-medium">%</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analytics.vercelAnalytics.countries.slice(0, 5).map((country, index) => (
                                                <tr key={index} className="border-b border-border/50">
                                                    <td className="py-3 px-4 text-foreground">{country.country}</td>
                                                    <td className="py-3 px-4 text-foreground text-right font-semibold">
                                                        {country.percentage}%
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Devices */}
                            <div>
                                <h3 className="font-semibold text-foreground mb-3">Devices & OS</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-border">
                                                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Device</th>
                                                <th className="text-right py-3 px-4 text-muted-foreground font-medium">%</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analytics.vercelAnalytics.devices.slice(0, 5).map((device, index) => (
                                                <tr key={index} className="border-b border-border/50">
                                                    <td className="py-3 px-4 text-foreground">{device.device}</td>
                                                    <td className="py-3 px-4 text-foreground text-right font-semibold">
                                                        {device.percentage}%
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>

                        <p className="mt-4 text-xs text-muted-foreground text-center italic">
                            {analytics.vercelAnalytics.note}
                        </p>
                    </motion.div>
                )}

                <div className="mt-6 flex justify-center">
                    <Button variant="ghost" onClick={() => navigate('/riya')}>
                        Back to Home
                    </Button>
                </div>

                {/* User List Dialog */}
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                    <DialogContent className="sm:max-w-[500px] max-h-[80vh] flex flex-col">
                        <DialogHeader>
                            <DialogTitle>Users: {selectedTier}</DialogTitle>
                            <DialogDescription>
                                Reviewing top 100 users in this category
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto pr-2 mt-4">
                            {isLoadingUsers ? (
                                <div className="flex justify-center py-8">
                                    <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                                </div>
                            ) : tierUsers.length === 0 ? (
                                <p className="text-center text-muted-foreground py-8">No users found in this range.</p>
                            ) : (
                                <div className="space-y-2">
                                    {tierUsers.map((user, idx) => (
                                        <div key={idx} className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                                            <div>
                                                <p className="font-medium text-foreground">
                                                    {user.instagram_name || 'Instagram User'}
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    @{user.instagram_username || 'unknown'}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <span className="inline-block px-2 py-1 rounded bg-primary/10 text-primary text-xs font-bold">
                                                    {user.message_count} msgs
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

export default RiyaAnalytics;
