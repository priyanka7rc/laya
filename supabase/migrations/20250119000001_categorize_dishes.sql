-- Categorize all existing dishes with primary_component_type
-- Based on dish names and typical Indian meal patterns

-- CARB dishes (Rice, Roti, Bread-based items)
UPDATE dishes SET primary_component_type = 'carb' WHERE canonical_name IN (
  'jeera_rice', 'steamed_rice', 'pulao', 'biryani', 'fried_rice',
  'roti', 'chapati', 'paratha', 'naan', 'puri', 'bhakri', 'kulcha',
  'chole_bhature', 'pav_bhaji', 'vada_pav', 'misal_pav', 'dosa', 'idli',
  'poha', 'upma', 'sheera', 'sabudana_khichdi',
  'bread', 'toast', 'sandwich'
);

-- PROTEIN dishes (Dal, Legumes, Paneer, Eggs)
UPDATE dishes SET primary_component_type = 'protein' WHERE canonical_name IN (
  'dal_tadka', 'dal_fry', 'dal_makhani', 'sambhar',
  'rajma', 'chole', 'chana_masala', 'kala_chana',
  'paneer_tikka', 'paneer_butter_masala', 'palak_paneer', 'kadai_paneer',
  'egg_curry', 'boiled_egg', 'omelette', 'scrambled_eggs',
  'tofu_curry'
);

-- VEG dishes (Vegetable-based curries and sabzis)
UPDATE dishes SET primary_component_type = 'veg' WHERE canonical_name IN (
  'aloo_gobi', 'aloo_jeera', 'jeera_aloo', 'alu_jeera',
  'bhindi_masala', 'baingan_bharta', 'palak', 'methi_aloo',
  'capsicum_masala', 'beans_poriyal', 'cabbage_sabzi',
  'lauki_sabzi', 'turai_sabzi', 'karela_sabzi',
  'mixed_veg', 'veg_jalfrezi'
);

-- DAIRY dishes (Curd, Yogurt-based items)
UPDATE dishes SET primary_component_type = 'dairy' WHERE canonical_name IN (
  'curd', 'dahi', 'raita', 'plain_raita', 'cucumber_raita',
  'boondi_raita', 'lassi', 'buttermilk', 'chaas'
);

-- CONDIMENT dishes (Pickles, Chutneys, Papad)
UPDATE dishes SET primary_component_type = 'condiment' WHERE canonical_name IN (
  'pickle', 'achar', 'mango_pickle', 'lime_pickle',
  'chutney', 'coconut_chutney', 'tomato_chutney', 'mint_chutney',
  'papad', 'papadum'
);

-- SALAD dishes
UPDATE dishes SET primary_component_type = 'salad' WHERE canonical_name IN (
  'salad', 'green_salad', 'cucumber_salad', 'onion_salad',
  'kachumber', 'mixed_salad'
);

-- SNACK dishes (Namkeen, Fried snacks, Packaged snacks)
UPDATE dishes SET primary_component_type = 'snack' WHERE canonical_name IN (
  'samosa', 'pakora', 'bhajiya', 'vada', 'kachori',
  'namkeen', 'mixture', 'chivda', 'sev',
  'biscuit', 'cookies', 'crackers',
  'chips', 'wafers'
);

-- FRUIT dishes
UPDATE dishes SET primary_component_type = 'fruit' WHERE canonical_name IN (
  'banana', 'apple', 'orange', 'mango', 'papaya', 'watermelon',
  'grapes', 'pomegranate', 'guava', 'chikoo', 'sapota',
  'fruit_salad', 'mixed_fruit'
);

-- BEVERAGE dishes
UPDATE dishes SET primary_component_type = 'beverage' WHERE canonical_name IN (
  'chai', 'tea', 'coffee', 'green_tea', 'herbal_tea',
  'milk', 'hot_milk', 'badam_milk',
  'juice', 'fresh_juice', 'nimbu_pani', 'lemonade',
  'coconut_water', 'jaljeera'
);

-- BROTH/SOUP dishes
UPDATE dishes SET primary_component_type = 'broth' WHERE canonical_name IN (
  'rasam', 'soup', 'tomato_soup', 'veg_soup', 'dal_ka_pani'
);

-- Log categorization results
DO $$
DECLARE
  total_dishes INTEGER;
  categorized_dishes INTEGER;
  uncategorized_dishes INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_dishes FROM dishes;
  SELECT COUNT(*) INTO categorized_dishes FROM dishes WHERE primary_component_type IS NOT NULL;
  SELECT COUNT(*) INTO uncategorized_dishes FROM dishes WHERE primary_component_type IS NULL;
  
  RAISE NOTICE 'Categorization complete:';
  RAISE NOTICE '  Total dishes: %', total_dishes;
  RAISE NOTICE '  Categorized: %', categorized_dishes;
  RAISE NOTICE '  Uncategorized: %', uncategorized_dishes;
  
  IF uncategorized_dishes > 0 THEN
    RAISE NOTICE 'Uncategorized dishes need manual review.';
  END IF;
END $$;
