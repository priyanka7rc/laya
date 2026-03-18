"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card, Button, Chip } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { trackTaskToggle, trackTaskAdd } from "@/lib/analytics";
import { getCurrentAppUser } from "@/lib/users/linking";
import { ConfirmInferenceBadge } from "@/components/ConfirmInferenceBadge";
import { ImportTasksModal } from "@/components/ImportTasksModal";
import TaskForm from "@/components/TaskForm";
import { executeTaskView } from "@/server/taskView/taskViewEngine";
import { TaskViewTask } from "@/lib/taskView/contracts";
import { supabase } from "@/lib/supabaseClient";

const TITLE_MAX_LENGTH = 120;

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

export default function TasksPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [quickAddFocused, setQuickAddFocused] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDate, setQuickDate] = useState("");
  const [quickTime, setQuickTime] = useState("");
  const [adding, setAdding] = useState(false);
  const [addAnywayPending, setAddAnywayPending] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const [animatingTasks, setAnimatingTasks] = useState<Set<string>>(new Set());

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterChip>("All");

  const lastDeletedRef = useRef<{ taskIds: string[]; deletedAt: number } | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const [todayExpanded, setTodayExpanded] = useState(true);
  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
  const [doneExpanded, setDoneExpanded] = useState(true);

  // Meatball menu / inline expansion / delete confirm
  const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [reminderTaskId, setReminderTaskId] = useState<string | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<Task | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");

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
      const result = await executeTaskView({
        identity: { kind: "appUserId", appUserId: appUser.id },
        view: trimmed ? "search" : "all",
        filters: {
          status: "active",
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

  const handleQuickAdd = async (
    e?: React.FormEvent,
    opts?: { allowDuplicate?: boolean }
  ) => {
    e?.preventDefault();
    const allowDuplicate = opts?.allowDuplicate ?? false;
    const trimmedInput = quickTitle.trim();

    if (!trimmedInput) {
      toast.error("Task title required");
      return;
    }
    if (trimmedInput.length > TITLE_MAX_LENGTH) {
      toast.error(`Task title must be ${TITLE_MAX_LENGTH} characters or less`);
      return;
    }
    if (/[\r\n]/.test(quickTitle)) {
      toast.error("Task title cannot contain line breaks");
      return;
    }

    setAdding(true);
    try {
      let appUserId: string | null = null;
      try {
        const appUser = await getCurrentAppUser();
        appUserId = appUser?.id ?? null;
      } catch {
        // non-blocking
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
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
        toast.error(data.error || "Couldn't save changes");
        return;
      }

      const { inserted, duplicates } = data;
      if (duplicates?.length > 0 && (!inserted || inserted.length === 0)) {
        toast.error("This task was just added.");
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
          return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        });
        setTasks(sorted);

        setQuickTitle("");
        setQuickDate("");
        setQuickTime("");
        setQuickAddFocused(false);
        setAddAnywayPending(false);

        toast.success("Task created");
        if (proposed?.inferred_date || proposed?.inferred_time) {
          const timeStr = (newRow.due_time || "").slice(0, 5);
          toast({
            title: `Scheduled for ${newRow.due_date} ${timeStr}. Tap Confirm to verify.`,
            variant: "info",
            duration: 5000,
          });
        }
        trackTaskAdd();
        titleInputRef.current?.focus();
      }
    } catch (err: unknown) {
      console.error("Error adding task:", err);
      toast.error("Couldn't save changes");
    } finally {
      setAdding(false);
    }
  };

  const handleAddAnyway = () => {
    setAddAnywayPending(false);
    handleQuickAdd(undefined, { allowDuplicate: true });
  };

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
    setOpenMenuTaskId(null);
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
        .update({ is_done: newStatus })
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

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const formatTime = (timeString: string | null) => {
    if (!timeString) return null;
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
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

  // Derive unique category values from fetched tasks for dynamic filter chips
  const categories = [
    ...new Set(tasks.map((t) => t.category).filter((c): c is string => Boolean(c))),
  ].sort();
  const filterChips: FilterChip[] = ["All", ...categories];

  // Filter each group by active category chip ("All" shows everything)
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
    const isMenuOpen = openMenuTaskId === task.id;
    const isReminderMode = reminderTaskId === task.id;

    return (
      <div className={`transition-all ${animatingTasks.has(task.id) ? "opacity-50 scale-[0.99]" : ""}`}>
        {/* Main card */}
        <div
          className={`flex items-center gap-3 bg-card border border-border shadow-sm p-4 transition-colors ${
            isExpanded ? "rounded-t-xl border-b-0" : "rounded-xl"
          }`}
        >
          {/* Checkbox */}
          <button
            onClick={() => toggleTask(task)}
            className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors tap-target ${
              isCompleted
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40 hover:border-primary"
            }`}
            aria-label={isCompleted ? `Mark "${task.title}" as incomplete` : `Mark "${task.title}" as complete`}
          >
            {isCompleted && (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className={`font-medium text-sm leading-snug ${isCompleted ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {task.title}
            </p>
            {task.due_time && (
              <div className="flex items-center gap-1 mt-0.5">
                <svg className="w-3 h-3 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                <span className="text-xs text-muted-foreground">{formatTime(task.due_time)}</span>
              </div>
            )}
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

          {/* Right side: category + meatball */}
          <div className="flex items-center gap-2 shrink-0">
            {task.category && (
              <Chip variant="category" className="text-xs py-0.5 px-2.5">
                {task.category}
              </Chip>
            )}
            {/* Meatball menu */}
            <div className="relative">
              <button
                onClick={() => setOpenMenuTaskId(isMenuOpen ? null : task.id)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                aria-label="Task options"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="5" cy="12" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="19" cy="12" r="1.5" />
                </svg>
              </button>
              {isMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 bg-card border border-border rounded-xl shadow-lg py-1 w-44">
                  <button
                    onClick={() => {
                      setExpandedTaskId(task.id);
                      setReminderTaskId(task.id);
                      setOpenMenuTaskId(null);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                    </svg>
                    Set Reminder
                  </button>
                  <button
                    onClick={() => {
                      setExpandedTaskId(task.id);
                      setReminderTaskId(null);
                      setOpenMenuTaskId(null);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>
                  <div className="my-1 h-px bg-border/60" />
                  <button
                    onClick={() => {
                      setDeleteConfirmTask(task);
                      setOpenMenuTaskId(null);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Inline expansion panel */}
        {isExpanded && (
          <div className="border border-t-0 border-border rounded-b-xl bg-card overflow-hidden">
            {isReminderMode ? (
              <div className="p-4">
                <p className="text-sm font-medium text-foreground mb-1">Set a reminder</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Remind me before{task.due_time ? ` ${formatTime(task.due_time)}` : " the task"}
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
    useCardPerTask = false,
    collapsible = false,
    collapsed = false,
    onToggle,
  }: {
    title: string;
    count: number;
    children: React.ReactNode;
    variant?: "default" | "overdue";
    useCardPerTask?: boolean;
    collapsible?: boolean;
    collapsed?: boolean;
    onToggle?: () => void;
  }) => (
    <div className="space-y-3">
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
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors">
          <main className="w-full max-w-md lg:max-w-7xl mx-auto px-4 lg:px-8 py-6 lg:py-10">
          {/* Header row: title left, search + New Task right on desktop; title only on mobile */}
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
                onClick={() => titleInputRef.current?.focus()}
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

          {/* Quick Add */}
          <Card
            className="mb-6 p-1 overflow-hidden shadow-sm cursor-text"
            onClick={() => titleInputRef.current?.focus()}
          >
            <form onSubmit={handleQuickAdd} className="flex items-center gap-3 px-4 py-1.5" onClick={(e) => e.stopPropagation()}>
              <div className="w-10 flex justify-center text-primary shrink-0">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </div>
              <input
                ref={titleInputRef}
                type="text"
                value={quickTitle}
                onChange={(e) => {
                  setQuickTitle(e.target.value);
                  setAddAnywayPending(false);
                }}
                onFocus={() => setQuickAddFocused(true)}
                placeholder="Type a task and press Enter..."
                maxLength={TITLE_MAX_LENGTH}
              className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-foreground placeholder-muted-foreground text-base py-0"
            />
          </form>
            {quickAddFocused && (
              <div className="px-4 pb-4 pt-0 space-y-3 animate-slide-down border-t border-border">
                <div className="grid grid-cols-2 gap-3 pt-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={quickDate}
                      onChange={(e) => {
                        setQuickDate(e.target.value);
                        setAddAnywayPending(false);
                      }}
                      className={inputBase}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1.5">
                      Due Time
                    </label>
                    <input
                      type="time"
                      value={quickTime}
                      onChange={(e) => {
                        setQuickTime(e.target.value);
                        setAddAnywayPending(false);
                      }}
                      className={inputBase}
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
                        setQuickTitle("");
                        setQuickDate("");
                        setQuickTime("");
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
          </Card>

          {/* Filter chips (presentation only) */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-6 -mx-1 px-1 scrollbar-hide">
            {filterChips.map((chip) => (
              <Chip
                key={chip}
                variant="filter"
                selected={activeFilter === chip}
                onClick={() => setActiveFilter(chip)}
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
            <div className="flex flex-col lg:flex-row gap-8">
              {/* Task list — order: Today → Upcoming → Overdue (collapsed) → Done */}
              <div className="flex-1 space-y-6 min-w-0">
                {filteredToday.length > 0 && (
                  <TaskGroup
                    title="TODAY"
                    count={filteredToday.length}
                    collapsible
                    collapsed={!todayExpanded}
                    onToggle={() => setTodayExpanded((v) => !v)}
                  >
                    {filteredToday.map((task) => (
                      <TaskRow key={task.id} task={task} isCompleted={false} />
                    ))}
                  </TaskGroup>
                )}
                {filteredUpcoming.length > 0 && (
                  <TaskGroup
                    title="UPCOMING"
                    count={filteredUpcoming.length}
                    collapsible
                    collapsed={!upcomingExpanded}
                    onToggle={() => setUpcomingExpanded((v) => !v)}
                  >
                    {filteredUpcoming.map((task) => (
                      <TaskRow key={task.id} task={task} isCompleted={false} />
                    ))}
                  </TaskGroup>
                )}
                {filteredOverdue.length > 0 && (
                  <TaskGroup
                    title="OVERDUE"
                    count={filteredOverdue.length}
                    variant="overdue"
                    collapsible
                    collapsed={!overdueExpanded}
                    onToggle={() => setOverdueExpanded((v) => !v)}
                  >
                    {filteredOverdue.map((task) => (
                      <TaskRow key={task.id} task={task} isCompleted={false} />
                    ))}
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
                    {filteredCompleted.map((task) => (
                      <TaskRow key={task.id} task={task} isCompleted />
                    ))}
                  </TaskGroup>
                )}
              </div>

              {/* Click-outside overlay to close meatball menus */}
              {openMenuTaskId && (
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setOpenMenuTaskId(null)}
                  aria-hidden
                />
              )}
            </div>
          )}


          {!loading && hasMore && (
            <div className="mt-6 flex justify-center">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  fetchTasks(searchTerm, { cursor: nextCursor, append: true })
                }
                disabled={!nextCursor}
              >
                Load more
              </Button>
            </div>
          )}
        </main>
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirmTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => { setDeleteConfirmTask(null); setRescheduleDate(""); }}
        >
          <div className="absolute inset-0 bg-black/40" aria-hidden />
          <div
            className="relative w-full max-w-sm bg-card rounded-2xl shadow-2xl border border-border p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground mb-1">Delete or reschedule?</h3>
            <p className="text-sm text-muted-foreground mb-5 leading-snug line-clamp-2">
              &ldquo;{deleteConfirmTask.title}&rdquo;
            </p>

            {/* Reschedule date picker (revealed on reschedule click) */}
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
    </ProtectedRoute>
  );
}
