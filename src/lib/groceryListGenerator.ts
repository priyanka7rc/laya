import { supabase, supabaseAdmin } from './supabaseClient';
import { IngredientJSON } from '@/types/relish';
import OpenAI from 'openai';
import { z } from 'zod';
import { getISTTimestamp } from './utils/dateUtils';

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

// ============================================================================
// UNIT CONVERSION TABLES (Rule-Based Normalization)
// ============================================================================

// Spice and liquid conversions
const VOLUME_CONVERSIONS = {
  // Spices/powders (solid)
  tsp: { g: 5, ml: 5 },
  teaspoon: { g: 5, ml: 5 },
  tbsp: { g: 15, ml: 15 },
  tablespoon: { g: 15, ml: 15 },
  cup: { g: 120, ml: 240 }, // Default cup for spices/liquids
  
  // Liquid measures
  ml: { ml: 1 },
  l: { ml: 1000 },
  liter: { ml: 1000 },
  litre: { ml: 1000 },
};

// Flour and grain conversions (denser than spices)
const FLOUR_GRAIN_CONVERSIONS: Record<string, number> = {
  cup: 200, // 1 cup flour/rice/lentils = 200g
};

// Vegetable piece conversions
const VEGETABLE_CONVERSIONS: Record<string, Record<string, number>> = {
  onion: { small: 70, medium: 100, large: 150, piece: 100, whole: 100 },
  tomato: { small: 60, medium: 100, large: 150, piece: 100, whole: 100 },
  potato: { small: 70, medium: 120, large: 180, piece: 120, whole: 120 },
  cauliflower: { small: 400, medium: 600, large: 900, head: 600, whole: 600 },
  'green chili': { small: 3, medium: 5, large: 8, piece: 5, whole: 5 },
  garlic: { clove: 3, piece: 3 },
  ginger: { inch: 5, piece: 10 },
};

// Weight conversions
const WEIGHT_CONVERSIONS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  pound: 453,
  lb: 453,
  oz: 28,
  ounce: 28,
};

// Liquid ingredient patterns
const LIQUIDS = new Set([
  'water', 'milk', 'oil', 'cream', 'vinegar', 'buttermilk',
  'curd', 'yogurt', 'coconut milk', 'tomato puree', 'lemon juice',
  'ghee', 'butter', 'stock', 'broth', 'sauce'
]);

// Flour/grain ingredient patterns
const FLOURS_GRAINS = new Set([
  'flour', 'rice', 'dal', 'lentils', 'chickpeas', 'beans',
  'oats', 'semolina', 'rava', 'poha'
]);

// ============================================================================
// TYPES & VALIDATION
// ============================================================================

type RawIngredient = {
  dish: string;
  name: string;
  qty: number | string;
  unit: string | null;
  dish_id: string;
};

type NormalizedLine = {
  i: number;
  canonical_name: string;
  metric_qty: number;
  metric_unit: 'g' | 'ml';
  is_liquid: boolean;
  source_dish_id: string;
};

type AggregatedItem = {
  name: string;
  quantity: number;
  unit: 'g' | 'kg' | 'ml' | 'L';
  source_dish_ids: string[];
  notes?: string;
};

// FIX 6: Zod validation schema
const NormalizedLineSchema = z.object({
  i: z.number(),
  canonical_name: z.string(),
  metric_qty: z.number(),
  metric_unit: z.enum(['g', 'ml']),
  is_liquid: z.boolean(),
  dish_id: z.string().optional()
});

const NormalizedResponseSchema = z.object({
  lines: z.array(NormalizedLineSchema)
});

// FIX 4: Deterministic liquid classification
function forceMetricUnit(canonical: string): 'g' | 'ml' {
  const liquidAllowlist = new Set([
    'water',
    'milk',
    'oil',
    'cream',
    'vinegar',
    'buttermilk',
    'curd',
    'yogurt',
    'coconut milk',
    'tomato puree',
    'lemon juice'
  ]);
  
  return liquidAllowlist.has(canonical.toLowerCase().trim()) ? 'ml' : 'g';
}

// DETERMINISTIC SYNONYM MAPPING (Applied after AI, before aggregation)
const SYNONYM_MAP: Record<string, string> = {
  // Spices - merge powder/seeds/whole forms
  'cumin seeds': 'cumin',
  'cumin powder': 'cumin',
  'jeera': 'cumin',
  'coriander seeds': 'coriander',
  'coriander powder': 'coriander',
  'dhania': 'coriander',
  'turmeric powder': 'turmeric',
  'haldi': 'turmeric',
  'chili powder': 'red chili powder',
  'red chili powder': 'red chili powder',
  'red chilli powder': 'red chili powder',
  'chilli powder': 'red chili powder',
  'garam masala powder': 'garam masala',
  'mustard seeds': 'mustard seeds', // Keep as-is (different from powder)
  
  // Herbs - merge fresh/dried variations
  'fresh coriander': 'coriander leaves',
  'cilantro': 'coriander leaves',
  'fresh coriander leaves': 'coriander leaves',
  'coriander leaf': 'coriander leaves',
  'curry leaf': 'curry leaves',
  'fresh curry leaves': 'curry leaves',
  
  // Flour - default ambiguous to all-purpose
  'flour': 'all-purpose flour',
  'plain flour': 'all-purpose flour',
  'maida': 'all-purpose flour',
  'atta': 'whole wheat flour',
  'wheat flour': 'whole wheat flour',
  'whole wheat atta': 'whole wheat flour',
  'besan': 'chickpea flour',
  'gram flour': 'chickpea flour',
  'chana dal flour': 'chickpea flour',
  'rice flour': 'rice flour',
  'urad dal flour': 'urad dal flour',
  
  // Vegetables - plural to singular
  'onions': 'onion',
  'tomatoes': 'tomato',
  'potatoes': 'potato',
  'green chilies': 'green chili',
  'green chillies': 'green chili',
  'curry leaves': 'curry leaves', // Already plural
  
  // Dairy - standardize names
  'curd': 'yogurt',
  'dahi': 'yogurt',
  'plain yogurt': 'yogurt',
  'thick curd': 'yogurt',
  'fresh cream': 'cream',
  'heavy cream': 'cream',
  
  // Lentils/Pulses - use common names
  'toor dal': 'toor dal',
  'toovar dal': 'toor dal',
  'arhar dal': 'toor dal',
  'moong dal': 'moong dal',
  'mung dal': 'moong dal',
  'urad dal': 'urad dal',
  'black gram': 'urad dal',
  'chana dal': 'chana dal',
  'bengal gram': 'chana dal',
  'masoor dal': 'masoor dal',
  'red lentils': 'masoor dal',
  'rajma': 'kidney beans',
  'red kidney beans': 'kidney beans',
  'kabuli chana': 'chickpeas',
  'white chickpeas': 'chickpeas',
  'chole': 'chickpeas',
  
  // Rice - keep types distinct
  'basmati rice': 'basmati rice',
  'white rice': 'rice',
  'plain rice': 'rice',
  'steamed rice': 'rice',
  
  // Oils - merge generic variants
  'cooking oil': 'oil',
  'vegetable oil': 'oil',
  'refined oil': 'oil',
  'sunflower oil': 'oil',
  'mustard oil': 'mustard oil', // Keep distinct
  'ghee': 'ghee', // Keep distinct
  'clarified butter': 'ghee',
  
  // Peppers/Capsicum
  'capsicum': 'bell pepper',
  'bell peppers': 'bell pepper',
  'green bell pepper': 'bell pepper',
  'shimla mirch': 'bell pepper',
  
  // Common ingredients
  'ginger garlic paste': 'ginger-garlic paste',
  'ginger-garlic paste': 'ginger-garlic paste',
  'spring onions': 'spring onion',
  'scallions': 'spring onion',
  'green onions': 'spring onion',
};

