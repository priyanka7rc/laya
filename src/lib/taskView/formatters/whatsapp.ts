import { TaskViewResult, TaskViewTask } from '@/lib/taskView/contracts';
import { getLocalDateString, DEFAULT_TZ } from '@/lib/taskView/time';

function format24hTo12h(time24: string): string {
  const [hourStr, minuteStr] = time24.split(':');
  const hour24 = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const isPM = hour24 >= 12;
  const hour12 = hour24 % 12 || 12;
  const period = isPM ? 'pm' : 'am';

  if (minute === 0) {
    return `${hour12}${period}`;
  }
  return `${hour12}:${minuteStr}${period}`;
}

export function formatWhen(due_date: string | null, due_time: string | null): string {
  if (!due_date) {
    return 'later';
  }

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
 * Format due time from canonical dueAt (ISO string). Prefer this over due_date/due_time.
 * tz: IANA timezone for "today"/"tomorrow" labels.
 */
export function formatWhenFromDueAt(dueAt: string | Date | null, tz: string = DEFAULT_TZ): string {
  if (!dueAt) return 'later';
  const d = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  const dateStr = getLocalDateString(tz, d);
  const now = new Date();
  const todayLocal = getLocalDateString(tz, now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowLocal = getLocalDateString(tz, tomorrow);
  let label: string;
  if (dateStr === todayLocal) label = 'today';
  else if (dateStr === tomorrowLocal) label = 'tomorrow';
  else label = dateStr;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const hasTime = hour !== 0 || minute !== '00';
  if (hasTime) {
    const isPM = hour >= 12;
    const hour12 = hour % 12 || 12;
    const period = isPM ? 'pm' : 'am';
    const timeStr = minute === '00' ? `${hour12}${period}` : `${hour12}:${minute}${period}`;
    return `${label} at ${timeStr}`;
  }
  return label;
}

export function formatDigestFromResult(result: TaskViewResult, tz?: string): string {
  const tasks = result.tasks;
  const maxTasks = 10;
  const visible = tasks.slice(0, maxTasks);
  const remaining = tasks.length - maxTasks;

  const effectiveTz = tz ?? DEFAULT_TZ;
  const lines = visible.map((task) => {
    if (task.dueAt) {
      const timePart = task.dueAt.split('T')[1]?.slice(0, 5) ?? null;
      const timeStr = timePart ? format24hTo12h(timePart) : null;
      return timeStr ? `• ${task.title} (${timeStr})` : `• ${task.title}`;
    }
    return `• ${task.title}`;
  });

  if (remaining > 0) {
    lines.push(`• +${remaining} more`);
  }

  return lines.join('\n');
}

export function formatTaskListForQuery(result: TaskViewResult, header: string): string {
  const lines: string[] = [];

  if (header) {
    lines.push(header, '');
  }

  result.tasks.forEach((task: TaskViewTask) => {
    let line = `• ${task.title}`;
    if (task.dueAt) {
      const time = task.dueAt.split('T')[1]?.slice(0, 5) ?? null;
      if (time) {
        line += ` (${time})`;
      }
    }
    lines.push(line);
  });

  return lines.join('\n');
}

