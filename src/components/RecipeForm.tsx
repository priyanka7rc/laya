"use client";

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthProvider';

interface RecipeFormProps {
  onSuccess?: () => void;
}

interface Ingredient {
  name: string;
  qty: string;
  unit: string;
}

export default function RecipeForm({ onSuccess }: RecipeFormProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('');
  const [servings, setServings] = useState('');
  const [tags, setTags] = useState('');
  const [ingredients, setIngredients] = useState<Ingredient[]>([{ name: '', qty: '', unit: '' }]);
  const [steps, setSteps] = useState(['']);
  const [loading, setLoading] = useState(false);

  const addIngredient = () => {
    setIngredients([...ingredients, { name: '', qty: '', unit: '' }]);
  };

  const removeIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index));
  };

  const updateIngredient = (index: number, field: keyof Ingredient, value: string) => {
    const newIngredients = [...ingredients];
    newIngredients[index][field] = value;
    setIngredients(newIngredients);
  };

  const addStep = () => {
    setSteps([...steps, '']);
  };

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, value: string) => {
    const newSteps = [...steps];
    newSteps[index] = value;
    setSteps(newSteps);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const tagsArray = tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      // Insert recipe
      const { data: recipeData, error: recipeError } = await supabase
        .from('recipes')
        .insert([{
          title,
          duration_min: duration ? parseInt(duration) : null,
          servings: servings ? parseInt(servings) : null,
          tags: tagsArray.length > 0 ? tagsArray : null,
          user_id: user?.id,
        }])
        .select()
        .single();

      if (recipeError) throw recipeError;

      const recipeId = recipeData.id;

      // Insert ingredients
      const filteredIngredients = ingredients.filter(i => i.name.trim().length > 0);
      if (filteredIngredients.length > 0) {
        const { error: ingredientsError } = await supabase
          .from('ingredients')
          .insert(
            filteredIngredients.map(ing => ({
              recipe_id: recipeId,
              name: ing.name,
              qty: ing.qty ? parseFloat(ing.qty) : null,
              unit: ing.unit || null,
            }))
          );

        if (ingredientsError) throw ingredientsError;
      }

      // Insert instructions
      const filteredSteps = steps.filter(s => s.trim().length > 0);
      if (filteredSteps.length > 0) {
        const { error: instructionsError } = await supabase
          .from('instructions')
          .insert(
            filteredSteps.map((step, index) => ({
              recipe_id: recipeId,
              step_no: index + 1,
              body: step,
            }))
          );

        if (instructionsError) throw instructionsError;
      }

      // Reset form
      setTitle('');
      setDuration('');
      setServings('');
      setTags('');
      setIngredients([{ name: '', qty: '', unit: '' }]);
      setSteps(['']);

      if (onSuccess) onSuccess();
    } catch (error: any) {
      console.error('Error saving recipe:', error);
      alert('Error saving recipe: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-6">
      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Recipe Title *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., Spaghetti Carbonara"
        />
      </div>

      {/* Duration and Servings */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Duration (minutes)
          </label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="30"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Servings
          </label>
          <input
            type="number"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="4"
          />
        </div>
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Tags (comma-separated)
        </label>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., Italian, Pasta, Quick"
        />
      </div>

      {/* Ingredients */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-300">
            Ingredients *
          </label>
          <button
            type="button"
            onClick={addIngredient}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            + Add Ingredient
          </button>
        </div>
        <div className="space-y-2">
          {ingredients.map((ingredient, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={ingredient.name}
                onChange={(e) => updateIngredient(index, 'name', e.target.value)}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Name (e.g., Tomatoes)"
              />
              <input
                type="number"
                step="0.1"
                value={ingredient.qty}
                onChange={(e) => updateIngredient(index, 'qty', e.target.value)}
                className="w-20 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Qty"
              />
              <input
                type="text"
                value={ingredient.unit}
                onChange={(e) => updateIngredient(index, 'unit', e.target.value)}
                className="w-24 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Unit"
              />
              {ingredients.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeIngredient(index)}
                  className="px-3 py-2 text-red-400 hover:text-red-300"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-300">
            Steps *
          </label>
          <button
            type="button"
            onClick={addStep}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            + Add Step
          </button>
        </div>
        <div className="space-y-2">
          {steps.map((step, index) => (
            <div key={index} className="flex gap-2">
              <div className="flex-shrink-0 w-8 h-10 flex items-center justify-center text-gray-500 font-medium">
                {index + 1}.
              </div>
              <textarea
                value={step}
                onChange={(e) => updateStep(index, e.target.value)}
                rows={2}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder={`Step ${index + 1}`}
              />
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  className="px-3 py-2 text-red-400 hover:text-red-300"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Saving...' : 'Save Recipe'}
      </button>
    </form>
  );
}