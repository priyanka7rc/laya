import { supabase } from '@/lib/supabaseClient';

export interface OtpError {
  message: string;
}

function toFriendlyOtpErrorMessage(message?: string): string {
  const text = (message ?? '').toLowerCase();
  if (text.includes('rate limit') || text.includes('too many')) {
    return 'Too many attempts. Please wait and try again.';
  }
  if (text.includes('invalid') || text.includes('token')) {
    return 'Invalid code. Please check and try again.';
  }
  return 'Something went wrong. Please try again.';
}

export async function sendOtp(phoneE164: string): Promise<{ ok: true } | { ok: false; error: OtpError }> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      phone: phoneE164,
    });

    if (error) {
      console.error('[auth][sendOtp] error', error);
      return { ok: false, error: { message: toFriendlyOtpErrorMessage(error.message) } };
    }

    return { ok: true };
  } catch (err) {
    console.error('[auth][sendOtp] unexpected error', err);
    return { ok: false, error: { message: 'Something went wrong. Please try again.' } };
  }
}

export async function verifyOtp(
  phoneE164: string,
  token: string
): Promise<{ ok: true } | { ok: false; error: OtpError }> {
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      phone: phoneE164,
      token,
      type: 'sms',
    });

    if (error || !data.session) {
      console.error('[auth][verifyOtp] error', error);
      return { ok: false, error: { message: toFriendlyOtpErrorMessage(error?.message) } };
    }

    return { ok: true };
  } catch (err) {
    console.error('[auth][verifyOtp] unexpected error', err);
    return { ok: false, error: { message: 'Something went wrong. Please try again.' } };
  }
}

