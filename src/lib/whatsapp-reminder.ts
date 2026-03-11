/**
 * WhatsApp Task Reminder Scheduler
 * Sends reminders for due tasks via WhatsApp.
 * Task selection is delegated to TaskViewEngine (view: reminderWindow).
 */

import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageWithFallback } from './whatsapp-client';
import { TEMPLATES } from './whatsapp-templates';
import { formatWhenFromDueAt } from '@/lib/taskView/formatters/whatsapp';
import { DEFAULT_TZ } from '@/lib/taskView/time';
import { executeTaskView } from '@/server/taskView/taskViewEngine';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function runReminderJob(): Promise<{
  total: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  console.log('[WA][REMINDER] Starting reminder job...');

  const stats = { total: 0, sent: 0, skipped: 0, failed: 0 };

  try {
    const { data: waUsers, error: usersError } = await supabase
      .from('whatsapp_users')
      .select('auth_user_id, phone_number')
      .eq('opted_out', false)
      .not('auth_user_id', 'is', null);

    if (usersError || !waUsers?.length) {
      if (usersError) console.error('[WA][REMINDER] Users query error:', usersError);
      return stats;
    }

    const { data: appUsers } = await supabase
      .from('app_users')
      .select('id, auth_user_id, timezone')
      .in('auth_user_id', waUsers.map((u) => u.auth_user_id).filter(Boolean) as string[]);

    const byAuth = new Map<string | null, { appUserId: string; phoneNumber: string; timezone: string }>();
    for (const w of waUsers) {
      const app = appUsers?.find((a) => a.auth_user_id === w.auth_user_id);
      if (app && w.phone_number) {
        const tz = app.timezone || DEFAULT_TZ;
        byAuth.set(w.auth_user_id, { appUserId: app.id, phoneNumber: w.phone_number, timezone: tz });
      }
    }

    for (const [authUserId, { appUserId, phoneNumber, timezone }] of byAuth) {
      const viewResult = await executeTaskView({
        identity: { kind: 'appUserId' as const, appUserId },
        view: 'reminderWindow',
        now: new Date(),
        timezone,
      });

      for (const task of viewResult.tasks) {
        const timePart = task.dueAt?.split('T')[1]?.slice(0, 5);
        if (!task.dueAt || !timePart || timePart === '00:00') {
          stats.skipped++;
          continue;
        }

        stats.total++;

        const { data: claimed, error: claimError } = await supabase
          .from('tasks')
          .update({ reminder_sent: true, reminder_sent_at: new Date().toISOString() })
          .eq('id', task.id)
          .eq('reminder_sent', false)
          .select('id, title, due_at')
          .maybeSingle();

        if (claimError || !claimed) {
          stats.skipped++;
          continue;
        }

        const when = formatWhenFromDueAt(claimed.due_at ?? task.dueAt, timezone);
        const freeFormMessage = `⏰ Reminder: ${claimed.title} (${when})`;
        const messageId = await sendWhatsAppMessageWithFallback({
          phoneNumber,
          userId: authUserId!,
          message: freeFormMessage,
          templateId: TEMPLATES.TASK_REMINDER.templateId,
          templateParams: [claimed.title, when],
        });

        if (messageId) {
          stats.sent++;
        } else {
          await supabase
            .from('tasks')
            .update({ reminder_sent: false, reminder_sent_at: null })
            .eq('id', task.id);
          stats.failed++;
        }
      }
    }

    console.log(
      `[WA][REMINDER] Job complete | total=${stats.total} | sent=${stats.sent} | skipped=${stats.skipped} | failed=${stats.failed}`
    );
    return stats;
  } catch (error) {
    console.error('[WA][REMINDER] Job error:', error);
    return stats;
  }
}
