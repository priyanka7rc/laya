export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { insertListWithIdempotency } from '@/server/lists/insertListWithIdempotency';
import { normalizeImportCandidates } from '@/lib/listImportCandidates';

const LOG = '[lists/import/confirm]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { mediaId, lists: incomingLists } = body as {
      mediaId?: string;
      lists?: Array<{
        name: string;
        candidates: Array<{ text: string; classification?: string; sourceLine?: number }>;
      }>;
    };

    if (!mediaId || typeof mediaId !== 'string') {
      return NextResponse.json({ error: 'mediaId required' }, { status: 400 });
    }

    if (!Array.isArray(incomingLists) || incomingLists.length === 0) {
      return NextResponse.json(
        { error: 'lists array required (at least one list)' },
        { status: 400 }
      );
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const created: Array<{ id: string; name: string; candidatesCount: number }> =
      [];
    const warnings: string[] = [];

    for (let i = 0; i < incomingLists.length; i++) {
      const list = incomingLists[i];
      const name = typeof list.name === 'string' ? list.name.trim() : '';
      const candidates = Array.isArray(list.candidates) ? list.candidates : [];

      if (!name) {
        return NextResponse.json(
          { error: `List at index ${i} has no name` },
          { status: 400 }
        );
      }

      const sourceMessageId = `${mediaId}:${i}`;

      const importCandidatesArray = normalizeImportCandidates(candidates);
      const importCandidates = importCandidatesArray.length
        ? importCandidatesArray.map((c) => c.text)
        : null;

      const result = await insertListWithIdempotency({
        appUserId: appUser.id,
        name,
        source: 'ocr',
        sourceMessageId,
        importCandidates,
      });

      if (!candidates.length) {
        warnings.push(`List "${name}" has no item candidates.`);
      }

      created.push({
        id: result.list.id,
        name: result.list.name,
        candidatesCount: candidates.length,
      });
    }

    return NextResponse.json({ created, warnings });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Confirm failed' }, { status: 500 });
  }
}
