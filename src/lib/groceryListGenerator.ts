import { supabase } from './supabaseClient';

export async function regenerateGroceryList(userId: string, weekStartDate: string) {
  try {
    // Get Monday of the week
    const monday = getMonday(weekStartDate);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const sundayStr = sunday.toISOString().split('T')[0];

    // Fetch all meal plan slots for the week
    const { data: mealSlots, error: mealError } = await supabase
      .from('mealplanslots')
      .select('recipe_id')
      .eq('user_id', userId)
      .gte('day', monday.toISOString().split('T')[0])
      .lte('day', sundayStr)
      .not('recipe_id', 'is', null);

    if (mealError) throw mealError;

    // Get unique recipe IDs
    const recipeIds = [...new Set(mealSlots?.map(slot => slot.recipe_id).filter(Boolean) || [])];

    if (recipeIds.length === 0) {
      // No recipes, clear grocery list for this week
      await supabase
        .from('grocerylistitems')
        .delete()
        .eq('user_id', userId)
        .eq('source_week', monday.toISOString().split('T')[0]);
      return;
    }

    // Fetch all ingredients for these recipes
    const { data: ingredients, error: ingError } = await supabase
      .from('ingredients')
      .select('name, qty, unit')
      .in('recipe_id', recipeIds);

    if (ingError) throw ingError;

    // Group by (name, unit) and sum quantities
    const grouped = new Map<string, { name: string; qty: number; unit: string | null }>();

    (ingredients || []).forEach(ing => {
      const key = `${ing.name.toLowerCase().trim()}|${(ing.unit || '').toLowerCase().trim()}`;
      
      if (grouped.has(key)) {
        const existing = grouped.get(key)!;
        existing.qty += ing.qty || 0;
      } else {
        grouped.set(key, {
          name: ing.name,
          qty: ing.qty || 0,
          unit: ing.unit,
        });
      }
    });

    // Delete existing grocery items for this week
    await supabase
      .from('grocerylistitems')
      .delete()
      .eq('user_id', userId)
      .eq('source_week', monday.toISOString().split('T')[0]);

    // Insert new aggregated items
    if (grouped.size > 0) {
      const items = Array.from(grouped.values()).map(item => ({
        user_id: userId,
        source_week: monday.toISOString().split('T')[0],
        name: item.name,
        qty: item.qty > 0 ? item.qty : null,
        unit: item.unit,
        checked: false,
      }));

      const { error: insertError } = await supabase
        .from('grocerylistitems')
        .insert(items);

      if (insertError) throw insertError;
    }

    console.log(`Grocery list regenerated for week of ${monday.toISOString().split('T')[0]}`);
  } catch (error) {
    console.error('Error regenerating grocery list:', error);
    throw error;
  }
}

function getMonday(dateString: string): Date {
  const date = new Date(dateString);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Adjust to Monday
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  return monday;
}