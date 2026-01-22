"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import RecipePicker from '@/components/RecipePicker';
import { MealSlot, ComponentType, MealPlateComponent } from '@/types/relish';
import { useToastContext } from '@/context/ToastContext';
import { useSearchParams, useRouter } from 'next/navigation';

// Type alias for meal slot types to avoid repetition
type MealSlotType = 'breakfast' | 'morning_snack' | 'lunch' | 'evening_snack' | 'dinner';

interface MealSlotData {
  day: string;
  slot: MealSlotType;
  meal_plan_item_id: string | null;
  meal_plate_id: string | null;
  components: MealPlateComponent[];
  is_skipped?: boolean;
}

export default function MealPlanPage() {
  const { user } = useAuth();
  const { addToast } = useToastContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const formatDateLocal = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Get current Monday as default (local date to avoid UTC shifts)
  const getCurrentMonday = () => {
    const today = new Date();
    const currentDay = today.getDay();
    const monday = new Date(today);
    const daysToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    monday.setDate(today.getDate() + daysToMonday);
    return formatDateLocal(monday);
  };
  
  const [selectedWeek, setSelectedWeek] = useState<string>(getCurrentMonday());
  const [mealPlan, setMealPlan] = useState<MealSlotData[]>([]);
  const [mealPlanId, setMealPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState('');
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [filledSlotsCount, setFilledSlotsCount] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ day: string; slot: MealSlotType } | null>(null);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);

  // Helper: Regenerate grocery list via API
  // DISABLED - Grocery feature in development
  // const regenerateGroceryList = async (userId: string, weekStartDate: string) => {
  //   try {
  //     const response = await fetch('/api/grocery-list/regenerate', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ userId, weekStartDate }),
  //     });
  //     
  //     if (!response.ok) {
  //       throw new Error('Failed to regenerate grocery list');
  //     }
  //   } catch (error) {
  //     console.error('Error regenerating grocery list:', error);
  //     // Don't throw - grocery list regeneration is not critical
  //   }
  // };

  const slots = ['breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner'] as const;
  const slotLabels: Record<typeof slots[number], string> = {
    breakfast: 'Breakfast',
    morning_snack: 'Morning Snack',
    lunch: 'Lunch',
    evening_snack: 'Evening Snack',
    dinner: 'Dinner'
  };
  const weekDays = getWeekDays(selectedWeek); // Show all 7 days with horizontal scroll

  // Initialize selectedWeek from URL params
  useEffect(() => {
    const weekParam = searchParams.get('week');
    if (weekParam) {
      setSelectedWeek(weekParam);
    }
  }, [searchParams]);

  useEffect(() => {
    if (user) {
      fetchMealPlan();
    }
  }, [user, selectedWeek]);

  // Auto-generate meal plan if this is the first visit (no existing meal plan items)
  // BUT ONLY for current week - past weeks stay empty
  useEffect(() => {
    if (!loading && user && isFirstVisit && mealPlan.length === 0) {
      const currentMonday = getCurrentMonday();
      if (selectedWeek === currentMonday) {
        console.log('📭 Current week is empty, auto-generating from today forward...');
        handleGeneratePlan(true); // Silent generation with loading indicator
      } else {
        console.log('📭 Past week - leaving empty (no auto-generation)');
      }
    }
  }, [loading, isFirstVisit, mealPlan.length, user, selectedWeek]);

  function getWeekDays(weekStart?: string) {
    const monday = weekStart ? new Date(`${weekStart}T00:00:00`) : new Date();
    if (!weekStart) {
      const currentDay = monday.getDay();
      const daysToMonday = currentDay === 0 ? -6 : 1 - currentDay;
      monday.setDate(monday.getDate() + daysToMonday);
    }

    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      days.push({
        date: formatDateLocal(day),
        label: day.toLocaleDateString('en-US', { weekday: 'short' }),
        fullLabel: day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      });
    }
    return days;
  }

  const navigateToPreviousWeek = async () => {
    try {
      // Find the most recent week before current with meal plan items
      const { data: previousPlans, error } = await supabase
        .from('meal_plans')
        .select('week_start_date, meal_plan_items!inner(id)')
        .eq('user_id', user?.id)
        .lt('week_start_date', selectedWeek)
        .order('week_start_date', { ascending: false })
        .limit(1);
      
      if (error) {
        console.error('Error fetching previous week:', error);
        addToast({
          type: 'error',
          message: 'Failed to navigate to previous week',
          duration: 3000,
        });
        return;
      }
      
      if (previousPlans && previousPlans.length > 0) {
        // Jump to the most recent populated week
        const newWeek = previousPlans[0].week_start_date;
        setSelectedWeek(newWeek);
        router.push(`/mealplan?week=${newWeek}`, { scroll: false });
      } else {
        // No previous weeks with data
        addToast({
          type: 'info',
          message: 'No previous meal plans found',
          duration: 3000,
        });
      }
    } catch (error) {
      console.error('Error in navigateToPreviousWeek:', error);
    }
  };

  const navigateToNextWeek = () => {
    const currentMonday = getCurrentMonday();
    const currentWeekDate = new Date(selectedWeek);
    currentWeekDate.setDate(currentWeekDate.getDate() + 7);
    const newWeek = currentWeekDate.toISOString().split('T')[0];
    
    // Only allow up to current week
    if (newWeek <= currentMonday) {
      setSelectedWeek(newWeek);
      router.push(`/mealplan?week=${newWeek}`, { scroll: false });
    }
  };

  const isCurrentWeek = () => {
    return selectedWeek === getCurrentMonday();
  };

  const fetchMealPlan = async () => {
    try {
      setLoading(true);
      const startDate = weekDays[0].date;

      // Try to get existing meal plan for this week
      const { data: existingPlan, error: planError } = await supabase
        .from('meal_plans')
        .select('id')
        .eq('user_id', user?.id)
        .eq('week_start_date', startDate)
        .maybeSingle();

      let planId = existingPlan?.id;

      // Check if this is a first visit (meal plan doesn't exist yet)
      const firstVisit = !existingPlan;
      setIsFirstVisit(firstVisit);

      // Create meal plan if it doesn't exist (using upsert to handle race conditions)
      if (!existingPlan) {
        const { data: newPlan, error: createError } = await supabase
          .from('meal_plans')
          .upsert({
            user_id: user?.id,
            week_start_date: startDate,
            week_name: `Week of ${new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          }, {
            onConflict: 'user_id,week_start_date',
            ignoreDuplicates: false, // Update if exists
          })
          .select('id')
          .single();

        if (createError) {
          console.error('Error creating meal plan:', createError);
          throw createError;
        }
        planId = newPlan?.id;
        console.log('✅ Created/retrieved meal plan:', planId, '(first visit:', firstVisit, ')');
      } else {
        // Existing plan but check if it has any meals
        // If user manually cleared all meals, don't auto-generate
        console.log('✅ Returning to existing meal plan:', existingPlan.id);
      }

      if (!planId) {
        throw new Error('Failed to get or create meal plan');
      }

      setMealPlanId(planId);

      // Fetch meal plan items with plates and components
      const { data: items, error: itemsError } = await supabase
        .from('meal_plan_items')
        .select(`
          id,
          day_of_week,
          meal_slot,
          is_skipped,
          meal_plates (
            id,
            meal_plate_components (
              id,
              component_type,
              dish_name,
              dish_id,
              sort_order,
              is_optional,
              servings,
              quantity_hint,
              tags
            )
          )
        `)
        .eq('meal_plan_id', planId)
        .order('day_of_week', { ascending: true });

      if (itemsError) {
        console.error('Error fetching meal items:', itemsError);
        throw itemsError;
      }

      // Transform to MealSlotData format
      const formattedData: MealSlotData[] = (items || []).map((item: any) => {
        const dayDate = new Date(startDate);
        dayDate.setDate(dayDate.getDate() + item.day_of_week);
        
        const components = item.meal_plates?.meal_plate_components || [];
        
        return {
          day: dayDate.toISOString().split('T')[0],
          slot: item.meal_slot,
          meal_plan_item_id: item.id,
          meal_plate_id: item.meal_plates?.id || null,
          components: components.sort((a: any, b: any) => a.sort_order - b.sort_order),
          is_skipped: item.is_skipped || false,
        };
      });

      setMealPlan(formattedData);
      
      // Count filled slots (slots with at least one component)
      const filled = formattedData.filter(slot => slot.components.length > 0).length;
      setFilledSlotsCount(filled);
      
      console.log('✅ Loaded meal plan:', formattedData.length, 'slots,', 
        formattedData.reduce((sum, slot) => sum + slot.components.length, 0), 'components',
        `(${filled}/35 filled)`);
    } catch (err: any) {
      console.error('Error fetching meal plan:', err);
      console.error('Full error details:', JSON.stringify(err, null, 2));
      
      addToast({
        title: 'Error loading meal plan',
        description: 'Please refresh the page. If the problem persists, contact support.',
        variant: 'error',
        duration: 6000,
      });
    } finally {
      setLoading(false);
    }
  };

  const getMealForSlot = (day: string, slot: string): MealSlotData | undefined => {
    return mealPlan.find(m => m.day === day && m.slot === slot);
  };

  const getComponentTypeEmoji = (type: ComponentType): string => {
    const emojiMap: Record<ComponentType, string> = {
      [ComponentType.CARB]: '🍚',
      [ComponentType.PROTEIN]: '🫘',
      [ComponentType.VEG]: '🥬',
      [ComponentType.BROTH]: '🍲',
      [ComponentType.CONDIMENT]: '🥄',
      [ComponentType.DAIRY]: '🥛',
      [ComponentType.SALAD]: '🥗',
      [ComponentType.CRUNCH]: '🍘',
      [ComponentType.SNACK]: '🍿',
      [ComponentType.FRUIT]: '🍎',
      [ComponentType.BEVERAGE]: '☕',
      [ComponentType.OTHER]: '🍽️',
    };
    return emojiMap[type] || '🍽️';
  };

  const handleCellClick = (day: string, slot: MealSlotType) => {
    setSelectedCell({ day, slot });
    setEditingComponentId(null); // Clear edit mode
    setPickerOpen(true);
  };

  const handleDishClick = (componentId: string, day: string, slot: MealSlotType) => {
    setEditingComponentId(componentId);
    setSelectedCell({ day, slot });
    setPickerOpen(true);
  };

  const handleRecipeSelect = async (dishId: string | null) => {
    if (!selectedCell || !mealPlanId) return;
    if (dishId === null) {
      // Remove entire meal (handled by handleRemoveSlot)
      return;
    }
  
    try {
      // Get dish info
      const { data: dish, error: dishError } = await supabase
        .from('dishes')
        .select('canonical_name')
        .eq('id', dishId)
        .single();

      if (dishError) throw dishError;
      const dishName = dish?.canonical_name || '';
  
      // If editing existing component, just update it
      if (editingComponentId) {
        await supabase
          .from('meal_plate_components')
          .update({ 
            dish_id: dishId,
            dish_name: dishName 
          })
          .eq('id', editingComponentId);
        
        await fetchMealPlan();
        setPickerOpen(false);
        setEditingComponentId(null);
        setSelectedCell(null);
        
        addToast({
          title: 'Dish updated!',
          description: `Changed to ${dishName}`,
          variant: 'success',
        });
        return;
      }
  
      // Calculate day of week (0 = Monday)
      const monday = new Date(weekDays[0].date);
      const selectedDate = new Date(selectedCell.day);
      const dayOfWeek = Math.floor((selectedDate.getTime() - monday.getTime()) / (1000 * 60 * 60 * 24));
  
      let existing = getMealForSlot(selectedCell.day, selectedCell.slot);
      let mealPlanItemId = existing?.meal_plan_item_id;
      let mealPlateId = existing?.meal_plate_id;

      console.log('Existing meal slot:', { existing, mealPlanItemId, mealPlateId });

      // Create meal_plan_item if it doesn't exist (trigger should create plate)
      if (!mealPlanItemId) {
        const { data: newItem, error: itemError } = await supabase
          .from('meal_plan_items')
          .insert({
            meal_plan_id: mealPlanId,
            day_of_week: dayOfWeek,
            meal_slot: selectedCell.slot,
            dish_id: dishId,
            dish_name: dishName, // Required by schema, represents first/primary dish
          })
          .select('id')
          .single();

        if (itemError) throw itemError;
        mealPlanItemId = newItem.id;

        // Wait a moment for trigger to execute
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get the auto-created plate (or create manually as fallback)
        let { data: plate, error: plateError } = await supabase
          .from('meal_plates')
          .select('id')
          .eq('meal_plan_item_id', mealPlanItemId)
          .maybeSingle();

        console.log('Looking for plate:', { mealPlanItemId, plate, plateError });

        if (!plate) {
          // Fallback: Create plate manually if trigger didn't work
          console.warn('Trigger did not create plate, creating manually');
          const { data: newPlate, error: createPlateError } = await supabase
            .from('meal_plates')
            .insert({ meal_plan_item_id: mealPlanItemId })
            .select('id')
            .single();

          console.log('Manual plate creation:', { newPlate, createPlateError });
          if (createPlateError) {
            console.error('Failed to create plate manually:', createPlateError);
            throw createPlateError;
          }
          mealPlateId = newPlate.id;
        } else {
          mealPlateId = plate.id;
        }
      } else if (mealPlanItemId && !mealPlateId) {
        // Existing meal_plan_item but no plate (old data before migration)
        console.warn('Existing item has no plate, creating plate for:', mealPlanItemId);
        const { data: newPlate, error: createPlateError } = await supabase
          .from('meal_plates')
          .insert({ meal_plan_item_id: mealPlanItemId })
          .select('id')
          .single();

        console.log('Created plate for existing item:', { newPlate, createPlateError });
        if (createPlateError) {
          console.error('Failed to create plate for existing item:', createPlateError);
          throw createPlateError;
        }
        mealPlateId = newPlate.id;
      }

      if (!mealPlateId) {
        console.error('Still no plate after all attempts:', { mealPlanItemId, existing });
        throw new Error('No meal plate found or created');
      }

      // Get current component count for sort order
      const { data: existingComponents } = await supabase
        .from('meal_plate_components')
        .select('sort_order')
        .eq('meal_plate_id', mealPlateId)
        .order('sort_order', { ascending: false })
        .limit(1);

      const nextSortOrder = existingComponents && existingComponents.length > 0 
        ? existingComponents[0].sort_order + 1 
        : 0;

      // Add component to plate
      const { error: componentError } = await supabase
        .from('meal_plate_components')
        .insert({
          meal_plate_id: mealPlateId,
          dish_id: dishId,
          dish_name: dishName,
          component_type: ComponentType.OTHER, // Default, can be enhanced later
          sort_order: nextSortOrder,
          is_optional: false,
        });

      if (componentError) throw componentError;

      // Increment dish usage count for personalization
      if (user?.id) {
        try {
          const { error: usageError } = await supabase
            .rpc('increment_dish_usage', {
              p_user_id: user.id,
              p_dish_id: dishId
            });
          
          if (usageError) {
            console.warn('Failed to increment dish usage:', usageError);
            // Don't throw - usage tracking is not critical
          } else {
            console.log('✅ Incremented usage for dish:', dishName);
          }
        } catch (err) {
          console.warn('Error tracking dish usage:', err);
        }
      }
  
      // Regenerate grocery list for this week
      // DISABLED - Grocery feature in development
      // if (user?.id && mealPlanId) {
      //   await regenerateGroceryList(user.id, weekDays[0].date);
      // }
  
      await fetchMealPlan();
      setPickerOpen(false);
      setSelectedCell(null);
      
      addToast({
        title: 'Dish added!',
        description: `Added ${dishName} to your meal`,
        variant: 'success',
      });
    } catch (error: any) {
      console.error('Error adding dish:', error);
      addToast({
        title: 'Error adding dish',
        description: error.message || 'Something went wrong',
        variant: 'error',
        duration: 5000,
      });
    }
  };

  const handleRemoveComponent = async (componentId: string) => {
    try {
      // Find the component to get its plate_id
      const { data: component } = await supabase
        .from('meal_plate_components')
        .select('meal_plate_id')
        .eq('id', componentId)
        .single();

      if (!component) return;

      // Delete the component
          const { error } = await supabase
        .from('meal_plate_components')
        .delete()
        .eq('id', componentId);

      if (error) throw error;

      // Check if this was the last component in the plate
      const { data: remainingComponents } = await supabase
        .from('meal_plate_components')
        .select('id')
        .eq('meal_plate_id', component.meal_plate_id);

      // If no components left, delete the entire meal_plan_item (cascades to plate)
      if (!remainingComponents || remainingComponents.length === 0) {
        const { data: plate } = await supabase
          .from('meal_plates')
          .select('meal_plan_item_id')
          .eq('id', component.meal_plate_id)
          .single();

        if (plate) {
          await supabase
            .from('meal_plan_items')
            .delete()
            .eq('id', plate.meal_plan_item_id);
        }
      }

      // Regenerate grocery list
      // DISABLED - Grocery feature in development
      // if (user?.id && mealPlanId) {
      //   await regenerateGroceryList(user.id, weekDays[0].date);
      // }

      await fetchMealPlan();
      
      addToast({
        title: 'Dish removed',
        variant: 'info',
      });
    } catch (error: any) {
      console.error('Error removing component:', error);
      addToast({
        title: 'Error removing dish',
        description: error.message || 'Something went wrong',
        variant: 'error',
        duration: 5000,
      });
    }
  };

  const handleRegenerateSlot = async (day: string, slot: MealSlotType) => {
    if (!user?.id || !mealPlanId) return;

    try {
      const existing = getMealForSlot(day, slot);
      if (!existing || existing.components.length === 0) return;

      // Get current dish names to exclude
      const currentDishes = existing.components
        .map(c => c.dish_name)
        .filter(Boolean);

      addToast({
        title: 'Regenerating meal...',
        description: `Getting new options for ${slotLabels[slot]}`,
        variant: 'info',
        duration: 2000,
      });

      // Calculate day of week (0 = Monday)
      const monday = new Date(weekDays[0].date);
      const selectedDate = new Date(day);
      const dayOfWeek = Math.floor((selectedDate.getTime() - monday.getTime()) / (1000 * 60 * 60 * 24));

      const response = await fetch('/api/meal-plan/regenerate-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          mealPlanId,
          dayOfWeek,
          slot,
          excludeDishes: currentDishes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to regenerate meal');
      }

      await fetchMealPlan();

      addToast({
        title: 'Meal regenerated! 🎉',
        description: `New ${slotLabels[slot]} created`,
        variant: 'success',
      });
    } catch (error: any) {
      console.error('Error regenerating meal slot:', error);
      addToast({
        title: 'Error regenerating meal',
        description: error.message || 'Something went wrong',
        variant: 'error',
        duration: 5000,
      });
    }
  };

  const handleRemoveSlot = async (day: string, slot: MealSlotType) => {
    try {
      const existing = getMealForSlot(day, slot);
      if (!existing?.meal_plan_item_id) return;

      const { error } = await supabase
        .from('meal_plan_items')
        .delete()
        .eq('id', existing.meal_plan_item_id);

          if (error) throw error;

      // Regenerate grocery list
      // DISABLED - Grocery feature in development
      // if (user?.id && mealPlanId) {
      //   await regenerateGroceryList(user.id, weekDays[0].date);
      // }

      await fetchMealPlan();
      
      addToast({
        title: 'Meal removed',
        variant: 'info',
      });
    } catch (error: any) {
      console.error('Error removing meal slot:', error);
      addToast({
        title: 'Error removing meal',
        description: error.message || 'Something went wrong',
        variant: 'error',
        duration: 5000,
      });
    }
  };

  const handleGeneratePlan = async (silent = false) => {
    if (!user?.id) return;

    // Only allow generation for current week
    const currentMonday = getCurrentMonday();
    if (selectedWeek !== currentMonday) {
      addToast({
        title: 'Cannot generate',
        description: 'Can only generate meals for current week',
        variant: 'error',
        duration: 4000,
      });
      return;
    }

    // Check if meal plan is complete (all 35 slots filled)
    const isComplete = filledSlotsCount >= 35;
    
    // If complete, confirm before regenerating everything
    if (isComplete && !silent) {
      const confirmed = confirm(
        '⚠️ You already have a complete meal plan for this week.\n\n' +
        'Click OK to REGENERATE ALL meals with fresh suggestions.\n' +
        'Click Cancel to keep your current plan.'
      );
      if (!confirmed) return;
    }
    
    setGenerating(true);
    setGeneratingStatus(isComplete ? 'Regenerating all meals...' : 'Completing meal plan...');
    setGenerationProgress({ current: 0, total: 35 });
    
    try {
      // If regenerating all, clear existing plan first
      if (isComplete && mealPlanId) {
        console.log('🗑️ Clearing existing meal plan for regeneration...');
        await supabase
          .from('meal_plan_items')
          .delete()
          .eq('meal_plan_id', mealPlanId);
      }
      
      // Get previously used dishes to avoid repeats (only if NOT regenerating all)
      let previousDishNames: string[] = [];
      
      if (!isComplete) {
        const { data: previousDishes } = await supabase
          .from('meal_plate_components')
          .select('dish_id, dishes(canonical_name)')
          .not('dish_id', 'is', null)
          .in('meal_plate_id', 
            mealPlan
              .filter(m => m.meal_plate_id)
              .map(m => m.meal_plate_id)
          );

        previousDishNames = previousDishes
          ?.map(d => d.dishes?.canonical_name)
          .filter(Boolean) || [];

        console.log('📋 Previously used dishes:', previousDishNames);
      }

      const response = await fetch('/api/meal-plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekStartDate: weekDays[0].date,
          userId: user.id,
          excludeDishes: previousDishNames, // Empty if regenerating all
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Special handling for rate limit errors
        if (response.status === 429) {
          addToast({
            title: 'Rate limit exceeded',
            description: data.error || 'Please try again later. This helps keep costs under control.',
            variant: 'error',
            duration: 6000,
          });
          return;
        }
        throw new Error(data.error || 'Failed to generate meal plan');
      }

      console.log('✅ Meal plan generated:', data);
      
      setGeneratingStatus('Refreshing...');
      
      // Refresh meal plan
      await fetchMealPlan();

      // Regenerate grocery list
      // DISABLED - Grocery feature in development
      // if (mealPlanId) {
      //   setGeneratingStatus('Updating grocery...');
      //   await regenerateGroceryList(user.id, weekDays[0].date);
      // }
      
      // Only show toast for manual generation
      if (!silent) {
        const successMsg = isComplete 
          ? '🎉 Meal plan regenerated with fresh suggestions!'
          : (data.message || `✨ Filled ${data.mealsGenerated} empty slots!`);
        
        addToast({
          title: isComplete ? 'Plan regenerated!' : 'Meals completed!',
          description: successMsg,
          variant: 'success',
          duration: 4000,
        });
      }
    } catch (error: any) {
      console.error('Error generating meal plan:', error);
      addToast({
        title: 'Error generating meals',
        description: error.message || 'Something went wrong',
        variant: 'error',
        duration: 5000,
      });
    } finally {
      setGenerating(false);
      setGeneratingStatus('');
      setGenerationProgress({ current: 0, total: 0 });
    }
  };

  const handleClearAll = async () => {
    if (!mealPlanId) return;

    // Use native confirm for destructive actions
    const confirmClear = confirm(
      '⚠️ Clear ALL meals for this week? This cannot be undone.'
    );

    if (!confirmClear) return;

    try {
      setLoading(true);

      // Delete all meal_plan_items (cascades to plates and components)
      const { error } = await supabase
        .from('meal_plan_items')
        .delete()
        .eq('meal_plan_id', mealPlanId);

      if (error) throw error;

      console.log('✅ Cleared all meals for week');

      // Regenerate (empty) grocery list
      // DISABLED - Grocery feature in development
      // if (user?.id) {
      //   await regenerateGroceryList(user.id, weekDays[0].date);
      // }

      await fetchMealPlan();
      
      addToast({
        title: 'All meals cleared',
        description: 'Your week is now empty',
        variant: 'info',
      });
    } catch (error: any) {
      console.error('Error clearing all meals:', error);
      addToast({
        title: 'Error clearing meals',
        description: error.message || 'Something went wrong',
        variant: 'error',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSkip = async (day: string, slot: MealSlotType) => {
    try {
      const existing = getMealForSlot(day, slot);
      const isCurrentlySkipped = existing?.is_skipped || false;

      // Calculate day of week (0 = Monday)
      const monday = new Date(weekDays[0].date);
      const selectedDate = new Date(day);
      const dayOfWeek = Math.floor((selectedDate.getTime() - monday.getTime()) / (1000 * 60 * 60 * 24));

      if (!existing?.meal_plan_item_id) {
        // Create a skipped meal_plan_item (no plate or components)
        const { error } = await supabase
          .from('meal_plan_items')
          .insert({
            meal_plan_id: mealPlanId,
            day_of_week: dayOfWeek,
            meal_slot: slot,
            dish_name: 'Skipped', // Required field
            is_skipped: true,
          });

        if (error) throw error;
        console.log('✅ Marked meal as skipped');
      } else {
        // Toggle skip status
        const { error } = await supabase
          .from('meal_plan_items')
          .update({ is_skipped: !isCurrentlySkipped })
          .eq('id', existing.meal_plan_item_id);

        if (error) throw error;
        console.log(`✅ ${!isCurrentlySkipped ? 'Skipped' : 'Unskipped'} meal`);
      }
  
      await fetchMealPlan();
    } catch (error: any) {
      console.error('Error toggling skip:', error);
      addToast({
        title: 'Error updating meal',
        description: error.message || 'Something went wrong',
        variant: 'error',
        duration: 5000,
      });
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-20 md:pb-4 transition-colors">
        <main className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Header with Action Buttons */}
          <div className="flex flex-col gap-4 mb-6">
            {/* Week Navigation */}
            <div className="flex items-center justify-between">
              <button
                onClick={navigateToPreviousWeek}
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors flex items-center gap-2"
                aria-label="Previous week"
              >
                <span>←</span>
                <span className="hidden sm:inline">Previous Week</span>
              </button>
              
              <div className="text-center flex-1 mx-4">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Weekly Meal Plan</h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {(() => {
                    const today = formatDateLocal(new Date());
                    const currentMonday = getCurrentMonday();
                    const isThisWeek = selectedWeek === currentMonday;
                    
                    if (isThisWeek) {
                      // Find first day that's today or later
                      const firstAvailableDay = weekDays.find(day => day.date >= today);
                      if (firstAvailableDay && firstAvailableDay.date !== weekDays[0].date) {
                        // Show partial week indicator
                        return `${firstAvailableDay.fullLabel} - ${weekDays[6].fullLabel}`;
                      }
                    }
                    
                    // Full week
                    return `${weekDays[0]?.fullLabel} - ${weekDays[6]?.fullLabel}`;
                  })()}
                </p>
              </div>
              
              <button
                onClick={navigateToNextWeek}
                disabled={isCurrentWeek()}
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors flex items-center gap-2"
                aria-label="Next week"
              >
                <span className="hidden sm:inline">Next Week</span>
                <span>→</span>
              </button>
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={handleClearAll}
                disabled={loading || generating || mealPlan.length === 0}
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors flex items-center gap-2 text-sm"
                title="Remove all meals from this week"
              >
                <span>🗑️</span>
                Clear All
              </button>
              <button
                onClick={() => handleGeneratePlan(false)}
                disabled={generating || loading || selectedWeek !== getCurrentMonday()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2 min-w-[200px]"
                title={selectedWeek !== getCurrentMonday() ? 'Can only generate for current week' : ''}
              >
                {generating ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    <span className="text-sm">
                      {generationProgress.total > 0 
                        ? `Generating... ${generationProgress.current}/${generationProgress.total}`
                        : (generatingStatus || 'Generating...')}
                    </span>
                  </>
                ) : selectedWeek !== getCurrentMonday() ? (
                  <>
                    <span>👁️</span>
                    <span className="text-sm">Past Week (View Only)</span>
                  </>
                ) : (
                  <>
                    <span>{filledSlotsCount >= 35 ? '🔄' : '✨'}</span>
                    {(() => {
                      const totalSlots = 35; // 7 days × 5 meals (breakfast, morning snack, lunch, evening snack, dinner)
                      
                      if (filledSlotsCount === 0) return 'Generate Meal Plan';
                      if (filledSlotsCount >= totalSlots) return 'Regenerate All';
                      return `Complete Meal Plan (${filledSlotsCount}/${totalSlots})`;
                    })()}
                  </>
                )}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="overflow-x-auto">
              <div className="animate-pulse">
                {/* Skeleton Table */}
                <div className="grid grid-cols-4 gap-4">
                  {[...Array(7)].map((_, rowIdx) => (
                    <div key={rowIdx} className="col-span-4 flex gap-4">
                      <div className="w-24 h-20 bg-gray-300 dark:bg-gray-800 rounded"></div>
                      {[...Array(3)].map((_, colIdx) => (
                        <div key={colIdx} className="flex-1 h-20 bg-gray-200 dark:bg-gray-900 rounded"></div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="text-center text-gray-500 dark:text-gray-400 mt-4">Loading your meal plan...</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto max-w-full">
              <table className="table-fixed border-collapse w-[1330px] md:w-[1640px]">
                <thead>
                  <tr>
                    <th className="p-2 md:p-3 text-left text-xs md:text-sm font-medium text-gray-700 dark:text-gray-400 border border-gray-300 dark:border-gray-800 bg-gray-100 dark:bg-gray-900 sticky top-0 left-0 z-30 w-[70px] md:w-[100px]">
                      Meal
                    </th>
                    {weekDays.map((day) => {
                      const isToday = day.date === new Date().toISOString().split('T')[0];
                      return (
                        <th
                          key={day.date}
                          className={`p-2 md:p-3 text-center text-xs md:text-sm font-medium border border-gray-300 dark:border-gray-800 w-[180px] md:w-[220px] sticky top-0 z-20 ${
                            isToday 
                              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-900 dark:text-blue-300' 
                              : 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-400'
                          }`}
                        >
                          <div className="font-semibold">{day.label}</div>
                          <div className="text-xs font-normal mt-0.5">{day.fullLabel.split(',')[1]?.trim()}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr key={slot}>
                      <td className="p-2 md:p-3 text-xs md:text-sm font-semibold text-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 sticky left-0 z-20 w-[70px] md:w-[100px]">
                        {slotLabels[slot]}
                      </td>
                      {weekDays.map((day) => {
                        const mealSlot = getMealForSlot(day.date, slot);
                        const hasComponents = mealSlot && mealSlot.components.length > 0;
                        const isSkipped = mealSlot?.is_skipped || false;
                        const todayString = formatDateLocal(new Date());
                        const isToday = day.date === todayString;
                        const isPast = day.date < todayString;
                        
                        return (
                          <td
                            key={`${day.date}-${slot}`}
                            className={`p-2 md:p-3 border border-gray-300 dark:border-gray-800 align-top transition-colors w-[180px] md:w-[220px] ${
                              isPast
                                ? 'bg-gray-100 dark:bg-gray-800/80 opacity-50 cursor-not-allowed'
                                : isSkipped 
                                ? 'bg-gray-100 dark:bg-gray-800/50 opacity-60' 
                                : isToday
                                ? 'bg-blue-50 dark:bg-blue-900/10'
                                : 'bg-white dark:bg-gray-900/30'
                            }`}
                          >
                            {/* Past day indicator */}
                            {isPast ? (
                              <div className="text-center py-6">
                                <span className="text-xs text-gray-400 dark:text-gray-600 italic">
                                  Past
                                </span>
                              </div>
                            ) : (
                              <>
                                {/* Skip checkbox and Remove meal button header */}
                                <div className="flex items-center justify-between mb-1.5 gap-1">
                                  <label className="flex items-center gap-1.5 cursor-pointer group" title={isSkipped ? "Eating out" : "Skip this meal"}>
                                    <input
                                      type="checkbox"
                                      checked={isSkipped}
                                      onChange={() => handleToggleSkip(day.date, slot)}
                                      className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-1 focus:ring-blue-500"
                                    />
                                    <span className="text-xs text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300">
                                      Skip
                                    </span>
                                  </label>
                                  {hasComponents && !isSkipped && (
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => handleRegenerateSlot(day.date, slot)}
                                        className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                        title="Regenerate this meal with different dishes"
                                      >
                                        🔄
                                      </button>
                                      <button
                                        onClick={() => handleRemoveSlot(day.date, slot)}
                                        className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                                        title="Remove all dishes from this meal"
                                      >
                                        🗑️
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Meal content */}
                                {isSkipped ? (
                              <div className="text-center py-3">
                                <span className="text-sm text-gray-500 dark:text-gray-500 italic">
                                  Skipped
                                </span>
                              </div>
                            ) : hasComponents ? (
                              <div className="space-y-1">
                                {mealSlot.components.map((component) => (
                                  <div
                                    key={component.id}
                                    className="group relative text-sm text-gray-900 dark:text-white bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded px-2 py-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                                  >
                                    <div className="flex items-start gap-1.5">
                                      <div className="flex-1 flex items-center gap-1">
                                        {component.dish_id ? (
                                          <Link 
                                            href={`/dish/${component.dish_id}`}
                                            className="flex-1 capitalize text-sm leading-tight hover:underline"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            {component.dish_name}
                                          </Link>
                                        ) : (
                                          <span className="flex-1 capitalize text-sm leading-tight">
                                            {component.dish_name}
                                          </span>
                                        )}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDishClick(component.id, day.date, slot);
                                          }}
                                          className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-opacity text-xs"
                                          title="Change dish"
                                        >
                                          ✏️
                                        </button>
                                      </div>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRemoveComponent(component.id);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-opacity"
                                        title="Remove this dish"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  </div>
                                ))}
                                <button
                                  onClick={() => handleCellClick(day.date, slot)}
                                  className="w-full text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                >
                                  + Add another dish
                                </button>
                              </div>
                                ) : (
                                  <button
                                    onClick={() => handleCellClick(day.date, slot)}
                                    className="w-full text-sm text-gray-500 dark:text-gray-600 hover:text-blue-600 dark:hover:text-blue-400 text-center py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded transition-colors"
                                  >
                                    + Add meal
                                  </button>
                                )}
                              </>
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
            setEditingComponentId(null);
          }}
          onNewRecipe={() => {
            router.push('/meals');
          }}
        />
      )}
    </ProtectedRoute>
  );
}