function applySynonymMapping(lines: NormalizedLine[]): NormalizedLine[] {
  const unknownIngredients = new Set<string>();
  
  const mapped = lines.map(line => {
    const mapped = SYNONYM_MAP[line.canonical_name];
    
    if (mapped) {
      // Found in map → use it
      return { ...line, canonical_name: mapped };
    } else {
      // Not in map → track it
      unknownIngredients.add(line.canonical_name);
      return line;
    }
  });
  
  // Log unknown ingredients for potential mapping
  if (unknownIngredients.size > 0) {
    console.log(`\nℹ️  Ingredients not in synonym map (${unknownIngredients.size}):`);
    Array.from(unknownIngredients).slice(0, 10).forEach(ing => {
      console.log(`   - "${ing}"`);
    });
    if (unknownIngredients.size > 10) {
      console.log(`   ... and ${unknownIngredients.size - 10} more`);
    }
    console.log(`   💡 Consider adding these to SYNONYM_MAP if they need merging\n`);
  }
  
  return mapped;
}

// ============================================================================
// RULE-BASED NORMALIZER (95% of ingredients, instant)
// ============================================================================

type NormalizationResult = {
  success: true;
  canonical_name: string;
  metric_qty: number;
  metric_unit: 'g' | 'ml';
  is_liquid: boolean;
  method: 'rules';
} | {
  success: false;
  reason: string;
};

function tryRuleBasedNormalization(ingredient: RawIngredient): NormalizationResult {
  const name = (ingredient.name || '').toLowerCase().trim();
  const unit = (ingredient.unit || '').toLowerCase().trim();
  const qty = typeof ingredient.qty === 'number' ? ingredient.qty : parseFloat(String(ingredient.qty)) || 0;
  
  if (qty === 0) {
    return { success: false, reason: 'MISSING_QUANTITY' };
  }
  
  // 1. Check if it's a known weight unit (already metric)
  if (WEIGHT_CONVERSIONS[unit]) {
    const grams = qty * WEIGHT_CONVERSIONS[unit];
    return {
      success: true,
      canonical_name: name,
      metric_qty: grams,
      metric_unit: 'g',
      is_liquid: LIQUIDS.has(name),
      method: 'rules'
    };
  }
  
  // 2. Check for volume units (tsp, tbsp, cup, ml, L)
  if (VOLUME_CONVERSIONS[unit]) {
    const isLiquid = LIQUIDS.has(name);
    const isFlourGrain = Array.from(FLOURS_GRAINS).some(fg => name.includes(fg));
    
    if (isLiquid) {
      // Liquid: use ml conversion
      const ml = qty * (VOLUME_CONVERSIONS[unit].ml || 0);
      if (ml > 0) {
        return {
          success: true,
          canonical_name: name,
          metric_qty: ml,
          metric_unit: 'ml',
          is_liquid: true,
          method: 'rules'
        };
      }
    } else if (isFlourGrain && unit === 'cup') {
      // Flour/grain: 1 cup = 200g
      const grams = qty * FLOUR_GRAIN_CONVERSIONS[unit];
      return {
        success: true,
        canonical_name: name,
        metric_qty: grams,
        metric_unit: 'g',
        is_liquid: false,
        method: 'rules'
      };
    } else {
      // Spice/powder: use g conversion
      const grams = qty * (VOLUME_CONVERSIONS[unit].g || 0);
      if (grams > 0) {
        return {
          success: true,
          canonical_name: name,
          metric_qty: grams,
          metric_unit: 'g',
          is_liquid: false,
          method: 'rules'
        };
      }
    }
  }
  
  // 3. Check for vegetable pieces (medium onion, large tomato, etc.)
  for (const [vegName, sizeMap] of Object.entries(VEGETABLE_CONVERSIONS)) {
    if (name.includes(vegName)) {
      // Check if unit specifies size
      const size = unit || 'medium'; // Default to medium
      if (sizeMap[size]) {
        const grams = qty * sizeMap[size];
        return {
          success: true,
          canonical_name: vegName,
          metric_qty: grams,
          metric_unit: 'g',
          is_liquid: false,
          method: 'rules'
        };
      }
      
      // Check if size is in the name itself (e.g., "large onion")
      for (const [sizeName, gramsPerPiece] of Object.entries(sizeMap)) {
        if (name.includes(sizeName)) {
          return {
            success: true,
            canonical_name: vegName,
            metric_qty: qty * gramsPerPiece,
            metric_unit: 'g',
            is_liquid: false,
            method: 'rules'
          };
        }
      }
    }
  }
  
  // 4. If unit is empty or generic (piece, whole, unit), try default conversions
  if (!unit || unit === 'piece' || unit === 'whole' || unit === 'unit' || unit === 'nos') {
    // Check vegetable list for defaults
    for (const [vegName, sizeMap] of Object.entries(VEGETABLE_CONVERSIONS)) {
      if (name.includes(vegName)) {
        const defaultGrams = sizeMap['medium'] || sizeMap['piece'] || sizeMap['whole'];
        if (defaultGrams) {
          return {
            success: true,
            canonical_name: vegName,
            metric_qty: qty * defaultGrams,
            metric_unit: 'g',
            is_liquid: false,
            method: 'rules'
          };
        }
      }
    }
  }
  
  // 5. Failed all rules - needs AI or knowledge base
  return { 
    success: false, 
    reason: unit ? 'UNUSUAL_UNIT' : 'AMBIGUOUS_QUANTITY'
  };
}

