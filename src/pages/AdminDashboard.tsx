import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, MessageSquare, TrendingUp, Lock, UserPlus, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';

interface Stats {
  totalUsers: number;
  totalMessages: number;
  vibeBreakdown: { name: string; count: number }[];
  recentLogs: {
    email: string;
    message: string;
    reply: string;
    time: string;
  }[];
}

interface GuestStats {
  totalSessions: number;
  convertedCount: number;
  conversionRate: number;
  avgMessagesBeforeConvert: number;
}

interface ImageStats {
  clicksByType: { name: string; count: number }[];
  totalClicks: number;
  imagesByCategory: { name: string; count: number }[];
  totalImagesSent: number;
}

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    totalMessages: 0,
    vibeBreakdown: [],
    recentLogs: [],
  });
  const [guestStats, setGuestStats] = useState<GuestStats>({
    totalSessions: 0,
    convertedCount: 0,
    conversionRate: 0,
    avgMessagesBeforeConvert: 0,
  });
  const [imageStats, setImageStats] = useState<ImageStats>({
    clicksByType: [],
    totalClicks: 0,
    imagesByCategory: [],
    totalImagesSent: 0,
  });
  const [isLoading, setIsLoading] = useState(false);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === '1234') {
      setIsAuthenticated(true);
      loadStats();
      loadGuestStats();
      loadImageStats();
    } else {
      alert('Invalid PIN');
    }
  };

  const loadStats = async () => {
    setIsLoading(true);
    try {
      // Get total users
      const { count: userCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      // Get total messages
      const { count: messageCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true });

      // Get vibe breakdown
      const { data: personas } = await supabase
        .from('personas')
        .select('vibe');

      const vibeMap: Record<string, number> = {};
      personas?.forEach((p) => {
        vibeMap[p.vibe] = (vibeMap[p.vibe] || 0) + 1;
      });

      const vibeBreakdown = Object.entries(vibeMap).map(([name, count]) => ({
        name,
        count,
      }));

      // Get recent messages with user emails
      const { data: recentMessages } = await supabase
        .from('messages')
        .select('*, users(email)')
        .order('timestamp', { ascending: false })
        .limit(50);

      // Group messages by pairs (user + assistant)
      const recentLogs: Stats['recentLogs'] = [];
      if (recentMessages) {
        for (let i = 0; i < recentMessages.length - 1; i += 2) {
          const msg1 = recentMessages[i];
          const msg2 = recentMessages[i + 1];

          if (msg1.role === 'assistant' && msg2?.role === 'user') {
            recentLogs.push({
              email: (msg2 as any).users?.email || 'Unknown',
              message: msg2.content.substring(0, 50) + '...',
              reply: msg1.content.substring(0, 50) + '...',
              time: new Date(msg1.timestamp!).toLocaleString(),
            });
          }
        }
      }

      setStats({
        totalUsers: userCount || 0,
        totalMessages: messageCount || 0,
        vibeBreakdown,
        recentLogs: recentLogs.slice(0, 10),
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadGuestStats = async () => {
    try {
      // @ts-ignore - Table exists after migration
      const { data: sessions, error } = await supabase
        .from('riya_guest_sessions')
        .select('*');

      if (error) {
        console.error('Error loading guest stats:', error);
        return;
      }

      if (!sessions || sessions.length === 0) {
        return;
      }

      const totalSessions = sessions.length;
      const convertedSessions = sessions.filter((s: any) => s.converted);
      const convertedCount = convertedSessions.length;
      const conversionRate = totalSessions > 0 ? (convertedCount / totalSessions) * 100 : 0;

      // Calculate avg messages for converted users
      const totalMsgsConverted = convertedSessions.reduce((acc: number, s: any) => acc + (s.message_count || 0), 0);
      const avgMessagesBeforeConvert = convertedCount > 0 ? totalMsgsConverted / convertedCount : 0;

      setGuestStats({
        totalSessions,
        convertedCount,
        conversionRate,
        avgMessagesBeforeConvert,
      });
    } catch (error) {
      console.error('Error loading guest stats:', error);
    }
  };

  const loadImageStats = async () => {
    try {
      // Get camera button clicks
      // @ts-ignore - Table exists after migration
      const { data: clicks, error: clickError } = await supabase
        .from('riya_image_clicks')
        .select('user_type');

      if (clickError) {
        console.error('Error loading image clicks:', clickError);
      }

      // Count by user type
      const clickMap: Record<string, number> = { guest: 0, free: 0, pro: 0 };
      clicks?.forEach((c: any) => {
        clickMap[c.user_type] = (clickMap[c.user_type] || 0) + 1;
      });

      const clicksByType = Object.entries(clickMap).map(([name, count]) => ({ name, count }));
      const totalClicks = clicks?.length || 0;

      // Get images by category (from gallery times_sent)
      // @ts-ignore - Table exists after migration
      const { data: gallery, error: galleryError } = await supabase
        .from('riya_gallery')
        .select('category, times_sent');

      let imagesByCategory: { name: string; count: number }[] = [];
      let totalImagesSent = 0;

      if (!galleryError && gallery) {
        const categoryMap: Record<string, number> = {};
        gallery.forEach((img: any) => {
          categoryMap[img.category] = (categoryMap[img.category] || 0) + (img.times_sent || 0);
          totalImagesSent += img.times_sent || 0;
        });
        imagesByCategory = Object.entries(categoryMap).map(([name, count]) => ({ name, count }));
      }

      setImageStats({
        clicksByType,
        totalClicks,
        imagesByCategory,
        totalImagesSent,
      });
    } catch (error) {
      console.error('Error loading image stats:', error);
    }
  };

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
            Admin Access
          </h1>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="text-center text-xl tracking-widest"
              maxLength={4}
            />
            <Button type="submit" variant="neon" className="w-full">
              Unlock
            </Button>
          </form>

          <Button
            variant="ghost"
            className="mt-4 text-muted-foreground"
            onClick={() => navigate('/')}
          >
            Back to Home
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="font-display text-3xl font-bold neon-text">
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground">SoulMate Analytics</p>
        </motion.div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card p-6"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Total Users</p>
                <p className="font-display text-3xl font-bold text-foreground">
                  {stats.totalUsers}
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card p-6"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-secondary/10">
                <MessageSquare className="w-6 h-6 text-secondary" />
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Total Messages</p>
                <p className="font-display text-3xl font-bold text-foreground">
                  {stats.totalMessages}
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="glass-card p-6"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-accent/10">
                <TrendingUp className="w-6 h-6 text-accent" />
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Avg Messages/User</p>
                <p className="font-display text-3xl font-bold text-foreground">
                  {stats.totalUsers > 0
                    ? (stats.totalMessages / stats.totalUsers).toFixed(1)
                    : 0}
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Guest Analytics Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mb-8"
        >
          <h2 className="font-display text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Guest Analytics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Total Guest Sessions</p>
              <p className="font-display text-2xl font-bold text-foreground">
                {guestStats.totalSessions}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Converted to Users</p>
              <p className="font-display text-2xl font-bold text-primary">
                {guestStats.convertedCount}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Conversion Rate</p>
              <p className="font-display text-2xl font-bold text-foreground">
                {guestStats.conversionRate.toFixed(1)}%
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Avg Msgs Before Convert</p>
              <p className="font-display text-2xl font-bold text-foreground">
                {guestStats.avgMessagesBeforeConvert.toFixed(1)}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Image Analytics Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className="mb-8"
        >
          <h2 className="font-display text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
            <Camera className="w-5 h-5 text-pink-400" />
            Image Analytics
          </h2>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Total Camera Clicks</p>
              <p className="font-display text-2xl font-bold text-foreground">
                {imageStats.totalClicks}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Guest Clicks</p>
              <p className="font-display text-2xl font-bold text-pink-400">
                {imageStats.clicksByType.find(c => c.name === 'guest')?.count || 0}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Free User Clicks</p>
              <p className="font-display text-2xl font-bold text-primary">
                {imageStats.clicksByType.find(c => c.name === 'free')?.count || 0}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Pro User Clicks</p>
              <p className="font-display text-2xl font-bold text-yellow-400">
                {imageStats.clicksByType.find(c => c.name === 'pro')?.count || 0}
              </p>
            </div>
          </div>

          {/* Images Sent Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Total Images Sent</p>
              <p className="font-display text-2xl font-bold text-foreground">
                {imageStats.totalImagesSent}
              </p>
            </div>
            <div className="glass-card p-4">
              <p className="text-muted-foreground text-sm">Click-to-Image Rate</p>
              <p className="font-display text-2xl font-bold text-foreground">
                {imageStats.totalClicks > 0
                  ? ((imageStats.totalImagesSent / imageStats.totalClicks) * 100).toFixed(1)
                  : 0}%
              </p>
            </div>
          </div>
        </motion.div>

        {/* Vibe Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="glass-card p-6 mb-8"
        >
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">
            Vibe Breakdown
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.vibeBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240, 10%, 20%)" />
                <XAxis dataKey="name" stroke="hsl(240, 5%, 65%)" />
                <YAxis stroke="hsl(240, 5%, 65%)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(240, 10%, 8%)',
                    border: '1px solid hsl(240, 10%, 20%)',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="count" fill="hsl(174, 100%, 50%)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Recent Logs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="glass-card p-6"
        >
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">
            Recent Chat Logs
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">
                    Email
                  </th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">
                    Message
                  </th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">
                    Bot Reply
                  </th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.recentLogs.map((log, index) => (
                  <tr key={index} className="border-b border-border/50">
                    <td className="py-3 px-4 text-foreground text-sm">{log.email}</td>
                    <td className="py-3 px-4 text-foreground text-sm">{log.message}</td>
                    <td className="py-3 px-4 text-primary text-sm">{log.reply}</td>
                    <td className="py-3 px-4 text-muted-foreground text-sm">{log.time}</td>
                  </tr>
                ))}
                {stats.recentLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted-foreground">
                      No chat logs yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>

        <div className="mt-6 flex justify-center">
          <Button variant="ghost" onClick={() => navigate('/')}>
            Back to Home
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
