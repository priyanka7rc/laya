"use client";

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Card, Button } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { trackTaskToggle, trackTaskAdd } from '@/lib/analytics';
import { getCurrentAppUser } from '@/lib/users/linking';
import { ConfirmInferenceBadge } from '@/components/ConfirmInferenceBadge';
import { ImportTasksModal } from '@/components/ImportTasksModal';
import TaskForm from '@/components/TaskForm';
import { executeTaskView } from '@/server/taskView/taskViewEngine';
import { TaskViewTask } from '@/lib/taskView/contracts';
import { supabase } from '@/lib/supabaseClient';

const TITLE_MAX_LENGTH = 120;

type Task = TaskViewTask & {
  inferred_date?: boolean;
  inferred_time?: boolean;
  notes?: string | null;
  is_done?: boolean;
};

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
  const [addAnywayPending, setAddAnywayPending] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Animation state for toggled tasks
  const [animatingTasks, setAnimatingTasks] = useState<Set<string>>(new Set());

  // Media import modal
  const [importModalOpen, setImportModalOpen] = useState(false);
  // Search: when non-empty, use view 'search' (debounced)
  const [searchTerm, setSearchTerm] = useState('');
  // Pagination
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Undo delete state
  const lastDeletedRef = useRef<{ taskIds: string[]; deletedAt: number } | null>(null);
  // Edit modal
  const [editTask, setEditTask] = useState<Task | null>(null);

  const PAGE_LIMIT = 50;

  const fetchTasks = async (
    term?: string,
    opts?: { cursor?: string | null; append?: boolean }
  ) => {
    const { cursor, append } = opts ?? {};
    try {
      if (!user) return;
      if (!append) {
        setLoading(true);
      }

      const appUser = await getCurrentAppUser();
      if (!appUser) {
        if (!append) {
          setTasks([]);
        }
        setNextCursor(null);
        setHasMore(false);
        return;
      }

      const trimmed = (term ?? searchTerm).trim();
      const result = await executeTaskView({
        identity: { kind: 'appUserId', appUserId: appUser.id },
        view: trimmed ? 'search' : 'all',
        filters: {
          status: 'active',
          ...(trimmed ? { term: trimmed } : {}),
        },
        pagination: {
          limit: PAGE_LIMIT,
          cursor: cursor ?? undefined,
        },
      });

      setNextCursor(result.pageInfo.nextCursor ?? null);
      setHasMore(result.pageInfo.hasMore);

      setTasks((prev) => {
        const incoming = result.tasks as Task[];
        if (!append) {
          return incoming;
        }
        const byId = new Map<string, Task>();
        prev.forEach((t) => byId.set(t.id, t));
        incoming.forEach((t) => byId.set(t.id, t));
        return Array.from(byId.values());
      });
    } catch (err: any) {
      console.error('Error fetching tasks:', err);
      toast.error('That didn\'t work - want to try again?');
    } finally {
      if (!opts?.append) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!user) return;
    const delay = searchTerm.trim() ? 300 : 0;
    const id = setTimeout(() => {
      fetchTasks(searchTerm, { cursor: null, append: false });
    }, delay);
    return () => clearTimeout(id);
  }, [user, searchTerm]);

  const handleQuickAdd = async (
    e?: React.FormEvent,
    opts?: { allowDuplicate?: boolean }
  ) => {
    e?.preventDefault();

    const allowDuplicate = opts?.allowDuplicate ?? false;

    const trimmedInput = quickTitle.trim();

    if (!trimmedInput) {
      toast.error('Task title required');
      return;
    }
    if (trimmedInput.length > TITLE_MAX_LENGTH) {
      toast.error(`Task title must be ${TITLE_MAX_LENGTH} characters or less`);
      return;
    }
    if (/[\r\n]/.test(quickTitle)) {
      toast.error('Task title cannot contain line breaks');
      return;
    }

    setAdding(true);
    try {
      let appUserId: string | null = null;
      try {
        const appUser = await getCurrentAppUser();
        appUserId = appUser?.id ?? null;
      } catch {
        // Non-blocking: insert with user_id only if app_user unavailable
      }

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          text: trimmedInput,
          due_date: quickDate || undefined,
          due_time: quickTime || undefined,
          allowDuplicate,
          app_user_id: appUserId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to add task');
        return;
      }

      const { inserted, duplicates } = data;
      if (duplicates?.length > 0 && (!inserted || inserted.length === 0)) {
        toast.error('This task was just added.');
        setAddAnywayPending(true);
        return;
      }

      if (inserted?.length > 0) {
        const newRow = inserted[0];
        const proposed = data.proposed?.[0];
        const newTask: Task = {
          ...newRow,
          notes: null,
          is_done: false,
          created_at: new Date().toISOString(),
          inferred_date: proposed?.inferred_date ?? false,
          inferred_time: proposed?.inferred_time ?? false,
        };
        const newTasks = [...tasks, newTask];
        const sorted = newTasks.sort((a, b) => {
          if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
          if (a.due_date !== b.due_date) {
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return a.due_date.localeCompare(b.due_date);
          }
          return (b.created_at ?? '').localeCompare(a.created_at ?? '');
        });
        setTasks(sorted);

        setQuickTitle('');
        setQuickDate('');
        setQuickTime('');
        setQuickAddFocused(false);
        setAddAnywayPending(false);

        const titleForDisplay = newRow.title;
        toast.success('Task added!', titleForDisplay);
        if (proposed?.inferred_date || proposed?.inferred_time) {
          const timeStr = (newRow.due_time || '').slice(0, 5);
          toast({
            title: `Scheduled for ${newRow.due_date} ${timeStr}. Tap Confirm to verify.`,
            variant: 'info',
            duration: 5000,
          });
        }
        trackTaskAdd();
        titleInputRef.current?.focus();
      }
    } catch (err: any) {
      console.error('Error adding task:', err);
      toast.error('Failed to add task', 'Please try again');
    } finally {
      setAdding(false);
    }
  };

  const handleAddAnyway = () => {
    setAddAnywayPending(false);
    handleQuickAdd(undefined, { allowDuplicate: true }); // inserts exactly once with dedupe bypassed
  };

  const handleUndoDelete = async () => {
    const last = lastDeletedRef.current;
    if (!last) return;

    const elapsed = Date.now() - last.deletedAt;
    if (elapsed > 5 * 60 * 1000) {
      toast.error("Couldn't undo — I only keep deletions for 5 minutes.");
      lastDeletedRef.current = null;
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/tasks/undo-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ taskIds: last.taskIds }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.restoredIds?.length) {
        toast.error("Couldn't undo — I only keep deletions for 5 minutes.");
        return;
      }

      lastDeletedRef.current = null;
      toast.success('Restored ✅');
      // Re-fetch page 1 for correctness (avoids stale ordering)
      fetchTasks(searchTerm, { cursor: null, append: false });
    } catch (err: any) {
      console.error('Error undoing delete:', err);
      toast.error("Couldn't undo — please try again.");
    }
  };

  const handleDeleteTask = async (task: Task) => {
    const previousTasks = [...tasks];

    // Optimistic: remove from list immediately
    setTasks((prev) => prev.filter((t) => t.id !== task.id));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/tasks/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ taskId: task.id }),
      });

      if (!res.ok) {
        throw new Error('Delete request failed');
      }

      // Track for undo
      lastDeletedRef.current = { taskIds: [task.id], deletedAt: Date.now() };

      // Show toast with Undo action (stays for 8 seconds to give time to click)
      toast({
        title: 'Deleted ✅',
        variant: 'success',
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: handleUndoDelete,
        },
      });
    } catch (err: any) {
      console.error('Error deleting task:', err);
      // Revert optimistic removal
      setTasks(previousTasks);
      toast.error('Could not delete task. Please try again.');
    }
  };

  const handleConfirmInference = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || (!task.inferred_date && !task.inferred_time)) return;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, inferred_date: false, inferred_time: false } : t
      )
    );

    // Persisting inferred flags is still done via Supabase client
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
      toast.error('That didn\'t work - want to try again?');
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
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2">
                Tasks
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                {incompleteTasks.length} active · {completedTasks.length} completed
              </p>
            </div>
            <div className="w-full sm:w-auto sm:min-w-[200px]">
              <input
                type="search"
                placeholder="Search tasks…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setImportModalOpen(true)}
              className="shrink-0"
              title="Create tasks from a screenshot, photo, or PDF"
            >
              Import from image
            </Button>
          </div>

          <ImportTasksModal
            isOpen={importModalOpen}
            onClose={() => setImportModalOpen(false)}
            onSuccess={fetchTasks}
            getToken={async () => {
              const { data: { session } } = await supabase.auth.getSession();
              return session?.access_token ?? null;
            }}
            toast={toast}
          />

          {/* Quick Add */}
          <Card className="mb-6 border-blue-300/30 dark:border-blue-800/30">
            <form onSubmit={handleQuickAdd}>
              <input
                ref={titleInputRef}
                type="text"
                value={quickTitle}
                onChange={(e) => {
                  setQuickTitle(e.target.value);
                  setAddAnywayPending(false);
                }}
                onFocus={() => setQuickAddFocused(true)}
                placeholder="Add a task…"
                maxLength={TITLE_MAX_LENGTH}
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
                        onChange={(e) => {
                          setQuickDate(e.target.value);
                          setAddAnywayPending(false);
                        }}
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
                        onChange={(e) => {
                          setQuickTime(e.target.value);
                          setAddAnywayPending(false);
                        }}
                        className="w-full h-11 px-3 bg-gray-100 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
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
                          setAddAnywayPending(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                    {addAnywayPending && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleAddAnyway}
                        disabled={adding}
                        className="w-full"
                      >
                        Add anyway
                      </Button>
                    )}
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
                Or use Brain Dump to capture multiple tasks at once, or Import from image for a screenshot or PDF
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
                            {(task.inferred_date || task.inferred_time) && (
                              <ConfirmInferenceBadge
                                inferred_date={task.inferred_date ?? false}
                                inferred_time={task.inferred_time ?? false}
                                taskId={task.id}
                                onConfirmed={handleConfirmInference}
                              />
                            )}
                          </div>

                          {task.notes && (
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                              {task.notes}
                            </p>
                          )}
                        </div>

                        {/* Edit button */}
                        <button
                          onClick={() => setEditTask(task)}
                          className="flex-shrink-0 h-8 w-8 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors flex items-center justify-center"
                          aria-label={`Edit "${task.title}"`}
                          title="Edit task"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {/* Delete button */}
                        <button
                          onClick={() => handleDeleteTask(task)}
                          className="flex-shrink-0 h-8 w-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors flex items-center justify-center"
                          aria-label={`Delete "${task.title}"`}
                          title="Delete task"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
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
                        <button
                          onClick={() => setEditTask(task)}
                          className="flex-shrink-0 h-8 w-8 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-center"
                          aria-label={`Edit "${task.title}"`}
                          title="Edit task"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Edit task modal */}
          {editTask && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setEditTask(null)}>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 flex justify-between items-center border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Edit task</h3>
                  <button type="button" onClick={() => setEditTask(null)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1 rounded">✕</button>
                </div>
                <div className="p-4">
                  <TaskForm
                    editTask={editTask}
                    onSuccess={() => { setEditTask(null); fetchTasks(); }}
                    onError={(msg) => toast.error(msg)}
                  />
                </div>
              </div>
            </div>
          )}

          {!loading && hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="secondary"
                onClick={() => fetchTasks(searchTerm, { cursor: nextCursor, append: true })}
                disabled={!nextCursor}
              >
                Load more
              </Button>
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}

