/**
 * Canonical task categories. Single source of truth for:
 * - taskRulesParser.detectCategory, brainDumpParser.guessCategory
 * - refineTasks validation, WhatsApp processor filters/emoji/actions
 * - Any UI that needs an allowed category list
 *
 * Finance is the canonical name for pay/bill/bank (Bills is legacy; map for display if needed).
 */

export const TASK_CATEGORIES = [
  'Admin',
  'Finance',
  'Fitness',
  'Health',
  'Home',
  'Learning',
  'Meals',
  'Personal',
  'Shopping',
  'Tasks',
  'Work',
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const DEFAULT_CATEGORY: TaskCategory = 'Tasks';

/** Set for O(1) membership (e.g. refineTasks validation). */
export const TASK_CATEGORIES_SET = new Set<string>(TASK_CATEGORIES);

/**
 * Keyword → category. Order matters: first match wins.
 * Used by detectCategory and guessCategory for consistent inference.
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Finance: [
    'pay', 'bill', 'bank', 'money', 'transfer', 'payment', 'invoice',
    'budget', 'taxes', 'tax', 'insurance', 'atm', 'account', 'renew', 'renewal', 'subscription',
  ],
  Shopping: [
    'buy', 'purchase', 'shop', 'store', 'grocery', 'groceries', 'milk', 'bread',
    'get from', 'pick up', 'eggs', 'meat', 'vegetables', 'fruits', 'food', 'order', 'get',
  ],
  Meals: [
    'cook', 'meal', 'recipe', 'dinner', 'lunch', 'breakfast', 'eat', 'food',
    'prepare', 'make dinner', 'bake', 'grill', 'restaurant',
  ],
  Work: [
    'meeting', 'call', 'email', 'send', 'report', 'project', 'deadline',
    'presentation', 'review', 'submit', 'office', 'work', 'client', 'boss',
    'file', 'document', 'paperwork', 'expense',
  ],
  Health: [
    'doctor', 'appointment', 'medicine', 'health', 'checkup', 'dentist', 'hospital', 'therapy', 'physical',
    'take', 'vitamin', 'pill', 'supplement', 'medication',
  ],
  Admin: ['book', 'schedule', 'reserve'],
  Fitness: ['gym', 'workout', 'exercise', 'run', 'jog', 'fitness', 'yoga', 'sport'],
  Learning: ['study', 'learn', 'read', 'course', 'homework'],
  Home: [
    'clean', 'laundry', 'dishes', 'vacuum', 'organize', 'fix', 'repair',
    'maintenance', 'chore', 'trash', 'garbage', 'tidy',
  ],
  Personal: [
    'birthday', 'anniversary', 'gift', 'family', 'friend', 'mom', 'dad',
    'call mom', 'call dad', 'visit', 'party', 'call', 'text',
  ],
};

/**
 * Detect category from task text. First keyword match wins.
 * Returns DEFAULT_CATEGORY ('Tasks') if no match.
 * Used by task rules parser (mobile parity) and brain dump parser.
 */
export function detectCategory(text: string): string {
  const lowerText = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) return category;
    }
  }
  return DEFAULT_CATEGORY;
}

/** Alias for brain dump parser; same logic as detectCategory. */
export function guessCategory(text: string): string {
  return detectCategory(text);
}

/** Comma-separated list for prompts (e.g. refineTasks). */
export function getCategoryListForPrompt(): string {
  return TASK_CATEGORIES.join(', ');
}
