/**
 * Deterministic Ingredient Normalization
 * Maps ingredient names to canonical forms using ingredient_master
 * NO fuzzy matching - uses exact synonym mapping only
 */

import { supabase } from './supabaseClient';

interface IngredientMasterEntry {
  id: string;
  canonical_name: string;
  synonyms: string[];
  unit_class: string;
  typical_unit: string | null;
}

// In-memory cache of ingredient master (loaded once)
let ingredientMasterCache: Map<string, IngredientMasterEntry> | null = null;

/**
 * Load ingredient master into memory
 */
async function loadIngredientMaster(): Promise<Map<string, IngredientMasterEntry>> {
  if (ingredientMasterCache) {
    return ingredientMasterCache;
  }

  const { data, error } = await supabase
    .from('ingredient_master')
    .select('id, canonical_name, synonyms, unit_class, typical_unit');

  if (error) {
    console.error('Error loading ingredient master:', error);
    return new Map();
  }

  const cache = new Map<string, IngredientMasterEntry>();
  
  data?.forEach(ing => {
    // Add canonical name
    cache.set(ing.canonical_name.toLowerCase().trim(), ing);
    
    // Add all synonyms
    ing.synonyms?.forEach(syn => {
      cache.set(syn.toLowerCase().trim(), ing);
    });
  });

  ingredientMasterCache = cache;
  console.log(`✅ Loaded ${cache.size} ingredient mappings`);
  return cache;
}

/**
 * Normalize a single ingredient name deterministically
 */
export async function normalizeIngredientName(rawName: string): Promise<{
  canonical_name: string;
  ingredient_id: string | null;
  matched: boolean;
}> {
  const masterMap = await loadIngredientMaster();
  const normalized = rawName.toLowerCase().trim();

  // Try exact match first
  const match = masterMap.get(normalized);
  
  if (match) {
    return {
      canonical_name: match.canonical_name,
      ingredient_id: match.id,
      matched: true,
    };
  }

  // No match found - return as-is
  // In future: could log to unresolved_ingredients table for review
  return {
    canonical_name: rawName.trim(),
    ingredient_id: null,
    matched: false,
  };
}

/**
 * Normalize a batch of ingredient names
 */
export async function normalizeIngredients(rawNames: string[]): Promise<Map<string, {
  canonical_name: string;
  ingredient_id: string | null;
}>> {
  const masterMap = await loadIngredientMaster();
  const results = new Map();

  for (const rawName of rawNames) {
    const normalized = rawName.toLowerCase().trim();
    const match = masterMap.get(normalized);

    results.set(rawName, {
      canonical_name: match?.canonical_name || rawName.trim(),
      ingredient_id: match?.id || null,
    });
  }

  return results;
}

/**
 * Clear cache (for testing or when ingredient_master updates)
 */
export function clearIngredientCache(): void {
  ingredientMasterCache = null;
}

