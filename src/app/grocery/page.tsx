"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import { GroceryListItem, GroceryStatus } from '@/types/relish';
import { useToastContext } from '@/context/ToastContext';

interface GroceryItemDisplay {
  id: string;
  display_name: string;
  quantity: number | null;
  unit: string | null;
  status: GroceryStatus;
  source_dish_ids: string[];
  notes?: string | null;
}

export default function GroceryPage() {
  const { user } = useAuth();
  const { addToast } = useToastContext();
  const [items, setItems] = useState<GroceryItemDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

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

      // 1. Find the meal plan for the current week
      const { data: mealPlan, error: mealPlanError } = await supabase
        .from('meal_plans')
        .select('id')
        .eq('user_id', user?.id)
        .eq('week_start_date', monday)
        .maybeSingle();

      if (!mealPlan) {
        setItems([]);
        setLoading(false);
        return;
      }

      // 2. Find the grocery list for that meal plan
      const { data: groceryList, error: glError } = await supabase
        .from('grocery_lists')
        .select('id')
        .eq('meal_plan_id', mealPlan.id)
        .maybeSingle();

      if (!groceryList) {
        setItems([]);
        setLoading(false);
        return;
      }

      // 3. Fetch grocery list items
      const { data, error } = await supabase
        .from('grocery_list_items')
        .select('*')
        .eq('grocery_list_id', groceryList.id)
        .order('status', { ascending: true })
        .order('display_name', { ascending: true });

      if (error) throw error;
      setItems(data || []);
    } catch (err: any) {
      console.error('Error fetching grocery list:', err);
      addToast({
        title: 'Error loading grocery list',
        description: 'Please refresh the page. If the problem persists, try regenerating your meal plan.',
        variant: 'error',
        duration: 6000,
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleItem = async (itemId: string, currentStatus: GroceryStatus) => {
    const newStatus = currentStatus === GroceryStatus.NEEDED ? GroceryStatus.PANTRY : GroceryStatus.NEEDED;
    
    setItems(items.map(item =>
      item.id === itemId ? { ...item, status: newStatus } : item
    ));

    try {
      const { error } = await supabase
        .from('grocery_list_items')
        .update({ status: newStatus })
        .eq('id', itemId);

      if (error) throw error;
    } catch (err: any) {
      console.error('Error updating item:', err);
      setItems(items.map(item =>
        item.id === itemId ? { ...item, status: currentStatus } : item
      ));
      addToast({
        title: 'Error updating item',
        description: 'Could not update grocery item status',
        variant: 'error',
      });
    }
  };

  const handleRegenerate = async () => {
    if (!user) return;
    
    setRegenerating(true);
    
    try {
      const monday = getMonday();
      
      const response = await fetch('/api/grocery-list/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          weekStartDate: monday
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to regenerate');
      }

      addToast({
        title: 'Grocery list regenerated! 🎉',
        description: 'Your list has been updated with the latest ingredients',
        variant: 'success',
      });

      // Refresh the list
      await fetchGroceryList();
      
    } catch (err: any) {
      console.error('Error regenerating grocery list:', err);
      addToast({
        title: 'Failed to regenerate',
        description: err.message || 'Could not regenerate grocery list',
        variant: 'error',
      });
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-2xl">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold text-white">Grocery List</h1>
            <button
              onClick={handleRegenerate}
              disabled={regenerating || loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {regenerating ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span className="text-sm">Regenerating...</span>
                </>
              ) : (
                <>
                  <span>🔄</span>
                  <span className="hidden sm:inline">Regenerate</span>
                </>
              )}
            </button>
          </div>
          <p className="text-gray-400 mb-6">
            Week of {new Date(getMonday()).toLocaleDateString('en-US', { 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>

          {loading ? (
            <div className="space-y-2 animate-pulse">
              {[...Array(8)].map((_, idx) => (
                <div key={idx} className="flex items-center gap-3 p-4 bg-gray-900 border border-gray-800 rounded-lg">
                  <div className="h-5 w-5 bg-gray-800 rounded"></div>
                  <div className="flex-1 h-4 bg-gray-800 rounded w-3/4"></div>
                </div>
              ))}
              <p className="text-center text-gray-500 mt-4">Loading your grocery list...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🛒</div>
              <p className="text-gray-400 text-lg mb-2">No groceries yet!</p>
              <p className="text-gray-500 text-sm">
                Plan meals for this week to generate a grocery list
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-4 bg-gray-900 border border-gray-800 rounded-lg"
                >
                  <input
                    type="checkbox"
                    checked={item.status === GroceryStatus.PANTRY}
                    onChange={() => toggleItem(item.id, item.status)}
                    className="h-5 w-5 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2">
                      <p
                        className={`font-medium ${
                          item.status === GroceryStatus.PANTRY
                            ? 'text-gray-500 line-through'
                            : 'text-white'
                        }`}
                      >
                        {item.display_name}
                      </p>
                      {item.quantity !== null && item.quantity > 0 && (
                        <span
                          className={`text-sm ${
                            item.status === GroceryStatus.PANTRY
                              ? 'text-gray-600'
                              : 'text-gray-400'
                          }`}
                        >
                          {item.quantity} {item.unit}
                        </span>
                      )}
                      {item.quantity === 0 && item.unit === 'to taste' && (
                        <span
                          className={`text-sm italic ${
                            item.status === GroceryStatus.PANTRY
                              ? 'text-gray-600'
                              : 'text-gray-400'
                          }`}
                        >
                          to taste
                        </span>
                      )}
                    </div>
                    {item.notes && (
                      <p
                        className={`text-xs mt-1 ${
                          item.status === GroceryStatus.PANTRY
                            ? 'text-gray-600'
                            : 'text-gray-500'
                        }`}
                      >
                        💡 {item.notes}
                      </p>
                    )}
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