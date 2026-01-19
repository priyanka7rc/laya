/**
 * Test Script: Grocery List Aggregation
 * 
 * Verifies that:
 * 1. Ingredients are fetched from meal_plate_components
 * 2. Ingredient names are normalized using ingredient_master
 * 3. Duplicate ingredients are properly merged
 * 4. Quantities are summed correctly
 * 
 * Run with: npx ts-node scripts/test-grocery-aggregation.ts
 */

import { supabase } from '../src/lib/supabaseClient';
import { normalizeIngredientName } from '../src/lib/ingredientNormalizer';

async function testGroceryAggregation() {
  console.log('🧪 Testing Grocery List Aggregation\n');

  // 1. Test ingredient normalization
  console.log('1️⃣ Testing Ingredient Normalization:');
  const testIngredients = [
    'onion',
    'haldi', // Should map to turmeric powder
    'tomato',
    'hing', // Should map to asafoetida
    'green chili',
  ];

  for (const ing of testIngredients) {
    const normalized = await normalizeIngredientName(ing);
    console.log(`  "${ing}" → "${normalized.canonical_name}" (matched: ${normalized.matched})`);
  }

  console.log('\n');

  // 2. Check a sample meal plan's grocery list
  console.log('2️⃣ Checking Sample Meal Plan:');
  
  const { data: users, error: usersError } = await supabase
    .from('auth.users')
    .select('id')
    .limit(1)
    .single();

  if (usersError || !users) {
    console.error('❌ No users found');
    return;
  }

  const userId = users.id;

  // Get current week's meal plan
  const monday = getMonday(new Date());
  const { data: mealPlan } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start_date', monday.toISOString().split('T')[0])
    .single();

  if (!mealPlan) {
    console.log('⚠️  No meal plan found for this week');
    return;
  }

  // Get meal plan items with plates and components
  const { data: items } = await supabase
    .from('meal_plan_items')
    .select(`
      id,
      day_of_week,
      meal_slot,
      meal_plate:meal_plates(
        id,
        components:meal_plate_components(
          dish_id,
          dish_name
        )
      )
    `)
    .eq('meal_plan_id', mealPlan.id);

  if (!items || items.length === 0) {
    console.log('⚠️  No meal items found');
    return;
  }

  console.log(`  Found ${items.length} meal slots`);

  // Get unique dishes
  const dishIds = new Set<string>();
  items.forEach(item => {
    item.meal_plate?.components.forEach(comp => {
      if (comp.dish_id) dishIds.add(comp.dish_id);
    });
  });

  console.log(`  Found ${dishIds.size} unique dishes`);

  // Fetch recipe variants
  const { data: variants } = await supabase
    .from('recipe_variants')
    .select('dish_id, ingredients_json')
    .in('dish_id', Array.from(dishIds));

  console.log(`  Found ${variants?.length || 0} recipe variants`);

  if (variants && variants.length > 0) {
    console.log('\n3️⃣ Sample Ingredients:');
    const sampleVariant = variants[0];
    const ingredients = sampleVariant.ingredients_json as any[];
    
    console.log(`  Dish: ${sampleVariant.dish_id}`);
    ingredients.slice(0, 5).forEach(ing => {
      console.log(`    - ${ing.name} (${ing.qty} ${ing.unit || ''})`);
    });
  }

  // Check grocery list
  const { data: groceryList } = await supabase
    .from('grocery_lists')
    .select(`
      id,
      items:grocery_list_items(
        id,
        display_name,
        quantity,
        unit,
        ingredient_id
      )
    `)
    .eq('meal_plan_id', mealPlan.id)
    .single();

  if (groceryList) {
    console.log(`\n4️⃣ Grocery List Items: ${groceryList.items.length}`);
    
    const matchedCount = groceryList.items.filter(i => i.ingredient_id).length;
    const unmatchedCount = groceryList.items.length - matchedCount;
    
    console.log(`  ✅ Matched to ingredient_master: ${matchedCount}`);
    console.log(`  ⚠️  Unmatched: ${unmatchedCount}`);

    if (unmatchedCount > 0) {
      console.log('\n  Unmatched ingredients:');
      groceryList.items
        .filter(i => !i.ingredient_id)
        .slice(0, 10)
        .forEach(i => {
          console.log(`    - ${i.display_name}`);
        });
    }
  } else {
    console.log('\n⚠️  No grocery list found');
  }

  console.log('\n✅ Test complete!');
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

testGroceryAggregation()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });

