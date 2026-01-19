'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import type { Dish, RecipeVariant, IngredientJSON, StepJSON } from '@/types/relish';

interface DishWithVariant extends Dish {
  recipe_variant?: RecipeVariant | null;
}

export default function DishDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const dishId = params.id as string;

  const [dish, setDish] = useState<DishWithVariant | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    fetchDishDetails();
  }, [dishId]);

  const fetchDishDetails = async () => {
    try {
      setLoading(true);

      // Fetch dish with its recipe variant
      const { data: dishData, error: dishError } = await supabase
        .from('dishes')
        .select(`
          *,
          recipe_variant:recipe_variants!left(
            id,
            description,
            servings_default,
            prep_time_min,
            cook_time_min,
            ingredients_json,
            steps_json,
            source_type,
            source_ref,
            validator_score
          )
        `)
        .eq('id', dishId)
        .single();

      if (dishError) throw dishError;

      // Handle the array of variants (take first one)
      const variantsArray = (dishData.recipe_variant as any);
      const variant = Array.isArray(variantsArray) && variantsArray.length > 0 
        ? variantsArray[0] 
        : null;

      setDish({
        ...dishData,
        recipe_variant: variant,
      });
    } catch (error) {
      console.error('Error fetching dish details:', error);
      alert('Failed to load dish details');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white p-6">
        <div className="max-w-2xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-800 rounded w-3/4 mb-4"></div>
            <div className="h-4 bg-gray-800 rounded w-1/2 mb-8"></div>
            <div className="space-y-3">
              <div className="h-4 bg-gray-800 rounded"></div>
              <div className="h-4 bg-gray-800 rounded w-5/6"></div>
              <div className="h-4 bg-gray-800 rounded w-4/6"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!dish) {
    return (
      <div className="min-h-screen bg-black text-white p-6">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Dish Not Found</h1>
          <button
            onClick={() => router.back()}
            className="text-blue-400 hover:text-blue-300"
          >
            ← Go Back
          </button>
        </div>
      </div>
    );
  }

  const variant = dish.recipe_variant;
  const ingredients = (variant?.ingredients_json as IngredientJSON[]) || [];
  const steps = (variant?.steps_json as StepJSON[]) || [];

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black border-b border-gray-800 p-4">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ←
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{dish.canonical_name}</h1>
            {dish.cuisine_tags && dish.cuisine_tags.length > 0 && (
              <p className="text-sm text-gray-400">{dish.cuisine_tags.join(', ')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Description */}
        {variant?.description && (
          <div className="bg-gray-900 rounded-lg p-4">
            <p className="text-gray-300 leading-relaxed">{variant.description}</p>
          </div>
        )}

        {/* Recipe Meta */}
        {variant && (
          <div className="flex gap-4 text-sm text-gray-400">
            {variant.servings_default && (
              <div className="flex items-center gap-2">
                <span>🍽️</span>
                <span>Serves {variant.servings_default}</span>
              </div>
            )}
            {variant.prep_time_min && (
              <div className="flex items-center gap-2">
                <span>⏱️</span>
                <span>Prep: {variant.prep_time_min}m</span>
              </div>
            )}
            {variant.cook_time_min && (
              <div className="flex items-center gap-2">
                <span>🔥</span>
                <span>Cook: {variant.cook_time_min}m</span>
              </div>
            )}
          </div>
        )}

        {/* Ingredients */}
        <div className="bg-gray-900 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            🥘 Ingredients
          </h2>
          
          {ingredients.length > 0 ? (
            <ul className="space-y-2">
              {ingredients.map((ing, idx) => (
                <li key={idx} className="flex items-start gap-3 text-gray-300">
                  <span className="text-gray-600 text-sm mt-1">•</span>
                  <div className="flex-1">
                    <span className="capitalize">{ing.name}</span>
                    {ing.qty && ing.unit && (
                      <span className="text-gray-500 ml-2">
                        ({ing.qty} {ing.unit})
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 italic">
              No ingredients available yet. We'll compile this recipe soon!
            </p>
          )}
        </div>

        {/* Steps (Collapsible) */}
        {steps.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-4">
            <button
              onClick={() => setShowSteps(!showSteps)}
              className="w-full flex items-center justify-between text-lg font-semibold mb-2"
            >
              <span className="flex items-center gap-2">
                📝 Cooking Steps
              </span>
              <span className="text-gray-400 text-xl">
                {showSteps ? '▼' : '▶'}
              </span>
            </button>

            {showSteps && (
              <ol className="space-y-4 mt-4">
                {steps.map((step) => (
                  <li key={step.step_no} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-sm font-bold">
                      {step.step_no}
                    </span>
                    <p className="text-gray-300 flex-1 pt-0.5">{step.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* Recipe Source */}
        {variant?.source_type && (
          <div className="text-sm text-gray-500 text-center py-4 border-t border-gray-800">
            <p>
              Recipe source: {variant.source_type === 'ai' ? '✨ Laya\'s Recipe' : '👤 Your Recipe'}
            </p>
          </div>
        )}

        {/* Dish Metadata */}
        {(dish.aliases && dish.aliases.length > 0) && (
          <div className="bg-gray-900 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Also known as:</h3>
            <p className="text-gray-300">{dish.aliases.join(', ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

