"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function ActivityPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalTasks: 0,
    completedTasks: 0,
    totalRecipes: 0,
    mealsPlanned: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchStats();
    }
  }, [user]);

  const fetchStats = async () => {
    try {
      // Total tasks
      const { count: totalTasks } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user?.id);

      // Completed tasks
      const { count: completedTasks } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user?.id)
        .eq('is_done', true);

      // Total recipes
      const { count: totalRecipes } = await supabase
        .from('recipes')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user?.id);

      // Meals planned
      const { count: mealsPlanned } = await supabase
        .from('mealplanslots')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user?.id);

      setStats({
        totalTasks: totalTasks || 0,
        completedTasks: completedTasks || 0,
        totalRecipes: totalRecipes || 0,
        mealsPlanned: mealsPlanned || 0,
      });
    } catch (err: any) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const completionRate = stats.totalTasks > 0 
    ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
    : 0;

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          <h1 className="text-3xl font-bold text-white mb-6">Your Activity</h1>

          {loading ? (
            <p className="text-gray-400">Loading stats...</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Tasks Stats */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Tasks</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-4xl font-bold text-blue-400">{stats.totalTasks}</p>
                    <p className="text-sm text-gray-400">Total tasks created</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-green-400">{stats.completedTasks}</p>
                    <p className="text-sm text-gray-400">Tasks completed</p>
                  </div>
                  <div className="pt-4 border-t border-gray-800">
                    <p className="text-xl font-semibold text-white">{completionRate}%</p>
                    <p className="text-sm text-gray-400">Completion rate</p>
                  </div>
                </div>
              </div>

              {/* Recipes Stats */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Meals</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-4xl font-bold text-purple-400">{stats.totalRecipes}</p>
                    <p className="text-sm text-gray-400">Recipes saved</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold text-orange-400">{stats.mealsPlanned}</p>
                    <p className="text-sm text-gray-400">Meals planned</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}