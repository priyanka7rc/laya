import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { DEFAULT_TZ } from '@/lib/taskView/time';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getUserTimezoneByAuthUserId(authUserId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('timezone')
      .eq('auth_user_id', authUserId)
      .maybeSingle<{ timezone: string | null }>();

    if (error) {
      console.error('[tasks][getUserTimezoneByAuthUserId]', error);
      return DEFAULT_TZ;
    }

    return data?.timezone || DEFAULT_TZ;
  } catch (err) {
    console.error('[tasks][getUserTimezoneByAuthUserId] unexpected', err);
    return DEFAULT_TZ;
  }
}

export async function getUserTimezoneByAppUserId(appUserId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('app_users')
      .select('timezone')
      .eq('id', appUserId)
      .maybeSingle<{ timezone: string | null }>();

    if (error) {
      console.error('[tasks][getUserTimezoneByAppUserId]', error);
      return DEFAULT_TZ;
    }

    return data?.timezone || DEFAULT_TZ;
  } catch (err) {
    console.error('[tasks][getUserTimezoneByAppUserId] unexpected', err);
    return DEFAULT_TZ;
  }
}

