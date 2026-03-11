import { supabase } from '@/lib/supabaseClient';

export interface OtpError {
  message: string;
}

export async function sendOtp(phoneE164: string): Promise<{ ok: true } | { ok: false; error: OtpError }> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      phone: phoneE164,
    });

    if (error) {
      console.error('[auth][sendOtp] error', error);
      return { ok: false, error: { message: 'Failed to send code. Please try again.' } };
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
      return { ok: false, error: { message: 'Invalid code. Please try again.' } };
    }

    return { ok: true };
  } catch (err) {
    console.error('[auth][verifyOtp] unexpected error', err);
    return { ok: false, error: { message: 'Something went wrong. Please try again.' } };
  }
}

