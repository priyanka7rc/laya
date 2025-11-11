"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Card, Button } from '@/components/ui';
import { trackTaskToggle } from '@/lib/analytics';
import { useRouter } from 'next/navigation';

interface TodayTask {
  id: string;
  title: string;
  is_done: boolean;
  due_time: string | null;
  category: string | null;
}

interface TodayMeal {
  slot: 'breakfast' | 'lunch' | 'dinner';
  recipe_title: string | null;
}

interface MealPlanData {
  slot: string;
  recipes: { title: string } | null;
}

export default function HomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [meals, setMeals] = useState<TodayMeal[]>([]);
  const [tasks, setTasks] = useState<TodayTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [groceryMissing, setGroceryMissing] = useState(0);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (user) {
      fetchTodayData();
    }
  }, [user]);

  const fetchTodayData = async () => {
    try {
      // Fetch today's meals
      const { data: mealsData } = await supabase
        .from('mealplanslots')
        .select(`slot, recipes (title)`)
        .eq('user_id', user?.id)
        .eq('day', today) as { data: MealPlanData[] | null };

      const formattedMeals = ['breakfast', 'lunch', 'dinner'].map(slot => {
        const meal = mealsData?.find(m => m.slot === slot);
        return {
          slot: slot as 'breakfast' | 'lunch' | 'dinner',
          recipe_title: meal?.recipes?.title || null,
        };
      });

      setMeals(formattedMeals);

      // Fetch today's tasks
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('id, title, is_done, due_time, category')
        .eq('user_id', user?.id)
        .eq('due_date', today)
        .order('due_time', { ascending: true });

      setTasks(tasksData || []);

      // Fetch grocery status
      const monday = getMonday();
      const { count } = await supabase
        .from('grocerylistitems')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user?.id)
        .eq('source_week', monday)
        .eq('is_checked', false);

      setGroceryMissing(count || 0);
    } catch (err: any) {
      console.error('Error fetching today data:', err);
    } finally {
      setLoading(false);
    }
  };

  function getMonday() {
    const today = new Date();
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    return monday.toISOString().split('T')[0];
  }

  const toggleTask = async (taskId: string, currentStatus: boolean) => {
    setTasks(tasks.map(task =>
      task.id === taskId ? { ...task, is_done: !currentStatus } : task
    ));

    try {
      const { error } = await supabase
        .from('tasks')
        .update({ is_done: !currentStatus })
        .eq('id', taskId);

      if (error) throw error;
      trackTaskToggle(taskId, !currentStatus);
    } catch (err: any) {
      console.error('Error updating task:', err);
      setTasks(tasks.map(task =>
        task.id === taskId ? { ...task, is_done: currentStatus } : task
      ));
    }
  };

  const formatTime = (timeString: string | null) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getUserName = () => {
    const email = user?.email || '';
    const name = email.split('@')[0];
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  const incompleteTasks = tasks.filter(t => !t.is_done);
  const taskCount = incompleteTasks.length;

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24 md:pb-8 transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
          {/* Header */}
          <div className="mb-8 md:mb-12">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2">
              Hi {getUserName()} 👋
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Today at a glance
            </p>
          </div>

          {loading ? (
            <div className="space-y-6">
              {/* Loading skeletons handled by loading.tsx */}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Card 1: Today's Tasks */}
              <Card className="hover:border-emerald-600/50 dark:hover:border-emerald-800/50 transition-colors">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">✓</span>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Today's Tasks</h2>
                  </div>
                  {taskCount > 0 && (
                    <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700/50 rounded-full text-sm text-emerald-700 dark:text-emerald-300">
                      {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
                    </span>
                  )}
                </div>

                {taskCount === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-gray-600 dark:text-gray-400 mb-1">Light day—enjoy it ✨</p>
                    <p className="text-sm text-gray-500">No tasks due today</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {incompleteTasks.slice(0, 3).map((task) => (
                      <div
                        key={task.id}
                        className="flex items-start gap-3 p-3 bg-gray-100 dark:bg-gray-800/50 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={task.is_done}
                          onChange={() => toggleTask(task.id, task.is_done)}
                          className="mt-0.5 h-5 w-5 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 cursor-pointer flex-shrink-0 transition-colors"
                          aria-label={`Mark "${task.title}" as complete`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-900 dark:text-white font-medium truncate">{task.title}</p>
                          {(task.due_time || task.category) && (
                            <div className="flex items-center gap-2 mt-1 text-xs text-gray-600 dark:text-gray-400">
                              {task.due_time && <span>🕐 {formatTime(task.due_time)}</span>}
                              {task.category && (
                                <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">
                                  {task.category}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {taskCount > 3 && (
                      <button
                        onClick={() => router.push('/tasks')}
                        className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 w-full text-center py-2"
                      >
                        +{taskCount - 3} more {taskCount - 3 === 1 ? 'task' : 'tasks'} →
                      </button>
                    )}
                  </div>
                )}
              </Card>

              {/* Card 2: Meals Today */}
              <Card className="hover:border-purple-600/50 dark:hover:border-emerald-800/50 transition-colors">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">🍽️</span>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Meals Today</h2>
                </div>

                {meals.every(m => !m.recipe_title) ? (
                  <div className="text-center py-6">
                    <p className="text-gray-600 dark:text-gray-400 mb-1">No meals planned yet</p>
                    <button
                      onClick={() => router.push('/mealplan')}
                      className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 mt-2"
                    >
                      Plan your week →
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {meals.map((meal) => {
                      if (!meal.recipe_title) return null;
                      
                      const icon = meal.slot === 'breakfast' ? '🥐' : 
                                   meal.slot === 'lunch' ? '🥗' : '🍝';
                      const label = meal.slot.charAt(0).toUpperCase();
                      
                      return (
                        <div
                          key={meal.slot}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700/50 rounded-full text-sm"
                        >
                          <span>{icon}</span>
                          <span className="text-purple-900 dark:text-white font-medium">{label}</span>
                          <span className="text-purple-700 dark:text-gray-300">·</span>
                          <span className="text-purple-700 dark:text-gray-300 truncate max-w-[120px]">
                            {meal.recipe_title}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Card 3: Grocery Readiness */}
              <Card className="hover:border-green-600/50 dark:hover:border-emerald-800/50 transition-colors">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">🛒</span>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Grocery Readiness</h2>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    {groceryMissing === 0 ? (
                      <>
                        <p className="text-gray-900 dark:text-white font-medium mb-1">All set! ✨</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Your grocery list is complete</p>
                      </>
                    ) : (
                      <>
                        <p className="text-gray-900 dark:text-white font-medium mb-1">
                          {groceryMissing} {groceryMissing === 1 ? 'item' : 'items'} needed
                        </p>
                        <button
                          onClick={() => router.push('/meals/groceries')}
                          className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
                        >
                          View list →
                        </button>
                      </>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`text-3xl font-bold ${groceryMissing === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-yellow-400'}`}>
                      {groceryMissing === 0 ? '✓' : groceryMissing}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Primary CTA */}
              <div className="pt-4">
                <Button
                  className="w-full h-14 text-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 focus-visible:ring-emerald-500"
                  onClick={() => {
                    // Trigger the FloatingBrainDump component
                    const brainDumpButton = document.querySelector('[aria-label="Open Brain Dump"]') as HTMLButtonElement;
                    if (brainDumpButton) {
                      brainDumpButton.click();
                    }
                  }}
                  aria-label="Open Brain Dump to add tasks"
                >
                  💭 Unload (Brain Dump)
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}

