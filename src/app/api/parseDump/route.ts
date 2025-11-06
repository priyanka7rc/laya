import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Zod schema for a single task
const TaskSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().optional().nullable(),
  due_date: z.string().nullable(), // ISO date string or null
  due_time: z.string().nullable(), // HH:MM format or null
  category: z.string().nullable(),
//   priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
});

// Zod schema for the API response
const ParsedDumpSchema = z.object({
  tasks: z.array(TaskSchema),
  summary: z.string().optional(),
});

// Types derived from schemas
type Task = z.infer<typeof TaskSchema>;
type ParsedDump = z.infer<typeof ParsedDumpSchema>;

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // TODO: Replace this with actual OpenAI call when ready
    const parsedDump = await mockParseText(text);

    // Validate response with Zod
    const validatedResult = ParsedDumpSchema.parse(parsedDump);

    return NextResponse.json(validatedResult);
  } catch (error: any) {
    console.error('Error parsing dump:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid response format', details: error.errors },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to parse brain dump' },
      { status: 500 }
    );
  }
}

/**
 * Mock function that simulates OpenAI parsing
 * Replace this with actual OpenAI call later
 */
async function mockParseText(text: string): Promise<ParsedDump> {
  await new Promise(resolve => setTimeout(resolve, 800));

  // Split into separate tasks
  const taskStrings = text
    .split(/[,;]|(?:\band\b)/i)
    .map(t => t.trim())
    .filter(t => t.length > 0);

    if (taskStrings.length === 0) {
      return {
        tasks: [{
          title: text.trim().slice(0, 100),
          notes: null,
          due_date: getTodayDate(),  // Changed from null
          due_time: '20:00:00',      // Changed from null
          category: 'Brain Dump',
        }],
        summary: 'Extracted 1 task',
      };
    }

  // Parse each task string individually
  const parsedTasks = taskStrings.map(taskStr => {
    // Extract and remove date/time info to get clean title
    const timeInfo = extractTimeFromText(taskStr);
    const dateInfo = extractDateFromText(taskStr);
    
    // Remove date/time phrases from title
    let cleanTitle = taskStr
      .replace(/\b(at|@)\s*\d{1,2}:?\d{0,2}\s*(am|pm)?\b/gi, '')
      .replace(/\btomorrow\b/gi, '')
      .replace(/\btoday\b/gi, '')
      .replace(/\bmonday|tuesday|wednesday|thursday|friday|saturday|sunday\b/gi, '')
      .replace(/\bnext week\b/gi, '')
      .replace(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
      .trim();

    // Capitalize first letter
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

    return {
      title: cleanTitle.slice(0, 100),
      notes: null,
      due_date: dateInfo || getTodayDate(),
      due_time: timeInfo || '20:00:00',
      category: guessCategory(taskStr),
    };
  });

  return {
    tasks: parsedTasks,
    summary: `Extracted ${parsedTasks.length} task(s) from your brain dump`,
  };
}

// Improved time extraction
// Improved time extraction
function extractTimeFromText(text: string): string | null {
  const lowerText = text.toLowerCase();
  
  // Pattern 1: "at 3pm", "at 3:30pm", "@3pm"
  const pattern1 = /(?:at|@)\s*(\d{1,2}):?(\d{2})?\s*(am|pm)/i;
  const match1 = lowerText.match(pattern1);
  if (match1) {
    let hours = parseInt(match1[1]);
    const minutes = match1[2] || '00';
    const meridiem = match1[3].toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
  }

  // Pattern 2: "3pm", "10am" (without "at")
  const pattern2 = /\b(\d{1,2})\s*(am|pm)\b/i;
  const match2 = lowerText.match(pattern2);
  if (match2) {
    let hours = parseInt(match2[1]);
    const minutes = '00';
    const meridiem = match2[2].toLowerCase();

    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
  }

  // Pattern 3: "15:00", "3:30" (24-hour or ambiguous)
  const pattern3 = /\b(\d{1,2}):(\d{2})\b/i;
  const match3 = lowerText.match(pattern3);
  if (match3) {
    let hours = parseInt(match3[1]);
    const minutes = match3[2];

    // If hours < 8 and no meridiem, assume PM
    if (hours < 8 && hours > 0) hours += 12;

    return `${hours.toString().padStart(2, '0')}:${minutes}:00`;
  }

  return null;
}

// Improved date extraction
function extractDateFromText(text: string): string | null {
  const lowerText = text.toLowerCase();
  const today = new Date();

  // Check for relative dates
  if (lowerText.includes('today')) {
    return getTodayDate();
  }

  if (lowerText.includes('tomorrow')) {
    return getTomorrowDate();
  }

  // Check for "by Friday" or "on Friday" or just "Friday"
  const dayOfWeekMatch = lowerText.match(/\b(?:by|on)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (dayOfWeekMatch) {
    const dayName = dayOfWeekMatch[1].toLowerCase();
    const dayMap: { [key: string]: number } = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6
    };
    return getNextDayOfWeek(dayMap[dayName]);
  }

  // Check for "next week"
  if (lowerText.includes('next week')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    return nextWeek.toISOString().split('T')[0];
  }

  // Check for "this weekend"
  if (lowerText.includes('weekend')) {
    return getNextDayOfWeek(6); // Saturday
  }

  return null;
}

function guessCategory(text: string): string | null {
  const lower = text.toLowerCase();

  if (lower.match(/\b(groceries|grocery|food|cook|meal|dinner|lunch|breakfast|eat)\b/)) return 'Meals';
  if (lower.match(/\b(gym|workout|exercise|run|jog|fitness|yoga|sport)\b/)) return 'Fitness';
  if (lower.match(/\b(work|project|meeting|deadline|client|email|presentation)\b/)) return 'Work';
  if (lower.match(/\b(call|text|mom|dad|family|friend|visit|birthday)\b/)) return 'Personal';
  if (lower.match(/\b(shop|buy|purchase|order|get|pick up)\b/)) return 'Shopping';
  if (lower.match(/\b(study|learn|read|course|book|homework)\b/)) return 'Learning';
  if (lower.match(/\b(doctor|dentist|appointment|checkup|medicine)\b/)) return 'Health';
  if (lower.match(/\b(clean|laundry|dishes|vacuum|organize)\b/)) return 'Home';

  return 'Brain Dump';
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function getTomorrowDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

function getNextDayOfWeek(targetDay: number): string {
  const today = new Date();
  const currentDay = today.getDay();
  let daysUntil = targetDay - currentDay;
  
  // If target day is today or already passed this week, go to next week
  if (daysUntil <= 0) {
    daysUntil += 7;
  }
  
  const nextDay = new Date(today);
  nextDay.setDate(today.getDate() + daysUntil);
  return nextDay.toISOString().split('T')[0];
}
