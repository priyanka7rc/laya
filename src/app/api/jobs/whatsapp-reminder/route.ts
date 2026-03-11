export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { runReminderJob } from '@/lib/whatsapp-reminder';

const LOG = '[jobs/whatsapp-reminder]';

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-cron-secret');
    if (!secret || secret !== process.env.CRON_SECRET) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const result = await runReminderJob();
    return NextResponse.json(result);
  } catch (error) {
    console.error(LOG, error);
    return NextResponse.json({ error: 'Reminder job failed' }, { status: 500 });
  }
}

