"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import { FirstRunDemo } from "@/components/FirstRunDemo";
import { Card } from "@/components/ui";
import { useToast } from "@/hooks/useToast";
import { trackTaskToggle } from "@/lib/analytics";
import { getFirstRunDemoSeen, markFirstRunDemoSeen } from "@/lib/firstRunDemo";
import { getCurrentAppUser } from "@/lib/users/linking";
import { TaskViewTask } from "@/lib/taskView/contracts";
import type { ListViewList } from "@/lib/listView/contracts";
import { supabase } from "@/lib/supabaseClient";
import { CreateTaskModal } from "@/components/CreateTaskModal";
import { CreateListModal } from "@/components/CreateListModal";
import {
  MessageSquare,
  ChevronRight,
  emojiForListName,
} from "@/components/Icons";

type TodayTask = TaskViewTask;

function getUpcomingBuckets(tasks: TodayTask[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextMonday = new Date(today);
  const dayOfWeek = today.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 6 ? 2 : 8 - dayOfWeek;
  nextMonday.setDate(today.getDate() + daysUntilMonday);
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextSunday.getDate() + 6);

  let tomorrowCount = 0;
  let weekendCount = 0;
  let nextWeekCount = 0;

  for (const t of tasks) {
    if (!t.due_date || t.is_done) continue;
    const d = new Date(t.due_date);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === tomorrow.getTime()) tomorrowCount++;
    else if (d >= nextMonday && d <= nextSunday) weekendCount++;
    else if (d > tomorrow) nextWeekCount++;
  }
  const thisWeekCount = weekendCount + nextWeekCount;

  return { tomorrowCount, weekendCount, nextWeekCount, thisWeekCount };
}

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<TodayTask[]>([]);
  const [lists, setLists] = useState<ListViewList[]>([]);
  const [loading, setLoading] = useState(true);
  const [isWhatsAppLinked, setIsWhatsAppLinked] = useState(true);
  const [displayName, setDisplayName] = useState<string>("");
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [demoReady, setDemoReady] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    if (user) fetchTodayData();
  }, [user]);

  useEffect(() => {
    let mounted = true;
    if (authLoading || !user) return;
    void getFirstRunDemoSeen("home").then((seen) => {
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
    void markFirstRunDemoSeen("home");
  };

  const fetchTodayData = async () => {
    try {
      const { data: whatsappData } = await supabase
        .from("whatsapp_users")
        .select("auth_user_id")
        .eq("auth_user_id", user?.id)
        .maybeSingle();

      setIsWhatsAppLinked(!!whatsappData);

      const appUser = await getCurrentAppUser();
      if (!appUser) {
        setTodayTasks([]);
        setUpcomingTasks([]);
        setLists([]);
        return;
      }

      if (appUser.display_name) {
        setDisplayName(appUser.display_name);
      } else if (user?.email) {
        const part = user.email.split("@")[0];
        setDisplayName(part.charAt(0).toUpperCase() + part.slice(1));
      }

      const { data: { session } } = await supabase.auth.getSession();
      const taskHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) taskHeaders["Authorization"] = `Bearer ${session.access_token}`;

      const [todayRes, upcomingRes] = await Promise.all([
        fetch("/api/tasks/view", { method: "POST", headers: taskHeaders, body: JSON.stringify({ view: "today" }) }),
        fetch("/api/tasks/view", { method: "POST", headers: taskHeaders, body: JSON.stringify({ view: "upcoming" }) }),
      ]);
      const [todayResult, upcomingResult] = await Promise.all([
        todayRes.ok ? todayRes.json() : { tasks: [] },
        upcomingRes.ok ? upcomingRes.json() : { tasks: [] },
      ]);
      setTodayTasks((todayResult.tasks ?? []) as TodayTask[]);
      setUpcomingTasks((upcomingResult.tasks ?? []) as TodayTask[]);

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const res = await fetch(`/api/lists/view?limit=3`, {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.lists)) {
          setLists(data.lists);
        } else {
          setLists([]);
        }
      } catch {
        setLists([]);
      }
    } catch (err) {
      console.error("Error fetching today data:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleTask = async (taskId: string, currentStatus: boolean) => {
    const updater = (prev: TodayTask[]) =>
      prev.map((t) => (t.id === taskId ? { ...t, is_done: !currentStatus } : t));
    setTodayTasks(updater);
    setUpcomingTasks(updater);

    try {
      const { error } = await supabase
        .from("tasks")
        .update({ is_done: !currentStatus })
        .eq("id", taskId);
      if (error) throw error;
      trackTaskToggle(taskId, !currentStatus);
    } catch (err) {
      console.error("Error updating task:", err);
      const revert = (prev: TodayTask[]) =>
        prev.map((t) => (t.id === taskId ? { ...t, is_done: currentStatus } : t));
      setTodayTasks(revert);
      setUpcomingTasks(revert);
    }
  };

  // Suppress unused warning — toggleTask will be wired to task rows in a future pass
  void toggleTask;

  const formatTime = (timeString: string | null) => {
    if (!timeString) return "";
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  const getDateString = () =>
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  const todayStr = new Date().toISOString().slice(0, 10);
  const incompleteToday = todayTasks.filter((t) => !t.is_done);
  const overdueTasks = incompleteToday.filter(
    (t) => t.due_date && t.due_date < todayStr
  );
  const overdueCount = overdueTasks.length;
  // Only tasks due today (excludes overdue and tasks without any due date that arrived via upcoming)
  const todayOnlyTasks = incompleteToday.filter(
    (t) => !t.due_date || t.due_date >= todayStr
  );

  const incompleteUpcoming = upcomingTasks.filter((t) => !t.is_done);
  const buckets = getUpcomingBuckets(incompleteUpcoming);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors">
        <main className="container mx-auto px-4 lg:px-12 py-8 md:py-12 max-w-md lg:max-w-6xl">
          {/* Header */}
          <header className="mb-8 md:mb-12">
            <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-1">
              {getGreeting()}
              <span className="hidden lg:inline">
                {displayName ? `, ${displayName}` : ""}
              </span>
            </h1>
            <p className="text-muted-foreground text-base mt-2">{getDateString()}</p>
          </header>

          {loading ? (
            <div className="space-y-6">
              <Card className="animate-pulse p-5 rounded-2xl">
                <div className="h-6 bg-muted rounded w-32 mb-4" />
                <div className="space-y-3">
                  <div className="h-12 bg-muted rounded-xl" />
                  <div className="h-12 bg-muted rounded-xl" />
                </div>
              </Card>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
              {/* Left column: Today + On the Horizon */}
              <div className="lg:col-span-7 space-y-6">
                {/* Today card — today-only tasks */}
                <Card className="rounded-2xl p-5 shadow-sm border border-border hover:border-primary/30 transition-colors">
                <div className="flex items-center justify-between mb-4">
                    <Link
                      href="/tasks"
                      className="text-xl font-semibold text-foreground hover:text-primary transition-colors"
                    >
                      Today
                    </Link>
                    <button
                      type="button"
                      onClick={() => setShowCreateTask(true)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      aria-label="Add task"
                      title="Add task"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                  </div>

                  {todayOnlyTasks.length > 0 ? (
                    <>
                      <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                        NEXT UP
                      </h4>
                      <div className="space-y-3">
                        {/* Mobile: one sample row */}
                        <div className="lg:hidden space-y-3">
                          {todayOnlyTasks[0] && (
                            <div className="flex items-start gap-3">
                              <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                              <div className="flex-1">
                                <p className="text-foreground font-medium">
                                  {todayOnlyTasks[0].title}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {todayOnlyTasks[0].due_time
                                    ? formatTime(todayOnlyTasks[0].due_time)
                                    : "Today"}
                                </p>
                              </div>
                            </div>
                  )}
                </div>
                        {/* Desktop: up to 3 task rows */}
                        <div className="hidden lg:block space-y-2">
                          {todayOnlyTasks.slice(0, 3).map((task) => (
                      <div
                        key={task.id}
                              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors"
                            >
                        <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm text-foreground truncate">
                                  {task.title}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {task.due_time ? formatTime(task.due_time) : "Today"}
                                </p>
                              </div>
                              {task.category && (
                                <div className="px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium shrink-0">
                                  {task.category}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No tasks due today</p>
                  )}
                </Card>

                {/* On the Horizon card */}
                <Card className="rounded-2xl p-5 shadow-sm border border-border">
                  <h3 className="text-xl font-semibold text-foreground mb-4">
                    On the Horizon
                  </h3>

                  {/* Catch Up — always visible */}
                  <div className="mb-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Catch Up
                    </p>
                    {/* Desktop: full-width card tile */}
                    <Link
                      href="/tasks#catch-up"
                      className="hidden lg:block p-3 rounded-xl border border-border/50 hover:border-primary/30 transition-colors"
                    >
                      <p className="text-sm font-medium mb-1">Overdue</p>
                      <p className={`text-sm ${overdueCount > 0 ? "text-warning-foreground" : "text-muted-foreground"}`}>
                        {overdueCount} {overdueCount === 1 ? "task" : "tasks"}
                      </p>
                    </Link>
                    {/* Mobile: flex row matching Upcoming rows */}
                    <Link
                      href="/tasks#catch-up"
                      className="flex lg:hidden items-center justify-between py-2"
                    >
                      <span className="text-sm text-foreground">Overdue</span>
                      <span className={`text-sm font-semibold ${overdueCount > 0 ? "text-warning-foreground" : "text-foreground"}`}>
                        {overdueCount} {overdueCount === 1 ? "task" : "tasks"}
                      </span>
                    </Link>
                  </div>

                  {/* Upcoming buckets */}
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Upcoming
                  </p>
                  {/* Desktop: 3-column grid */}
                  <div className="hidden lg:grid grid-cols-3 gap-3">
                    {[
                      { label: "Tomorrow", count: buckets.tomorrowCount },
                      { label: "Weekend", count: buckets.weekendCount },
                      { label: "Next Week", count: buckets.nextWeekCount },
                    ].map(({ label, count }) => (
                      <Link
                        key={label}
                        href="/tasks#upcoming"
                        className="p-3 rounded-xl border border-border/50 hover:border-primary/30 transition-colors"
                      >
                        <p className="text-sm font-medium mb-1">{label}</p>
                        <p className="text-muted-foreground text-sm">
                          {count} {count === 1 ? "task" : "tasks"}
                        </p>
                      </Link>
                    ))}
                  </div>
                  {/* Mobile: rows */}
                  <div className="space-y-2 lg:hidden">
                    {[
                      { label: "Tomorrow", count: buckets.tomorrowCount },
                      { label: "This week", count: buckets.thisWeekCount },
                    ].map(({ label, count }) => (
                      <Link
                        key={label}
                        href="/tasks#upcoming"
                        className="flex items-center justify-between py-2"
                      >
                        <span className="text-sm text-foreground">{label}</span>
                        <span className="text-sm font-semibold text-foreground">
                          {count} {count === 1 ? "task" : "tasks"}
                        </span>
                      </Link>
                    ))}
                  </div>
              </Card>
                </div>

              {/* Right column: Recent Lists, WhatsApp */}
              <div className="lg:col-span-5 space-y-6">
                {/* Lists / Recent Lists */}
                <Card className="rounded-2xl p-5 shadow-sm border border-border">
                  <div className="flex items-center justify-between mb-6">
                    <Link
                      href="/lists"
                      className="flex items-center justify-between w-full gap-2 hover:opacity-80 transition-opacity lg:hidden"
                    >
                      <span className="text-xl font-semibold text-foreground">Lists</span>
                      <ChevronRight className="w-4 h-4 shrink-0 text-foreground" />
                    </Link>
                    <Link
                      href="/lists"
                      className="text-xl font-semibold text-foreground hover:text-primary transition-colors hidden lg:block"
                    >
                      Recent Lists
                    </Link>
                    <div className="hidden lg:flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowCreateList(true)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        aria-label="Add list"
                        title="Add list"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                    </button>
                    </div>
                  </div>
                  {lists.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">No lists yet</p>
                  ) : (
                    <div className="space-y-3">
                      {lists.map((list) => {
                        const done = list.doneCount ?? 0;
                        const total = list.itemCount ?? 0;
                      return (
                          <Link
                            key={list.id}
                            href={`/lists/${list.id}`}
                            className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-base leading-none">
                                {emojiForListName(list.name)}
                              </div>
                              <span className="font-medium text-sm text-foreground">
                                {list.name}
                          </span>
                        </div>
                            <span className="text-xs text-muted-foreground">
                              <span className="lg:hidden">
                                {total > 0 ? `${done}/${total}` : "0"}
                              </span>
                              <span className="hidden lg:inline bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                                {total}
                              </span>
                            </span>
                          </Link>
                      );
                    })}
                  </div>
                )}
              </Card>

                {/* WhatsApp card */}
                <Card
                  className={`relative overflow-hidden rounded-2xl p-5 shadow-sm border ${
                    isWhatsAppLinked
                      ? "bg-[#25D366]/5 border-[#25D366]/20"
                      : "border-border"
                  }`}
                >
                  {isWhatsAppLinked && (
                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-[#25D366]/20 blur-2xl pointer-events-none" />
                  )}
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                        isWhatsAppLinked ? "bg-[#25D366] text-white" : "bg-muted"
                      }`}
                    >
                      <MessageSquare
                        className={`w-5 h-5 ${
                          isWhatsAppLinked ? "text-white" : "text-muted-foreground"
                        }`}
                      />
                </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground mb-1">WhatsApp</h3>
                      {isWhatsAppLinked ? (
                        <>
                          <p className="text-sm text-muted-foreground mb-3">
                            Forward messages to add tasks instantly.
                          </p>
                          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <span className="w-2 h-2 rounded-full bg-[#25D366] animate-pulse" />
                            Daily digest enabled
                          </div>
                      </>
                    ) : (
                        <p className="text-sm text-muted-foreground mb-4">Not linked</p>
                      )}
                      <Link
                        href="/link-whatsapp"
                        className={`mt-3 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-medium text-sm ${
                          isWhatsAppLinked
                            ? "border border-primary text-primary hover:bg-primary/5"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                        }`}
                      >
                        {isWhatsAppLinked ? "Manage WhatsApp" : "Connect WhatsApp"}
                      </Link>
                  </div>
                </div>
              </Card>
              </div>
            </div>
          )}
        </main>
      </div>

      <CreateTaskModal
        isOpen={showCreateTask}
        onClose={() => setShowCreateTask(false)}
        onSuccess={() => { setShowCreateTask(false); fetchTodayData(); }}
        toast={toast}
      />

      <CreateListModal
        isOpen={showCreateList}
        onClose={() => setShowCreateList(false)}
        onSuccess={() => { setShowCreateList(false); fetchTodayData(); }}
        toast={toast}
      />

      <FirstRunDemo
        page="home"
        isOpen={demoReady && showDemo}
        onComplete={dismissDemo}
        onSkip={dismissDemo}
      />
    </ProtectedRoute>
  );
}
