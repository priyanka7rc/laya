/**
 * WhatsApp Task Reminder Scheduler
 * Sends reminders for due tasks via WhatsApp
 */

import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageWithFallback } from './whatsapp-client';
import { TEMPLATES } from './whatsapp-templates';
import { formatWhen } from './whatsapp-formatters';

// ============================================
// SUPABASE CLIENT
// ============================================

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ============================================
// REMINDER JOB
// ============================================

/**
 * Run reminder job for all due tasks
 * 
 * Queries tasks where:
 * - due_at <= now()
 * - reminder_sent = false
 * - is_done = false
 * 
 * For each task:
 * - Skip if user opted_out = true
 * - Skip if task has no due_time (only date-specific tasks get reminders)
 * - Send via session-aware router (free-form or template)
 * - Mark as reminder_sent on success
 * 
 * @returns Object with counts: { total, sent, skipped, failed }
 */
export async function runReminderJob(): Promise<{
  total: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  console.log('[WA][REMINDER] Starting reminder job...');
  
  const stats = {
    total: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    // Query tasks that need reminders
    const { data: tasks, error: queryError } = await supabase
      .from('tasks')
      .select(`
        id,
        user_id,
        title,
        due_date,
        due_time,
        whatsapp_users!inner(phone_number, opted_out)
      `)
      .eq('is_done', false)
      .eq('reminder_sent', false)
      .not('due_at', 'is', null)
      .lte('due_at', new Date().toISOString());

    if (queryError) {
      console.error('[WA][REMINDER] Query error:', queryError);
      return stats;
    }

    if (!tasks || tasks.length === 0) {
      console.log('[WA][REMINDER] No tasks need reminders');
      return stats;
    }

    stats.total = tasks.length;
    console.log(`[WA][REMINDER] Found ${tasks.length} tasks needing reminders`);

    // Process each task
    for (const task of tasks as any[]) {
      const whatsappUser = task.whatsapp_users;
      
      if (!whatsappUser || !whatsappUser.phone_number) {
        console.log(
          `[WA][REMINDER] Skip | taskId=${task.id} | reason=no_whatsapp_user`
        );
        stats.skipped++;
        continue;
      }

      // Skip if user opted out
      if (whatsappUser.opted_out) {
        console.log(
          `[WA][REMINDER] Skip | taskId=${task.id} | ` +
          `userId=${task.user_id} | reason=opted_out`
        );
        stats.skipped++;
        continue;
      }

      // Skip if no time component (only send reminders for time-specific tasks)
      if (!task.due_time) {
        console.log(
          `[WA][REMINDER] Skip | taskId=${task.id} | ` +
          `userId=${task.user_id} | reason=no_time_component`
        );
        stats.skipped++;
        continue;
      }

      // ATOMIC UPDATE: Claim the task first (prevents race conditions)
      const { data: claimed, error: claimError } = await supabase
        .from('tasks')
        .update({
          reminder_sent: true,
          reminder_sent_at: new Date().toISOString(),
        })
        .eq('id', task.id)
        .eq('reminder_sent', false) // Only update if still false
        .select('id, title, due_date, due_time')
        .maybeSingle();

      // If no rows affected, another job already claimed this task
      if (!claimed) {
        console.log(
          `[WA][REMINDER] Skip | taskId=${task.id} | reason=already_claimed`
        );
        stats.skipped++;
        continue;
      }

      // Format reminder message
      const when = formatWhen(claimed.due_date, claimed.due_time);
      const freeFormMessage = `⏰ Reminder: ${claimed.title} (${when})`;
      const templateParams = [claimed.title, when];

      console.log(
        `[WA][REMINDER] Sending | taskId=${task.id} | ` +
        `userId=${task.user_id} | title="${claimed.title}"`
      );

      // Send via session-aware router
      const messageId = await sendWhatsAppMessageWithFallback({
        phoneNumber: whatsappUser.phone_number,
        userId: task.user_id,
        message: freeFormMessage,
        templateId: TEMPLATES.TASK_REMINDER.templateId,
        templateParams,
      });

      if (messageId) {
        console.log(
          `[WA][REMINDER] Success | taskId=${task.id} | ` +
          `msgId=${messageId}`
        );
        stats.sent++;
      } else {
        // Send failed - revert the claim
        console.log(
          `[WA][REMINDER] Failed | taskId=${task.id} | reason=send_failed | ` +
          `action=reverting_claim`
        );
        
        await supabase
          .from('tasks')
          .update({
            reminder_sent: false,
            reminder_sent_at: null,
          })
          .eq('id', task.id);
        
        stats.failed++;
      }
    }

    console.log(
      `[WA][REMINDER] Job complete | ` +
      `total=${stats.total} | sent=${stats.sent} | ` +
      `skipped=${stats.skipped} | failed=${stats.failed}`
    );

    return stats;
  } catch (error) {
    console.error('[WA][REMINDER] Job error:', error);
    return stats;
  }
}
