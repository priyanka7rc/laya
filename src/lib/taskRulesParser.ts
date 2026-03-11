/**
 * Task rules parser — mobile-parity parsing for Tasks tab (keyboard input).
 * Pure functions, no AI. Date format YYYY-MM-DD, time format HH:MM.
 * Category detection uses shared canonical list from @/lib/categories.
 */

export { detectCategory } from '@/lib/categories';

/**
 * Normalize due_time to HH:MM (24-hour). Accepts HH:MM or HH:MM:SS; returns HH:MM or null.
 */
export function toHHMM(s: string | null | undefined): string | null {
  if (s == null || !String(s).trim()) return null;
  const parts = String(s).trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parts[1] != null ? parseInt(parts[1], 10) : 0;
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse relative date from text. Always returns YYYY-MM-DD (default today).
 */
export function parseDate(text: string): string {
  const lowerText = text.toLowerCase();
  const today = new Date();

  if (lowerText.includes('today')) return formatDateToYYYYMMDD(today);
  if (lowerText.includes('tomorrow')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateToYYYYMMDD(tomorrow);
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < dayNames.length; i++) {
    if (lowerText.includes(dayNames[i])) {
      const targetDay = i;
      const currentDay = today.getDay();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysToAdd);
      return formatDateToYYYYMMDD(targetDate);
    }
  }

  if (lowerText.includes('next week')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    return formatDateToYYYYMMDD(nextWeek);
  }

  if (lowerText.includes('weekend') || lowerText.includes('saturday') || lowerText.includes('sunday')) {
    const currentDay = today.getDay();
    const daysToSaturday = currentDay === 0 ? 6 : 6 - currentDay;
    const saturday = new Date(today);
    saturday.setDate(today.getDate() + daysToSaturday);
    return formatDateToYYYYMMDD(saturday);
  }

  return formatDateToYYYYMMDD(today);
}

/**
 * Smart default time from keywords. Returns HH:MM or null.
 */
export function getSmartDefaultTime(text: string): string | null {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('breakfast')) return '08:00';
  if (lowerText.includes('brunch')) return '11:00';
  if (lowerText.includes('lunch')) return '12:00';
  if (lowerText.includes('snack')) return '15:00';
  if (lowerText.includes('dinner')) return '18:30';
  if (lowerText.includes('supper')) return '19:00';
  if (lowerText.includes('dessert')) return '20:00';
  if (lowerText.includes('morning')) {
    if (lowerText.includes('gym') || lowerText.includes('workout') || lowerText.includes('exercise')) return '07:00';
    return '08:00';
  }
  if (lowerText.includes('noon')) return '12:00';
  if (lowerText.includes('afternoon')) return '14:00';
  if (lowerText.includes('evening')) return '18:00';
  if (lowerText.includes('night') || lowerText.includes('tonight')) return '20:00';
  if (lowerText.includes('midnight')) return '00:00';
  if (lowerText.includes('doctor') || lowerText.includes('dentist') ||
      lowerText.includes('checkup') || lowerText.includes('physical') ||
      lowerText.includes('therapy')) return '10:00';
  return null;
}

/**
 * Parse time from text. Always returns HH:MM (24-hour).
 * Uses regex for explicit times, then getSmartDefaultTime, then 20:00 fallback.
 */
export function parseTime(text: string): string {
  const lowerText = text.toLowerCase();

  const timePatterns: { regex: RegExp; hasColon: boolean }[] = [
    { regex: /at\s*(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)/i, hasColon: true },
    { regex: /(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)/i, hasColon: true },
    { regex: /(\d{1,2}):(\d{2})(?!\s*[ap]\.?m)/i, hasColon: true },
    { regex: /at\s*(\d{1,2})\s*([ap]\.?m\.?)/i, hasColon: false },
    { regex: /(\d{1,2})\s*([ap]\.?m\.?)/i, hasColon: false },
  ];

  for (const { regex, hasColon } of timePatterns) {
    const match = lowerText.match(regex);
    if (match) {
      let hours: number;
      let minutes: number;
      const meridiem = match[3] ?? match[2];
      if (hasColon) {
        hours = parseInt(match[1], 10);
        minutes = parseInt(match[2], 10);
      } else {
        hours = parseInt(match[1], 10);
        minutes = 0;
      }
      if (meridiem) {
        const m = meridiem.toLowerCase().replace(/\./g, '');
        if (m === 'pm' && hours < 12) hours += 12;
        if (m === 'am' && hours === 12) hours = 0;
      }
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      }
    }
  }

  const smart = getSmartDefaultTime(text);
  if (smart) return smart;
  return '20:00';
}

/**
 * Strip date/time and temporal phrases from title for display/storage.
 * Returns trimmed string; does not capitalize.
 */
export function stripTemporalPhrases(text: string): string {
  return text
    .replace(/\b(at|@|by)\s*\d{1,2}:?\d{0,2}\s*([ap]\.?m\.?)?/gi, '')
    .replace(/\b[ap]\.?m\.?\b/gi, '')
    .replace(/\bin the\s+(morning|afternoon|evening|night)\b/gi, '')
    .replace(/\b(morning|afternoon|evening|night)\b/gi, '')
    .replace(/\b(for|on|by|in)\s+(tomorrow|today|tonight|this|next)\b/gi, '')
    .replace(/\b(for|on|by|in)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|week|month)\b/gi, '')
    .replace(/\bby\s+next\s+(week|month|year)\b/gi, '')
    .replace(/\bnext\s+(week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\btomorrow\b/gi, '')
    .replace(/\btoday\b/gi, '')
    .replace(/\btonigh?t\b/gi, '')
    .replace(/\bthis\s+(morning|afternoon|evening|night|weekend|week|month|year)\b/gi, '')
    .replace(/\bmonday|tuesday|wednesday|thursday|friday|saturday|sunday\b/gi, '')
    .replace(/\bweekend\b/gi, '')
    .replace(/\bweek\b/gi, '')
    .replace(/\bmonth\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(for|at|on|by|in)\s*$/gi, '')
    .trim();
}
