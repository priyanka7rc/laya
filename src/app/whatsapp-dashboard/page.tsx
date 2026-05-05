/**
 * WhatsApp Dashboard
 * View all WhatsApp users and their data
 */

import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface User {
  user_id: string;
  phone_number: string;
  message_count: number;
  last_message_time: string;
}

async function getWhatsAppUsers(): Promise<User[]> {
  try {
    const { data: users, error: usersError } = await supabase
      .from('whatsapp_users')
      .select('id, phone_number, last_active')
      .order('last_active', { ascending: false });

    if (usersError) {
      console.error('Error fetching WhatsApp users:', usersError);
      return [];
    }

    const usersWithStats: User[] = [];

    for (const user of users || []) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('channel', 'whatsapp');

      usersWithStats.push({
        user_id: user.id,
        phone_number: user.phone_number,
        message_count: count || 0,
        last_message_time: user.last_active || 'Never',
      });
    }

    return usersWithStats;
  } catch (error) {
    console.error('Error in getWhatsAppUsers:', error);
    return [];
  }
}

export default async function WhatsAppDashboard() {
  const users = await getWhatsAppUsers();

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            WhatsApp Dashboard
          </h1>
          <p className="text-muted-foreground">
            View conversations, tasks, and groceries from WhatsApp users
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-card border border-border rounded-lg p-6">
            <p className="text-sm text-muted-foreground mb-1">Total Users</p>
            <p className="text-3xl font-bold text-foreground">{users.length}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-6">
            <p className="text-sm text-muted-foreground mb-1">Active Today</p>
            <p className="text-3xl font-bold text-foreground">
              {users.filter(u => {
                const today = new Date().toDateString();
                const lastMsg = new Date(u.last_message_time).toDateString();
                return today === lastMsg;
              }).length}
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-6">
            <p className="text-sm text-muted-foreground mb-1">Channel</p>
            {/* WhatsApp green is intentional brand color */}
            <p className="text-3xl font-bold text-green-600">WhatsApp</p>
          </div>
        </div>

        {/* Users List */}
        <div className="bg-card border border-border rounded-lg">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-xl font-semibold text-foreground">Users</h2>
          </div>

          {users.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <p className="text-lg mb-2">No WhatsApp users yet</p>
              <p className="text-sm">Users will appear here once they send their first message</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {users.map((user) => (
                <Link
                  key={user.user_id}
                  href={`/whatsapp-dashboard/${user.user_id}`}
                  className="block px-6 py-4 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {/* Avatar — WhatsApp green is intentional brand color */}
                      <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white font-semibold text-lg">
                        {user.phone_number.slice(-2)}
                      </div>

                      <div>
                        <p className="text-lg font-medium text-foreground">
                          {user.phone_number}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Last active: {formatTime(user.last_message_time)}
                        </p>
                      </div>
                    </div>

                    <svg
                      className="w-5 h-5 text-muted-foreground"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Back to Home Link */}
        <div className="mt-8 text-center">
          <Link
            href="/"
            className="text-primary hover:text-primary/80 font-medium transition-colors"
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

function formatTime(timestamp: string): string {
  if (timestamp === 'Never') return 'Never';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
