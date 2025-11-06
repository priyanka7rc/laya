// export default function MealsPage() {
//     return (
//       <div className="min-h-screen p-4 pb-20 md:pb-4">
//         <h1 className="text-2xl font-bold">Meals</h1>
//       </div>
//     );
//   }

"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import RecipeForm from '@/components/RecipeForm';
import Link from 'next/link';

interface Recipe {
  id: string;
  title: string;
  duration_min: number | null;
  servings: number | null;
  tags: string[] | null;
  created_at: string;
  ingredient_count?: number;
}

export default function MealsPage() {
  const { user } = useAuth();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (user) {
      fetchRecipes();
    }
  }, [user]);

  const fetchRecipes = async () => {
    try {
      setLoading(true);
      
      // Fetch recipes
      const { data: recipesData, error: recipesError } = await supabase
        .from('recipes')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (recipesError) throw recipesError;

      // Fetch ingredient counts for each recipe
      const recipesWithCounts = await Promise.all(
        (recipesData || []).map(async (recipe) => {
          const { count } = await supabase
            .from('ingredients')
            .select('*', { count: 'exact', head: true })
            .eq('recipe_id', recipe.id);
          
          return {
            ...recipe,
            ingredient_count: count || 0,
          };
        })
      );

      setRecipes(recipesWithCounts);
    } catch (err: any) {
      setError(err.message);
      console.error('Error fetching recipes:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-white">Meals & Recipes</h1>
            <div className="flex gap-2">
              <Link
                href="/meals/groceries"
                className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
              >
                🛒 Groceries
              </Link>
              <button
                onClick={() => setShowForm(!showForm)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                {showForm ? '− Cancel' : '+ Add Recipe'}
              </button>
            </div>
          </div>

          {showForm && (
            <div className="mb-6">
              <RecipeForm
                onSuccess={() => {
                  setShowForm(false);
                  fetchRecipes();
                }}
              />
            </div>
          )}

          {loading && (
            <p className="text-gray-400">Loading recipes...</p>
          )}

          {error && (
            <div className="bg-red-900/50 text-red-200 p-4 rounded-lg mb-4">
              Error: {error}
            </div>
          )}

          {!loading && !error && recipes.length === 0 && (
            <p className="text-gray-400">No recipes yet. Click "+ Add Recipe" to create one!</p>
          )}

          {!loading && recipes.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recipes.map((recipe) => (
                <div
                  key={recipe.id}
                  className="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition-colors"
                >
                  <h3 className="text-xl font-semibold text-white mb-3">
                    {recipe.title}
                  </h3>

                  <div className="flex items-center gap-4 text-sm text-gray-400 mb-3">
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

                  {recipe.tags && recipe.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {recipe.tags.map((tag, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 text-xs bg-gray-800 text-gray-300 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="border-t border-gray-800 pt-3 mt-3">
                    <p className="text-sm text-gray-500">
                      {recipe.ingredient_count} ingredient{recipe.ingredient_count !== 1 ? 's' : ''}
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