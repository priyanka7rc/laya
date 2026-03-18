"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card } from "@/components/ui";
import { trackTaskToggle } from "@/lib/analytics";
import { useRouter } from "next/navigation";
import { getCurrentAppUser } from "@/lib/users/linking";
import { executeTaskView } from "@/server/taskView/taskViewEngine";
import { TaskViewTask } from "@/lib/taskView/contracts";
import type { ListViewList } from "@/lib/listView/contracts";
import { supabase } from "@/lib/supabaseClient";
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
  const { user } = useAuth();
  const router = useRouter();
  const [todayTasks, setTodayTasks] = useState<TodayTask[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<TodayTask[]>([]);
  const [lists, setLists] = useState<ListViewList[]>([]);
  const [loading, setLoading] = useState(true);
  const [isWhatsAppLinked, setIsWhatsAppLinked] = useState(true);
  const [displayName, setDisplayName] = useState<string>("");

  useEffect(() => {
    if (user) fetchTodayData();
  }, [user]);

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

      // Set display name from app user record
      if (appUser.display_name) {
        setDisplayName(appUser.display_name);
      } else if (user?.email) {
        // Fallback: derive from email prefix
        const part = user.email.split("@")[0];
        setDisplayName(part.charAt(0).toUpperCase() + part.slice(1));
      }

      const [todayResult, upcomingResult] = await Promise.all([
        executeTaskView({
          identity: { kind: "appUserId", appUserId: appUser.id },
          view: "today",
        }),
        executeTaskView({
          identity: { kind: "appUserId", appUserId: appUser.id },
          view: "upcoming",
        }),
      ]);
      setTodayTasks(todayResult.tasks as TodayTask[]);
      setUpcomingTasks(upcomingResult.tasks as TodayTask[]);

      try {
        const { data: { session } } = await supabase.auth.getSession();
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
      prev.map((t) =>
        t.id === taskId ? { ...t, is_done: !currentStatus } : t
      );
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
        prev.map((t) =>
          t.id === taskId ? { ...t, is_done: currentStatus } : t
        );
      setTodayTasks(revert);
      setUpcomingTasks(revert);
    }
  };

  const formatTime = (timeString: string | null) => {
    if (!timeString) return "";
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatOverdueDate = (dateString: string | null, timeString: string | null) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const d = new Date(dateString);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === yesterday.getTime()) return "Yesterday";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  const getDisplayName = () => displayName;

  const getDateString = () =>
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  const getDateStringShort = () =>
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  const incompleteToday = todayTasks.filter((t) => !t.is_done);
  const taskCount = incompleteToday.length;

  const todayStr = new Date().toISOString().slice(0, 10);
  const overdueTasks = todayTasks.filter(
    (t) => !t.is_done && t.due_date && t.due_date < todayStr
  );
  const overdueCount = overdueTasks.length;

  const incompleteUpcoming = upcomingTasks.filter((t) => !t.is_done);
  const buckets = getUpcomingBuckets(incompleteUpcoming);

  const sampleOverdue = overdueTasks[0];
  const sampleToday = overdueCount === 0 ? incompleteToday[0] : null;

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors">
        <main className="container mx-auto px-4 lg:px-12 py-8 md:py-12 max-w-md lg:max-w-6xl">
          {/* Header: greeting + date only */}
          <header className="mb-8 md:mb-12">
            <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-1">
              {getGreeting()}
              <span className="hidden lg:inline">
                {getDisplayName() ? `, ${getDisplayName()}` : ""}
              </span>
            </h1>
            <p className="text-muted-foreground text-base mt-2">
              {getDateString()}
            </p>
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
              {/* Left column: Today + Upcoming */}
              <div className="lg:col-span-7 space-y-6">
                {/* Today card */}
                <Card className="rounded-2xl p-5 shadow-sm border border-border hover:border-primary/30 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <Link
                      href="/tasks"
                      className="text-xl font-semibold text-foreground hover:text-primary transition-colors"
                    >
                      Today
                    </Link>
                    <Link
                      href="/tasks"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      aria-label="Add task"
                      title="Add task"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </Link>
                  </div>

                  {(overdueCount > 0 || taskCount > 0) ? (
                    <>
                      <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                        NEXT UP
                      </h4>
                      <div className="space-y-3">
                        {/* Mobile: one sample row */}
                        <div className="lg:hidden space-y-3">
                          {sampleOverdue ? (
                            <div className="flex items-start gap-3">
                              <div className="mt-1 w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />
                              <div className="flex-1">
                                <p className="text-foreground font-medium">
                                  {sampleOverdue.title}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {formatOverdueDate(sampleOverdue.due_date, sampleOverdue.due_time)}
                                  {sampleOverdue.due_time && ` ${formatTime(sampleOverdue.due_time)}`}
                                </p>
                              </div>
                            </div>
                          ) : sampleToday ? (
                            <div className="flex items-start gap-3">
                              <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                              <div className="flex-1">
                                <p className="text-foreground font-medium">
                                  {sampleToday.title}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {sampleToday.due_time
                                    ? formatTime(sampleToday.due_time)
                                    : "Today"}
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </div>
                        {/* Desktop: task rows */}
                        <div className="hidden lg:block space-y-2">
                          {[...overdueTasks, ...incompleteToday.filter(t => !overdueTasks.some(o => o.id === t.id))]
                            .slice(0, 3)
                            .map((task) => (
                              <div
                                key={task.id}
                                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-sm text-foreground truncate">
                                    {task.title}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {task.due_date && task.due_date < todayStr
                                      ? `${formatOverdueDate(task.due_date, task.due_time)}${task.due_time ? ` · ${formatTime(task.due_time)}` : ""}`
                                      : task.due_time
                                        ? formatTime(task.due_time)
                                        : "Today"}
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
                  ) : null}

                </Card>

                {/* Upcoming card */}
                <Card className="rounded-2xl p-5 shadow-sm border border-border">
                  <h3 className="text-xl font-semibold text-foreground mb-4">
                    Upcoming
                  </h3>
                  {/* Mobile: two rows - Tomorrow, This week */}
                  <div className="space-y-4 lg:hidden">
                    <div>
                      <p className="text-sm text-foreground">Tomorrow</p>
                      <p className="text-sm font-semibold text-foreground mt-0.5">
                        {buckets.tomorrowCount} {buckets.tomorrowCount === 1 ? "task" : "tasks"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-foreground">This week</p>
                      <p className="text-sm font-semibold text-foreground mt-0.5">
                        {buckets.thisWeekCount} {buckets.thisWeekCount === 1 ? "task" : "tasks"}
                      </p>
                    </div>
                  </div>
                  {/* Desktop: three cards */}
                  <div className="hidden lg:grid grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl border border-border/50">
                      <p className="text-sm font-medium mb-2">Tomorrow</p>
                      <p className="text-muted-foreground text-sm">
                        {buckets.tomorrowCount} {buckets.tomorrowCount === 1 ? "task" : "tasks"}
                      </p>
                    </div>
                    <div className="p-4 rounded-xl border border-border/50">
                      <p className="text-sm font-medium mb-2">Weekend</p>
                      <p className="text-muted-foreground text-sm">
                        {buckets.weekendCount} {buckets.weekendCount === 1 ? "task" : "tasks"}
                      </p>
                    </div>
                    <div className="p-4 rounded-xl border border-border/50">
                      <p className="text-sm font-medium mb-2">Next Week</p>
                      <p className="text-muted-foreground text-sm">
                        {buckets.nextWeekCount} {buckets.nextWeekCount === 1 ? "task" : "tasks"}
                      </p>
                    </div>
                  </div>
                  {incompleteUpcoming.length === 0 && (
                    <p className="text-sm text-muted-foreground mt-4">
                      No upcoming tasks
                    </p>
                  )}
                </Card>
              </div>

              {/* Right column: Recent Lists, Quick capture, WhatsApp */}
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
                      <Link
                        href="/lists"
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        aria-label="Add list"
                        title="Add list"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </Link>
                    </div>
                  </div>
                  {lists.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      No lists yet
                    </p>
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
                              <span className="lg:hidden">{total > 0 ? `${done}/${total}` : "0"}</span>
                              <span className="hidden lg:inline bg-muted text-muted-foreground rounded px-1.5 py-0.5">{total}</span>
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
                        className={`w-5 h-5 ${isWhatsAppLinked ? "text-white" : "text-muted-foreground"}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground mb-1">
                        WhatsApp
                      </h3>
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
                        <p className="text-sm text-muted-foreground mb-4">
                          Not linked
                        </p>
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
    </ProtectedRoute>
  );
}
