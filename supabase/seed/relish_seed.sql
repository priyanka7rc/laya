-- ============================================================================
-- RELISH SEED DATA
-- ============================================================================
-- Purpose: Populate core tables with Indian cuisine basics
-- Note: This is MVP seed data focusing on common Indian dishes and ingredients
-- ============================================================================

-- ============================================================================
-- INGREDIENT MASTER (40 common ingredients with UK/US/Indian synonyms)
-- ============================================================================

INSERT INTO ingredient_master (canonical_name, synonyms, unit_class, pantry_likelihood, typical_unit, category) VALUES
  -- Core Spices (high pantry likelihood - always stocked)
  ('cumin', ARRAY['jeera', 'cumin seeds', 'jeera seeds', 'cummin'], 'weight', 0.95, 'teaspoon', 'spice'),
  ('turmeric', ARRAY['haldi', 'turmeric powder', 'haldi powder'], 'weight', 0.95, 'teaspoon', 'spice'),
  ('coriander powder', ARRAY['dhaniya powder', 'ground coriander', 'coriander', 'dhania'], 'weight', 0.90, 'teaspoon', 'spice'),
  ('garam masala', ARRAY['garam masala powder', 'indian spice mix'], 'weight', 0.90, 'teaspoon', 'spice'),
  ('red chili powder', ARRAY['lal mirch', 'chilli powder', 'cayenne', 'red chilli'], 'weight', 0.90, 'teaspoon', 'spice'),
  ('mustard seeds', ARRAY['sarson', 'rai', 'yellow mustard seeds', 'black mustard seeds'], 'weight', 0.85, 'teaspoon', 'spice'),
  ('black pepper', ARRAY['kali mirch', 'pepper', 'ground pepper', 'black pepper powder'], 'weight', 0.85, 'teaspoon', 'spice'),
  ('cardamom', ARRAY['elaichi', 'green cardamom', 'cardamom pods'], 'count', 0.80, 'piece', 'spice'),
  ('cinnamon', ARRAY['dalchini', 'cinnamon stick', 'cassia'], 'count', 0.80, 'piece', 'spice'),
  ('cloves', ARRAY['laung', 'clove'], 'count', 0.80, 'piece', 'spice'),
  
  -- Fresh Aromatics (moderate-high pantry likelihood)
  ('onion', ARRAY['onions', 'yellow onion', 'red onion', 'pyaz', 'white onion'], 'count', 0.90, 'piece', 'vegetable'),
  ('garlic', ARRAY['garlic cloves', 'lahsun', 'fresh garlic', 'garlic bulb'], 'count', 0.85, 'clove', 'aromatic'),
  ('ginger', ARRAY['fresh ginger', 'ginger root', 'adrak'], 'weight', 0.85, 'inch', 'aromatic'),
  ('green chili', ARRAY['hari mirch', 'fresh chili', 'green chilli', 'serrano'], 'count', 0.75, 'piece', 'vegetable'),
  ('curry leaves', ARRAY['kadi patta', 'kari patta', 'fresh curry leaves'], 'count', 0.70, 'sprig', 'herb'),
  
  -- Core Vegetables (moderate pantry likelihood)
  ('tomato', ARRAY['tomatoes', 'roma tomato', 'cherry tomatoes', 'tamatar'], 'count', 0.70, 'piece', 'vegetable'),
  ('potato', ARRAY['potatoes', 'aloo', 'white potato'], 'count', 0.75, 'piece', 'vegetable'),
  ('spinach', ARRAY['palak', 'saag', 'spinach leaves', 'baby spinach'], 'weight', 0.30, 'cup', 'vegetable'),
  ('cauliflower', ARRAY['gobi', 'phool gobi'], 'count', 0.25, 'head', 'vegetable'),
  ('peas', ARRAY['matar', 'green peas', 'garden peas'], 'weight', 0.50, 'cup', 'vegetable'),
  ('eggplant', ARRAY['brinjal', 'baingan', 'aubergine'], 'count', 0.20, 'piece', 'vegetable'),
  ('okra', ARRAY['bhindi', 'ladyfinger', 'lady finger'], 'weight', 0.20, 'pound', 'vegetable'),
  ('bell pepper', ARRAY['capsicum', 'simla mirch', 'peppers', 'sweet pepper'], 'count', 0.40, 'piece', 'vegetable'),
  
  -- Dairy & Paneer
  ('paneer', ARRAY['cottage cheese', 'indian cheese', 'panir'], 'weight', 0.50, 'cup', 'dairy'),
  ('yogurt', ARRAY['curd', 'dahi', 'plain yogurt', 'yoghurt'], 'volume', 0.70, 'cup', 'dairy'),
  ('cream', ARRAY['heavy cream', 'double cream', 'fresh cream', 'malai'], 'volume', 0.40, 'cup', 'dairy'),
  ('ghee', ARRAY['clarified butter', 'desi ghee'], 'volume', 0.80, 'tablespoon', 'fat'),
  ('butter', ARRAY['makkhan', 'unsalted butter'], 'weight', 0.60, 'tablespoon', 'dairy'),
  
  -- Proteins
  ('chicken', ARRAY['chicken breast', 'chicken thighs', 'murgh'], 'weight', 0.40, 'pound', 'protein'),
  ('lentils', ARRAY['dal', 'daal', 'red lentils', 'masoor', 'toor dal'], 'weight', 0.85, 'cup', 'legume'),
  ('chickpeas', ARRAY['chana', 'garbanzo beans', 'kabuli chana', 'chole'], 'weight', 0.70, 'cup', 'legume'),
  ('kidney beans', ARRAY['rajma', 'red kidney beans'], 'weight', 0.60, 'cup', 'legume'),
  
  -- Staples & Base Ingredients
  ('rice', ARRAY['basmati rice', 'chawal', 'white rice'], 'weight', 0.95, 'cup', 'grain'),
  ('oil', ARRAY['vegetable oil', 'cooking oil', 'sunflower oil', 'tel'], 'volume', 0.95, 'tablespoon', 'fat'),
  ('salt', ARRAY['namak', 'table salt', 'sea salt'], 'weight', 0.98, 'teaspoon', 'seasoning'),
  ('sugar', ARRAY['cheeni', 'white sugar', 'caster sugar'], 'weight', 0.85, 'teaspoon', 'sweetener'),
  
  -- Fresh Herbs
  ('cilantro', ARRAY['coriander leaves', 'dhania', 'fresh coriander', 'chinese parsley'], 'weight', 0.60, 'cup', 'herb'),
  ('mint', ARRAY['pudina', 'fresh mint', 'mint leaves'], 'weight', 0.40, 'cup', 'herb'),
  
  -- Other Common
  ('coconut', ARRAY['nariyal', 'grated coconut', 'desiccated coconut'], 'weight', 0.50, 'cup', 'nut'),
  ('tamarind', ARRAY['imli', 'tamarind paste', 'tamarind pulp'], 'weight', 0.60, 'tablespoon', 'souring agent');

