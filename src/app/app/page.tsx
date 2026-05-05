"use client";

import { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/components/AuthProvider";
import { getCurrentAppUser } from "@/lib/users/linking";
import {
  setTaskStatus,
  snoozeTaskInTwoHours,
  snoozeTaskToTodayEvening,
} from "@/lib/tasks/mutations";
import { supabase } from "@/lib/supabaseClient";
import type { TaskViewTask } from "@/lib/taskView/contracts";

type ViewMode = "today" | "tomorrow" | "week";

export default function AppHomePage() {
  return (
    <ProtectedRoute>
      <HomeInner />
    </ProtectedRoute>
  );
}

function HomeInner() {
  const { user } = useAuth();
  const [appUserId, setAppUserId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("today");
  const [todayTasks, setTodayTasks] = useState<TaskViewTask[]>([]);
  const [upcomingTasks, setUpcomingTasksState] = useState<TaskViewTask[]>([]);
  const [inboxTasks, setInboxTasks] = useState<TaskViewTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const appUser = await getCurrentAppUser();
      if (!active) return;

      if (!appUser) {
        setLoading(false);
        return;
      }

      setAppUserId(appUser.id);
    })();

    return () => {
      active = false;
    };
  }, []);

  const baseDate = useMemo(() => {
    const d = new Date();
    if (view === "tomorrow") {
      const t = new Date(d);
      t.setDate(t.getDate() + 1);
      return t;
    }
    return d;
  }, [view]);

  const loadTasks = async (targetAppUserId: string) => {
    void targetAppUserId; // identity resolved server-side via auth token
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

      const [todayRes, upcomingRes, inboxRes] = await Promise.all([
        fetch("/api/tasks/view", { method: "POST", headers, body: JSON.stringify({ view: "today", now: baseDate.toISOString() }) }),
        fetch("/api/tasks/view", { method: "POST", headers, body: JSON.stringify({ view: "upcoming", now: new Date().toISOString() }) }),
        fetch("/api/tasks/view", { method: "POST", headers, body: JSON.stringify({ view: "inbox" }) }),
      ]);
      const [todayResult, upcomingResult, inboxResult] = await Promise.all([
        todayRes.ok ? todayRes.json() : { tasks: [] },
        upcomingRes.ok ? upcomingRes.json() : { tasks: [] },
        inboxRes.ok ? inboxRes.json() : { tasks: [] },
      ]);
      setTodayTasks(todayResult.tasks ?? []);
      setUpcomingTasksState(upcomingResult.tasks ?? []);
      setInboxTasks(inboxResult.tasks ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (appUserId) {
      loadTasks(appUserId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUserId, view]);

  const handleComplete = async (id: string) => {
    await setTaskStatus(id, "completed");
    if (appUserId) loadTasks(appUserId);
  };

  const handleRemindEvening = async (id: string) => {
    await snoozeTaskToTodayEvening(id);
    if (appUserId) loadTasks(appUserId);
  };

  const handleRemindInTwoHours = async (id: string) => {
    await snoozeTaskInTwoHours(id);
    if (appUserId) loadTasks(appUserId);
  };

  const handleChipToday = () => setView("today");
  const handleChipPlanWeek = () => setView("week");

  if (!user) return null;

  return (
    <main className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Laya</h1>
            <p className="text-xs text-muted-foreground">
              {new Date().toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded border border-border text-sm text-foreground hover:bg-muted transition-colors">
              + Add task
            </button>
            <button className="px-3 py-1 rounded border border-border text-xs text-muted-foreground" disabled>
              Voice
            </button>
          </div>
        </div>

        {/* Toggle */}
        <div className="flex rounded-full border border-border overflow-hidden text-sm">
          {(["today", "tomorrow", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`flex-1 py-1 transition-colors ${
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground hover:bg-muted"
              }`}
            >
              {v === "today" ? "Today" : v === "tomorrow" ? "Tomorrow" : "Week"}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <section className="flex-1 px-4 py-4 space-y-6">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {/* TODAY */}
        <section aria-label="Today">
          <h2 className="text-sm font-semibold mb-2 text-foreground">Today</h2>
          {todayTasks.length === 0 && (
            <p className="text-xs text-muted-foreground">Nothing scheduled for today.</p>
          )}
          <ul className="space-y-2">
            {todayTasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between border border-border rounded px-3 py-2 bg-card"
              >
                <div>
                  <p className="text-sm text-foreground">{task.title}</p>
                  {(task.dueAt || task.remindAt || task.category) && (
                    <p className="text-xs text-muted-foreground">
                      {task.dueAt && `Due ${new Date(task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                      {task.remindAt &&
                        ` · Remind ${new Date(task.remindAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`}
                      {task.category && ` · ${task.category}`}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleComplete(task.id)}
                  className="text-xs border border-border rounded px-2 py-1 text-foreground hover:bg-muted transition-colors"
                >
                  Done
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* UPCOMING */}
        <section aria-label="Upcoming">
          <h2 className="text-sm font-semibold mb-2 text-foreground">Upcoming (next 48 hours)</h2>
          {upcomingTasks.length === 0 && (
            <p className="text-xs text-muted-foreground">No upcoming tasks.</p>
          )}
          <ul className="space-y-2">
            {upcomingTasks.map((task) => (
              <li
                key={task.id}
                className="border border-border rounded px-3 py-2 space-y-1 bg-card"
              >
                <p className="text-sm text-foreground">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  {task.dueAt
                    ? `Due ${new Date(task.dueAt).toLocaleString([], {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : "No due time"}
                </p>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => handleRemindEvening(task.id)}
                    className="border border-border rounded px-2 py-1 text-foreground hover:bg-muted transition-colors"
                  >
                    Remind this evening
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemindInTwoHours(task.id)}
                    className="border border-border rounded px-2 py-1 text-foreground hover:bg-muted transition-colors"
                  >
                    In 2 hours
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* CHIPS */}
        <section aria-label="Shortcuts">
          <h2 className="text-sm font-semibold mb-2 text-foreground">Shortcuts</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className="px-3 py-1 rounded-full border border-border text-foreground hover:bg-muted transition-colors"
              onClick={handleChipToday}
            >
              Add groceries
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-full border border-border text-foreground hover:bg-muted transition-colors"
              onClick={handleChipToday}
            >
              What do I have today?
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-full border border-border text-foreground hover:bg-muted transition-colors"
              onClick={handleChipPlanWeek}
            >
              Plan my week
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-full border border-border text-foreground hover:bg-muted transition-colors"
            >
              Remind me later
            </button>
          </div>
        </section>

        {/* INBOX */}
        <section aria-label="Inbox">
          <h2 className="text-sm font-semibold mb-2 text-foreground">Inbox (needs one detail)</h2>
          {inboxTasks.length === 0 && (
            <p className="text-xs text-muted-foreground">Nothing needs clarification.</p>
          )}
          <ul className="space-y-2">
            {inboxTasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between border border-border rounded px-3 py-2 bg-card"
              >
                <div>
                  <p className="text-sm text-foreground">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Missing due date or time.
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs border border-border rounded px-2 py-1 text-foreground hover:bg-muted transition-colors"
                >
                  Set now
                </button>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </main>
  );
}
