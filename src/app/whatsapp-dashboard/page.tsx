/**
 * WhatsApp Dashboard
 * View all WhatsApp users and their data
 */

import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

// Create Supabase client (server-side)
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

/**
 * Fetch all WhatsApp users with message stats
 */
async function getWhatsAppUsers(): Promise<User[]> {
  try {
    // Get all users with phone numbers
    const { data: phoneNumbers, error: phoneError } = await supabase
      .from('user_phone_numbers')
      .select('user_id, phone_number');

    if (phoneError) {
      console.error('Error fetching phone numbers:', phoneError);
      return [];
    }

    // Get message stats for each user
    const usersWithStats: User[] = [];

    for (const phone of phoneNumbers || []) {
      const { data: messages } = await supabase
        .from('messages')
        .select('created_at')
        .eq('user_id', phone.user_id)
        .eq('channel', 'whatsapp')
        .order('created_at', { ascending: false })
        .limit(1);

      usersWithStats.push({
        user_id: phone.user_id,
        phone_number: phone.phone_number,
        message_count: messages?.length || 0,
        last_message_time: messages?.[0]?.created_at || 'Never',
      });
    }

    // Sort by most recent activity
    return usersWithStats.sort((a, b) => 
      new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime()
    );
  } catch (error) {
    console.error('Error in getWhatsAppUsers:', error);
    return [];
  }
}

/**
 * Dashboard Page Component
 */
export default async function WhatsAppDashboard() {
  const users = await getWhatsAppUsers();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            WhatsApp Dashboard
          </h1>
          <p className="text-gray-600">
            View conversations, tasks, and groceries from WhatsApp users
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-600 mb-1">Total Users</p>
            <p className="text-3xl font-bold text-gray-900">{users.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-600 mb-1">Active Today</p>
            <p className="text-3xl font-bold text-gray-900">
              {users.filter(u => {
                const today = new Date().toDateString();
                const lastMsg = new Date(u.last_message_time).toDateString();
                return today === lastMsg;
              }).length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-600 mb-1">Channel</p>
            <p className="text-3xl font-bold text-green-600">WhatsApp</p>
          </div>
        </div>

        {/* Users List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Users</h2>
          </div>
          
          {users.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <p className="text-lg mb-2">No WhatsApp users yet</p>
              <p className="text-sm">Users will appear here once they send their first message</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {users.map((user) => (
                <Link
                  key={user.user_id}
                  href={`/whatsapp-dashboard/${user.user_id}`}
                  className="block px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {/* Avatar */}
                      <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white font-semibold text-lg">
                        {user.phone_number.slice(-2)}
                      </div>
                      
                      {/* User Info */}
                      <div>
                        <p className="text-lg font-medium text-gray-900">
                          {user.phone_number}
                        </p>
                        <p className="text-sm text-gray-500">
                          Last active: {formatTime(user.last_message_time)}
                        </p>
                      </div>
                    </div>

                    {/* Arrow */}
                    <svg
                      className="w-5 h-5 text-gray-400"
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
            className="text-green-600 hover:text-green-700 font-medium"
          >
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Format timestamp for display
 */
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