-- ============================================================================
-- DISHES (25 popular Indian dishes with ontology tokens)
-- ============================================================================
-- ontology_tokens format: 'ingredient:frequency'
--   critical = must have (>90% of recipes)
--   common = usually present (60-90%)
--   occasional = sometimes used (30-60%)
--   rare = rarely used (<30%)
-- ============================================================================

INSERT INTO dishes (canonical_name, cuisine_tags, aliases, ontology_tokens, typical_meal_slots) VALUES
  -- Paneer Dishes
  (
    'palak paneer',
    ARRAY['indian', 'vegetarian', 'punjabi', 'north_indian'],
    ARRAY['saag paneer', 'spinach paneer', 'paneer saag'],
    ARRAY['spinach:critical', 'paneer:critical', 'cream:common', 'garam_masala:common', 'cumin:common', 'onion:common', 'garlic:common', 'ginger:common', 'ghee:common', 'tomato:occasional'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'paneer butter masala',
    ARRAY['indian', 'vegetarian', 'punjabi', 'north_indian'],
    ARRAY['paneer makhani', 'butter paneer'],
    ARRAY['paneer:critical', 'butter:critical', 'cream:critical', 'tomato:critical', 'garam_masala:common', 'kasuri_methi:common', 'onion:common', 'garlic:common', 'ginger:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'paneer tikka masala',
    ARRAY['indian', 'vegetarian', 'punjabi'],
    ARRAY['tikka paneer', 'paneer tikka curry'],
    ARRAY['paneer:critical', 'yogurt:common', 'tomato:critical', 'cream:common', 'bell_pepper:common', 'onion:common', 'garam_masala:common', 'cumin:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'kadai paneer',
    ARRAY['indian', 'vegetarian', 'punjabi'],
    ARRAY['karahi paneer', 'kadhai paneer'],
    ARRAY['paneer:critical', 'bell_pepper:critical', 'tomato:critical', 'onion:common', 'ginger:common', 'garlic:common', 'coriander_powder:common', 'cumin:common'],
    ARRAY['lunch', 'dinner']
  ),
  
  -- Chicken Dishes
  (
    'butter chicken',
    ARRAY['indian', 'non_veg', 'punjabi', 'north_indian'],
    ARRAY['murgh makhani', 'chicken makhani'],
    ARRAY['chicken:critical', 'butter:critical', 'cream:critical', 'tomato:critical', 'garam_masala:common', 'kasuri_methi:common', 'yogurt:common', 'garlic:common', 'ginger:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'chicken tikka masala',
    ARRAY['indian', 'non_veg', 'punjabi'],
    ARRAY['chicken tikka curry', 'tikka masala'],
    ARRAY['chicken:critical', 'yogurt:critical', 'tomato:critical', 'cream:common', 'onion:common', 'garam_masala:common', 'cumin:common', 'coriander_powder:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'chicken curry',
    ARRAY['indian', 'non_veg', 'home_style'],
    ARRAY['murgh curry', 'basic chicken curry'],
    ARRAY['chicken:critical', 'onion:critical', 'tomato:critical', 'ginger:common', 'garlic:common', 'turmeric:common', 'red_chili_powder:common', 'garam_masala:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'chicken biryani',
    ARRAY['indian', 'non_veg', 'rice_dish', 'hyderabadi'],
    ARRAY['murgh biryani', 'hyderabadi biryani'],
    ARRAY['chicken:critical', 'rice:critical', 'yogurt:common', 'onion:common', 'garam_masala:common', 'saffron:occasional', 'mint:common', 'cilantro:common'],
    ARRAY['lunch', 'dinner']
  ),
  
  -- Dal & Legume Dishes
  (
    'dal tadka',
    ARRAY['indian', 'vegetarian', 'comfort_food'],
    ARRAY['tadka dal', 'yellow dal'],
    ARRAY['lentils:critical', 'ghee:common', 'cumin:common', 'mustard_seeds:common', 'onion:common', 'tomato:common', 'turmeric:common', 'green_chili:common', 'garlic:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'dal makhani',
    ARRAY['indian', 'vegetarian', 'punjabi', 'north_indian'],
    ARRAY['makhani dal', 'black dal'],
    ARRAY['black_lentils:critical', 'kidney_beans:common', 'butter:critical', 'cream:critical', 'tomato:common', 'garam_masala:common', 'ginger:common', 'garlic:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'chana masala',
    ARRAY['indian', 'vegetarian', 'punjabi'],
    ARRAY['chole', 'chickpea curry', 'chole masala'],
    ARRAY['chickpeas:critical', 'onion:critical', 'tomato:critical', 'garam_masala:common', 'cumin:common', 'coriander_powder:common', 'ginger:common', 'garlic:common', 'amchur:occasional'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'rajma',
    ARRAY['indian', 'vegetarian', 'punjabi', 'comfort_food'],
    ARRAY['rajma masala', 'kidney bean curry'],
    ARRAY['kidney_beans:critical', 'onion:critical', 'tomato:critical', 'garam_masala:common', 'cumin:common', 'ginger:common', 'garlic:common', 'red_chili_powder:common'],
    ARRAY['lunch', 'dinner']
  ),
  
  -- Vegetable Dishes
  (
    'aloo gobi',
    ARRAY['indian', 'vegetarian', 'dry_curry', 'punjabi'],
    ARRAY['potato cauliflower', 'gobi aloo'],
    ARRAY['potato:critical', 'cauliflower:critical', 'turmeric:common', 'cumin:common', 'ginger:common', 'tomato:occasional', 'onion:occasional'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'aloo matar',
    ARRAY['indian', 'vegetarian', 'home_style'],
    ARRAY['potato peas curry', 'matar aloo'],
    ARRAY['potato:critical', 'peas:critical', 'tomato:common', 'onion:common', 'garam_masala:common', 'cumin:common', 'turmeric:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'baingan bharta',
    ARRAY['indian', 'vegetarian', 'punjabi'],
    ARRAY['eggplant bharta', 'brinjal bharta'],
    ARRAY['eggplant:critical', 'onion:common', 'tomato:common', 'green_chili:common', 'ginger:common', 'garlic:common', 'cumin:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'bhindi masala',
    ARRAY['indian', 'vegetarian', 'dry_curry'],
    ARRAY['okra fry', 'bhindi fry', 'ladyfinger curry'],
    ARRAY['okra:critical', 'onion:common', 'tomato:common', 'turmeric:common', 'coriander_powder:common', 'cumin:common', 'amchur:occasional'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'mixed vegetable curry',
    ARRAY['indian', 'vegetarian', 'home_style'],
    ARRAY['sabzi', 'veg curry', 'mixed veg'],
    ARRAY['potato:common', 'peas:common', 'cauliflower:common', 'carrot:common', 'beans:common', 'onion:common', 'tomato:common', 'garam_masala:common'],
    ARRAY['lunch', 'dinner']
  ),
  
  -- Rice Dishes
  (
    'vegetable biryani',
    ARRAY['indian', 'vegetarian', 'rice_dish'],
    ARRAY['veg biryani', 'vegetable pulao'],
    ARRAY['rice:critical', 'mixed_vegetables:common', 'yogurt:common', 'garam_masala:common', 'mint:common', 'cilantro:common', 'onion:common'],
    ARRAY['lunch', 'dinner']
  ),
  (
    'jeera rice',
    ARRAY['indian', 'vegetarian', 'rice_dish', 'simple'],
    ARRAY['cumin rice', 'jeera pulao'],
    ARRAY['rice:critical', 'cumin:critical', 'ghee:common', 'bay_leaf:occasional'],
    ARRAY['lunch', 'dinner']
  ),
  
  -- Breakfast Items
  (
    'poha',
    ARRAY['indian', 'vegetarian', 'breakfast', 'maharashtrian'],
    ARRAY['flattened rice', 'pohe', 'aval'],
    ARRAY['flattened_rice:critical', 'onion:common', 'potato:occasional', 'peas:occasional', 'peanuts:common', 'mustard_seeds:common', 'curry_leaves:common', 'turmeric:common'],
    ARRAY['breakfast', 'morning_snack']
  ),
  (
    'upma',
    ARRAY['indian', 'vegetarian', 'breakfast', 'south_indian'],
    ARRAY['rava upma', 'suji upma'],
    ARRAY['semolina:critical', 'onion:common', 'ginger:common', 'mustard_seeds:common', 'curry_leaves:common', 'cashews:occasional', 'peas:occasional'],
    ARRAY['breakfast', 'morning_snack']
  ),
  (
    'masala dosa',
    ARRAY['indian', 'vegetarian', 'breakfast', 'south_indian'],
    ARRAY['dosa', 'masala dosai'],
    ARRAY['rice:critical', 'urad_dal:critical', 'potato:critical', 'onion:common', 'mustard_seeds:common', 'curry_leaves:common', 'turmeric:common'],
    ARRAY['breakfast', 'lunch']
  ),
  (
    'idli',
    ARRAY['indian', 'vegetarian', 'breakfast', 'south_indian'],
    ARRAY['idly', 'steamed rice cakes'],
    ARRAY['rice:critical', 'urad_dal:critical', 'fenugreek:occasional'],
    ARRAY['breakfast']
  ),
  
  -- Bread/Roti
  (
    'paratha',
    ARRAY['indian', 'vegetarian', 'bread', 'punjabi'],
    ARRAY['aloo paratha', 'stuffed paratha'],
    ARRAY['wheat_flour:critical', 'potato:common', 'ghee:common', 'ajwain:occasional'],
    ARRAY['breakfast', 'lunch', 'dinner']
  ),
  
  -- Snacks
  (
    'samosa',
    ARRAY['indian', 'vegetarian', 'snack', 'fried'],
    ARRAY['punjabi samosa', 'aloo samosa'],
    ARRAY['potato:critical', 'peas:common', 'flour:critical', 'cumin:common', 'coriander_powder:common', 'garam_masala:common', 'amchur:occasional'],
    ARRAY['evening_snack']
  );

-- ============================================================================
-- SAMPLE RECIPE VARIANTS (5 canonical recipes with full details)
-- ============================================================================

-- Palak Paneer (Canonical Global Recipe)
INSERT INTO recipe_variants (
  dish_id,
  scope_user_id,
  servings_default,
  description,
  ingredients_json,
  steps_json,
  source_type,
  validator_score,
  prep_time_min,
  cook_time_min,
  effort_level
) VALUES (
  (SELECT id FROM dishes WHERE canonical_name = 'palak paneer'),
  NULL, -- Global recipe
  4,
  'Classic North Indian spinach and paneer curry with cream',
  '[
    {"name": "spinach", "qty": 500, "unit": "gram"},
    {"name": "paneer", "qty": 250, "unit": "gram"},
    {"name": "onion", "qty": 2, "unit": "piece"},
    {"name": "tomato", "qty": 2, "unit": "piece"},
    {"name": "garlic", "qty": 6, "unit": "clove"},
    {"name": "ginger", "qty": 1, "unit": "inch"},
    {"name": "green chili", "qty": 2, "unit": "piece"},
    {"name": "cream", "qty": 0.25, "unit": "cup"},
    {"name": "cumin", "qty": 1, "unit": "teaspoon"},
    {"name": "garam masala", "qty": 1, "unit": "teaspoon"},
    {"name": "ghee", "qty": 2, "unit": "tablespoon"},
    {"name": "salt", "qty": 1, "unit": "teaspoon"}
  ]'::jsonb,
  '[
    {"step_no": 1, "body": "Blanch spinach in boiling water for 2 minutes, then transfer to ice water. Drain and blend to smooth puree."},
    {"step_no": 2, "body": "Heat ghee, add cumin seeds. Once they splutter, add chopped onions and sauté until golden."},
    {"step_no": 3, "body": "Add ginger-garlic paste and green chilies. Cook for 1 minute."},
    {"step_no": 4, "body": "Add chopped tomatoes and cook until soft (5-7 minutes)."},
    {"step_no": 5, "body": "Add spinach puree, salt, and garam masala. Simmer for 5 minutes."},
    {"step_no": 6, "body": "Add cream and paneer cubes. Cook for 3-4 minutes. Serve hot."}
  ]'::jsonb,
  'ai',
  0.95,
  15,
  20,
  3
);

-- Butter Chicken (Canonical Global Recipe)
INSERT INTO recipe_variants (
  dish_id,
  scope_user_id,
  servings_default,
  description,
  ingredients_json,
  steps_json,
  source_type,
  validator_score,
  prep_time_min,
  cook_time_min,
  effort_level
) VALUES (
  (SELECT id FROM dishes WHERE canonical_name = 'butter chicken'),
  NULL,
  4,
  'Rich and creamy Punjabi butter chicken with tomato-based gravy',
  '[
    {"name": "chicken", "qty": 1.5, "unit": "pound"},
    {"name": "butter", "qty": 4, "unit": "tablespoon"},
    {"name": "cream", "qty": 0.5, "unit": "cup"},
    {"name": "tomato", "qty": 6, "unit": "piece"},
    {"name": "yogurt", "qty": 0.5, "unit": "cup"},
    {"name": "garlic", "qty": 8, "unit": "clove"},
    {"name": "ginger", "qty": 2, "unit": "inch"},
    {"name": "garam masala", "qty": 2, "unit": "teaspoon"},
    {"name": "kasuri methi", "qty": 1, "unit": "tablespoon"},
    {"name": "red chili powder", "qty": 1, "unit": "teaspoon"},
    {"name": "salt", "qty": 1.5, "unit": "teaspoon"},
    {"name": "sugar", "qty": 1, "unit": "teaspoon"}
  ]'::jsonb,
  '[
    {"step_no": 1, "body": "Marinate chicken pieces with yogurt, half the ginger-garlic, red chili powder, and salt. Let rest 30 minutes."},
    {"step_no": 2, "body": "Grill or pan-fry marinated chicken until cooked through. Set aside."},
    {"step_no": 3, "body": "Blend tomatoes to smooth puree. In a pan, melt butter and cook remaining ginger-garlic for 1 minute."},
    {"step_no": 4, "body": "Add tomato puree, garam masala, and salt. Cook on medium heat for 15 minutes until oil separates."},
    {"step_no": 5, "body": "Add cream, sugar, and crushed kasuri methi. Simmer for 5 minutes."},
    {"step_no": 6, "body": "Add cooked chicken and simmer for 5 more minutes. Finish with a dollop of butter."}
  ]'::jsonb,
  'ai',
  0.98,
  20,
  35,
  4
);

-- Dal Tadka (Canonical Global Recipe)
INSERT INTO recipe_variants (
  dish_id,
  scope_user_id,
  servings_default,
  description,
  ingredients_json,
  steps_json,
  source_type,
  validator_score,
  prep_time_min,
  cook_time_min,
  effort_level
) VALUES (
  (SELECT id FROM dishes WHERE canonical_name = 'dal tadka'),
  NULL,
  4,
  'Comforting yellow lentil dal with tempered spices',
  '[
    {"name": "lentils", "qty": 1, "unit": "cup"},
    {"name": "ghee", "qty": 3, "unit": "tablespoon"},
    {"name": "cumin", "qty": 1, "unit": "teaspoon"},
    {"name": "mustard seeds", "qty": 0.5, "unit": "teaspoon"},
    {"name": "onion", "qty": 1, "unit": "piece"},
    {"name": "tomato", "qty": 2, "unit": "piece"},
    {"name": "garlic", "qty": 6, "unit": "clove"},
    {"name": "ginger", "qty": 1, "unit": "inch"},
    {"name": "green chili", "qty": 2, "unit": "piece"},
    {"name": "turmeric", "qty": 0.5, "unit": "teaspoon"},
    {"name": "red chili powder", "qty": 0.5, "unit": "teaspoon"},
    {"name": "garam masala", "qty": 0.5, "unit": "teaspoon"},
    {"name": "cilantro", "qty": 0.25, "unit": "cup"},
    {"name": "salt", "qty": 1, "unit": "teaspoon"}
  ]'::jsonb,
  '[
    {"step_no": 1, "body": "Wash lentils and pressure cook with turmeric and 3 cups water for 3-4 whistles. Mash lightly."},
    {"step_no": 2, "body": "Heat ghee in a pan. Add cumin and mustard seeds, let them crackle."},
    {"step_no": 3, "body": "Add chopped onions, sauté until golden. Add ginger-garlic paste and green chilies."},
    {"step_no": 4, "body": "Add chopped tomatoes and cook until soft (5 minutes)."},
    {"step_no": 5, "body": "Add red chili powder and garam masala. Pour this tempering into cooked dal."},
    {"step_no": 6, "body": "Simmer for 5-10 minutes. Garnish with cilantro and serve hot."}
  ]'::jsonb,
  'ai',
  0.92,
  10,
  25,
  2
);

-- Aloo Gobi (Canonical Global Recipe)
INSERT INTO recipe_variants (
  dish_id,
  scope_user_id,
  servings_default,
  description,
  ingredients_json,
  steps_json,
  source_type,
  validator_score,
  prep_time_min,
  cook_time_min,
  effort_level
) VALUES (
  (SELECT id FROM dishes WHERE canonical_name = 'aloo gobi'),
  NULL,
  4,
  'Dry curry of potatoes and cauliflower with aromatic spices',
  '[
    {"name": "potato", "qty": 3, "unit": "piece"},
    {"name": "cauliflower", "qty": 1, "unit": "head"},
    {"name": "onion", "qty": 1, "unit": "piece"},
    {"name": "tomato", "qty": 1, "unit": "piece"},
    {"name": "ginger", "qty": 1, "unit": "inch"},
    {"name": "green chili", "qty": 2, "unit": "piece"},
    {"name": "turmeric", "qty": 0.5, "unit": "teaspoon"},
    {"name": "cumin", "qty": 1, "unit": "teaspoon"},
    {"name": "coriander powder", "qty": 1, "unit": "teaspoon"},
    {"name": "garam masala", "qty": 0.5, "unit": "teaspoon"},
    {"name": "oil", "qty": 3, "unit": "tablespoon"},
    {"name": "cilantro", "qty": 0.25, "unit": "cup"},
    {"name": "salt", "qty": 1, "unit": "teaspoon"}
  ]'::jsonb,
  '[
    {"step_no": 1, "body": "Cut cauliflower into florets and potatoes into cubes. Parboil for 5 minutes, drain."},
    {"step_no": 2, "body": "Heat oil, add cumin seeds. Once they splutter, add chopped onions and sauté."},
    {"step_no": 3, "body": "Add ginger, green chilies, and tomatoes. Cook until soft."},
    {"step_no": 4, "body": "Add turmeric, coriander powder, and salt. Mix well."},
    {"step_no": 5, "body": "Add cauliflower and potatoes. Toss to coat with spices."},
    {"step_no": 6, "body": "Cover and cook on low heat for 10-12 minutes until vegetables are tender. Sprinkle garam masala and cilantro before serving."}
  ]'::jsonb,
  'ai',
  0.90,
  15,
  20,
  2
);

-- Chana Masala (Canonical Global Recipe)
INSERT INTO recipe_variants (
  dish_id,
  scope_user_id,
  servings_default,
  description,
  ingredients_json,
  steps_json,
  source_type,
  validator_score,
  prep_time_min,
  cook_time_min,
  effort_level
) VALUES (
  (SELECT id FROM dishes WHERE canonical_name = 'chana masala'),
  NULL,
  4,
  'Spicy and tangy chickpea curry, a Punjabi classic',
  '[
    {"name": "chickpeas", "qty": 2, "unit": "cup"},
    {"name": "onion", "qty": 2, "unit": "piece"},
    {"name": "tomato", "qty": 3, "unit": "piece"},
    {"name": "garlic", "qty": 6, "unit": "clove"},
    {"name": "ginger", "qty": 1, "unit": "inch"},
    {"name": "green chili", "qty": 2, "unit": "piece"},
    {"name": "cumin", "qty": 1.5, "unit": "teaspoon"},
    {"name": "coriander powder", "qty": 2, "unit": "teaspoon"},
    {"name": "garam masala", "qty": 1, "unit": "teaspoon"},
    {"name": "turmeric", "qty": 0.5, "unit": "teaspoon"},
    {"name": "red chili powder", "qty": 1, "unit": "teaspoon"},
    {"name": "amchur", "qty": 1, "unit": "teaspoon"},
    {"name": "oil", "qty": 3, "unit": "tablespoon"},
    {"name": "cilantro", "qty": 0.25, "unit": "cup"},
    {"name": "salt", "qty": 1.5, "unit": "teaspoon"}
  ]'::jsonb,
  '[
    {"step_no": 1, "body": "If using dried chickpeas, soak overnight and pressure cook until soft. If using canned, drain and rinse."},
    {"step_no": 2, "body": "Heat oil, add cumin seeds. Add chopped onions and sauté until golden brown."},
    {"step_no": 3, "body": "Add ginger-garlic paste and green chilies. Cook for 2 minutes."},
    {"step_no": 4, "body": "Add chopped tomatoes and cook until they break down (8-10 minutes)."},
    {"step_no": 5, "body": "Add all spice powders (coriander, turmeric, red chili, garam masala, amchur) and salt. Mix well."},
    {"step_no": 6, "body": "Add cooked chickpeas with some cooking water. Simmer for 10-15 minutes, mashing some chickpeas for thickness."},
    {"step_no": 7, "body": "Garnish with fresh cilantro and serve hot with rice or bread."}
  ]'::jsonb,
  'ai',
  0.93,
  15,
  30,
  3
);

-- ============================================================================
-- UTILITY: Grant permissions for service role operations
-- ============================================================================

-- Note: Service role bypasses RLS, so no additional grants needed
-- This comment is here to remind that server-side operations use service role key

-- ============================================================================
-- END OF SEED DATA
-- ============================================================================

-- Verification queries (run these to check seed data):
-- SELECT COUNT(*) FROM ingredient_master; -- Should be 40
-- SELECT COUNT(*) FROM dishes; -- Should be 25
-- SELECT COUNT(*) FROM recipe_variants; -- Should be 5

