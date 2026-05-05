"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Card } from '@/components/ui';

interface DayStats {
  day: string;
  count: number;
  label: string;
}

interface WeekStats {
  tasksCompleted: number;
  mealsPlanned: number;
  groceriesChecked: number;
  dailyTasks: DayStats[];
  topDay: string | null;
}

export default function ActivityPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<WeekStats>({
    tasksCompleted: 0,
    mealsPlanned: 0,
    groceriesChecked: 0,
    dailyTasks: [],
    topDay: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchWeeklyStats();
    }
  }, [user]);

  const fetchWeeklyStats = async () => {
    try {
      const today = new Date();
      const monday = getMonday(today);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const mondayStr = monday.toISOString().split('T')[0];
      const sundayStr = sunday.toISOString().split('T')[0];

      const { data: tasksData } = await supabase
        .from('tasks')
        .select('id, is_done, created_at')
        .eq('user_id', user?.id)
        .eq('is_done', true)
        .gte('created_at', mondayStr)
        .lte('created_at', sundayStr + 'T23:59:59');

      const { count: mealsCount } = await supabase
        .from('mealplanslots')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user?.id)
        .gte('day', mondayStr)
        .lte('day', sundayStr);

      const { count: groceriesCount } = await supabase
        .from('grocerylistitems')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user?.id)
        .eq('source_week', mondayStr)
        .eq('is_checked', true);

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dailyCounts: Record<string, number> = {};

      (tasksData || []).forEach(task => {
        const taskDate = new Date(task.created_at);
        const dayName = dayNames[taskDate.getDay()];
        dailyCounts[dayName] = (dailyCounts[dayName] || 0) + 1;
      });

      const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const dailyTasks: DayStats[] = weekDays.map(day => ({
        day,
        count: dailyCounts[day] || 0,
        label: day,
      }));

      const maxCount = Math.max(...dailyTasks.map(d => d.count));
      const topDays = dailyTasks.filter(d => d.count === maxCount && d.count > 0);
      const topDay = topDays.length > 0 && topDays.length <= 3
        ? topDays.map(d => d.day).join('/')
        : null;

      setStats({
        tasksCompleted: tasksData?.length || 0,
        mealsPlanned: mealsCount || 0,
        groceriesChecked: groceriesCount || 0,
        dailyTasks,
        topDay,
      });
    } catch (err: any) {
      console.error('Error fetching weekly stats:', err);
    } finally {
      setLoading(false);
    }
  };

  function getMonday(date: Date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const hasActivity = stats.tasksCompleted > 0 || stats.mealsPlanned > 0 || stats.groceriesChecked > 0;
  const maxTaskCount = Math.max(...stats.dailyTasks.map(d => d.count), 1);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background pb-24 md:pb-8 transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
              📊 Activity
            </h1>
            {loading ? (
              <div className="h-5 bg-muted rounded w-64 animate-pulse" />
            ) : hasActivity && stats.topDay ? (
              <p className="text-muted-foreground text-lg">
                You complete most tasks on {stats.topDay} 💪
              </p>
            ) : hasActivity ? (
              <p className="text-muted-foreground text-lg">
                Keep up the great work this week!
              </p>
            ) : (
              <p className="text-muted-foreground text-lg">
                Your weekly summary
              </p>
            )}
          </div>

          {loading ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => (
                  <Card key={i} className="animate-pulse">
                    <div className="h-12 bg-muted rounded w-16 mb-2" />
                    <div className="h-4 bg-soft rounded w-24" />
                  </Card>
                ))}
              </div>
              <Card className="animate-pulse">
                <div className="h-6 bg-muted rounded w-48 mb-4" />
                <div className="h-48 bg-muted/50 rounded" />
              </Card>
            </div>
          ) : !hasActivity ? (
            <Card className="text-center py-16">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-soft/30 rounded-full mb-4">
                <span className="text-3xl">✨</span>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                Nothing to show yet
              </h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                We'll show insights after you've used Laya for a bit. Add some tasks or plan your meals to get started!
              </p>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-full bg-success/30 flex items-center justify-center text-xl">
                      ✓
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {stats.tasksCompleted}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Tasks completed
                  </p>
                </Card>

                <Card>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-full bg-info/30 flex items-center justify-center text-xl">
                      🍽️
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {stats.mealsPlanned}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Meals planned
                  </p>
                </Card>

                <Card>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-xl">
                      🛒
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">
                        {stats.groceriesChecked}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Grocery items checked
                  </p>
                </Card>
              </div>

              {/* Daily Task Distribution Chart */}
              {stats.tasksCompleted > 0 && (
                <Card>
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    Tasks completed by day
                  </h2>

                  <div className="space-y-3">
                    {stats.dailyTasks.map((day) => {
                      const percentage = maxTaskCount > 0
                        ? (day.count / maxTaskCount) * 100
                        : 0;
                      const isTopDay = stats.topDay?.includes(day.day);

                      return (
                        <div key={day.day} className="flex items-center gap-3">
                          <span className={`text-sm font-medium w-10 ${
                            isTopDay ? 'text-success-foreground' : 'text-muted-foreground'
                          }`}>
                            {day.label}
                          </span>

                          <div className="flex-1 h-8 bg-muted rounded-lg overflow-hidden relative">
                            {day.count > 0 && (
                              <div
                                className={`h-full rounded-lg transition-all duration-500 ${
                                  isTopDay ? 'bg-primary' : 'bg-soft'
                                }`}
                                style={{ width: `${Math.max(percentage, 8)}%` }}
                              />
                            )}
                          </div>

                          <span className={`text-sm font-semibold w-8 text-right ${
                            day.count > 0 ? 'text-foreground' : 'text-muted-foreground'
                          }`}>
                            {day.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {stats.topDay && (
                    <p className="mt-4 text-sm text-muted-foreground text-center">
                      Peak productivity on {stats.topDay} 🎯
                    </p>
                  )}
                </Card>
              )}

              {/* Insight Card */}
              {stats.tasksCompleted > 0 && (
                <Card className="bg-success border-success-border">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">💡</span>
                    <div>
                      <h3 className="text-sm font-semibold text-success-foreground mb-1">
                        Weekly Insight
                      </h3>
                      <p className="text-sm text-success-foreground/80">
                        {stats.tasksCompleted >= 10
                          ? `Amazing! You completed ${stats.tasksCompleted} tasks this week. You're on fire! 🔥`
                          : stats.tasksCompleted >= 5
                          ? `Great week! ${stats.tasksCompleted} tasks done. Keep building momentum! 💪`
                          : `You completed ${stats.tasksCompleted} ${stats.tasksCompleted === 1 ? 'task' : 'tasks'} this week. Every bit counts! ⭐️`
                        }
                      </p>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}
