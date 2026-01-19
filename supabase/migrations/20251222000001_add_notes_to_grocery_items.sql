-- Add notes column to grocery_list_items for AI-generated shopping tips
ALTER TABLE grocery_list_items 
ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN grocery_list_items.notes IS 'AI-generated helpful notes like "approximately 3-4 medium onions" for quantity clarification';

