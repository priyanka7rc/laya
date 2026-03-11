export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { runDailyDigestJob } from '@/lib/whatsapp-digest';

const LOG = '[jobs/whatsapp-digest]';

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-cron-secret');
    if (!secret || secret !== process.env.CRON_SECRET) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const result = await runDailyDigestJob();
    return NextResponse.json(result);
  } catch (error) {
    console.error(LOG, error);
    return NextResponse.json({ error: 'Digest job failed' }, { status: 500 });
  }
}

