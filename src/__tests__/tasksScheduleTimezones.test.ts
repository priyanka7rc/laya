import { computeDueAtFromLocal } from '@/lib/tasks/schedule';

describe('computeDueAtFromLocal across timezones', () => {
  test('computes correct UTC instant for Asia/Kolkata (IST)', () => {
    const iso = computeDueAtFromLocal('Asia/Kolkata', '2026-02-28', '10:00');
    // 10:00 IST (UTC+5:30) should be 04:30Z
    expect(iso).toBe('2026-02-28T04:30:00.000Z');
  });

  test('computes correct UTC instant for America/Los_Angeles (PST, non-DST date)', () => {
    // Choose mid-January to avoid DST boundaries
    const iso = computeDueAtFromLocal('America/Los_Angeles', '2026-01-15', '09:00');
    // 09:00 PST (UTC-8) should be 17:00Z
    expect(iso).toBe('2026-01-15T17:00:00.000Z');
  });

  test('computes correct UTC instant for Asia/Singapore (SGT, UTC+8)', () => {
    const iso = computeDueAtFromLocal('Asia/Singapore', '2026-02-28', '09:00');
    // 09:00 SGT (UTC+8) should be 01:00Z
    expect(iso).toBe('2026-02-28T01:00:00.000Z');
  });
});

