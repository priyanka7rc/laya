"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import Link from 'next/link';

interface GroceryItem {
  id: string;
  name: string;
  qty: number | null;
  unit: string | null;
  is_checked: boolean;
}

export default function GroceriesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchGroceryList();
    }
  }, [user]);

  function getMonday() {
    const today = new Date();
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    return monday.toISOString().split('T')[0];
  }

  const fetchGroceryList = async () => {
    try {
      setLoading(true);
      const monday = getMonday();

      const { data, error } = await supabase
        .from('grocerylistitems')
        .select('*')
        .eq('user_id', user?.id)
        .eq('source_week', monday)
        .order('is_checked', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      setItems(data || []);
    } catch (err: any) {
      console.error('Error fetching grocery list:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = async (itemId: string, currentStatus: boolean) => {
    // Optimistic update
    setItems(items.map(item =>
      item.id === itemId ? { ...item, is_checked: !currentStatus } : item
    ));

    try {
      const { error } = await supabase
        .from('grocerylistitems')
        .update({ is_checked: !currentStatus })
        .eq('id', itemId);

      if (error) throw error;
    } catch (err: any) {
      console.error('Error updating item:', err);
      // Rollback on error
      setItems(items.map(item =>
        item.id === itemId ? { ...item, is_checked: currentStatus } : item
      ));
    }
  };

  const checkedCount = items.filter(i => i.is_checked).length;
  const totalCount = items.length;

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Grocery List</h1>
              <p className="text-gray-400">
                Week of {new Date(getMonday()).toLocaleDateString('en-US', { 
                  month: 'long', 
                  day: 'numeric',
                  year: 'numeric'
                })}
              </p>
            </div>
            <Link
              href="/meals"
              className="text-blue-400 hover:text-blue-300"
            >
              ← Back
            </Link>
          </div>

          {totalCount > 0 && (
            <div className="mb-4 p-4 bg-gray-900 border border-gray-800 rounded-lg">
              <p className="text-gray-300">
                {checkedCount} of {totalCount} items checked
              </p>
              <div className="mt-2 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${totalCount > 0 ? (checkedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 mb-4">
                No grocery items for this week.
              </p>
              <Link
                href="/mealplan"
                className="text-blue-400 hover:text-blue-300"
              >
                Plan meals to generate a grocery list →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-4 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={item.is_checked}
                    onChange={() => toggleItem(item.id, item.is_checked)}
                    className="h-5 w-5 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    aria-label={`Mark ${item.name} as ${item.is_checked ? 'needed' : 'purchased'}`}
                  />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2">
                      <p
                        className={`font-medium ${
                          item.is_checked
                            ? 'text-gray-500 line-through'
                            : 'text-white'
                        }`}
                      >
                        {item.name}
                      </p>
                      {(item.qty || item.unit) && (
                        <span className="text-sm text-gray-400">
                          {item.qty && item.unit && `${item.qty} ${item.unit}`}
                          {item.qty && !item.unit && item.qty}
                          {!item.qty && item.unit && item.unit}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}