"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Card, Button } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useRouter } from 'next/navigation';

interface Recipe {
  id: string;
  title: string;
  duration_min: number | null;
  servings: number | null;
  created_at: string;
}

interface Ingredient {
  id: string;
  recipe_id: string;
  item: string;
  qty: number | null;
  unit: string | null;
}

interface Instruction {
  id: string;
  recipe_id: string;
  step_number: number;
  text: string;
}

interface RecipeWithDetails extends Recipe {
  ingredients: Ingredient[];
  instructions: Instruction[];
}

export default function MealsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [expandedRecipe, setExpandedRecipe] = useState<string | null>(null);
  const [recipeDetails, setRecipeDetails] = useState<Record<string, RecipeWithDetails>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  
  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formDuration, setFormDuration] = useState('');
  const [formServings, setFormServings] = useState('');
  const [formIngredients, setFormIngredients] = useState<Array<{item: string, qty: string, unit: string}>>([
    {item: '', qty: '', unit: ''}
  ]);
  const [formSteps, setFormSteps] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      fetchRecipes();
    }
  }, [user]);

  const fetchRecipes = async () => {
    try {
      const { data, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRecipes(data || []);
    } catch (err: any) {
      console.error('Error fetching recipes:', err);
      toast.error('Failed to load recipes', 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  const fetchRecipeDetails = async (recipeId: string) => {
    if (recipeDetails[recipeId]) {
      return; // Already loaded
    }

    try {
      const [ingredientsRes, instructionsRes] = await Promise.all([
        supabase
          .from('ingredients')
          .select('*')
          .eq('recipe_id', recipeId)
          .order('id', { ascending: true }),
        supabase
          .from('instructions')
          .select('*')
          .eq('recipe_id', recipeId)
          .order('step_number', { ascending: true }),
      ]);

      if (ingredientsRes.error) throw ingredientsRes.error;
      if (instructionsRes.error) throw instructionsRes.error;

      const recipe = recipes.find(r => r.id === recipeId);
      if (recipe) {
        setRecipeDetails(prev => ({
          ...prev,
          [recipeId]: {
            ...recipe,
            ingredients: ingredientsRes.data || [],
            instructions: instructionsRes.data || [],
          }
        }));
      }
    } catch (err: any) {
      console.error('Error fetching recipe details:', err);
      toast.error('Failed to load recipe details', 'Please try again');
    }
  };

  const toggleRecipe = (recipeId: string) => {
    if (expandedRecipe === recipeId) {
      setExpandedRecipe(null);
    } else {
      setExpandedRecipe(recipeId);
      fetchRecipeDetails(recipeId);
    }
  };

  const addIngredientRow = () => {
    setFormIngredients([...formIngredients, {item: '', qty: '', unit: ''}]);
  };

  const removeIngredientRow = (index: number) => {
    setFormIngredients(formIngredients.filter((_, i) => i !== index));
  };

  const updateIngredient = (index: number, field: 'item' | 'qty' | 'unit', value: string) => {
    const updated = [...formIngredients];
    updated[index][field] = value;
    setFormIngredients(updated);
  };

  const addStepRow = () => {
    setFormSteps([...formSteps, '']);
  };

  const removeStepRow = (index: number) => {
    setFormSteps(formSteps.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, value: string) => {
    const updated = [...formSteps];
    updated[index] = value;
    setFormSteps(updated);
  };

  const resetForm = () => {
    setFormTitle('');
    setFormDuration('');
    setFormServings('');
    setFormIngredients([{item: '', qty: '', unit: ''}]);
    setFormSteps(['']);
    setShowForm(false);
  };

  const handleSaveRecipe = async () => {
    // Validate
    if (!formTitle.trim()) {
      toast.error('Title required', 'Please enter a recipe title');
      return;
    }

    setSaving(true);
    try {
      // Insert recipe
      const { data: recipe, error: recipeError } = await supabase
        .from('recipes')
        .insert([{
          user_id: user?.id,
          title: formTitle.trim(),
          duration_min: formDuration ? parseInt(formDuration) : null,
          servings: formServings ? parseInt(formServings) : null,
        }])
        .select()
        .single();

      if (recipeError) throw recipeError;

      // Insert ingredients
      const ingredientsToInsert = formIngredients
        .filter(ing => ing.item.trim())
        .map(ing => ({
          recipe_id: recipe.id,
          item: ing.item.trim(),
          qty: ing.qty ? parseFloat(ing.qty) : null,
          unit: ing.unit.trim() || null,
        }));

      if (ingredientsToInsert.length > 0) {
        const { error: ingredientsError } = await supabase
          .from('ingredients')
          .insert(ingredientsToInsert);
        
        if (ingredientsError) throw ingredientsError;
      }

      // Insert instructions
      const stepsToInsert = formSteps
        .filter(step => step.trim())
        .map((step, idx) => ({
          recipe_id: recipe.id,
          step_number: idx + 1,
          text: step.trim(),
        }));

      if (stepsToInsert.length > 0) {
        const { error: stepsError } = await supabase
          .from('instructions')
          .insert(stepsToInsert);
        
        if (stepsError) throw stepsError;
      }

      // Refresh list
      await fetchRecipes();
      resetForm();
      toast.success('Recipe saved!', formTitle.trim());
    } catch (err: any) {
      console.error('Error saving recipe:', err);
      toast.error('Failed to save recipe', 'Please try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24 md:pb-8 transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-4xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2">
                🍽️ Recipes
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => router.push('/meals/groceries')}
                className="bg-gradient-to-br from-green-900/50 to-green-800/30 border-green-700/50 hover:from-green-900/60 hover:to-green-800/40"
              >
                🛒 Groceries
              </Button>
              <Button
                onClick={() => setShowForm(!showForm)}
                className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700"
              >
                {showForm ? '✕ Cancel' : '+ Add Recipe'}
              </Button>
            </div>
          </div>

          {/* Add Recipe Form */}
          {showForm && (
            <Card className="mb-6 border-orange-800/30 animate-slide-down">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">New Recipe</h2>
              
              <div className="space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Title *
                  </label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="e.g., Mediterranean Quinoa Bowl"
                    className="w-full h-11 px-4 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-base"
                    maxLength={100}
                  />
                </div>

                {/* Duration & Servings */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      ⏱️ Duration (min)
                    </label>
                    <input
                      type="number"
                      value={formDuration}
                      onChange={(e) => setFormDuration(e.target.value)}
                      placeholder="30"
                      className="w-full h-11 px-4 bg-gray-100 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-base"
                      min="1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      🍽️ Servings
                    </label>
                    <input
                      type="number"
                      value={formServings}
                      onChange={(e) => setFormServings(e.target.value)}
                      placeholder="4"
                      className="w-full h-11 px-4 bg-gray-100 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-base"
                      min="1"
                    />
                  </div>
                </div>

                {/* Ingredients */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    🥗 Ingredients
                  </label>
                  <div className="space-y-2">
                    {formIngredients.map((ing, idx) => (
                      <div key={idx} className="flex gap-2">
                        <input
                          type="text"
                          value={ing.item}
                          onChange={(e) => updateIngredient(idx, 'item', e.target.value)}
                          placeholder="Item"
                          className="flex-1 h-11 px-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 text-base"
                        />
                        <input
                          type="text"
                          value={ing.qty}
                          onChange={(e) => updateIngredient(idx, 'qty', e.target.value)}
                          placeholder="Qty"
                          className="w-20 h-11 px-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 text-base"
                        />
                        <input
                          type="text"
                          value={ing.unit}
                          onChange={(e) => updateIngredient(idx, 'unit', e.target.value)}
                          placeholder="Unit"
                          className="w-24 h-11 px-3 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 text-base"
                        />
                        {formIngredients.length > 1 && (
                          <button
                            onClick={() => removeIngredientRow(idx)}
                            className="h-11 w-11 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-xl transition-colors"
                            aria-label="Remove ingredient"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={addIngredientRow}
                      className="text-sm text-orange-400 hover:text-orange-300 font-medium"
                    >
                      + Add ingredient
                    </button>
                  </div>
                </div>

                {/* Steps */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    📝 Instructions
                  </label>
                  <div className="space-y-2">
                    {formSteps.map((step, idx) => (
                      <div key={idx} className="flex gap-2">
                        <span className="flex-shrink-0 w-8 h-11 flex items-center justify-center text-gray-400 font-medium">
                          {idx + 1}.
                        </span>
                        <textarea
                          value={step}
                          onChange={(e) => updateStep(idx, e.target.value)}
                          placeholder="Describe this step..."
                          className="flex-1 min-h-[44px] px-3 py-2.5 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 text-base resize-none"
                          rows={2}
                        />
                        {formSteps.length > 1 && (
                          <button
                            onClick={() => removeStepRow(idx)}
                            className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-xl transition-colors"
                            aria-label="Remove step"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={addStepRow}
                      className="text-sm text-orange-400 hover:text-orange-300 font-medium"
                    >
                      + Add step
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSaveRecipe}
                    loading={saving}
                    disabled={!formTitle.trim() || saving}
                    className="flex-1 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700"
                  >
                    Save Recipe
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={resetForm}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Recipe List */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Card key={i} className="animate-pulse">
                  <div className="h-6 bg-gray-200 dark:bg-gray-800 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-1/2"></div>
                </Card>
              ))}
            </div>
          ) : recipes.length === 0 ? (
            <Card className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-full mb-4">
                <span className="text-3xl">✨</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                No recipes yet
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Add your first recipe above ✨
              </p>
              <Button
                onClick={() => setShowForm(true)}
                className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700"
              >
                + Add Recipe
              </Button>
            </Card>
          ) : (
            <div className="grid gap-3">
              {recipes.map((recipe) => {
                const isExpanded = expandedRecipe === recipe.id;
                const details = recipeDetails[recipe.id];

                return (
                  <Card
                    key={recipe.id}
                    className="hover:border-orange-700/50 transition-all cursor-pointer"
                    onClick={() => toggleRecipe(recipe.id)}
                  >
                    {/* Recipe Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                          {recipe.title}
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-gray-400">
                          {recipe.duration_min && (
                            <span className="flex items-center gap-1">
                              ⏱️ {recipe.duration_min} min
                            </span>
                          )}
                          {recipe.servings && (
                            <span className="flex items-center gap-1">
                              🍽️ {recipe.servings} servings
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className={`flex-shrink-0 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      >
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </button>
                    </div>

                    {/* Recipe Details (Accordion) */}
                    {isExpanded && details && (
                      <div className="mt-4 pt-4 border-t border-gray-800 space-y-4 animate-slide-down">
                        {/* Ingredients */}
                        {details.ingredients.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
                              🥗 Ingredients
                            </h4>
                            <ul className="space-y-1.5">
                              {details.ingredients.map((ing) => (
                                <li key={ing.id} className="text-sm text-gray-400 flex items-start">
                                  <span className="mr-2">•</span>
                                  <span>
                                    {ing.qty && `${ing.qty} `}
                                    {ing.unit && `${ing.unit} `}
                                    {ing.item}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Instructions */}
                        {details.instructions.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2">
                              📝 Instructions
                            </h4>
                            <ol className="space-y-2">
                              {details.instructions.map((inst) => (
                                <li key={inst.id} className="text-sm text-gray-400 flex">
                                  <span className="font-medium text-orange-400 mr-2">
                                    {inst.step_number}.
                                  </span>
                                  <span>{inst.text}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}

