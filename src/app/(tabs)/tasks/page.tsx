"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Card, Button } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { trackTaskToggle, trackTaskAdd } from '@/lib/analytics';

interface Task {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_time: string | null;
  category: string | null;
  is_done: boolean;
  created_at: string;
}

export default function TasksPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Quick add states
  const [quickAddFocused, setQuickAddFocused] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickDate, setQuickDate] = useState('');
  const [quickTime, setQuickTime] = useState('');
  const [adding, setAdding] = useState(false);

  // Animation state for toggled tasks
  const [animatingTasks, setAnimatingTasks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user) {
      fetchTasks();
    }
  }, [user]);

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Sort: incomplete first, then by due date, then created_at
      const sorted = (data || []).sort((a, b) => {
        // Incomplete tasks first
        if (a.is_done !== b.is_done) {
          return a.is_done ? 1 : -1;
        }
        
        // Then by due date (null dates go last)
        if (a.due_date !== b.due_date) {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        }
        
        // Then by created_at (newest first for same date)
        return b.created_at.localeCompare(a.created_at);
      });

      setTasks(sorted);
    } catch (err: any) {
      console.error('Error fetching tasks:', err);
      toast.error('Failed to load tasks', 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAdd = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    if (!quickTitle.trim()) {
      toast.error('Task title required', 'Please enter a task title');
      return;
    }

    setAdding(true);
    try {
      const { data, error } = await supabase
        .from('tasks')
        .insert([{
          user_id: user?.id,
          title: quickTitle.trim(),
          due_date: quickDate || null,
          due_time: quickTime || null,
          is_done: false,
        }])
        .select()
        .single();

      if (error) throw error;

      // Add to list and resort
      const newTasks = [...tasks, data];
      const sorted = newTasks.sort((a, b) => {
        if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
        if (a.due_date !== b.due_date) {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date.localeCompare(b.due_date);
        }
        return b.created_at.localeCompare(a.created_at);
      });
      setTasks(sorted);

      // Reset form
      setQuickTitle('');
      setQuickDate('');
      setQuickTime('');
      setQuickAddFocused(false);

      toast.success('Task added!', quickTitle.trim());
      trackTaskAdd();
    } catch (err: any) {
      console.error('Error adding task:', err);
      toast.error('Failed to add task', 'Please try again');
    } finally {
      setAdding(false);
    }
  };

  const toggleTask = async (task: Task) => {
    const newStatus = !task.is_done;
    const previousTasks = [...tasks];

    // Optimistic update with animation
    setAnimatingTasks(prev => new Set(prev).add(task.id));
    setTimeout(() => {
      setTasks(tasks.map(t =>
        t.id === task.id ? { ...t, is_done: newStatus } : t
      ));
      setAnimatingTasks(prev => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }, 200);

    try {
      const { error } = await supabase
        .from('tasks')
        .update({ is_done: newStatus })
        .eq('id', task.id);

      if (error) throw error;

      trackTaskToggle(task.id, newStatus);

      // Show toast with undo option
      if (newStatus) {
        toast({
          title: 'Task completed',
          description: task.title,
          variant: 'success',
          duration: 5000,
        });

        // Note: Undo functionality would require extending the toast component
        // For now, users can manually uncheck the task
      }
    } catch (err: any) {
      console.error('Error toggling task:', err);
      // Revert on error
      setTasks(previousTasks);
      toast.error('Failed to update task', 'Please try again');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTime = (timeString: string | null) => {
    if (!timeString) return null;
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const incompleteTasks = tasks.filter(t => !t.is_done);
  const completedTasks = tasks.filter(t => t.is_done);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24 md:pb-8 transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2">
              Tasks
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {incompleteTasks.length} active · {completedTasks.length} completed
            </p>
          </div>

          {/* Quick Add */}
          <Card className="mb-6 border-blue-300/30 dark:border-blue-800/30">
            <form onSubmit={handleQuickAdd}>
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                onFocus={() => setQuickAddFocused(true)}
                placeholder="Add a task…"
                className="w-full h-11 px-4 bg-gray-100 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-base"
              />

              {quickAddFocused && (
                <div className="mt-4 space-y-3 animate-slide-down">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5">
                        Due Date
                      </label>
                      <input
                        type="date"
                        value={quickDate}
                        onChange={(e) => setQuickDate(e.target.value)}
                        className="w-full h-11 px-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1.5">
                        Due Time
                      </label>
                      <input
                        type="time"
                        value={quickTime}
                        onChange={(e) => setQuickTime(e.target.value)}
                        className="w-full h-11 px-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      loading={adding}
                      disabled={!quickTitle.trim() || adding}
                      className="flex-1"
                    >
                      Add Task
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setQuickAddFocused(false);
                        setQuickTitle('');
                        setQuickDate('');
                        setQuickTime('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </Card>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Card key={i} className="animate-pulse">
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 bg-gray-200 dark:bg-gray-800 rounded-lg"></div>
                    <div className="flex-1">
                      <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-3/4 mb-2"></div>
                      <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-1/2"></div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <Card className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mb-4">
                <span className="text-3xl">✨</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Nothing here yet
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-1">
                Add your first task above ↑
              </p>
              <p className="text-sm text-gray-500">
                Or use Brain Dump to capture multiple tasks at once
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Incomplete Tasks */}
              {incompleteTasks.length > 0 && (
                <div className="space-y-2">
                  {incompleteTasks.map((task) => (
                    <Card
                      key={task.id}
                      className={`transition-all duration-200 hover:border-blue-500/50 dark:hover:border-blue-700/50 ${
                        animatingTasks.has(task.id) 
                          ? 'opacity-50 scale-95' 
                          : 'opacity-100 scale-100'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleTask(task)}
                          className="flex-shrink-0 mt-0.5 h-11 w-11 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 transition-all flex items-center justify-center cursor-pointer"
                          aria-label={`Mark "${task.title}" as complete`}
                        >
                          {task.is_done && (
                            <svg
                              className="w-6 h-6 text-blue-500"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={3}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </button>

                        <div className="flex-1 min-w-0 pt-1">
                          <p className="text-gray-900 dark:text-white font-medium mb-1">
                            {task.title}
                          </p>
                          
                          <div className="flex items-center gap-2 flex-wrap">
                            {task.due_date && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-700 dark:text-gray-300">
                                📅 {formatDate(task.due_date)}
                              </span>
                            )}
                            {task.due_time && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-700 dark:text-gray-300">
                                🕐 {formatTime(task.due_time)}
                              </span>
                            )}
                            {task.category && (
                              <span className="inline-flex items-center px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700/50 rounded text-xs text-blue-700 dark:text-blue-300">
                                {task.category}
                              </span>
                            )}
                          </div>

                          {task.notes && (
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                              {task.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Completed Tasks */}
              {completedTasks.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide px-1">
                    Completed
                  </h2>
                  {completedTasks.map((task) => (
                    <Card
                      key={task.id}
                      className={`transition-all duration-200 opacity-60 hover:opacity-80 ${
                        animatingTasks.has(task.id) 
                          ? 'scale-95' 
                          : 'scale-100'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleTask(task)}
                          className="flex-shrink-0 mt-0.5 h-11 w-11 rounded-xl border-2 border-blue-600 bg-blue-600 hover:bg-blue-700 hover:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 transition-all flex items-center justify-center cursor-pointer"
                          aria-label={`Mark "${task.title}" as incomplete`}
                        >
                          <svg
                            className="w-6 h-6 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </button>

                        <div className="flex-1 min-w-0 pt-1">
                          <p className="text-gray-500 dark:text-gray-600 font-medium mb-1 line-through">
                            {task.title}
                          </p>
                          
                          {(task.due_date || task.due_time || task.category) && (
                            <div className="flex items-center gap-2 flex-wrap">
                              {task.due_date && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-200 dark:bg-gray-800/50 rounded text-xs text-gray-500">
                                  📅 {formatDate(task.due_date)}
                                </span>
                              )}
                              {task.due_time && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-200 dark:bg-gray-800/50 rounded text-xs text-gray-500">
                                  🕐 {formatTime(task.due_time)}
                                </span>
                              )}
                              {task.category && (
                                <span className="inline-flex items-center px-2 py-0.5 bg-gray-200 dark:bg-gray-800/50 rounded text-xs text-gray-500">
                                  {task.category}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}

