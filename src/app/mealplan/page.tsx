"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import RecipePicker from '@/components/RecipePicker';
import { regenerateGroceryList } from '@/lib/groceryListGenerator';

interface MealSlot {
  id?: string;
  day: string;
  slot: 'breakfast' | 'lunch' | 'dinner';
  recipe_id: string | null;
  recipe_title?: string;
}

export default function MealPlanPage() {
  const { user } = useAuth();
  const [mealPlan, setMealPlan] = useState<MealSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ day: string; slot: 'breakfast' | 'lunch' | 'dinner' } | null>(null);

  const slots = ['breakfast', 'lunch', 'dinner'] as const;
  const weekDays = getWeekDays();

  useEffect(() => {
    if (user) {
      fetchMealPlan();
    }
  }, [user]);

  function getWeekDays() {
    const today = new Date();
    const currentDay = today.getDay();
    const monday = new Date(today);
    const daysToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    monday.setDate(today.getDate() + daysToMonday);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      days.push({
        date: day.toISOString().split('T')[0],
        label: day.toLocaleDateString('en-US', { weekday: 'short' }),
        fullLabel: day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      });
    }
    return days;
  }

  const fetchMealPlan = async () => {
    try {
      setLoading(true);
      const startDate = weekDays[0].date;
      const endDate = weekDays[6].date;

      const { data, error } = await supabase
        .from('mealplanslots')
        .select(`*, recipes (title)`)
        .eq('user_id', user?.id)
        .gte('day', startDate)
        .lte('day', endDate);

      if (error) throw error;

      const formattedData = (data || []).map(item => ({
        id: item.id,
        day: item.day,
        slot: item.slot,
        recipe_id: item.recipe_id,
        recipe_title: item.recipes?.title || null,
      }));

      setMealPlan(formattedData);
    } catch (err: any) {
      console.error('Error fetching meal plan:', err);
    } finally {
      setLoading(false);
    }
  };

  const getMealForSlot = (day: string, slot: string) => {
    return mealPlan.find(m => m.day === day && m.slot === slot);
  };

  const handleCellClick = (day: string, slot: 'breakfast' | 'lunch' | 'dinner') => {
    setSelectedCell({ day, slot });
    setPickerOpen(true);
  };

  const handleRecipeSelect = async (recipeId: string | null) => {
    if (!selectedCell) return;
  
    try {
      const existing = getMealForSlot(selectedCell.day, selectedCell.slot);
  
      if (recipeId === null) {
        if (existing?.id) {
          const { error } = await supabase
            .from('mealplanslots')
            .delete()
            .eq('id', existing.id);
          if (error) throw error;
        }
      } else if (existing?.id) {
        const { error } = await supabase
          .from('mealplanslots')
          .update({ recipe_id: recipeId })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('mealplanslots')
          .insert([{
            user_id: user?.id,
            day: selectedCell.day,
            slot: selectedCell.slot,
            recipe_id: recipeId,
          }]);
        if (error) throw error;
      }
  
      // Regenerate grocery list for this week
      if (user?.id) {
        await regenerateGroceryList(user.id, selectedCell.day);
      }
  
      await fetchMealPlan();
      setPickerOpen(false);
      setSelectedCell(null);
    } catch (error: any) {
      console.error('Error saving meal:', error);
      alert('Error saving meal: ' + error.message);
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-20 md:pb-4 transition-colors">
        <main className="container mx-auto px-4 py-8 max-w-7xl">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">Weekly Meal Plan</h1>

          {loading ? (
            <p className="text-gray-600 dark:text-gray-400">Loading meal plan...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="p-3 text-left text-sm font-medium text-gray-700 dark:text-gray-400 border border-gray-300 dark:border-gray-800 bg-gray-100 dark:bg-gray-900 sticky left-0 z-10">
                      Day
                    </th>
                    {slots.map((slot) => (
                      <th
                        key={slot}
                        className="p-3 text-center text-sm font-medium text-gray-700 dark:text-gray-400 border border-gray-300 dark:border-gray-800 bg-gray-100 dark:bg-gray-900 capitalize min-w-[150px]"
                      >
                        {slot}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekDays.map((day) => (
                    <tr key={day.date}>
                      <td className="p-3 text-sm font-medium text-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 sticky left-0 z-10">
                        <div>{day.label}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-600">{day.fullLabel.split(',')[1]}</div>
                      </td>
                      {slots.map((slot) => {
                        const meal = getMealForSlot(day.date, slot);
                        return (
                          <td
                            key={`${day.date}-${slot}`}
                            className="p-2 border border-gray-300 dark:border-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            onClick={() => handleCellClick(day.date, slot)}
                          >
                            {meal?.recipe_title ? (
                              <div className="text-sm text-gray-900 dark:text-white bg-blue-100 dark:bg-blue-600/20 border border-blue-400 dark:border-blue-600/50 rounded px-2 py-2 hover:bg-blue-200 dark:hover:bg-blue-600/30 transition-colors">
                                {meal.recipe_title}
                              </div>
                            ) : (
                              <div className="text-sm text-gray-500 dark:text-gray-600 text-center py-2">
                                + Add
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {pickerOpen && selectedCell && (
        <RecipePicker
          onSelect={handleRecipeSelect}
          onClose={() => {
            setPickerOpen(false);
            setSelectedCell(null);
          }}
        />
      )}
    </ProtectedRoute>
  );
}