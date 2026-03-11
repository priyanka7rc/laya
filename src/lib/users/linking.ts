import { supabase } from '@/lib/supabaseClient';

export interface AppUser {
  id: string;
  auth_user_id: string | null;
  phone_e164: string | null;
  email: string | null;
  onboarding_state: string;
  has_app_account: boolean;
  timezone?: string | null;
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

