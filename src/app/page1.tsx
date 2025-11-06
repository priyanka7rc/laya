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

export default function Home() {
  const { user } = useAuth();
  const [meals, setMeals] = useState<TodayMeal[]>([]);
  const [tasks, setTasks] = useState<TodayTask[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">
              Today's Overview
            </h1>
            <p className="text-gray-400">
              {new Date().toLocaleDateString('en-US', { 
                weekday: 'long', 
                month: 'long', 
                day: 'numeric',
                year: 'numeric'
              })}
            </p>
          </div>

          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : (
            <div className="space-y-6">
              {/* Today's Meals */}
              <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-white">Today's Meals</h2>
                  <Link
                    href="/mealplan"
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    View Week →
                  </Link>
                </div>
                <div className="space-y-3">
                  {meals.map((meal) => (
                    <div
                      key={meal.slot}
                      className="flex items-center justify-between p-3 bg-gray-800 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">
                          {meal.slot === 'breakfast' ? '🥐' : meal.slot === 'lunch' ? '🥗' : '🍝'}
                        </span>
                        <div>
                          <p className="text-sm text-gray-400 capitalize">{meal.slot}</p>
                          <p className="text-white font-medium">
                            {meal.recipe_title || 'Not planned'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Today's Tasks */}
              <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-white">Today's Tasks</h2>
                  <Link
                    href="/tasks"
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    View All →
                  </Link>
                </div>
                {tasks.length === 0 ? (
                  <p className="text-gray-400 text-center py-4">No tasks for today</p>
                ) : (
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-start gap-3 p-3 bg-gray-800 rounded-lg hover:bg-gray-750 transition-colors"
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