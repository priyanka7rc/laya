"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';

interface GroceryItem {
  id: string;
  name: string;
  qty: number | null;
  unit: string | null;
  checked: boolean;
}

export default function GroceryPage() {
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
        .order('checked', { ascending: true })
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
    setItems(items.map(item =>
      item.id === itemId ? { ...item, checked: !currentStatus } : item
    ));

    try {
      const { error } = await supabase
        .from('grocerylistitems')
        .update({ checked: !currentStatus })
        .eq('id', itemId);

      if (error) throw error;
    } catch (err: any) {
      console.error('Error updating item:', err);
      setItems(items.map(item =>
        item.id === itemId ? { ...item, checked: currentStatus } : item
      ));
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-2xl">
          <h1 className="text-3xl font-bold text-white mb-2">Grocery List</h1>
          <p className="text-gray-400 mb-6">
            Week of {new Date(getMonday()).toLocaleDateString('en-US', { 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>

          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : items.length === 0 ? (
            <p className="text-gray-400">No items. Plan meals for this week to generate a grocery list!</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-4 bg-gray-900 border border-gray-800 rounded-lg"
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleItem(item.id, item.checked)}
                    className="h-5 w-5 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                  <div className="flex-1">
                    <p
                      className={`font-medium ${
                        item.checked
                          ? 'text-gray-500 line-through'
                          : 'text-white'
                      }`}
                    >
                      {item.name}
                      {item.qty && item.unit && (
                        <span className="text-gray-400 ml-2">
                          {item.qty} {item.unit}
                        </span>
                      )}
                      {item.qty && !item.unit && (
                        <span className="text-gray-400 ml-2">
                          {item.qty}
                        </span>
                      )}
                    </p>
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