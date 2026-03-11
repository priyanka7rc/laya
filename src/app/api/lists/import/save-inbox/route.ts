export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { getOrCreateSystemList } from '@/server/lists/getOrCreateSystemList';
import { mergeImportCandidates } from '@/lib/listImportCandidates';

const LOG = '[lists/import/save-inbox]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { mediaId, candidates } = body as {
      mediaId?: string;
      candidates?: Array<{ text: string; classification?: string; sourceLine?: number }>;
    };

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return NextResponse.json({ error: 'candidates array required' }, { status: 400 });
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const inbox = await getOrCreateSystemList({
      appUserId: appUser.id,
      systemKey: 'inbox',
      defaultName: 'Inbox',
    });

    const { data: inboxRow } = await supabaseAdmin!
      .from('lists')
      .select('id, import_candidates')
      .eq('id', inbox.id)
      .maybeSingle<{ id: string; import_candidates: unknown }>();

    const merged = mergeImportCandidates(
      inboxRow?.import_candidates ?? [],
      candidates
    );

    const { error: updateErr } = await supabaseAdmin!
      .from('lists')
      .update({
        import_candidates: merged,
      })
      .eq('id', inbox.id);

    if (updateErr) {
      console.error(LOG, updateErr);
      return NextResponse.json({ error: 'Failed to save to Inbox' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, listId: inbox.id, mediaId: mediaId ?? null });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to save to Inbox' }, { status: 500 });
  }
}

