"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import Link from 'next/link';

interface TodayMeal {
  slot: 'breakfast' | 'lunch' | 'dinner';
  recipe_title: string | null;
}

interface TodayTask {
  id: string;
  title: string;
  is_done: boolean;
  due_time: string | null;
  category: string | null;
}

interface CategoryCount {
  category: string;
  count: number;
}

export default function Home() {
  const { user } = useAuth();
  const [meals, setMeals] = useState<TodayMeal[]>([]);
  const [tasks, setTasks] = useState<TodayTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [groceryMissing, setGroceryMissing] = useState(0);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (user) {
      fetchTodayData();
      fetchGroceryStatus();
    }
  }, [user]);

  const fetchTodayData = async () => {
    try {
      // Fetch today's meals
      const { data: mealsData } = await supabase
        .from('mealplanslots')
        .select(`slot, recipes (title)`)
        .eq('user_id', user?.id)
        .eq('day', today);

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
    } catch (err: any) {
      console.error('Error fetching today data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroceryStatus = async () => {
    try {
      const monday = getMonday();
      const { count } = await supabase
        .from('grocerylistitems')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user?.id)
        .eq('source_week', monday)
        .eq('is_checked', false);

      setGroceryMissing(count || 0);
    } catch (err: any) {
      console.error('Error fetching grocery status:', err);
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

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getUserName = () => {
    return user?.email?.split('@')[0] || 'there';
  };

  // Get task counts by category
  const tasksByCategory = tasks.reduce((acc, task) => {
    if (!task.is_done) {
      const category = task.category || 'Uncategorized';
      acc[category] = (acc[category] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const categoryList = Object.entries(tasksByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const completedCount = tasks.filter(t => t.is_done).length;
  const totalCount = tasks.length;

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          {/* Greeting */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-white mb-3">
              {getGreeting()}, {getUserName()}! 👋
            </h1>
            <p className="text-gray-400 text-lg">
              {new Date().toLocaleDateString('en-US', { 
                weekday: 'long', 
                month: 'long', 
                day: 'numeric'
              })}
            </p>
          </div>

          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Tasks Summary */}
                <div className="bg-gradient-to-br from-blue-900/50 to-blue-800/30 border border-blue-700/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">✓</span>
                    <Link href="/tasks" className="text-xs text-blue-300 hover:text-blue-200">
                      View →
                    </Link>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {completedCount}/{totalCount}
                  </p>
                  <p className="text-sm text-gray-300">Tasks completed</p>
                  {categoryList.length > 0 && (
                    <div className="mt-2 text-xs text-gray-400">
                      {categoryList.map(([cat, count], idx) => (
                        <span key={cat}>
                          {cat}: {count}{idx < categoryList.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Meals Summary */}
                <div className="bg-gradient-to-br from-purple-900/50 to-purple-800/30 border border-purple-700/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">🍽️</span>
                    <Link href="/mealplan" className="text-xs text-purple-300 hover:text-purple-200">
                      View →
                    </Link>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {meals.filter(m => m.recipe_title).length}/3
                  </p>
                  <p className="text-sm text-gray-300">Meals planned</p>
                </div>

                {/* Grocery Status */}
                <div className="bg-gradient-to-br from-green-900/50 to-green-800/30 border border-green-700/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">🛒</span>
                    <Link href="/meals/groceries" className="text-xs text-green-300 hover:text-green-200">
                      View →
                    </Link>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {groceryMissing}
                  </p>
                  <p className="text-sm text-gray-300">
                    {groceryMissing === 0 ? 'All set!' : groceryMissing === 1 ? 'Item needed' : 'Items needed'}
                  </p>
                </div>
              </div>

              {/* Today's Meals - Compact Cards */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold text-white">Today's Menu</h2>
                  <Link
                    href="/mealplan"
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    Edit week →
                  </Link>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {meals.map((meal) => (
                    <div
                      key={meal.slot}
                      className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center hover:border-gray-700 transition-colors"
                    >
                      <span className="text-3xl mb-2 block">
                        {meal.slot === 'breakfast' ? '🥐' : meal.slot === 'lunch' ? '🥗' : '🍝'}
                      </span>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">
                        {meal.slot}
                      </p>
                      <p className="text-sm text-white font-medium line-clamp-2">
                        {meal.recipe_title || 'Not planned'}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Today's Tasks */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-bold text-white">Today's Tasks</h2>
                  <Link
                    href="/tasks"
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    View all →
                  </Link>
                </div>
                {tasks.length === 0 ? (
                  <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
                    <p className="text-gray-400">No tasks for today</p>
                    <p className="text-sm text-gray-500 mt-2">Click the Brain Dump button to add some!</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-start gap-3 p-4 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={task.is_done}
                          onChange={() => toggleTask(task.id, task.is_done)}
                          className="mt-1 h-5 w-5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                        />
                        <div className="flex-1">
                          <p
                            className={`font-medium ${
                              task.is_done
                                ? 'text-gray-500 line-through'
                                : 'text-white'
                            }`}
                          >
                            {task.title}
                          </p>
                          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                            {task.due_time && (
                              <span>🕐 {formatTime(task.due_time)}</span>
                            )}
                            {task.category && (
                              <span className="px-2 py-0.5 bg-gray-700 rounded text-xs">
                                {task.category}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}