/**
 * WhatsApp Daily Digest Scheduler
 * Sends daily task summaries via WhatsApp
 */

import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppMessageWithFallback } from './whatsapp-client';
import { TEMPLATES } from './whatsapp-templates';
import { executeTaskView } from '@/server/taskView/taskViewEngine';
import { formatDigestFromResult } from '@/lib/taskView/formatters/whatsapp';

// ============================================
// SUPABASE CLIENT
// ============================================

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ============================================
// DAILY DIGEST JOB
// ============================================

/**
 * Run daily digest job for all eligible users
 * 
 * Queries users where:
 * - daily_digest_enabled = true
 * - last_digest_sent_at != today (or null)
 * - opted_out = false
 * 
 * For each user:
 * - Query incomplete tasks due today
 * - Skip if no tasks
 * - Format digest list
 * - Send via session-aware router (free-form or template)
 * - Update last_digest_sent_at on success
 * 
 * @returns Object with counts: { total, sent, skipped, failed }
 */
export async function runDailyDigestJob(): Promise<{
  total: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  console.log('[WA][DIGEST] Starting daily digest job...');
  
  const stats = {
    total: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    const today = new Date().toISOString().split('T')[0];

    // Find users who need today's digest
    const { data: users, error: usersError } = await supabase
      .from('whatsapp_users')
      .select('id, phone_number, auth_user_id, opted_out, last_digest_sent_at')
      .eq('daily_digest_enabled', true)
      .or(`last_digest_sent_at.is.null,last_digest_sent_at.neq.${today}`);

    if (usersError) {
      console.error('[WA][DIGEST] Query error:', usersError);
      return stats;
    }

    if (!users || users.length === 0) {
      console.log('[WA][DIGEST] No users need digest today');
      return stats;
    }

    stats.total = users.length;
    console.log(`[WA][DIGEST] Found ${users.length} users needing digest`);

    // Process each user
    for (const user of users) {
      // Skip if no auth_user_id (not linked)
      if (!user.auth_user_id) {
        console.log(
          `[WA][DIGEST] Skip | phone=${user.phone_number} | reason=not_linked`
        );
        stats.skipped++;
        continue;
      }

      // Skip if opted out
      if (user.opted_out) {
        console.log(
          `[WA][DIGEST] Skip | userId=${user.auth_user_id} | reason=opted_out`
        );
        stats.skipped++;
        continue;
      }

      // ATOMIC CLAIM: Attempt to claim this user's digest slot for today
      // Only succeeds if daily_digest_enabled = true AND digest not already sent today
      const { data: claimed, error: claimError } = await supabase
        .from('whatsapp_users')
        .update({ last_digest_sent_at: today })
        .eq('id', user.id)
        .eq('daily_digest_enabled', true)
        .or(`last_digest_sent_at.is.null,last_digest_sent_at.neq.${today}`)
        .select('id, phone_number, auth_user_id')
        .maybeSingle();

      if (claimError) {
        console.error(
          `[WA][DIGEST] Claim error | userId=${user.auth_user_id}:`,
          claimError
        );
        stats.failed++;
        continue;
      }

      if (!claimed) {
        // Another job already claimed this user's digest for today
        console.log(
          `[WA][DIGEST] Skip | userId=${user.auth_user_id} | reason=already_claimed`
        );
        stats.skipped++;
        continue;
      }

      console.log(
        `[WA][DIGEST] Claim | userId=${user.auth_user_id} | date=${today}`
      );

      const viewResult = await executeTaskView({
        identity: { kind: 'authUserId', authUserId: user.auth_user_id },
        view: 'digest',
        filters: { status: 'active', date: today },
        timezone: 'Asia/Kolkata',
      });

      if (viewResult.identityResolved === false) {
        console.log(
          `[WA][DIGEST] Revert | userId=${user.auth_user_id} | reason=no_app_user`
        );
        await supabase
          .from('whatsapp_users')
          .update({ last_digest_sent_at: null })
          .eq('id', user.id);
        stats.failed++;
        continue;
      }

      // Skip if no tasks for today - revert claim
      if (!viewResult.tasks || viewResult.tasks.length === 0) {
        console.log(
          `[WA][DIGEST] Skip | userId=${user.auth_user_id} | reason=no_tasks_today`
        );
        console.log(
          `[WA][DIGEST] Revert | userId=${user.auth_user_id} | reason=no_tasks_today`
        );
        await supabase
          .from('whatsapp_users')
          .update({ last_digest_sent_at: null })
          .eq('id', user.id);
        stats.skipped++;
        continue;
      }

      // Format digest message
      const taskList = formatDigestFromResult(viewResult);
      const taskCount = viewResult.tasks.length;
      const freeFormMessage = 
        `Good morning! You have ${taskCount} task${taskCount > 1 ? 's' : ''} due today:\n\n${taskList}`;
      const templateParams = [taskCount.toString(), taskList];

      console.log(
        `[WA][DIGEST] Sending | userId=${user.auth_user_id} | ` +
        `taskCount=${taskCount}`
      );

      // Send via session-aware router
      const messageId = await sendWhatsAppMessageWithFallback({
        phoneNumber: user.phone_number,
        userId: user.auth_user_id,
        message: freeFormMessage,
        templateId: TEMPLATES.DAILY_DIGEST.templateId,
        templateParams,
      });

      if (messageId) {
        console.log(
          `[WA][DIGEST] Success | userId=${user.auth_user_id} | ` +
          `msgId=${messageId}`
        );
        stats.sent++;
      } else {
        // Send failed - revert the claim so it can be retried
        console.log(
          `[WA][DIGEST] Revert | userId=${user.auth_user_id} | reason=send_failed`
        );
        await supabase
          .from('whatsapp_users')
          .update({ last_digest_sent_at: null })
          .eq('id', user.id);
        stats.failed++;
      }
    }

    console.log(
      `[WA][DIGEST] Job complete | ` +
      `total=${stats.total} | sent=${stats.sent} | ` +
      `skipped=${stats.skipped} | failed=${stats.failed}`
    );

    return stats;
  } catch (error) {
    console.error('[WA][DIGEST] Job error:', error);
    return stats;
  }
}
