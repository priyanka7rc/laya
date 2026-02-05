/**
 * WhatsApp User Detail Page
 * View conversation, tasks, and groceries for a specific user
 */

import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

// Create Supabase client (server-side)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Message {
  id: string;
  role: string;
  content: string;
  direction: string;
  message_type: string;
  created_at: string;
}

interface Task {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  category: string;
  is_done: boolean;
  created_at: string;
}

interface Grocery {
  id: string;
  item_name: string;
  quantity: string | null;
  needed_by: string | null;
  status: string;
  created_at: string;
}

interface Mood {
  id: string;
  tag: string;
  intensity: number;
  created_at: string;
}

/**
 * Fetch user's phone number
 */
async function getUserPhone(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('whatsapp_users')
    .select('phone_number')
    .eq('id', userId)
    .single();

  return data?.phone_number || null;
}

/**
 * Fetch user's WhatsApp messages
 */
async function getMessages(userId: string): Promise<Message[]> {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .eq('channel', 'whatsapp')
    .order('created_at', { ascending: true });

  return data || [];
}

/**
 * Fetch user's tasks
 */
async function getTasks(userId: string): Promise<Task[]> {
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('is_done', { ascending: true })
    .order('due_date', { ascending: true });

  return data || [];
}

/**
 * Fetch user's groceries
 */
async function getGroceries(userId: string): Promise<Grocery[]> {
  const { data } = await supabase
    .from('groceries')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  return data || [];
}

/**
 * Fetch user's moods
 */
async function getMoods(userId: string): Promise<Mood[]> {
  const { data } = await supabase
    .from('moods')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  return data || [];
}

/**
 * User Detail Page Component
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  // Await params in Next.js 15+
  const { userId } = await params;
  
  const [phoneNumber, messages, tasks, groceries, moods] = await Promise.all([
    getUserPhone(userId),
    getMessages(userId),
    getTasks(userId),
    getGroceries(userId),
    getMoods(userId),
  ]);

  if (!phoneNumber) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-red-600">User not found</p>
          <Link href="/whatsapp-dashboard" className="text-green-600 hover:underline">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const pendingTasks = tasks.filter((t) => !t.is_done);
  const completedTasks = tasks.filter((t) => t.is_done);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/whatsapp-dashboard"
            className="text-green-600 hover:text-green-700 font-medium mb-4 inline-block"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {phoneNumber}
          </h1>
          <p className="text-gray-600">
            {messages.length} messages · {tasks.length} tasks · {groceries.length} groceries
          </p>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Conversation */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">Conversation</h2>
              </div>
              <div className="p-6 space-y-4 max-h-[600px] overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No messages yet</p>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.direction === 'inbound' ? 'justify-start' : 'justify-end'
                      }`}
                    >
                      <div
                        className={`max-w-[70%] rounded-lg px-4 py-2 ${
                          msg.direction === 'inbound'
                            ? 'bg-gray-100 text-gray-900'
                            : 'bg-green-500 text-white'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <p
                          className={`text-xs mt-1 ${
                            msg.direction === 'inbound' ? 'text-gray-500' : 'text-green-100'
                          }`}
                        >
                          {formatTime(msg.created_at)}
                          {msg.message_type === 'audio' && ' 🎤'}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Tasks */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">
                  Tasks ({pendingTasks.length})
                </h2>
              </div>
              <div className="p-6 space-y-3">
                {pendingTasks.length === 0 ? (
                  <p className="text-gray-500 text-sm">No pending tasks</p>
                ) : (
                  pendingTasks.map((task) => (
                    <div key={task.id} className="pb-3 border-b border-gray-100 last:border-0">
                      <p className="font-medium text-gray-900">{task.title}</p>
                      {task.due_date && (
                        <p className="text-sm text-gray-600 mt-1">
                          📅 {new Date(task.due_date).toLocaleDateString()}
                          {task.due_time && ` at ${task.due_time}`}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        📁 {task.category || 'Tasks'}
                      </p>
                    </div>
                  ))
                )}
                {completedTasks.length > 0 && (
                  <details className="mt-4">
                    <summary className="text-sm text-gray-600 cursor-pointer">
                      {completedTasks.length} completed
                    </summary>
                    <div className="mt-2 space-y-2">
                      {completedTasks.map((task) => (
                        <p key={task.id} className="text-sm text-gray-500 line-through">
                          ✓ {task.title}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>

            {/* Groceries */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">
                  Groceries ({groceries.length})
                </h2>
              </div>
              <div className="p-6 space-y-2">
                {groceries.length === 0 ? (
                  <p className="text-gray-500 text-sm">No groceries</p>
                ) : (
                  groceries.map((grocery) => (
                    <div key={grocery.id} className="flex items-start space-x-2">
                      <span className="text-gray-400 mt-1">○</span>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">
                          {grocery.item_name}
                          {grocery.quantity && (
                            <span className="text-gray-600 text-sm ml-2">
                              ({grocery.quantity})
                            </span>
                          )}
                        </p>
                        {grocery.needed_by && (
                          <p className="text-xs text-gray-500">
                            By: {new Date(grocery.needed_by).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Moods */}
            {moods.length > 0 && (
              <div className="bg-white rounded-lg shadow">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-xl font-semibold text-gray-900">Recent Moods</h2>
                </div>
                <div className="p-6 space-y-2">
                  {moods.map((mood) => (
                    <div key={mood.id} className="flex items-center justify-between">
                      <span className="text-gray-900 capitalize">{mood.tag}</span>
                      <span className="text-xs text-gray-500">
                        {formatTime(mood.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp: string): string {
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
  
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