// ============================================================================
// KNOWLEDGE BASE (Ingredient-Level Cache - Permanent)
// ============================================================================

async function lookupKnowledgeBase(ingredient: RawIngredient): Promise<NormalizedLine | null> {
  const client = supabaseAdmin || supabase;
  
  const name = (ingredient.name || '').toLowerCase().trim();
  const unit = (ingredient.unit || '').toLowerCase().trim();
  
  const { data, error } = await client
    .from('ingredient_normalization_rules')
    .select('*')
    .eq('ingredient_pattern', name)
    .eq('unit_pattern', unit)
    .maybeSingle();
  
  if (error || !data) return null;
  
  // Update usage stats
  await client
    .from('ingredient_normalization_rules')
    .update({
      usage_count: (data.usage_count || 0) + 1,
      last_used_at: new Date().toISOString()
    })
    .eq('id', data.id);
  
  // Calculate final qty
  const qty = typeof ingredient.qty === 'number' ? ingredient.qty : parseFloat(String(ingredient.qty)) || 0;
  const finalQty = qty * data.metric_qty_per_unit;
  
  return {
    i: 0, // Will be set by caller
    canonical_name: data.canonical_name,
    metric_qty: finalQty,
    metric_unit: data.metric_unit,
    is_liquid: data.is_liquid,
    source_dish_id: ingredient.dish_id
  };
}

async function saveToKnowledgeBase(
  ingredient: RawIngredient,
  result: NormalizedLine,
  learnedFrom: 'rules' | 'ai'
): Promise<void> {
  const client = supabaseAdmin || supabase;
  
  const name = (ingredient.name || '').toLowerCase().trim();
  const unit = (ingredient.unit || '').toLowerCase().trim();
  const qty = typeof ingredient.qty === 'number' ? ingredient.qty : parseFloat(String(ingredient.qty)) || 1;
  
  // Calculate per-unit quantity
  const perUnitQty = result.metric_qty / qty;
  
  // Insert or update (upsert)
  const { error } = await client
    .from('ingredient_normalization_rules')
    .upsert({
      ingredient_pattern: name,
      unit_pattern: unit,
      canonical_name: result.canonical_name,
      metric_qty_per_unit: perUnitQty,
      metric_unit: result.metric_unit,
      is_liquid: result.is_liquid,
      learned_from: learnedFrom,
      confidence_score: learnedFrom === 'rules' ? 1.0 : 0.8,
      usage_count: 1
    }, {
      onConflict: 'ingredient_pattern,unit_pattern',
      ignoreDuplicates: false
    });
  
  if (error && process.env.DEBUG_GROCERY === '1') {
    console.warn(`Failed to save to knowledge base: ${error.message}`);
  }
}

// ============================================================================
// HYBRID NORMALIZATION PIPELINE (Rules → Knowledge Base → AI)
// ============================================================================

