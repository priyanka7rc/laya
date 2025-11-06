"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthProvider';

interface Recipe {
  id: string;
  title: string;
  duration_min: number | null;
  tags: string[] | null;
}

interface RecipePickerProps {
  onSelect: (recipeId: string | null) => void;
  onClose: () => void;
}

export default function RecipePicker({ onSelect, onClose }: RecipePickerProps) {
  const { user } = useAuth();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchRecipes();
  }, []);

  const fetchRecipes = async () => {
    try {
      const { data, error } = await supabase
        .from('recipes')
        .select('id, title, duration_min, tags')
        .eq('user_id', user?.id)
        .order('title');

      if (error) throw error;
      setRecipes(data || []);
    } catch (err: any) {
      console.error('Error fetching recipes:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredRecipes = recipes.filter(recipe =>
    recipe.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-gray-900 rounded-lg shadow-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">Choose a Recipe</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
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

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes..."
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Recipe List */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-gray-400 text-center">Loading recipes...</p>
          ) : filteredRecipes.length === 0 ? (
            <p className="text-gray-400 text-center">
              {search ? 'No recipes found' : 'No recipes yet. Add some in the Meals page!'}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredRecipes.map((recipe) => (
                <button
                  key={recipe.id}
                  onClick={() => onSelect(recipe.id)}
                  className="w-full text-left p-4 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-blue-600 rounded-lg transition-colors"
                >
                  <h3 className="font-semibold text-white mb-1">{recipe.title}</h3>
                  <div className="flex items-center gap-3 text-sm text-gray-400">
                    {recipe.duration_min && (
                      <span>⏱️ {recipe.duration_min} min</span>
                    )}
                    {recipe.tags && recipe.tags.length > 0 && (
                      <div className="flex gap-1">
                        {recipe.tags.slice(0, 3).map((tag, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-gray-700 rounded text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-800">
          <button
            onClick={() => onSelect(null)}
            className="w-full py-2 px-4 bg-red-600/20 text-red-400 border border-red-600/50 rounded-lg hover:bg-red-600/30 transition-colors"
          >
            Remove Meal
          </button>
        </div>
      </div>
    </div>
  );
}