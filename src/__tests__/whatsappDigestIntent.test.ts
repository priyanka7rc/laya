import {
  normalizeForTodayDigestIntent,
  matchesTodayDigestIntent,
} from '@/lib/whatsapp-processor';

describe('WhatsApp today digest intent matching', () => {
  it('matches common positive variants', () => {
    const positives = [
      'what do i have today',
      'what do i have today?',
      'what do i have today??',
      'what do i have today pls',
      'What do I have today!',
      '  what\'s on today  ',
      "What's on today?",
      'today tasks',
      'tasks today',
      'what are my tasks today',
    ];

    for (const msg of positives) {
      const normalized = normalizeForTodayDigestIntent(msg);
      expect(matchesTodayDigestIntent(normalized)).toBe(true);
    }
  });

  it('does not match search-prefixed or unrelated messages', () => {
    const negatives = [
      'search what do i have today',
      'find what do i have today',
      'search today tasks',
      'find today tasks',
      'something else',
      'today',
      '',
      '   ',
    ];

    for (const msg of negatives) {
      const normalized = normalizeForTodayDigestIntent(msg);
      expect(matchesTodayDigestIntent(normalized)).toBe(false);
    }
  });
});

