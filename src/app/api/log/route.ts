import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface LogPayload {
  level?: 'error' | 'warn' | 'info';
  message: string;
  stack?: string;
  url?: string;
  context?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body: LogPayload = await request.json();
    const { level = 'error', message, stack, url, context } = body;

    const prefix = `[CLIENT:${level.toUpperCase()}]`;
    const location = url ? ` @ ${url}` : '';

    if (level === 'error') {
      console.error(`${prefix} ${message}${location}`);
      if (stack) console.error(stack);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}${location}`);
    } else {
      console.log(`${prefix} ${message}${location}`);
    }

    if (context) {
      console.log(`${prefix} context:`, context);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
