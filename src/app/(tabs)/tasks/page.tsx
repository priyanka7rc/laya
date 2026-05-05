"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { FirstRunDemo } from "@/components/FirstRunDemo";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card, Button, Chip } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { trackTaskToggle } from "@/lib/analytics";
import { getFirstRunDemoSeen, markFirstRunDemoSeen } from "@/lib/firstRunDemo";
import { getCurrentAppUser } from "@/lib/users/linking";
import { ConfirmInferenceBadge } from "@/components/ConfirmInferenceBadge";
import { ImportTasksModal } from "@/components/ImportTasksModal";
import { CreateTaskModal } from "@/components/CreateTaskModal";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import TaskForm from "@/components/TaskForm";
import { TaskViewTask } from "@/lib/taskView/contracts";
import { supabase } from "@/lib/supabaseClient";

type FilterChip = string;

type Task = TaskViewTask & {
  inferred_date?: boolean;
  inferred_time?: boolean;
  notes?: string | null;
  is_done?: boolean;
};

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Returns a combined date+time label such as "Today · 3:00 PM" or "in 3 days · 9:00 AM" */
function formatDueLabel(due_date: string | null | undefined, due_time: string | null | undefined): string | null {
  if (!due_date && !due_time) return null;

  let dateLabel = "";
  if (due_date) {
    const [year, month, day] = due_date.split("-").map(Number);
    const taskDate = new Date(year, month - 1, day);
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    const diffMs = taskDate.getTime() - todayDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      dateLabel = "Today";
    } else if (diffDays === 1) {
      dateLabel = "Tomorrow";
    } else if (diffDays > 1 && diffDays < 7) {
      dateLabel = `in ${diffDays} days`;
    } else if (diffDays >= 7 && diffDays < 28) {
      const weeks = Math.round(diffDays / 7);
      dateLabel = `in ${weeks} ${weeks === 1 ? "week" : "weeks"}`;
    } else if (diffDays >= 28) {
      const months = Math.round(diffDays / 30);
      dateLabel = `in ${months} ${months === 1 ? "month" : "months"}`;
    } else {
      // Past date — full readable format
      dateLabel = taskDate.toLocaleDateString("en-US", {
        month: "long",
        day: "2-digit",
        year: "numeric",
      });
    }
  }

  let timeLabel = "";
  if (due_time) {
    const [hours, minutes] = due_time.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    timeLabel = `${displayHour}:${minutes} ${ampm}`;
  }

  if (dateLabel && timeLabel) return `${dateLabel} · ${timeLabel}`;
  if (dateLabel) return dateLabel;
  return timeLabel || null;
}

