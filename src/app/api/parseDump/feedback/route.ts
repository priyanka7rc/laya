/**
 * POST /api/parseDump/feedback
 *
 * Called fire-and-forget by the web Capture page after the user applies or
 * discards the Unload review. Writes user_outcome and rejected_actions back
 * to the ai_turn_log row for the given turn_id.
 *
 * Body:
 *   { turn_id: string, outcome: 'accepted' | 'partially_accepted' | 'discarded', rejected_actions?: unknown[] }
 *
 * Always returns 200 — the client does not await this; errors are logged only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auditFeedback } from '@/lib/auditLog';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { turn_id, outcome, rejected_actions } = body as {
      turn_id?: string;
      outcome?: string;
      rejected_actions?: unknown[];
    };

    if (
      typeof turn_id !== 'string' ||
      !turn_id ||
      !['accepted', 'partially_accepted', 'discarded'].includes(outcome ?? '')
    ) {
      return NextResponse.json({ ok: false, error: 'invalid_params' }, { status: 200 });
    }

    await auditFeedback(
      turn_id,
      outcome as 'accepted' | 'partially_accepted' | 'discarded',
      Array.isArray(rejected_actions) ? rejected_actions : undefined
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn('[parseDump/feedback] error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
