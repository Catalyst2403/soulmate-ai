import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Users, MessageSquare, TrendingUp, Lock, DollarSign, Activity, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
        total_conversations: number;
    }>;
    engagement: {
        avgMessagesPerUser: string;
        totalMessages: number;
        totalSessions: number;
    };
    costs: {
        totalCostINR: string;
        costPerUser: string;
        totalTokens: number;
        googleCloudBilling: any;
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
        d7: string;
        d30: string;
    };
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

const RiyaAnalytics = () => {
    const navigate = useNavigate();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [pin, setPin] = useState('');
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [activeUsersInterval, setActiveUsersInterval] = useState('7 days');

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
            const response = await fetch(
                `${supabaseUrl}/functions/v1/riya-analytics?interval=${encodeURIComponent(activeUsersInterval)}`
            );

            if (!response.ok) {
                throw new Error('Failed to fetch analytics');
            }

            const data = await response.json();
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
                        Riya Analytics
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
                            Riya Analytics Dashboard
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

                {/* User Metrics */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="glass-card p-6 mb-6"
                >
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="font-display text-xl font-semibold text-foreground flex items-center gap-2">
                            <Users className="w-5 h-5 text-primary" />
                            User Metrics
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
                                    <Bar dataKey="total_conversations" fill="hsl(280, 100%, 70%)" name="Conversations" radius={[8, 8, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </motion.div>

                {/* Engagement Metrics */}
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

                {/* Cost Metrics */}
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
                            <p className="text-muted-foreground text-sm">Total API Cost</p>
                            <p className="font-display text-3xl font-bold text-foreground">
                                ₹{parseFloat(analytics.costs.totalCostINR).toFixed(2)}
                            </p>
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

                {/* Revenue Metrics */}
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

                {/* Retention Chart */}
                <motion.div
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
                </motion.div>

                {/* Vercel Analytics */}
                {analytics.vercelAnalytics && (
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
            </div>
        </div>
    );
};

export default RiyaAnalytics;
