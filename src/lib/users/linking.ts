import { supabase } from '@/lib/supabaseClient';

export type OnboardingState =
  | 'app_verified'
  | 'profile_required_done'
  | 'preferences_done'
  | 'onboarding_complete';

export interface AppUser {
  id: string;
  auth_user_id: string | null;
  phone_e164: string | null;
  email: string | null;
  onboarding_state: OnboardingState;
  has_app_account: boolean;
  timezone?: string | null;
  display_name?: string | null;
  city?: string | null;
  country?: string | null;
  household_mode?: 'run_most' | 'shared' | 'support' | null;
  reminder_window_pref?: 'morning' | 'afternoon' | 'evening' | null;
  whatsapp_assistant_enabled?: boolean;
}

export async function linkAuthUserToAppUser(params: {
  authUserId: string;
  phoneE164: string;
  email?: string | null;
}): Promise<{ ok: true; appUserId: string } | { ok: false; error: string }> {
  const { authUserId, phoneE164, email } = params;

  try {
    const { data, error } = await supabase.rpc('link_auth_user', {
      p_auth_user_id: authUserId,
      p_phone: phoneE164,
      p_email: email ?? null,
    });

    if (error || !data) {
      console.error('[users][linkAuthUserToAppUser] error', error);
      return { ok: false, error: 'Failed to link account. Please try again.' };
    }

    console.log('[users][linkAuthUserToAppUser] linked', {
      authUserId,
      phoneE164,
      appUserId: data,
    });

    return { ok: true, appUserId: data as string };
  } catch (err) {
    console.error('[users][linkAuthUserToAppUser] unexpected error', err);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function getCurrentAppUser(): Promise<AppUser | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('auth_user_id', user.id)
      .maybeSingle<AppUser>();

    if (error) {
      console.error('[users][getCurrentAppUser] error', error);
      return null;
    }

    return data ?? null;
  } catch (err) {
    console.error('[users][getCurrentAppUser] unexpected error', err);
    return null;
  }
}

export function resolvePostAuthRoute(appUser: AppUser | null): string {
  if (!appUser) return '/onboarding/required';
  if (appUser.onboarding_state === 'onboarding_complete') return '/app';
  if (appUser.onboarding_state === 'preferences_done') return '/onboarding/first-task';
  if (appUser.onboarding_state === 'profile_required_done') return '/onboarding/preferences';
  return '/onboarding/required';
}