async function hybridNormalizeLines(raw: RawIngredient[]): Promise<NormalizedLine[]> {
  const startTime = Date.now();
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🔄 HYBRID NORMALIZATION (${raw.length} ingredients)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
  const results: NormalizedLine[] = [];
  const needsAI: { ingredient: RawIngredient; index: number; reason: string }[] = [];
  
  let rulesCount = 0;
  let knowledgeBaseCount = 0;
  const reasonsForAI = new Map<string, number>();
  
  // Phase 1: Try rules and knowledge base for each ingredient
  console.log(`📋 Phase 1: Rules + Knowledge Base Lookup\n`);
  
  for (let idx = 0; idx < raw.length; idx++) {
    const ingredient = raw[idx];
    
    // Try rule-based normalization first (instant)
    const ruleResult = tryRuleBasedNormalization(ingredient);
    
    if (ruleResult.success) {
      results.push({
        i: idx,
        canonical_name: ruleResult.canonical_name,
        metric_qty: ruleResult.metric_qty,
        metric_unit: ruleResult.metric_unit,
        is_liquid: ruleResult.is_liquid,
        source_dish_id: ingredient.dish_id
      });
      rulesCount++;
      
      // Save to knowledge base for future use (sample only to avoid overhead)
      if (idx < 5 || Math.random() < 0.1) {
        await saveToKnowledgeBase(ingredient, results[results.length - 1], 'rules');
      }
      continue;
    }
    
    // Try knowledge base lookup (learned patterns)
    const kbResult = await lookupKnowledgeBase(ingredient);
    
    if (kbResult) {
      kbResult.i = idx;
      results.push(kbResult);
      knowledgeBaseCount++;
      continue;
    }
    
    // Failed both: needs AI
    needsAI.push({ ingredient, index: idx, reason: ruleResult.reason });
    
    const count = reasonsForAI.get(ruleResult.reason) || 0;
    reasonsForAI.set(ruleResult.reason, count + 1);
  }
  
  const phase1Duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`   ✅ Rules: ${rulesCount}/${raw.length} (${Math.round(rulesCount/raw.length*100)}%)`);
  console.log(`   💾 Knowledge Base: ${knowledgeBaseCount}/${raw.length} (${Math.round(knowledgeBaseCount/raw.length*100)}%)`);
  console.log(`   🤖 Need AI: ${needsAI.length}/${raw.length} (${Math.round(needsAI.length/raw.length*100)}%)`);
  console.log(`   ⏱️  Phase 1 Time: ${phase1Duration}s\n`);
  
  // Phase 2: AI fallback for remaining ingredients
  if (needsAI.length > 0) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🤖 Phase 2: AI Fallback (${needsAI.length} ingredients)\n`);
    
    // Log reasons for AI
    console.log(`   Reasons AI needed:`);
    Array.from(reasonsForAI.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => {
        console.log(`      ${reason}: ${count}`);
      });
    console.log();
    
    // Show sample ingredients going to AI
    if (needsAI.length <= 10) {
      console.log(`   Ingredients going to AI:`);
      needsAI.forEach(({ ingredient }) => {
        console.log(`      - "${ingredient.name}" ${ingredient.qty} ${ingredient.unit || '(no unit)'}`);
      });
    } else {
      console.log(`   Sample ingredients going to AI:`);
      needsAI.slice(0, 5).forEach(({ ingredient }) => {
        console.log(`      - "${ingredient.name}" ${ingredient.qty} ${ingredient.unit || '(no unit)'}`);
      });
      console.log(`      ... and ${needsAI.length - 5} more`);
    }
    console.log();
    
    const aiStartTime = Date.now();
    
    // Call AI for batch (reuse existing normalizeChunk logic)
    const aiIngredients = needsAI.map(item => item.ingredient);
    const aiResults = await aiNormalizeLines(aiIngredients);
    
    // Map AI results back to correct indices and save to knowledge base
    for (let i = 0; i < needsAI.length; i++) {
      const { index, ingredient } = needsAI[i];
      const aiResult = aiResults[i];
      
      if (aiResult) {
        results.push({
          ...aiResult,
          i: index
        });
        
        // Save to knowledge base for future use
        await saveToKnowledgeBase(ingredient, aiResult, 'ai');
      }
    }
    
    const aiDuration = ((Date.now() - aiStartTime) / 1000).toFixed(1);
    console.log(`   ✅ AI Processing Time: ${aiDuration}s\n`);
  } else {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🎉 No AI needed - all handled by rules/cache!\n`);
  }
  
  // Sort results by index
  results.sort((a, b) => a.i - b.i);
  
  // Verify we got all ingredients
  if (results.length !== raw.length) {
    const missingIndices = raw
      .map((_, idx) => idx)
      .filter(idx => !results.find(r => r.i === idx));
    
    console.error(`❌ CRITICAL: Expected ${raw.length}, got ${results.length}`);
    console.error(`Missing indices:`, missingIndices);
    throw new Error(`Normalization failed: ${raw.length} → ${results.length}`);
  }
  
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 NORMALIZATION SUMMARY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   ✅ Rules: ${rulesCount} (${Math.round(rulesCount/raw.length*100)}%)`);
  console.log(`   💾 Knowledge Base: ${knowledgeBaseCount} (${Math.round(knowledgeBaseCount/raw.length*100)}%)`);
  console.log(`   🤖 AI: ${needsAI.length} (${Math.round(needsAI.length/raw.length*100)}%)`);
  console.log(`   ⏱️  Total Time: ${totalDuration}s`);
  console.log(`   💰 Cost Savings: ${rulesCount + knowledgeBaseCount} AI calls avoided\n`);
  
  return results;
}

// ============================================================================
// PHASE 1: LLM NORMALIZES EACH LINE (NO AGGREGATION)
// ============================================================================

async function aiNormalizeLines(raw: RawIngredient[]): Promise<NormalizedLine[]> {
  const CHUNK_SIZE = 50; // Optimal size for reliability - avoids JSON truncation
  const allNormalized: NormalizedLine[] = [];
  const totalChunks = Math.ceil(raw.length / CHUNK_SIZE);

  console.log(`📦 Processing ${totalChunks} chunks of ${CHUNK_SIZE} ingredients each...`);
  
  for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = raw.slice(i, i + CHUNK_SIZE);
    const chunkStartIndex = i;
    
    console.log(`   [Chunk ${chunkNum}/${totalChunks}] Normalizing lines ${i}-${i + chunk.length - 1}...`);
    const startTime = Date.now();
    
    const normalized = await normalizeChunk(chunk, chunkStartIndex);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   [Chunk ${chunkNum}/${totalChunks}] ✓ Completed in ${duration}s`);
    
    allNormalized.push(...normalized);
  }

  // HARD ASSERTION: Must return exact count
  if (allNormalized.length !== raw.length) {
    const missingIndices = raw
      .map((_, idx) => idx)
      .filter(idx => !allNormalized.find(n => n.i === idx));
    
    console.error(`❌ CRITICAL: Input ${raw.length} lines, got ${allNormalized.length}`);
    console.error('Missing indices:', missingIndices);
    
    throw new Error(`Normalization failed: ${raw.length} → ${allNormalized.length}`);
  }

  // Debug report
  if (process.env.DEBUG_GROCERY === '1') {
    const grouped = new Map<string, number>();
    allNormalized.forEach(line => {
      const count = grouped.get(line.canonical_name) || 0;
      grouped.set(line.canonical_name, count + 1);
    });
    
    console.log('\n=== DEBUG: Top 10 Ingredients by Line Count ===');
    Array.from(grouped.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([name, count]) => {
        console.log(`  ${name}: ${count} lines`);
      });
    console.log('=============================================\n');
  }

  return allNormalized;
}

