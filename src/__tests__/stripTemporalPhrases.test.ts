/**
 * Tests for the booking-context fix in stripTemporalPhrases.
 *
 * Booking verbs: book, reserve, schedule, organise/organize, arrange, plan,
 * get, buy, order, pick up.
 *
 * Rule: "for [weekday]" is preserved when the title starts with a booking verb.
 * It is stripped for non-booking titles (where it signals a deadline).
 */

import { describe, it, expect } from 'vitest';
import { stripTemporalPhrases } from '@/lib/taskRulesParser';

describe('stripTemporalPhrases — booking context', () => {
  // Booking verbs: "for [weekday]" should be PRESERVED
  it('preserves "for Friday" after "Book"', () => {
    const result = stripTemporalPhrases('Book restaurant for Friday');
    expect(result).toContain('for Friday');
  });

  it('preserves "for Saturday" after "Reserve"', () => {
    const result = stripTemporalPhrases('Reserve table for Saturday');
    expect(result).toContain('for Saturday');
  });

  it('preserves "for Sunday" after "Order"', () => {
    const result = stripTemporalPhrases('Order cake for Sunday');
    expect(result).toContain('for Sunday');
  });

  it('preserves "for Friday" after "Arrange"', () => {
    const result = stripTemporalPhrases('Arrange transport for Friday');
    expect(result).toContain('for Friday');
  });

  it('preserves "for Saturday" after "Buy"', () => {
    const result = stripTemporalPhrases('Buy flowers for Saturday');
    expect(result).toContain('for Saturday');
  });

  it('preserves "for Monday" after "Get"', () => {
    const result = stripTemporalPhrases('Get haircut for Monday');
    expect(result).toContain('for Monday');
  });

  it('preserves "for Friday" after "Plan"', () => {
    const result = stripTemporalPhrases('Plan party for Friday');
    expect(result).toContain('for Friday');
  });

  // Non-booking verbs: "for [weekday]" should still be stripped
  it('strips "for Monday" from "Submit report for Monday" (deadline context)', () => {
    const result = stripTemporalPhrases('Submit report for Monday');
    expect(result).not.toContain('for Monday');
    expect(result).not.toContain('Monday');
  });

  it('strips "for Friday" from "Finish presentation for Friday"', () => {
    const result = stripTemporalPhrases('Finish presentation for Friday');
    expect(result).not.toContain('for Friday');
  });

  it('strips "for Tuesday" from "Call dentist for Tuesday"', () => {
    const result = stripTemporalPhrases('Call dentist for Tuesday');
    expect(result).not.toContain('Tuesday');
  });

  // "by [weekday]" is always stripped (unambiguous deadline)
  it('strips "by Friday" from "Pay invoice by Friday" (booking)', () => {
    const result = stripTemporalPhrases('Book meeting by Friday');
    expect(result).not.toContain('by Friday');
  });

  // Time stripping (unaffected by booking context)
  it('strips time expression from booking title', () => {
    const result = stripTemporalPhrases('Book dinner for Friday at 8pm');
    expect(result).not.toContain('at 8pm');
    expect(result).not.toContain('8pm');
  });

  // "today" should still be stripped in booking context
  it('strips "today" from booking title', () => {
    const result = stripTemporalPhrases('Book dentist today');
    expect(result).not.toContain('today');
  });
});

describe('stripTemporalPhrases — non-booking context', () => {
  it('strips day name from plain title', () => {
    const result = stripTemporalPhrases('Call bank on Thursday');
    expect(result).not.toContain('Thursday');
  });

  it('strips "tomorrow" from title', () => {
    const result = stripTemporalPhrases('Doctor tomorrow');
    expect(result).not.toContain('tomorrow');
  });

  it('strips "next week" from title', () => {
    const result = stripTemporalPhrases('Review contract next week');
    expect(result).not.toContain('next week');
  });

  it('strips "by Monday" from title', () => {
    const result = stripTemporalPhrases('Submit by Monday');
    expect(result).not.toContain('Monday');
  });

  it('result is non-empty after stripping', () => {
    expect(stripTemporalPhrases('Call dentist tomorrow').trim().length).toBeGreaterThan(0);
  });
});
