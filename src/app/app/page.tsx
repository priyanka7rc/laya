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
import { executeTaskView } from "@/server/taskView/taskViewEngine";
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
    // For week we still anchor on today for now
    return d;
  }, [view]);

  const loadTasks = async (targetAppUserId: string) => {
    setLoading(true);
    const [todayResult, upcomingResult, inboxResult] = await Promise.all([
      executeTaskView({
        identity: { kind: "appUserId", appUserId: targetAppUserId },
        view: "today",
        now: baseDate,
      }),
      executeTaskView({
        identity: { kind: "appUserId", appUserId: targetAppUserId },
        view: "upcoming",
        now: new Date(),
      }),
      executeTaskView({
        identity: { kind: "appUserId", appUserId: targetAppUserId },
        view: "inbox",
      }),
    ]);
    setTodayTasks(todayResult.tasks);
    setUpcomingTasksState(upcomingResult.tasks);
    setInboxTasks(inboxResult.tasks);
    setLoading(false);
  };

  useEffect(() => {
    if (appUserId) {
      loadTasks(appUserId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUserId, view]);

  const handleComplete = async (id: string) => {
    await setTaskStatus(id, "completed");
    if (appUserId) {
      loadTasks(appUserId);
    }
  };

  const handleRemindEvening = async (id: string) => {
    await snoozeTaskToTodayEvening(id);
    if (appUserId) {
      loadTasks(appUserId);
    }
  };

  const handleRemindInTwoHours = async (id: string) => {
    await snoozeTaskInTwoHours(id);
    if (appUserId) {
      loadTasks(appUserId);
    }
  };

  const handleChipToday = () => {
    setView("today");
  };

  const handleChipPlanWeek = () => {
    setView("week");
  };

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Laya</h1>
            <p className="text-xs text-gray-500">
              {new Date().toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded border text-sm">
              + Add task
            </button>
            <button className="px-3 py-1 rounded border text-xs text-gray-400" disabled>
              Voice
            </button>
          </div>
        </div>

        {/* Toggle */}
        <div className="flex rounded-full border overflow-hidden text-sm">
          {["today", "tomorrow", "week"].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v as ViewMode)}
              className={`flex-1 py-1 ${
                view === v ? "bg-black text-white" : "bg-white"
              }`}
            >
              {v === "today" ? "Today" : v === "tomorrow" ? "Tomorrow" : "Week"}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <section className="flex-1 px-4 py-4 space-y-6">
        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {/* TODAY */}
        <section aria-label="Today">
          <h2 className="text-sm font-semibold mb-2">Today</h2>
          {todayTasks.length === 0 && (
            <p className="text-xs text-gray-500">Nothing scheduled for today.</p>
          )}
          <ul className="space-y-2">
            {todayTasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between border rounded px-3 py-2"
              >
                <div>
                  <p className="text-sm">{task.title}</p>
                  {(task.dueAt || task.remindAt || task.category) && (
                    <p className="text-xs text-gray-500">
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
                  className="text-xs border rounded px-2 py-1"
                >
                  Done
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* UPCOMING */}
        <section aria-label="Upcoming">
          <h2 className="text-sm font-semibold mb-2">Upcoming (next 48 hours)</h2>
          {upcomingTasks.length === 0 && (
            <p className="text-xs text-gray-500">No upcoming tasks.</p>
          )}
          <ul className="space-y-2">
            {upcomingTasks.map((task) => (
              <li
                key={task.id}
                className="border rounded px-3 py-2 space-y-1"
              >
                <p className="text-sm">{task.title}</p>
                <p className="text-xs text-gray-500">
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
                    className="border rounded px-2 py-1"
                  >
                    Remind this evening
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemindInTwoHours(task.id)}
                    className="border rounded px-2 py-1"
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
          <h2 className="text-sm font-semibold mb-2">Shortcuts</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className="px-3 py-1 rounded-full border"
              // For now, chip just focuses Today area; future: open prefilled form
              onClick={handleChipToday}
            >
              Add groceries
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-full border"
              onClick={handleChipToday}
            >
              What do I have today?
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-full border"
              onClick={handleChipPlanWeek}
            >
              Plan my week
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-full border"
            >
              Remind me later
            </button>
          </div>
        </section>

        {/* INBOX */}
        <section aria-label="Inbox">
          <h2 className="text-sm font-semibold mb-2">Inbox (needs one detail)</h2>
          {inboxTasks.length === 0 && (
            <p className="text-xs text-gray-500">Nothing needs clarification.</p>
          )}
          <ul className="space-y-2">
            {inboxTasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between border rounded px-3 py-2"
              >
                <div>
                  <p className="text-sm">{task.title}</p>
                  <p className="text-xs text-gray-500">
                    Missing due date or time.
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs border rounded px-2 py-1"
                  // Future: open bottom sheet; for now this is a placeholder.
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