async function normalizeChunk(
  chunk: RawIngredient[],
  startIndex: number
): Promise<NormalizedLine[]> {
  
  // Build JSON array input
  const inputLines = chunk.map((item, idx) => ({
    i: startIndex + idx,
    name: item.name,
    qty: item.qty,
    unit: item.unit,
    dish_id: item.dish_id
  }));

  // Updated prompt: AI does ONLY metric conversion, NO synonym merging
  const prompt = `You are a food ingredient normalizer. Convert EACH line to canonical metric form.

CRITICAL RULES:
1. Output EXACTLY ${chunk.length} lines (one per input)
2. Preserve index "i" - DO NOT skip any
3. DO NOT group, dedupe, aggregate, or sum
4. DO NOT invent items
5. DO NOT merge synonyms (we handle that in code later)

NORMALIZATION:
1. canonical_name: Use ingredient name exactly as given
   - Just convert plural to singular: "onions" → "onion", "tomatoes" → "tomato"
   - Keep everything else as-is: "cumin seeds", "cumin powder", "turmeric", "turmeric powder" are ALL different
   - DO NOT merge variants (e.g., don't convert "cilantro" → "coriander leaves")

2. metric_qty: Convert to number in grams or ml
   Spices/Powders:
   - 1 tsp = 5g, 1 tbsp = 15g, 1 cup = 120g
   
   Liquids:
   - 1 tsp = 5ml, 1 tbsp = 15ml, 1 cup = 240ml
   
   Flours/Grains:
   - 1 cup flour = 120g, 1 cup rice/lentils = 200g
   
   Vegetables (convert pieces/sizes):
   - Onion: small=70g, medium=100g, large=150g, piece=100g
   - Tomato: small=60g, medium=100g, large=150g, piece=100g
   - Potato: small=70g, medium=120g, large=180g, piece=120g
   - Cauliflower: medium=600g, head=600g, large=900g
   - Garlic: 1 clove = 3g
   - Ginger: 1 inch = 5g
   
   Weights:
   - 1 pound = 453g

3. metric_unit: MUST be EXACTLY "g" or "ml" (lowercase only)
   ⚠️ CRITICAL: Use only these two strings - NO variations like "grams", "gram", "gm", "milliliters", "mL"
   - Use "g" for all solids, powders, and dry ingredients
   - Use "ml" for all liquids (water, oil, milk, cream, vinegar, etc.)

4. is_liquid: true for water, oil, milk, cream, vinegar, false otherwise

Input array:
${JSON.stringify(inputLines, null, 2)}

Return JSON with "lines" array containing EXACTLY ${chunk.length} items:
{
  "lines": [
    {"i": 0, "canonical_name": "onion", "metric_qty": 100, "metric_unit": "g", "is_liquid": false, "dish_id": "..."},
    {"i": 1, "canonical_name": "water", "metric_qty": 240, "metric_unit": "ml", "is_liquid": true, "dish_id": "..."}
  ]
}

⚠️ VALIDATION CHECKLIST before returning:
✓ metric_unit is ONLY "g" or "ml" (no other strings)
✓ All indices from input are present
✓ Array length matches input length (${chunk.length})`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini-2024-07-18',
      messages: [
        {
          role: 'system',
          content: 'You normalize ingredient lines one-to-one. Never skip, group, or aggregate.'
        },
        { role: 'user', content: prompt }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ingredient_normalization',
          strict: false,
          schema: {
            type: 'object',
            properties: {
              lines: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    i: { type: 'number' },
                    canonical_name: { type: 'string' },
                    metric_qty: { type: 'number' },
                    metric_unit: { 
                      type: 'string',
                      enum: ['g', 'ml']
                    },
                    is_liquid: { type: 'boolean' },
                    dish_id: { type: 'string' }
                  },
                  required: ['i', 'canonical_name', 'metric_qty', 'metric_unit', 'is_liquid', 'dish_id'],
                  additionalProperties: false
                }
              }
            },
            required: ['lines'],
            additionalProperties: false
          }
        }
      },
      temperature: 0,
      top_p: 1,
      seed: 12345,
      max_tokens: 4000,
    });

    // Optional: Log fingerprint for debugging non-determinism
    if (process.env.DEBUG_GROCERY === '1' && response.system_fingerprint) {
      console.log(`  [Chunk ${startIndex}] fingerprint: ${response.system_fingerprint}`);
    }

    const content = response.choices[0].message.content;
    if (!content) throw new Error('Empty AI response');

    const parsed = JSON.parse(content);
    
    // DEBUG: Log problematic lines before cleanup
    if (parsed.lines && Array.isArray(parsed.lines)) {
      const problematicLines = parsed.lines.filter((line: any, idx: number) => {
        const unit = line.metric_unit;
        const unitType = typeof unit;
        const isArray = Array.isArray(unit);
        return unitType !== 'string' || isArray || (unit !== 'g' && unit !== 'ml');
      });
      
      if (problematicLines.length > 0) {
        console.error('🔍 DEBUG: Problematic metric_unit values found:');
        problematicLines.slice(0, 5).forEach((line: any, idx: number) => {
          console.error(`  Line ${line.i}: type=${typeof line.metric_unit}, isArray=${Array.isArray(line.metric_unit)}, value=${JSON.stringify(line.metric_unit)}, ingredient=${line.canonical_name}`);
        });
      }
    }
    
    // CLEANUP: Normalize metric_unit values before Zod validation
    if (parsed.lines && Array.isArray(parsed.lines)) {
      parsed.lines = parsed.lines.map((line: any, idx: number) => {
        const rawUnit = line.metric_unit;
        
        // Handle array case (if AI returns array instead of string)
        if (Array.isArray(rawUnit)) {
          console.warn(`⚠️ metric_unit is array at line ${idx}: ${JSON.stringify(rawUnit)}, using first element`);
          line.metric_unit = rawUnit[0] || 'g';
        }
        
        let cleanUnit = String(line.metric_unit || '').toLowerCase().trim();
        
        // Map common variations to strict 'g' or 'ml'
        if (cleanUnit === 'g' || cleanUnit === 'gm' || cleanUnit === 'gram' || cleanUnit === 'grams') {
          cleanUnit = 'g';
        } else if (cleanUnit === 'ml' || cleanUnit === 'milliliter' || cleanUnit === 'milliliters' || cleanUnit === 'mls') {
          cleanUnit = 'ml';
        } else {
          // Default to 'g' for unknown/malformed units
          console.warn(`⚠️ Unknown metric_unit "${line.metric_unit}" (type: ${typeof rawUnit}) at line ${idx}, defaulting to "g"`);
          cleanUnit = 'g';
        }
        
        return {
          ...line,
          metric_unit: cleanUnit
        };
      });
    }
    
    // FIX 6: Validate with Zod
    const validated = NormalizedResponseSchema.parse(parsed);
    const lines = validated.lines;

    // FIX 2: Strict chunk validation
    if (!Array.isArray(lines)) {
      throw new Error('Response lines is not an array');
    }

    if (lines.length !== chunk.length) {
      throw new Error(`Chunk mismatch: expected ${chunk.length}, got ${lines.length}`);
    }

    // FIX 2: Validate exact index set
    const expectedIndices = new Set(
      Array.from({ length: chunk.length }, (_, idx) => startIndex + idx)
    );
    const returnedIndices = new Set(lines.map(l => l.i));
    
    const missing = [...expectedIndices].filter(i => !returnedIndices.has(i));
    const extra = [...returnedIndices].filter(i => !expectedIndices.has(i));
    
    if (missing.length > 0 || extra.length > 0) {
      console.error('Index validation failed:');
      console.error('  Expected:', [...expectedIndices]);
      console.error('  Received:', [...returnedIndices]);
      console.error('  Missing:', missing);
      console.error('  Extra:', extra);
      throw new Error('Index mismatch in chunk');
    }

    // Map with deterministic unit enforcement
    return lines.map((line: any) => {
      const canonical = String(line.canonical_name).toLowerCase().trim();
      
      // FIX 4: Force correct unit based on ingredient type
      const deterministic_unit = forceMetricUnit(canonical);

      return {
        i: line.i,
        canonical_name: canonical,
        metric_qty: Number(line.metric_qty),
        metric_unit: deterministic_unit, // Override model's choice
        is_liquid: deterministic_unit === 'ml',
        source_dish_id: line.dish_id || chunk.find((_, idx) => startIndex + idx === line.i)!.dish_id
      };
    });

  } catch (error) {
    // FIX 1: Fail-fast, no silent fallback
    console.error('❌ Normalization chunk failed (fail-fast):', error);
    throw error;
  }
}

// ============================================================================
// SMART NOTES GENERATOR (Contextual hints for users)
// ============================================================================

