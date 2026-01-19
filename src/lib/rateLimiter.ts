/**
 * Rate Limiter for AI API calls
 * Prevents abuse and controls costs
 */

interface RateLimitEntry {
  lastReset: number;
  callsThisHour: number;
}

const userRateLimits = new Map<string, RateLimitEntry>();

const CALLS_PER_HOUR = 10;
const HOUR_MS = 3600000;

/**
 * Check if user is within rate limits
 */
export function checkRateLimit(userId: string): { allowed: boolean; message?: string } {
  const now = Date.now();
  const userLimit = userRateLimits.get(userId);

  // First call or hour has passed - reset
  if (!userLimit || now - userLimit.lastReset > HOUR_MS) {
    userRateLimits.set(userId, { 
      lastReset: now, 
      callsThisHour: 1 
    });
    return { allowed: true };
  }

  // Check if limit exceeded
  if (userLimit.callsThisHour >= CALLS_PER_HOUR) {
    const resetIn = Math.ceil((HOUR_MS - (now - userLimit.lastReset)) / 60000);
    return { 
      allowed: false, 
      message: `Rate limit exceeded. Try again in ${resetIn} minutes.` 
    };
  }

  // Increment counter
  userLimit.callsThisHour++;
  return { allowed: true };
}

/**
 * Reset rate limit for a user (admin use)
 */
export function resetRateLimit(userId: string): void {
  userRateLimits.delete(userId);
}

/**
 * Get current rate limit status for a user
 */
export function getRateLimitStatus(userId: string): { 
  callsRemaining: number; 
  resetsIn: number;
} {
  const now = Date.now();
  const userLimit = userRateLimits.get(userId);

  if (!userLimit || now - userLimit.lastReset > HOUR_MS) {
    return { callsRemaining: CALLS_PER_HOUR, resetsIn: 0 };
  }

  const callsRemaining = Math.max(0, CALLS_PER_HOUR - userLimit.callsThisHour);
  const resetsIn = Math.ceil((HOUR_MS - (now - userLimit.lastReset)) / 60000);

  return { callsRemaining, resetsIn };
}

