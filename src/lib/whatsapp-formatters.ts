/**
 * WhatsApp Template Formatters
 * Deterministic formatting functions for template parameters
 */

// ============================================
// DATE/TIME FORMATTING
// ============================================

/**
 * Format due date and time for WhatsApp templates
 * 
 * @param due_date - Date in YYYY-MM-DD format or null
 * @param due_time - Time in HH:MM format (24h) or null
 * @returns Formatted date/time string
 * 
 * Examples:
 * - formatWhen('2026-02-05', null) -> 'today' (if today is 2026-02-05)
 * - formatWhen('2026-02-06', null) -> 'tomorrow' (if today is 2026-02-05)
 * - formatWhen('2026-02-07', null) -> '2026-02-07'
 * - formatWhen('2026-02-05', '18:00') -> 'today at 6pm'
 * - formatWhen('2026-02-05', '18:30') -> 'today at 6:30pm'
 */
export function formatWhen(
  due_date: string | null,
  due_time: string | null
): string {
  if (!due_date) {
    return 'later';
  }

  // Get today and tomorrow in YYYY-MM-DD format
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = tomorrowDate.toISOString().split('T')[0];

  let dateStr: string;
  if (due_date === today) {
    dateStr = 'today';
  } else if (due_date === tomorrow) {
    dateStr = 'tomorrow';
  } else {
    dateStr = due_date;
  }

  if (due_time) {
    const timeStr = format24hTo12h(due_time);
    return `${dateStr} at ${timeStr}`;
  }

  return dateStr;
}

/**
 * Convert 24-hour time to 12-hour format
 * 
 * @param time24 - Time in HH:MM format
 * @returns Time in 12h format (e.g., '6pm', '6:30pm')
 * 
 * Examples:
 * - format24hTo12h('18:00') -> '6pm'
 * - format24hTo12h('18:30') -> '6:30pm'
 * - format24hTo12h('09:00') -> '9am'
 * - format24hTo12h('00:00') -> '12am'
 */
function format24hTo12h(time24: string): string {
  const [hourStr, minuteStr] = time24.split(':');
  const hour24 = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const isPM = hour24 >= 12;
  const hour12 = hour24 % 12 || 12;
  const period = isPM ? 'pm' : 'am';

  if (minute === 0) {
    return `${hour12}${period}`;
  } else {
    return `${hour12}:${minuteStr}${period}`;
  }
}

// ============================================
// TASK LIST FORMATTING
// ============================================

/**
 * Format tasks as bullet list for daily digest
 * 
 * @param tasks - Array of tasks with title and optional due_time
 * @returns Formatted bullet list string
 * 
 * Rules:
 * - Cap at 10 tasks
 * - Include time if present
 * - If > 10 tasks, append "• +N more"
 * - No trailing newline
 * 
 * Example:
 * formatDigestList([
 *   { title: 'Buy milk', due_time: '18:00' },
 *   { title: 'Call doctor', due_time: null }
 * ])
 * -> "• Buy milk (6pm)\n• Call doctor"
 */
export function formatDigestList(
  tasks: { title: string; due_time?: string | null }[]
): string {
  const maxTasks = 10;
  const visibleTasks = tasks.slice(0, maxTasks);
  const remainingCount = tasks.length - maxTasks;

  const lines = visibleTasks.map((task) => {
    if (task.due_time) {
      const timeStr = format24hTo12h(task.due_time);
      return `• ${task.title} (${timeStr})`;
    }
    return `• ${task.title}`;
  });

  if (remainingCount > 0) {
    lines.push(`• +${remainingCount} more`);
  }

  return lines.join('\n');
}