export default function TasksPage() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [animatingTasks, setAnimatingTasks] = useState<Set<string>>(new Set());

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterChip>("All");

  const lastDeletedRef = useRef<{ taskIds: string[]; deletedAt: number } | null>(null);
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const [todayExpanded, setTodayExpanded] = useState(true);
  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
  const [doneExpanded, setDoneExpanded] = useState(true);

  // Per-section show-all toggle (initially capped at SECTION_LIMIT)
  const SECTION_LIMIT = 10;
  const [sectionShowAll, setSectionShowAll] = useState<Record<string, boolean>>({});

  // Inline expansion / delete confirm
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [reminderTaskId, setReminderTaskId] = useState<string | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<Task | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [demoReady, setDemoReady] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  const PAGE_LIMIT = 50;
  const todayStr = getTodayStr();

  const fetchTasks = async (
    term?: string,
    opts?: { cursor?: string | null; append?: boolean }
  ) => {
    const { cursor, append } = opts ?? {};
    try {
      if (!user) return;
      if (!append) setLoading(true);

      const appUser = await getCurrentAppUser();
      if (!appUser) {
        if (!append) setTasks([]);
        setNextCursor(null);
        setHasMore(false);
        return;
      }

      const trimmed = (term ?? searchTerm).trim();
      const { data: { session } } = await supabase.auth.getSession();
      const taskHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) taskHeaders["Authorization"] = `Bearer ${session.access_token}`;

      const res = await fetch("/api/tasks/view", {
        method: "POST",
        headers: taskHeaders,
        body: JSON.stringify({
          view: trimmed ? "search" : "all",
          filters: {
            status: "active",
            ...(trimmed ? { term: trimmed } : {}),
          },
          pagination: {
            limit: PAGE_LIMIT,
            cursor: cursor ?? undefined,
          },
        }),
      });
      const result = res.ok ? await res.json() : { tasks: [], pageInfo: { hasMore: false, nextCursor: null } };

      setNextCursor(result.pageInfo?.nextCursor ?? null);
      setHasMore(result.pageInfo?.hasMore ?? false);

      setTasks((prev) => {
        const incoming = result.tasks as Task[];
        if (!append) return incoming;
        const byId = new Map<string, Task>();
        prev.forEach((t) => byId.set(t.id, t));
        incoming.forEach((t) => byId.set(t.id, t));
        return Array.from(byId.values());
      });
    } catch (err: unknown) {
      console.error("Error fetching tasks:", err);
      toast.error("Try again");
    } finally {
      if (!opts?.append) setLoading(false);
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

  useEffect(() => {
    let mounted = true;
    if (authLoading || !user) return;
    void getFirstRunDemoSeen("tasks").then((seen) => {
      if (!mounted) return;
      setShowDemo(!seen);
      setDemoReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [authLoading, user]);

  const dismissDemo = () => {
    setShowDemo(false);
    void markFirstRunDemoSeen("tasks");
  };

  // Deep-link support: /tasks#catch-up or /tasks#upcoming
  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash;
    if (hash === "#catch-up") {
      setOverdueExpanded(true);
      setTimeout(() => {
        document.getElementById("catch-up")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } else if (hash === "#upcoming") {
      setUpcomingExpanded(true);
      setTimeout(() => {
        document.getElementById("upcoming")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [loading]);

  const handleUndoDelete = async () => {
    const last = lastDeletedRef.current;
    if (!last) return;
    const elapsed = Date.now() - last.deletedAt;
    if (elapsed > 5 * 60 * 1000) {
      toast.error("Couldn't undo — deletions expire after 5 minutes.");
      lastDeletedRef.current = null;
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/tasks/undo-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ taskIds: last.taskIds }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.restoredIds?.length) {
        toast.error("Couldn't undo.");
        return;
      }
      lastDeletedRef.current = null;
      toast.success("Task restored");
      fetchTasks(searchTerm, { cursor: null, append: false });
    } catch (err: unknown) {
      console.error("Error undoing delete:", err);
      toast.error("Try again");
    }
  };

  const handleDeleteTask = async (task: Task) => {
    const previousTasks = [...tasks];
    setTasks((prev) => prev.filter((t) => t.id !== task.id));

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/tasks/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ taskId: task.id }),
      });

      if (!res.ok) throw new Error("Delete request failed");

      lastDeletedRef.current = { taskIds: [task.id], deletedAt: Date.now() };
      toast({
        title: "Task deleted",
        variant: "success",
        duration: 8000,
        action: { label: "Undo", onClick: handleUndoDelete },
      });
    } catch (err: unknown) {
      console.error("Error deleting task:", err);
      setTasks(previousTasks);
      toast.error("Couldn't save changes");
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

    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch('/api/tasks/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ taskId, inferred_date: false, inferred_time: false }),
      });
    } catch (err) {
      console.error('[handleConfirmInference] failed to persist to DB', err);
    }
  };

  const handleSetReminder = async (task: Task, offsetMs: number) => {
    if (!task.dueAt) return;
    const remindAt = new Date(new Date(task.dueAt).getTime() - offsetMs).toISOString();
    const { error } = await supabase.from("tasks").update({ remind_at: remindAt }).eq("id", task.id);
    if (error) {
      toast.error("Couldn't set reminder");
    } else {
      toast.success("Reminder set");
    }
    setExpandedTaskId(null);
    setReminderTaskId(null);
  };

  const handleReschedule = async () => {
    if (!deleteConfirmTask || !rescheduleDate) return;
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/tasks/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ taskId: deleteConfirmTask.id, due_date: rescheduleDate }),
    });
    if (res.ok) {
      setTasks((prev) =>
        prev.map((t) => t.id === deleteConfirmTask.id ? { ...t, due_date: rescheduleDate } : t)
      );
      toast.success("Task rescheduled");
    } else {
      toast.error("Couldn't reschedule");
    }
    setDeleteConfirmTask(null);
    setRescheduleDate("");
  };

  const toggleTask = async (task: Task) => {
    const newStatus = !task.is_done;
    const previousTasks = [...tasks];
    setAnimatingTasks((prev) => new Set(prev).add(task.id));
    setTimeout(() => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, is_done: newStatus } : t
        )
      );
      setAnimatingTasks((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }, 200);

    try {
      const { error } = await supabase
        .from("tasks")
        .update({ is_done: newStatus, status: newStatus ? 'completed' : 'active' })
        .eq("id", task.id);
      if (error) throw error;
      trackTaskToggle(task.id, newStatus);
      if (newStatus) {
        toast({ title: "Task updated", variant: "success", duration: 5000 });
      }
    } catch (err: unknown) {
      console.error("Error toggling task:", err);
      setTasks(previousTasks);
      toast.error("Try again");
    }
  };

  // Client-side grouping (presentation only)
  const overdue = tasks.filter(
    (t) => !t.is_done && t.due_date && t.due_date < todayStr
  );
  const todayTasks = tasks.filter(
    (t) => !t.is_done && t.due_date && t.due_date === todayStr
  );
  const upcoming = tasks.filter(
    (t) =>
      !t.is_done && (!t.due_date || t.due_date > todayStr)
  );
  const completed = tasks.filter((t) => t.is_done);

  const categories = [
    ...new Set(tasks.map((t) => t.category).filter((c): c is string => Boolean(c))),
  ].sort();
  const filterChips: FilterChip[] = ["All", ...categories];

  const filteredOverdue   = activeFilter === "All" ? overdue   : overdue.filter((t) => t.category === activeFilter);
  const filteredToday     = activeFilter === "All" ? todayTasks : todayTasks.filter((t) => t.category === activeFilter);
  const filteredUpcoming  = activeFilter === "All" ? upcoming   : upcoming.filter((t) => t.category === activeFilter);
  const filteredCompleted = activeFilter === "All" ? completed  : completed.filter((t) => t.category === activeFilter);

  const inputBase =
    "w-full px-4 py-3 rounded-xl bg-card border border-border text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring input-mobile";

  const REMINDER_OPTIONS = [
    { label: "15 min", ms: 15 * 60 * 1000 },
    { label: "30 min", ms: 30 * 60 * 1000 },
    { label: "1 hour", ms: 60 * 60 * 1000 },
    { label: "2 hours", ms: 2 * 60 * 60 * 1000 },
    { label: "1 day", ms: 24 * 60 * 60 * 1000 },
  ];

  const TaskRow = ({
    task,
    isCompleted,
  }: {
    task: Task;
    isCompleted: boolean;
  }) => {
    const isExpanded = expandedTaskId === task.id;
    const isReminderMode = reminderTaskId === task.id;
    const dueLabel = formatDueLabel(task.due_date, task.due_time);

    return (
      <div className={`transition-all ${animatingTasks.has(task.id) ? "opacity-50 scale-[0.99]" : ""}`}>
        {/* Main card */}
        <div
          className={`flex items-center gap-3 bg-card border border-border shadow-sm lg:shadow-none p-4 lg:py-2.5 lg:px-4 transition-colors lg:hover:bg-muted/30 lg:cursor-pointer ${
            isExpanded ? "rounded-t-xl border-b-0" : "rounded-xl"
          }`}
          onClick={() => {
            if (isExpanded) {
              setExpandedTaskId(null);
              setReminderTaskId(null);
            } else {
              setExpandedTaskId(task.id);
              setReminderTaskId(null);
            }
          }}
        >
          {/* Checkbox */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleTask(task); }}
            className="tap-target lg:min-w-0 lg:min-h-0 relative flex items-center justify-center shrink-0"
            aria-label={isCompleted ? `Mark "${task.title}" as incomplete` : `Mark "${task.title}" as complete`}
          >
            <span className={`w-5 h-5 lg:w-[22px] lg:h-[22px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
              isCompleted
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40 hover:border-primary"
            }`}>
              {isCompleted && (
                <svg className="w-3 h-3 lg:w-3 lg:h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
          </button>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className={`font-medium text-sm leading-snug truncate ${isCompleted ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {task.title}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <svg className="w-3 h-3 text-muted-foreground/50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className={`text-xs ${dueLabel ? "text-muted-foreground" : "text-muted-foreground/40 italic"}`}>
                {dueLabel ?? "No date"}
              </span>
            </div>
            {(task.inferred_date || task.inferred_time) && (
              <div className="mt-1">
                <ConfirmInferenceBadge
                  inferred_date={task.inferred_date ?? false}
                  inferred_time={task.inferred_time ?? false}
                  taskId={task.id}
                  onConfirmed={handleConfirmInference}
                />
              </div>
            )}
          </div>

          {/* Right side: category chip + expand + trash — unified for mobile and desktop */}
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {task.category && (
              <Chip variant="category" className="text-xs py-0.5 px-2.5 hidden sm:inline-flex mr-1">
                {task.category}
              </Chip>
            )}

            {/* Expand icon — opens Task Detail modal */}
            <button
              onClick={(e) => { e.stopPropagation(); setDetailTaskId(task.id); }}
              className="flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Open task details"
            >
              {/* Two-arrow expand icon */}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7" />
              </svg>
            </button>

            {/* Trash icon — delete */}
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteConfirmTask(task); }}
              className="flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
              aria-label="Delete task"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Inline expansion panel (mobile + desktop) */}
        {isExpanded && (
          <div className="border border-t-0 border-border rounded-b-xl bg-card overflow-hidden">
            {isReminderMode ? (
              <div className="p-4">
                <p className="text-sm font-medium text-foreground mb-1">Set a reminder</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Remind me before{task.due_time ? ` ${formatDueLabel(null, task.due_time)}` : " the task"}
                </p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {REMINDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => handleSetReminder(task, opt.ms)}
                      className="px-3 py-1.5 rounded-full border border-border text-sm text-foreground hover:bg-primary/10 hover:border-primary hover:text-primary transition-colors"
                    >
                      {opt.label} before
                    </button>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => { setExpandedTaskId(null); setReminderTaskId(null); }}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <TaskForm
                  editTask={task}
                  panelMode
                  onSuccess={() => { setExpandedTaskId(null); fetchTasks(); }}
                  onError={(msg) => toast.error(msg)}
                />
                <div className="flex gap-2 pt-3 border-t border-border mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const form = document.getElementById("desktop-edit-form") as HTMLFormElement | null;
                      form?.requestSubmit();
                    }}
                    className="flex-1 h-9 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedTaskId(null)}
                    className="h-9 px-4 text-sm text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const TaskGroup = ({
    title,
    count,
    children,
    variant = "default",
    collapsible = false,
    collapsed = false,
    onToggle,
    id,
  }: {
    title: string;
    count: number;
    children: React.ReactNode;
    variant?: "default" | "overdue";
    collapsible?: boolean;
    collapsed?: boolean;
    onToggle?: () => void;
    id?: string;
  }) => (
    <div className="space-y-3" id={id}>
      <div
        className={`flex items-center gap-2 px-1 ${collapsible ? "cursor-pointer select-none" : ""}`}
        onClick={collapsible ? onToggle : undefined}
      >
        {collapsible && (
          <svg
            className={`w-3.5 h-3.5 shrink-0 transition-transform ${
              variant === "overdue" ? "text-destructive" : "text-muted-foreground"
            } ${collapsed ? "" : "rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
        <h2
          className={`text-sm font-medium uppercase tracking-wide shrink-0 ${
            variant === "overdue"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {title}
        </h2>
        <span className="text-xs font-medium bg-muted text-muted-foreground rounded-full px-2 py-0.5 shrink-0">
          {count}
        </span>
        <div className="flex-1 h-px bg-border/40" />
      </div>
      {!collapsed && (
        <div className="space-y-2 lg:space-y-1.5">{children}</div>
      )}
    </div>
  );

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors">
        <main className="w-full max-w-2xl lg:max-w-3xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
          {/* Header row */}
          <div className="mb-4 lg:mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl lg:text-4xl font-semibold text-foreground tracking-tight">
                Tasks
              </h1>
              <p className="text-muted-foreground text-sm mt-1 hidden lg:block">
                {overdue.length + todayTasks.length + upcoming.length} active ·{" "}
                {completed.length} completed
                {overdue.length > 0 && (
                  <span className="text-destructive ml-1">· {overdue.length} overdue</span>
                )}
              </p>
            </div>
            {/* Desktop: search + New Task in header */}
            <div className="hidden lg:flex items-center gap-3">
              <div className="relative w-64">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  type="search"
                  placeholder="Search tasks..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`${inputBase} pl-9 w-full !py-1.5 focus:ring-2 focus:ring-primary/20`}
                />
              </div>
              <Button
                type="button"
                onClick={() => setCreateModalOpen(true)}
                className="shrink-0"
                title="Add a new task"
              >
                + New Task
              </Button>
            </div>
          </div>

          {/* Mobile-only search bar */}
          <div className="mb-4 lg:hidden">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="search"
                placeholder="Search tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`${inputBase} pl-9 w-full !py-1.5`}
              />
            </div>
          </div>

          <ImportTasksModal
            isOpen={importModalOpen}
            onClose={() => setImportModalOpen(false)}
            onSuccess={fetchTasks}
            getToken={async () => {
              const {
                data: { session },
              } = await supabase.auth.getSession();
              return session?.access_token ?? null;
            }}
            toast={toast}
          />

          <CreateTaskModal
            isOpen={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            onSuccess={() => { setCreateModalOpen(false); fetchTasks(); }}
            toast={toast}
          />

          <TaskDetailModal
            taskId={detailTaskId}
            onClose={() => setDetailTaskId(null)}
            onSuccess={() => { setDetailTaskId(null); fetchTasks(); }}
            toast={toast}
          />

          {/* Filter chips */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-6 -mx-1 px-1 scrollbar-hide">
            {filterChips.map((chip) => (
              <Chip
                key={chip}
                variant="filter"
                selected={activeFilter === chip}
                onClick={() => { setActiveFilter(chip); setSectionShowAll({}); }}
              >
                {chip}
              </Chip>
            ))}
          </div>

          {/* Content */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <div className="flex items-start gap-4 py-4 px-5">
                    <div className="h-6 w-6 rounded-md bg-muted shrink-0" />
                    <div className="flex-1">
                      <div className="h-5 bg-muted rounded w-3/4 mb-2" />
                      <div className="h-4 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <Card className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
                <span className="text-3xl">✨</span>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                {searchTerm.trim() ? "No matching tasks" : "Nothing here yet"}
              </h3>
              <p className="text-muted-foreground mb-1">
                {searchTerm.trim()
                  ? "Try a different search"
                  : "Add your first task above"}
              </p>
              {!searchTerm.trim() && (
                <p className="text-sm text-muted-foreground">
                  Or use Brain Dump or Import from image
                </p>
              )}
            </Card>
          ) : (
            <div className="space-y-6">
              {filteredToday.length > 0 && (
                <TaskGroup
                  title="TODAY"
                  count={filteredToday.length}
                  collapsible
                  collapsed={!todayExpanded}
                  onToggle={() => setTodayExpanded((v) => !v)}
                >
                  {(sectionShowAll["today"] ? filteredToday : filteredToday.slice(0, SECTION_LIMIT)).map((task) => (
                    <TaskRow key={task.id} task={task} isCompleted={false} />
                  ))}
                  {!sectionShowAll["today"] && filteredToday.length > SECTION_LIMIT && (
                    <button
                      onClick={() => setSectionShowAll((s) => ({ ...s, today: true }))}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
                    >
                      Show {filteredToday.length - SECTION_LIMIT} more
                    </button>
                  )}
                  {sectionShowAll["today"] && hasMore && (
                    <button
                      onClick={() => fetchTasks(searchTerm, { cursor: nextCursor, append: true })}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
                    >
                      Load more
                    </button>
                  )}
                </TaskGroup>
              )}
              {filteredUpcoming.length > 0 && (
                <TaskGroup
                  id="upcoming"
                  title="UPCOMING"
                  count={filteredUpcoming.length}
                  collapsible
                  collapsed={!upcomingExpanded}
                  onToggle={() => setUpcomingExpanded((v) => !v)}
                >
                  {(sectionShowAll["upcoming"] ? filteredUpcoming : filteredUpcoming.slice(0, SECTION_LIMIT)).map((task) => (
                    <TaskRow key={task.id} task={task} isCompleted={false} />
                  ))}
                  {!sectionShowAll["upcoming"] && filteredUpcoming.length > SECTION_LIMIT && (
                    <button
                      onClick={() => setSectionShowAll((s) => ({ ...s, upcoming: true }))}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
                    >
                      Show {filteredUpcoming.length - SECTION_LIMIT} more
                    </button>
                  )}
                  {sectionShowAll["upcoming"] && hasMore && (
                    <button
                      onClick={() => fetchTasks(searchTerm, { cursor: nextCursor, append: true })}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
                    >
                      Load more
                    </button>
                  )}
                </TaskGroup>
              )}
              {filteredOverdue.length > 0 && (
                <TaskGroup
                  id="catch-up"
                  title="OVERDUE"
                  count={filteredOverdue.length}
                  variant="overdue"
                  collapsible
                  collapsed={!overdueExpanded}
                  onToggle={() => setOverdueExpanded((v) => !v)}
                >
                  {(sectionShowAll["overdue"] ? filteredOverdue : filteredOverdue.slice(0, SECTION_LIMIT)).map((task) => (
                    <TaskRow key={task.id} task={task} isCompleted={false} />
                  ))}
                  {!sectionShowAll["overdue"] && filteredOverdue.length > SECTION_LIMIT && (
                    <button
                      onClick={() => setSectionShowAll((s) => ({ ...s, overdue: true }))}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
                    >
                      Show {filteredOverdue.length - SECTION_LIMIT} more
                    </button>
                  )}
                  {sectionShowAll["overdue"] && hasMore && (
                    <button
                      onClick={() => fetchTasks(searchTerm, { cursor: nextCursor, append: true })}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
                    >
                      Load more
                    </button>
                  )}
                </TaskGroup>
              )}
              {filteredCompleted.length > 0 && (
                <TaskGroup
                  title="DONE"
                  count={filteredCompleted.length}
                  collapsible
                  collapsed={!doneExpanded}
                  onToggle={() => setDoneExpanded((v) => !v)}
                >
                  {(sectionShowAll["done"] ? filteredCompleted : filteredCompleted.slice(0, SECTION_LIMIT)).map((task) => (
                    <TaskRow key={task.id} task={task} isCompleted />
                  ))}
                  {!sectionShowAll["done"] && filteredCompleted.length > SECTION_LIMIT && (
                    <button
                      onClick={() => setSectionShowAll((s) => ({ ...s, done: true }))}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
                    >
                      Show {filteredCompleted.length - SECTION_LIMIT} more
                    </button>
                  )}
                  {sectionShowAll["done"] && hasMore && (
                    <button
                      onClick={() => fetchTasks(searchTerm, { cursor: nextCursor, append: true })}
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
                    >
                      Load more
                    </button>
                  )}
                </TaskGroup>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirmTask && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          onClick={() => { setDeleteConfirmTask(null); setRescheduleDate(""); }}
        >
          <div className="absolute inset-0 bg-overlay" aria-hidden />
          <div
            className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl border border-border p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground mb-1">Delete or reschedule?</h3>
            <p className="text-sm text-muted-foreground mb-5 leading-snug line-clamp-2">
              &ldquo;{deleteConfirmTask.title}&rdquo;
            </p>

            {rescheduleDate !== undefined && (
              <div className="mb-4">
                <label className="block text-xs text-muted-foreground mb-1.5">New due date</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { handleDeleteTask(deleteConfirmTask); setDeleteConfirmTask(null); setRescheduleDate(""); }}
                className="flex-1 h-10 bg-destructive text-destructive-foreground text-sm font-medium rounded-xl hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
              {rescheduleDate ? (
                <button
                  type="button"
                  disabled={!rescheduleDate}
                  onClick={handleReschedule}
                  className="flex-1 h-10 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  Confirm Reschedule
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setRescheduleDate(deleteConfirmTask.due_date ?? "")}
                  className="flex-1 h-10 border border-border text-sm text-foreground rounded-xl hover:bg-muted transition-colors"
                >
                  Reschedule
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setDeleteConfirmTask(null); setRescheduleDate(""); }}
              className="w-full mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <FirstRunDemo
        page="tasks"
        isOpen={demoReady && showDemo}
        onComplete={dismissDemo}
        onSkip={dismissDemo}
      />
    </ProtectedRoute>
  );
}