function generateSmartNote(item: AggregatedItem): string | null {
  const name = item.name.toLowerCase();
  const qty = item.quantity;
  const unit = item.unit;
  
  // Convert to base units for consistent checking
  const totalGrams = unit === 'kg' ? qty * 1000 : unit === 'g' ? qty : 0;
  const totalMl = unit === 'L' ? qty * 1000 : unit === 'ml' ? qty : 0;
  
  // Pantry staples (small amounts)
  const pantryStaples = [
    'salt', 'turmeric', 'cumin', 'coriander powder', 'red chili powder',
    'garam masala', 'asafoetida', 'mustard seeds', 'fenugreek'
  ];
  
  if (pantryStaples.some(staple => name.includes(staple))) {
    if (totalGrams < 50 || totalMl < 50) {
      return 'Pantry staple - check availability at home';
    } else {
      return 'Large amount needed - check stock or purchase';
    }
  }
  
  // Oils and ghee
  if (name.includes('oil') || name.includes('ghee')) {
    if (totalMl < 100) {
      return 'Small amount - likely have at home';
    } else if (totalMl > 500) {
      return 'Consider buying a larger bottle (500ml or 1L)';
    }
  }
  
  // Bulk dry goods
  if (name.includes('rice') || name.includes('dal') || name.includes('lentils')) {
    if (totalGrams > 200) {
      return 'Sold in packages: 500g, 1kg, 5kg';
    }
  }
  
  // Flour
  if (name.includes('flour') || name.includes('atta')) {
    if (totalGrams > 300) {
      return 'Consider buying 1kg bag';
    }
  }
  
  // Fresh produce with helpful counts
  const vegCounts: Record<string, number> = {
    'onion': 100,
    'tomato': 100,
    'potato': 120,
    'green chili': 5,
  };
  
  for (const [veg, gramsEach] of Object.entries(vegCounts)) {
    if (name === veg && totalGrams > 0) {
      const count = Math.round(totalGrams / gramsEach);
      if (count === 1) {
        return `Approximately 1 ${veg}`;
      } else if (count > 1) {
        return `Approximately ${count} ${veg}s`;
      }
    }
  }
  
  return null;
}

// ============================================================================
// PHASE 2: DETERMINISTIC AGGREGATION
// ============================================================================

function aggregateNormalizedLines(lines: NormalizedLine[]): AggregatedItem[] {
  
  // Group by (canonical_name, metric_unit)
  const groups = new Map<string, {
    name: string;
    totalQty: number;
    unit: 'g' | 'ml';
    dishIds: Set<string>;
  }>();

  for (const line of lines) {
    const key = `${line.canonical_name}|${line.metric_unit}`;

    if (groups.has(key)) {
      const existing = groups.get(key)!;
      existing.totalQty += line.metric_qty;
      existing.dishIds.add(line.source_dish_id);
    } else {
      groups.set(key, {
        name: line.canonical_name,
        totalQty: line.metric_qty,
        unit: line.metric_unit,
        dishIds: new Set([line.source_dish_id])
      });
    }
  }

  // Debug: Show pre-rounding totals
  if (process.env.DEBUG_GROCERY === '1') {
    console.log('\n=== DEBUG: Top 10 by Total Grams (before rounding) ===');
    Array.from(groups.values())
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 10)
      .forEach(item => {
        console.log(`  ${item.name}: ${Math.round(item.totalQty)}${item.unit}`);
      });
    console.log('====================================================\n');
  }

  // Convert to final format
  const aggregated: AggregatedItem[] = [];

  for (const group of groups.values()) {
    let qty = group.totalQty;
    let unit: 'g' | 'kg' | 'ml' | 'L' = group.unit;

    // Rounding: 5g for <200g, 10g for >200g
    if (unit === 'g') {
      if (qty > 200) {
        qty = Math.round(qty / 10) * 10;
      } else {
        qty = Math.round(qty / 5) * 5;
      }
    } else { // ml
      if (qty > 100) {
        qty = Math.round(qty / 10) * 10;
      }
    }

    // Convert to kg/L if >= 1000
    let notes: string | undefined;
    
    if (qty >= 1000) {
      if (unit === 'g') {
        qty = Math.round((qty / 1000) * 10) / 10;
        unit = 'kg';
      } else if (unit === 'ml') {
        qty = Math.round((qty / 1000) * 10) / 10;
        unit = 'L';
      }
    }

    // Add helpful notes (legacy ones)
    if (group.name === 'onion' && unit === 'kg') {
      notes = `approximately ${Math.round((group.totalQty / 100))} medium`;
    } else if (group.name === 'tomato' && unit === 'kg') {
      notes = `approximately ${Math.round((group.totalQty / 100))} medium`;
    } else if (group.name === 'garlic' && unit === 'g') {
      notes = `approximately ${Math.round(group.totalQty / 3)} cloves`;
    }

    const item: AggregatedItem = {
      name: group.name,
      quantity: qty,
      unit: unit,
      source_dish_ids: Array.from(group.dishIds),
      notes
    };
    
    // Add smart notes if no legacy note exists
    if (!item.notes) {
      item.notes = generateSmartNote(item) || undefined;
    }
    
    aggregated.push(item);
  }

  return aggregated.sort((a, b) => a.name.localeCompare(b.name));
}

// ============================================================================
// RECIPE-LEVEL CACHING
// ============================================================================

const NORMALIZATION_VERSION = 1; // Increment to invalidate cache when logic changes

async function loadCachedNormalizedIngredients(dishIds: string[]): Promise<Map<string, NormalizedLine[]>> {
  const client = supabaseAdmin || supabase;
  
  const { data: cached, error } = await client
    .from('normalized_recipe_ingredients')
    .select('*')
    .in('dish_id', dishIds)
    .eq('normalization_version', NORMALIZATION_VERSION)
    .order('dish_id')
    .order('ingredient_index');
  
  if (error) {
    console.warn('Failed to load cache:', error);
    return new Map();
  }
  
  const cacheMap = new Map<string, NormalizedLine[]>();
  
  cached?.forEach((row: any) => {
    if (!cacheMap.has(row.dish_id)) {
      cacheMap.set(row.dish_id, []);
    }
    
    cacheMap.get(row.dish_id)!.push({
      i: row.ingredient_index,
      canonical_name: row.canonical_name,
      metric_qty: parseFloat(row.metric_qty_per_serving),
      metric_unit: row.metric_unit,
      is_liquid: row.is_liquid,
      source_dish_id: row.dish_id
    });
  });
  
  return cacheMap;
}

