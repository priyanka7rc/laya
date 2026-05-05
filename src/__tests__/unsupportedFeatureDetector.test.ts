/**
 * Unit tests for unsupportedFeatureDetector.ts
 */

import { describe, it, expect } from 'vitest';
import { detectUnsupportedFeature } from '@/lib/unsupportedFeatureDetector';

describe('detectUnsupportedFeature', () => {
  // Recurring
  it('detects "every day"', () => {
    expect(detectUnsupportedFeature('remind me every day')).not.toBeNull();
    expect(detectUnsupportedFeature('remind me every day')?.feature).toBe('recurring');
  });

  it('detects "daily"', () => {
    expect(detectUnsupportedFeature('daily standup reminder')?.feature).toBe('recurring');
  });

  it('detects "every Monday"', () => {
    expect(detectUnsupportedFeature('team meeting every Monday')?.feature).toBe('recurring');
  });

  it('detects "weekly"', () => {
    expect(detectUnsupportedFeature('weekly review')?.feature).toBe('recurring');
  });

  it('detects "recurring"', () => {
    expect(detectUnsupportedFeature('set up recurring payment')?.feature).toBe('recurring');
  });

  // Snooze
  it('detects "snooze"', () => {
    expect(detectUnsupportedFeature('snooze this for 1 hour')?.feature).toBe('snooze');
  });

  it('detects "remind me again"', () => {
    expect(detectUnsupportedFeature('remind me again in 30 minutes')?.feature).toBe('snooze');
  });

  // Video meeting
  it('detects "zoom link"', () => {
    expect(detectUnsupportedFeature('create zoom link for meeting')?.feature).toBe('video_meeting');
  });

  it('detects "google meet"', () => {
    expect(detectUnsupportedFeature('send google meet link')?.feature).toBe('video_meeting');
  });

  it('detects "teams meeting"', () => {
    expect(detectUnsupportedFeature('schedule teams meeting')?.feature).toBe('video_meeting');
  });

  // Subtasks
  it('detects "subtask"', () => {
    expect(detectUnsupportedFeature('add subtask to report')?.feature).toBe('subtasks');
  });

  it('detects "checklist"', () => {
    expect(detectUnsupportedFeature('create a checklist for onboarding')?.feature).toBe('subtasks');
  });

  // Priority
  it('detects "high priority"', () => {
    expect(detectUnsupportedFeature('mark as high priority')?.feature).toBe('priority');
  });

  it('detects "p0"', () => {
    expect(detectUnsupportedFeature('this is p0')?.feature).toBe('priority');
  });

  // Non-matching
  it('returns null for regular task', () => {
    expect(detectUnsupportedFeature('Call dentist tomorrow at 10am')).toBeNull();
  });

  it('returns null for list creation', () => {
    expect(detectUnsupportedFeature('groceries: milk, eggs, butter')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectUnsupportedFeature('')).toBeNull();
  });

  // Response messages
  it('returns a non-empty message for detected feature', () => {
    const result = detectUnsupportedFeature('every Monday stand-up');
    expect(result?.message).toBeTruthy();
    expect(result?.message.length).toBeGreaterThan(10);
  });
});
