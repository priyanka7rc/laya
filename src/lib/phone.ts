export type NormalizedPhoneResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Normalize Indian phone inputs to E.164 format: +91XXXXXXXXXX
 *
 * Rules:
 * - Strip all non-digits
 * - If starts with 0 and length 11 -> drop leading 0
 * - If length 10 -> assume Indian mobile, prepend +91
 * - If length 12 and starts with 91 -> prepend +
 * - Final form must be +91 followed by 10 digits
 */
export function normalizeIndianPhone(input: string): NormalizedPhoneResult {
  const digits = input.replace(/\D/g, '');

  if (!digits) {
    return { ok: false, error: 'Enter your phone number.' };
  }

  let cleaned = digits;

  // 0XXXXXXXXXX -> drop leading 0
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }

  // 10-digit mobile -> assume Indian
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }

  // 91XXXXXXXXXX -> add +
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    cleaned = '+' + cleaned;
  }

  if (!cleaned.startsWith('+91') || cleaned.length !== 13) {
    return {
      ok: false,
      error: 'Use an Indian mobile number (10 digits).',
    };
  }

  const rest = cleaned.slice(3);
  if (!/^\d{10}$/.test(rest)) {
    return {
      ok: false,
      error: 'Phone number looks invalid. Please check and try again.',
    };
  }

  return { ok: true, value: cleaned };
}