async function saveCachedNormalizedIngredients(
  dishId: string,
  recipeServings: number,
  normalized: NormalizedLine[]
): Promise<void> {
  const client = supabaseAdmin || supabase;
  
  // Delete existing cache for this recipe
  await client
    .from('normalized_recipe_ingredients')
    .delete()
    .eq('dish_id', dishId);
  
  // Insert new cache entries
  const cacheRows = normalized.map((line, idx) => ({
    dish_id: dishId,
    recipe_servings_default: recipeServings,
    original_name: line.canonical_name, // We don't have original here, using canonical
    original_qty: line.metric_qty / recipeServings, // Normalize to per-serving
    original_unit: line.metric_unit,
    canonical_name: line.canonical_name,
    metric_qty_per_serving: line.metric_qty / recipeServings,
    metric_unit: line.metric_unit,
    is_liquid: line.is_liquid,
    ingredient_index: idx,
    normalization_version: NORMALIZATION_VERSION
  }));
  
  const { error } = await client
    .from('normalized_recipe_ingredients')
    .insert(cacheRows);
  
  if (error) {
    console.warn(`Failed to cache normalized ingredients for dish ${dishId}:`, error);
  }
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export async function regenerateGroceryList(userId: string, weekStartDate: string) {
  try {
    const timestamp = getISTTimestamp();
    const monday = getMonday(weekStartDate);
    const mondayStr = monday.toISOString().split('T')[0];

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 GROCERY LIST REGENERATION STARTED`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   User: ${userId.substring(0, 8)}...`);
    console.log(`   Week: ${mondayStr}`);
    console.log(`   Time: ${new Date(timestamp).toLocaleString()}`);
    console.log(`${'='.repeat(60)}\n`);

    const client = supabaseAdmin || supabase;
    
    const { data: mealPlan, error: planError } = await client
      .from('meal_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('week_start_date', mondayStr)
      .maybeSingle();

    if (planError || !mealPlan) {
      console.log(`[${timestamp}] No meal plan found`);
      return;
    }

    // FIX 3: Fetch in deterministic order (day_of_week, meal_slot)
    const { data: mealItems, error: itemsError } = await client
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
            dish_id,
            dish_name,
            sort_order,
            servings
          )
        )
      `)
      .eq('meal_plan_id', mealPlan.id)
      .eq('is_skipped', false)
      .order('day_of_week', { ascending: true });

    if (itemsError) throw itemsError;

    // FIX 2: Sort by meal_slot order deterministically
    const mealSlotOrder = { breakfast: 0, lunch: 1, dinner: 2 };
    mealItems?.sort((a: any, b: any) => {
      if (a.day_of_week !== b.day_of_week) {
        return a.day_of_week - b.day_of_week;
      }
      return (mealSlotOrder[a.meal_slot as keyof typeof mealSlotOrder] || 99) - 
             (mealSlotOrder[b.meal_slot as keyof typeof mealSlotOrder] || 99);
    });

    // FIX 3: Build raw ingredients in stable order (no Set iteration)
    const dishIdToRecipe = new Map<string, any>();

    // First, collect all unique dish IDs
    const dishIds: string[] = [];
    mealItems?.forEach((item: any) => {
      const components = item.meal_plates?.meal_plate_components || [];
      // Sort components by sort_order for stability
      components.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
      
      components.forEach((comp: any) => {
        if (comp.dish_id && !dishIds.includes(comp.dish_id)) {
          dishIds.push(comp.dish_id);
        }
      });
    });

    if (dishIds.length === 0) {
      console.log(`[${timestamp}] No dishes`);
      return;
    }

    // Fetch recipes WITH servings_default
    const { data: recipeVariants, error: recipesError } = await client
      .from('recipe_variants')
      .select('dish_id, ingredients_json, servings_default')
      .in('dish_id', dishIds);

    if (recipesError) throw recipesError;

    recipeVariants?.forEach((variant: any) => {
      if (!dishIdToRecipe.has(variant.dish_id)) {
        dishIdToRecipe.set(variant.dish_id, variant);
      }
    });

    // CACHING: Load cached normalized ingredients
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💾 CHECKING CACHE`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    const cacheLoadStart = Date.now();
    const cachedIngredients = await loadCachedNormalizedIngredients(dishIds);
    const cacheLoadDuration = ((Date.now() - cacheLoadStart) / 1000).toFixed(2);
    
    const cachedDishIds = Array.from(cachedIngredients.keys());
    const uncachedDishIds = dishIds.filter(id => !cachedDishIds.includes(id));
    
    console.log(`   ✅ Cache loaded in ${cacheLoadDuration}s`);
    console.log(`   📊 ${cachedDishIds.length} recipes cached, ${uncachedDishIds.length} need normalization\n`);
    
    // FIX 3: Build ingredients in stable traversal order WITH servings multiplier
    let skippedCount = 0;
    const skippedItems: string[] = [];
    const allRawIngredients: RawIngredient[] = [];
    const allNormalizedLines: NormalizedLine[] = [];
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📝 PROCESSING INGREDIENTS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    // Track which recipes need AI normalization
    const recipesToNormalize = new Map<string, {recipe: any, servings: number}>();
    
    mealItems?.forEach((item: any) => {
      const components = item.meal_plates?.meal_plate_components || [];
      components.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
      
      components.forEach((comp: any) => {
        if (!comp.dish_id) return;
        
        const recipe = dishIdToRecipe.get(comp.dish_id);
        if (!recipe || !recipe.ingredients_json) return;

        const ingredients: IngredientJSON[] = recipe.ingredients_json || [];
        const componentServings = comp.servings || recipe.servings_default || 4;
        const recipeDefaultServings = recipe.servings_default || 2;
        const multiplier = componentServings / recipeDefaultServings;
        
        // Check if we have this recipe in cache
        const cached = cachedIngredients.get(comp.dish_id);
        
        if (cached) {
          // USE CACHE: Apply multiplier to cached normalized ingredients
          console.log(`   💾 ${comp.dish_name} (${cached.length} ingredients, CACHED, ${multiplier}x multiplier)`);
          
          cached.forEach((cachedLine) => {
            allNormalizedLines.push({
              ...cachedLine,
              metric_qty: cachedLine.metric_qty * multiplier,
              source_dish_id: comp.dish_id
            });
          });
      } else {
          // NEEDS NORMALIZATION: Build raw ingredient list
          console.log(`   🤖 ${comp.dish_name} (${ingredients.length} ingredients, ${componentServings} servings, ${multiplier}x multiplier) - needs normalization`);
          
          // Track this recipe for batch normalization
          if (!recipesToNormalize.has(comp.dish_id)) {
            recipesToNormalize.set(comp.dish_id, {
              recipe,
              servings: recipeDefaultServings
            });
          }
          
          ingredients.forEach((ing) => {
            // BLACKLIST: Skip vague/problematic ingredients
            const ingredientName = (ing.name || '').toLowerCase().trim();
            const vaguePatterns = [
              'mixed vegetable',
              'to taste',
              'as needed',
              'as required',
              'spice mix',
              'seasoning',
              'garnish',
              'for garnishing',
              'to serve',
              'water', // Don't need water in grocery list
              'ice'
            ];
            
            const isVague = vaguePatterns.some(pattern => ingredientName.includes(pattern));
            if (isVague) {
              skippedCount++;
              skippedItems.push(`"${ing.name}" from ${comp.dish_name}`);
              return;
            }
            
            // Apply serving multiplier to quantity
            let adjustedQty = typeof ing.qty === 'number' ? ing.qty : parseFloat(String(ing.qty)) || 0;
            adjustedQty = adjustedQty * multiplier;
            
            allRawIngredients.push({
              dish: comp.dish_name || 'Unknown',
          name: ing.name,
              qty: adjustedQty,
          unit: ing.unit,
              dish_id: comp.dish_id
            });
          });
        }
      });
    });

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 PROCESSING SUMMARY`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   💾 From cache: ${allNormalizedLines.length} ingredients`);
    console.log(`   🤖 Need AI: ${allRawIngredients.length} ingredients`);
    if (skippedCount > 0) {
      console.log(`   ⚠️  Skipped: ${skippedCount} vague ingredients`);
      skippedItems.slice(0, 3).forEach(item => {
        console.log(`      - ${item}`);
      });
      if (skippedItems.length > 3) {
        console.log(`      ... and ${skippedItems.length - 3} more`);
      }
    }
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // PHASE 1: LLM NORMALIZATION (only for uncached recipes)
    let newlyNormalized: NormalizedLine[] = [];
    
    if (allRawIngredients.length > 0) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🤖 PHASE 1: AI NORMALIZATION (Uncached Recipes Only)`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`   Converting ${allRawIngredients.length} new ingredients to metric units...\n`);
      
      const phase1Start = Date.now();
      newlyNormalized = await hybridNormalizeLines(allRawIngredients);
      const phase1Duration = ((Date.now() - phase1Start) / 1000).toFixed(1);
      
      console.log(`\n   ✅ Phase 1 Complete in ${phase1Duration}s`);
      console.log(`   📊 ${newlyNormalized.length} lines normalized\n`);
      
      // SAVE TO CACHE: Group by dish_id and save each recipe's normalized ingredients
      console.log(`   💾 Saving ${recipesToNormalize.size} recipes to cache...`);
      const cacheStart = Date.now();
      
      for (const [dishId, recipeInfo] of recipesToNormalize.entries()) {
        const dishIngredients = newlyNormalized.filter(line => line.source_dish_id === dishId);
        if (dishIngredients.length > 0) {
          await saveCachedNormalizedIngredients(dishId, recipeInfo.servings, dishIngredients);
        }
      }
      
      const cacheDuration = ((Date.now() - cacheStart) / 1000).toFixed(2);
      console.log(`   ✅ Cached ${recipesToNormalize.size} recipes in ${cacheDuration}s\n`);
    } else {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`⚡ PHASE 1: SKIPPED (All recipes cached!)`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    }
    
    // Combine cached + newly normalized
    const allNormalized = [...allNormalizedLines, ...newlyNormalized];
    console.log(`   📊 Total normalized ingredients: ${allNormalized.length}\n`);

    // SYNONYM MAPPING (after AI, before aggregation)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔤 SYNONYM MAPPING (Code-based)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Applying deterministic synonym map to ${allNormalized.length} ingredients...\n`);
    
    const synonymStart = Date.now();
    const mappedNormalized = applySynonymMapping(allNormalized);
    const synonymDuration = ((Date.now() - synonymStart) / 1000).toFixed(1);
    
    console.log(`\n   ✅ Synonym Mapping Complete in ${synonymDuration}s\n`);

    // PHASE 2: DETERMINISTIC AGGREGATION
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔢 PHASE 2: DETERMINISTIC AGGREGATION`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Grouping ${mappedNormalized.length} ingredients and summing quantities...\n`);
    
    const phase2Start = Date.now();
    const aggregatedItems = aggregateNormalizedLines(mappedNormalized);
    const phase2Duration = ((Date.now() - phase2Start) / 1000).toFixed(1);
    
    console.log(`   ✅ Phase 2 Complete in ${phase2Duration}s`);
    console.log(`   📊 ${aggregatedItems.length} unique items\n`);

    // Insert into database
    let { data: groceryList } = await client
      .from('grocery_lists')
      .select('id')
      .eq('meal_plan_id', mealPlan.id)
      .maybeSingle();

    if (!groceryList) {
      const { data: newList, error: createError } = await client
        .from('grocery_lists')
        .insert({ meal_plan_id: mealPlan.id, user_id: userId })
        .select('id')
        .single();

      if (createError) throw createError;
      groceryList = newList;
    }

    await client
      .from('grocery_list_items')
      .delete()
      .eq('grocery_list_id', groceryList.id);

    const items = aggregatedItems.map(item => ({
      grocery_list_id: groceryList.id,
      ingredient_id: null,
      display_name: item.name,
      quantity: item.quantity,
        unit: item.unit,
      status: 'needed' as const,
      source_dish_ids: item.source_dish_ids,
      notes: item.notes || null,
      }));

    const { error: insertError } = await client
      .from('grocery_list_items')
        .insert(items);

      if (insertError) throw insertError;

    const totalDuration = ((Date.now() - new Date(timestamp).getTime()) / 1000).toFixed(1);
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ GROCERY LIST GENERATION COMPLETE!`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   📋 ${aggregatedItems.length} items saved to database`);
    console.log(`   ⏱️  Total time: ${totalDuration}s`);
    console.log(`\n   📊 Top 5 items by quantity:`);
    
    const top5 = aggregatedItems
      .map(item => ({
        name: item.name,
        qty: item.unit === 'kg' ? item.quantity * 1000 : item.unit === 'L' ? item.quantity * 1000 : item.quantity,
        display: `${item.quantity}${item.unit}`
      }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
    
    top5.forEach((item, idx) => {
      console.log(`      ${idx + 1}. ${item.name}: ${item.display}`);
    });
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  } catch (error) {
    console.error('Error regenerating grocery list:', error);
    throw error;
  }
}

function getMonday(dateString: string): Date {
  const date = new Date(dateString);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  return monday;
}
