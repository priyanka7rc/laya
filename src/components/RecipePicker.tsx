"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthProvider';
import { Dish } from '@/types/relish';

interface DishWithVariant extends Dish {
  recipe_variant_id?: string;
  prep_time?: number;
}

interface RecipePickerProps {
  onSelect: (dishId: string | null) => void;
  onClose: () => void;
  onNewRecipe?: () => void;
}

interface IngredientInput {
  item: string;
  qty: string;
  unit: string;
}

export default function RecipePicker({ onSelect, onClose, onNewRecipe }: RecipePickerProps) {
  const { user } = useAuth();
  const [dishes, setDishes] = useState<DishWithVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  
  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formDuration, setFormDuration] = useState('');
  const [formServings, setFormServings] = useState('4');
  const [formIngredients, setFormIngredients] = useState<IngredientInput[]>([
    { item: '', qty: '', unit: '' }
  ]);
  const [formSteps, setFormSteps] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const [ingredientOptions, setIngredientOptions] = useState<string[]>([]);

  useEffect(() => {
    fetchDishes();
    fetchIngredients();
  }, []);

  const fetchDishes = async () => {
    try {
      // Fetch all dishes with their canonical recipe variants
      const { data, error } = await supabase
        .from('dishes')
        .select(`
          id,
          canonical_name,
          cuisine_tags,
          aliases,
          recipe_variants!inner (
            id,
            prep_time_min,
            cook_time_min
          )
        `)
        .order('canonical_name');

      if (error) throw error;
      
      // Transform data to include recipe variant info
      const transformedData = (data || []).map((dish: any) => ({
        id: dish.id,
        canonical_name: dish.canonical_name,
        cuisine_tags: dish.cuisine_tags || [],
        aliases: dish.aliases || [],
        ontology_tokens: [],
        typical_meal_slots: [],
        created_at: '',
        recipe_variant_id: dish.recipe_variants?.[0]?.id,
        prep_time: dish.recipe_variants?.[0]?.prep_time_min + (dish.recipe_variants?.[0]?.cook_time_min || 0),
      }));
      
      setDishes(transformedData);
    } catch (err: any) {
      console.error('Error fetching dishes:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchIngredients = async () => {
    try {
      const { data, error } = await supabase
        .from('ingredient_master')
        .select('canonical_name, synonyms')
        .order('canonical_name');

      if (error) throw error;

      // Flatten canonical names and synonyms into a single list
      const allNames = data?.flatMap(ing => 
        [ing.canonical_name, ...(ing.synonyms || [])]
      ) || [];

      // Remove duplicates and sort
      const uniqueNames = [...new Set(allNames)].sort();
      setIngredientOptions(uniqueNames);
    } catch (err: any) {
      console.error('Error fetching ingredients:', err);
    }
  };

  const addIngredient = () => {
    setFormIngredients([...formIngredients, { item: '', qty: '', unit: '' }]);
  };

  const removeIngredient = (index: number) => {
    setFormIngredients(formIngredients.filter((_, i) => i !== index));
  };

  const updateIngredient = (index: number, field: keyof IngredientInput, value: string) => {
    const newIngredients = [...formIngredients];
    newIngredients[index][field] = value;
    setFormIngredients(newIngredients);
  };

  const addStep = () => {
    setFormSteps([...formSteps, '']);
  };

  const removeStep = (index: number) => {
    setFormSteps(formSteps.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, value: string) => {
    const newSteps = [...formSteps];
    newSteps[index] = value;
    setFormSteps(newSteps);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      alert('Please enter a dish name');
      return;
    }

    setSaving(true);
    try {
      const canonicalName = formTitle.toLowerCase().trim();
      
      // Check if dish already exists
      const { data: existingDish, error: findError } = await supabase
        .from('dishes')
        .select('*')
        .eq('canonical_name', canonicalName)
        .maybeSingle();

      let dishData;
      
      if (existingDish) {
        // Use existing dish
        console.log('Using existing dish:', existingDish);
        dishData = existingDish;
      } else {
        // Create new dish
        const { data: newDish, error: dishError } = await supabase
          .from('dishes')
          .insert({
            canonical_name: canonicalName,
            cuisine_tags: [],
            aliases: [],
          })
          .select()
          .single();

        if (dishError) {
          console.error('Error creating dish:', {
            message: dishError.message,
            code: dishError.code,
            details: dishError.details,
            hint: dishError.hint,
            full: dishError
          });
          throw dishError;
        }

        console.log('Dish created successfully:', newDish);
        dishData = newDish;
      }

      // Prepare ingredients JSON
      const ingredientsJson = formIngredients
        .filter(ing => ing.item.trim())
        .map(ing => ({
          name: ing.item.trim(),
          qty: ing.qty ? parseFloat(ing.qty) : 0,
          unit: ing.unit || '',
        }));

      // Prepare steps JSON
      const stepsJson = formSteps
        .filter(step => step.trim())
        .map((step, idx) => ({
          step_no: idx + 1,
          body: step.trim(),
        }));

      // Create recipe variant
      const { data: variantData, error: variantError } = await supabase
        .from('recipe_variants')
        .insert({
          dish_id: dishData.id,
          scope_user_id: user?.id,
          source_type: 'user_choice',
          prep_time_min: formDuration ? parseInt(formDuration) : null,
          cook_time_min: 0,
          servings_default: formServings ? parseInt(formServings) : 4,
          ingredients_json: ingredientsJson,
          steps_json: stepsJson,
          validator_score: 1.0,
        })
        .select()
        .single();

      if (variantError) {
        console.error('Error creating recipe variant:', {
          message: variantError.message,
          code: variantError.code,
          details: variantError.details,
          hint: variantError.hint,
          full: variantError
        });
        throw variantError;
      }

      console.log('Recipe variant created successfully:', variantData);

      // Select the newly created dish
      onSelect(dishData.id);
    } catch (error: any) {
      console.error('Error creating recipe:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        name: error?.name,
        stack: error?.stack,
        full: error
      });
      alert('Failed to create recipe. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const filteredDishes = dishes.filter(dish =>
    dish.canonical_name.toLowerCase().includes(search.toLowerCase()) ||
    dish.aliases.some(alias => alias.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {showForm ? 'Add New Recipe' : 'Choose a Dish'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {!showForm && (
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dishes (e.g., palak paneer, butter chicken)..."
              className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {showForm ? (
            /* New Recipe Form */
            <form onSubmit={handleSubmitForm} className="space-y-6">
              {/* Dish Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Dish Name *
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g., Butter Chicken"
                  className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              {/* Duration & Servings */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Duration (min)
                  </label>
                  <input
                    type="number"
                    value={formDuration}
                    onChange={(e) => setFormDuration(e.target.value)}
                    placeholder="30"
                    className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Servings
                  </label>
                  <input
                    type="number"
                    value={formServings}
                    onChange={(e) => setFormServings(e.target.value)}
                    placeholder="4"
                    className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="1"
                  />
                </div>
              </div>

              {/* Ingredients */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Ingredients
                  </label>
                  <button
                    type="button"
                    onClick={addIngredient}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Add Ingredient
                  </button>
                </div>
                <div className="space-y-2">
                  {formIngredients.map((ing, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        list="ingredient-suggestions"
                        value={ing.item}
                        onChange={(e) => updateIngredient(idx, 'item', e.target.value)}
                        placeholder="Item (e.g., onion, tomato)"
                        className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        value={ing.qty}
                        onChange={(e) => updateIngredient(idx, 'qty', e.target.value)}
                        placeholder="Qty"
                        className="w-20 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        value={ing.unit}
                        onChange={(e) => updateIngredient(idx, 'unit', e.target.value)}
                        placeholder="Unit"
                        className="w-24 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {formIngredients.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeIngredient(idx)}
                          className="px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* Datalist for ingredient autocomplete */}
                <datalist id="ingredient-suggestions">
                  {ingredientOptions.map((option, i) => (
                    <option key={i} value={option} />
                  ))}
                </datalist>
              </div>

              {/* Steps */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Steps
                  </label>
                  <button
                    type="button"
                    onClick={addStep}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    + Add Step
                  </button>
                </div>
                <div className="space-y-2">
                  {formSteps.map((step, idx) => (
                    <div key={idx} className="flex gap-2">
                      <span className="text-sm text-gray-500 dark:text-gray-400 pt-2 w-8">{idx + 1}.</span>
                      <textarea
                        value={step}
                        onChange={(e) => updateStep(idx, e.target.value)}
                        placeholder="Describe this step..."
                        className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={2}
                      />
                      {formSteps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(idx)}
                          className="px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors self-start"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2 px-4 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={saving || !formTitle.trim()}
                  className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save & Add'}
                </button>
              </div>
            </form>
          ) : (
            /* Dish List */
            <>
              {loading ? (
                <p className="text-gray-600 dark:text-gray-400 text-center">Loading dishes...</p>
              ) : filteredDishes.length === 0 ? (
                <p className="text-gray-600 dark:text-gray-400 text-center">
                  {search ? 'No dishes found' : 'No dishes available yet!'}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredDishes.map((dish) => (
                    <button
                      key={dish.id}
                      onClick={() => onSelect(dish.id)}
                      className="w-full text-left p-4 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-750 border border-gray-300 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-600 rounded-lg transition-colors"
                    >
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-1 capitalize">{dish.canonical_name}</h3>
                      <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                        {dish.prep_time && (
                          <span>⏱️ {dish.prep_time} min</span>
                        )}
                        {dish.cuisine_tags && dish.cuisine_tags.length > 0 && (
                          <div className="flex gap-1">
                            {dish.cuisine_tags.slice(0, 3).map((tag, idx) => (
                              <span key={idx} className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs capitalize">
                                {tag.replace('_', ' ')}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer - only show when not in form mode */}
        {!showForm && (
          <div className="p-6 border-t border-gray-200 dark:border-gray-800 space-y-2">
            <button
              onClick={() => {
                setFormTitle(search);
                setShowForm(true);
              }}
              className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <span className="text-xl">+</span>
              <span>New Recipe</span>
            </button>
            
            <button
              onClick={() => onSelect(null)}
              className="w-full py-2 px-4 bg-red-100 dark:bg-red-600/20 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-600/50 rounded-lg hover:bg-red-200 dark:hover:bg-red-600/30 transition-colors"
            >
              Remove Meal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
