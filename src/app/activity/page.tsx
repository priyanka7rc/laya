"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';

interface WeeklyStats {
  tasksCompleted: number;
  totalTasks: number;
  mealsPlanned: number;
  tasksByDay: Record<string, number>;
}

export default function ActivityPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<WeeklyStats>({
    tasksCompleted: 0,
    totalTasks: 0,
    mealsPlanned: 0,
    tasksByDay: {},
  });
  const [insight, setInsight] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchWeeklyStats();
    }
  }, [user]);

  const getWeekRange = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday as start
    
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    return {
      start: monday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0],
    };
  };

  const fetchWeeklyStats = async () => {
    try {
      const { start, end } = getWeekRange();

      // Fetch this week's tasks
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('id, is_done, due_date')
        .eq('user_id', user?.id)
        .gte('due_date', start)
        .lte('due_date', end);

      const totalTasks = tasksData?.length || 0;
      const tasksCompleted = tasksData?.filter(t => t.is_done).length || 0;

      // Count tasks by day of week
      const tasksByDay: Record<string, number> = {
        Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0
      };

      tasksData?.forEach(task => {
        const date = new Date(task.due_date + 'T00:00:00');
        const dayIndex = date.getDay();
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayName = dayNames[dayIndex];
        tasksByDay[dayName]++;
      });

      // Fetch this week's meal plan
      const { count: mealsPlanned } = await supabase
        .from('mealplanslots')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user?.id)
        .gte('day', start)
        .lte('day', end)
        .not('recipe_id', 'is', null);

      setStats({
        tasksCompleted,
        totalTasks,
        mealsPlanned: mealsPlanned || 0,
        tasksByDay,
      });

      // Generate insight
      generateInsight(tasksByDay, totalTasks, mealsPlanned || 0);
    } catch (err: any) {
      console.error('Error fetching weekly stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const generateInsight = (
    tasksByDay: Record<string, number>,
    totalTasks: number,
    mealsPlanned: number
  ) => {
    const insights: string[] = [];

    // Task distribution insight
    if (totalTasks > 0) {
      const sortedDays = Object.entries(tasksByDay)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1]);

      if (sortedDays.length > 0) {
        const topDays = sortedDays
          .filter(([_, count]) => count === sortedDays[0][1])
          .map(([day]) => day);
        
        if (topDays.length === 1) {
          insights.push(`Most tasks are scheduled for ${topDays[0]} (${sortedDays[0][1]} tasks)`);
        } else if (topDays.length === 2) {
          insights.push(`Most tasks land on ${topDays[0]} and ${topDays[1]}`);
        } else if (topDays.length > 2) {
          insights.push('Your tasks are evenly distributed this week');
        }
      }
    }

    // Meal planning insight
    const maxMeals = 21; // 7 days × 3 meals
    const mealPercentage = Math.round((mealsPlanned / maxMeals) * 100);
    
    if (mealPercentage >= 80) {
      insights.push('Great meal planning! Almost fully scheduled');
    } else if (mealPercentage >= 50) {
      insights.push(`${mealPercentage}% of meals planned for the week`);
    } else if (mealPercentage > 0) {
      insights.push('Still some meals to plan for the week');
    }

    // Completion insight
    if (totalTasks > 0) {
      const completionRate = Math.round((stats.tasksCompleted / totalTasks) * 100);
      if (completionRate >= 75) {
        insights.push('🔥 You\'re crushing it this week!');
      } else if (completionRate >= 50) {
        insights.push('Keep up the momentum!');
      }
    }

    setInsight(insights.join(' • '));
  };

  const completionRate = stats.totalTasks > 0 
    ? Math.round((stats.tasksCompleted / stats.totalTasks) * 100)
    : 0;

  const getDayColor = (count: number, max: number) => {
    if (count === 0) return 'bg-gray-800';
    const percentage = (count / max) * 100;
    if (percentage >= 75) return 'bg-blue-600';
    if (percentage >= 50) return 'bg-blue-500';
    if (percentage >= 25) return 'bg-blue-400';
    return 'bg-blue-300';
  };

  const maxTasksPerDay = Math.max(...Object.values(stats.tasksByDay), 1);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Your Activity</h1>
            <p className="text-gray-400">This week's overview</p>
          </div>

          {loading ? (
            <p className="text-gray-400">Loading stats...</p>
          ) : (
            <div className="space-y-6">
              {/* Insight Banner */}
              {insight && (
                <div className="bg-gradient-to-r from-purple-900/40 to-blue-900/40 border border-purple-700/50 rounded-lg p-4">
                  <p className="text-white text-center">
                    💡 {insight}
                  </p>
                </div>
              )}

              {/* Weekly Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Tasks Completed */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-3xl">✓</span>
                    <h2 className="text-lg font-semibold text-white">Tasks</h2>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-4xl font-bold text-blue-400">
                        {stats.tasksCompleted}
                      </p>
                      <p className="text-sm text-gray-400">Completed this week</p>
                    </div>
                    <div className="pt-3 border-t border-gray-800">
                      <p className="text-2xl font-semibold text-white">
                        {stats.totalTasks}
                      </p>
                      <p className="text-sm text-gray-400">Total tasks</p>
                    </div>
                    {stats.totalTasks > 0 && (
                      <div className="pt-3 border-t border-gray-800">
                        <p className="text-xl font-semibold text-green-400">
                          {completionRate}%
                        </p>
                        <p className="text-sm text-gray-400">Completion rate</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Meals Planned */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-3xl">🍽️</span>
                    <h2 className="text-lg font-semibold text-white">Meals</h2>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-4xl font-bold text-purple-400">
                        {stats.mealsPlanned}
                      </p>
                      <p className="text-sm text-gray-400">Planned this week</p>
                    </div>
                    <div className="pt-3 border-t border-gray-800">
                      <p className="text-2xl font-semibold text-white">21</p>
                      <p className="text-sm text-gray-400">Total slots</p>
                    </div>
                    <div className="pt-3 border-t border-gray-800">
                      <p className="text-xl font-semibold text-orange-400">
                        {Math.round((stats.mealsPlanned / 21) * 100)}%
                      </p>
                      <p className="text-sm text-gray-400">Week coverage</p>
                    </div>
                  </div>
                </div>

                {/* Task Distribution Heatmap */}
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-3xl">📊</span>
                    <h2 className="text-lg font-semibold text-white">
                      Task Distribution
                    </h2>
                  </div>
                  <div className="space-y-2">
                    {Object.entries(stats.tasksByDay).map(([day, count]) => (
                      <div key={day} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-8">{day}</span>
                        <div className="flex-1 h-6 bg-gray-800 rounded overflow-hidden">
                          <div
                            className={`h-full transition-all ${getDayColor(count, maxTasksPerDay)}`}
                            style={{ width: `${maxTasksPerDay > 0 ? (count / maxTasksPerDay) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 w-6 text-right">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Empty State */}
              {stats.totalTasks === 0 && stats.mealsPlanned === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-12 text-center">
                  <p className="text-gray-400 text-lg mb-2">
                    No activity this week yet
                  </p>
                  <p className="text-sm text-gray-500">
                    Start planning your tasks and meals to see insights here
                  </p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}