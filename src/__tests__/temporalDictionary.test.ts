/**
 * Unit tests for temporalDictionary.ts — term resolution, no LLM.
 *
 * All tests use a fixed reference date (Monday 2026-04-27) so they are
 * stable and deterministic in CI.
 */

import { describe, it, expect } from 'vitest';
import { resolveTemporal } from '@/lib/temporalDictionary';
import { parseDate } from '@/lib/taskRulesParser';

// Monday 2026-04-27 09:00 UTC
const MON = new Date('2026-04-27T09:00:00.000Z');

describe('temporalDictionary — resolveTemporal', () => {
  // End / start of week
  it('resolves "end of week"', () => {
    const r = resolveTemporal('submit report end of week', MON);
    expect(r?.termMatched).toBe('end_of_week');
    expect(r?.resolution.date).toBe('2026-05-02'); // Saturday
  });

  it('resolves "eow"', () => {
    expect(resolveTemporal('done eow', MON)?.termMatched).toBe('end_of_week');
  });

  it('resolves "over the weekend"', () => {
    const r = resolveTemporal('clean car over the weekend', MON);
    expect(r?.termMatched).toBe('over_the_weekend');
    expect(r?.resolution.date).toBe('2026-05-02');
  });

  // End / close of day
  it('resolves "end of day"', () => {
    const r = resolveTemporal('file report by end of day', MON);
    expect(r?.termMatched).toBe('end_of_day');
    expect(r?.resolution.time).toBe('23:59');
    expect(r?.resolution.date).toBe('2026-04-27');
  });

  it('resolves "eod"', () => {
    const r = resolveTemporal('send invoice eod', MON);
    expect(r?.termMatched).toBe('end_of_day');
  });

  it('resolves "close of business"', () => {
    const r = resolveTemporal('close of business', MON);
    expect(r?.termMatched).toBe('close_of_business');
    expect(r?.resolution.time).toBe('18:00');
  });

  it('resolves "COB"', () => {
    expect(resolveTemporal('COB today', MON)?.termMatched).toBe('close_of_business');
  });

  // ASAP
  it('resolves "asap"', () => {
    const r = resolveTemporal('fix this asap', MON);
    expect(r?.termMatched).toBe('asap');
    expect(r?.resolution.date).toBe('2026-04-27');
  });

  it('resolves "as soon as possible"', () => {
    expect(resolveTemporal('do this as soon as possible', MON)?.termMatched).toBe('asap');
  });

  it('resolves "urgently"', () => {
    expect(resolveTemporal('fix urgently', MON)?.termMatched).toBe('asap');
  });

  // First / last thing
  it('resolves "first thing"', () => {
    const r = resolveTemporal('call client first thing', MON);
    expect(r?.termMatched).toBe('first_thing');
    expect(r?.resolution.time).toBe('09:00');
  });

  it('resolves "last thing"', () => {
    const r = resolveTemporal('review slides last thing', MON);
    expect(r?.termMatched).toBe('last_thing');
    expect(r?.resolution.time).toBe('21:00');
  });

  // Relative days
  it('resolves "in 3 days"', () => {
    const r = resolveTemporal('follow up in 3 days', MON);
    expect(r?.termMatched).toBe('in_x_days');
    expect(r?.resolution.date).toBe('2026-04-30');
  });

  it('resolves "in 2 hours"', () => {
    const r = resolveTemporal('call in 2 hours', MON);
    expect(r?.termMatched).toBe('in_x_hours');
    expect(r?.resolution.date).toBe('2026-04-27');
  });

  it('resolves "a couple of days"', () => {
    const r = resolveTemporal('a couple of days', MON);
    expect(r?.termMatched).toBe('couple_of_days');
    expect(r?.resolution.date).toBe('2026-04-29');
  });

  it('resolves "a few days"', () => {
    const r = resolveTemporal('in a few days', MON);
    expect(r?.termMatched).toBe('few_days');
    expect(r?.resolution.date).toBe('2026-04-30');
  });

  it('resolves "a week from now"', () => {
    const r = resolveTemporal('a week from now', MON);
    expect(r?.termMatched).toBe('a_week_from_now');
    expect(r?.resolution.date).toBe('2026-05-04');
  });

  // End of month
  it('resolves "end of month" (without "by")', () => {
    const r = resolveTemporal('submit report end of month', MON);
    expect(r?.termMatched).toBe('end_of_month');
    expect(r?.resolution.date).toBe('2026-04-30');
  });

  it('"pay by end of month" matches by_end_of_month (more specific)', () => {
    const r = resolveTemporal('pay by end of month', MON);
    expect(r?.termMatched).toBe('by_end_of_month');
    expect(r?.resolution.time).toBe('23:59');
    expect(r?.resolution.date).toBe('2026-04-30');
  });

  it('resolves "eom"', () => {
    expect(resolveTemporal('eom payment', MON)?.termMatched).toBe('end_of_month');
  });

  // Next weekday — always next calendar week (NOT this week)
  // Monday 2026-04-27 → "next friday" = Friday of NEXT week = 2026-05-08
  it('resolves "next friday" to the Friday of NEXT calendar week', () => {
    const r = resolveTemporal('team lunch next friday', MON);
    expect(r?.termMatched).toBe('next_friday');
    expect(r?.resolution.date).toBe('2026-05-08'); // next week's Friday
  });

  it('resolves "next monday" to next week\'s Monday (not today)', () => {
    const r = resolveTemporal('meeting next monday', MON);
    expect(r?.termMatched).toBe('next_monday');
    expect(r?.resolution.date).toBe('2026-05-04');
  });

  // This weekday — the named day within the current calendar week
  // Monday 2026-04-27 → "this friday" = this week's Friday = 2026-05-01
  it('resolves "this friday" to this week\'s Friday', () => {
    const r = resolveTemporal('grocery run this friday', MON);
    expect(r?.termMatched).toBe('this_friday');
    expect(r?.resolution.date).toBe('2026-05-01');
  });

  // By weekday — deadline with 23:59
  it('resolves "by friday" to 23:59 on next occurrence of Friday', () => {
    const r = resolveTemporal('report by friday', MON);
    expect(r?.termMatched).toBe('by_friday');
    expect(r?.resolution.time).toBe('23:59');
  });

  it('resolves "by end of week" with time 23:59', () => {
    const r = resolveTemporal('by end of week', MON);
    expect(r?.termMatched).toBe('by_end_of_week');
    expect(r?.resolution.time).toBe('23:59');
  });

  // Non-matching
  it('returns null for plain English with no temporal term', () => {
    expect(resolveTemporal('call dentist', MON)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(resolveTemporal('', MON)).toBeNull();
  });
});

describe('parseDate — same-day guard (< 0 not <= 0)', () => {
  it('same-day resolves to TODAY (not next week)', () => {
    // Monday 2026-04-27 — "monday" in text should resolve to today
    const result = parseDate('Call dentist on monday', MON);
    expect(result).toBe('2026-04-27');
  });

  it('already-past day wraps to next week', () => {
    // Monday 2026-04-27 — "sunday" is yesterday; should wrap to next Sunday
    const result = parseDate('Visit family sunday', MON);
    expect(result).toBe('2026-05-03');
  });

  it('"tomorrow" always +1 day', () => {
    const result = parseDate('Doctor tomorrow', MON);
    expect(result).toBe('2026-04-28');
  });

  it('"today" returns today', () => {
    const result = parseDate('Call today', MON);
    expect(result).toBe('2026-04-27');
  });
});
