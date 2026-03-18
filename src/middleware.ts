import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for basic auth guarding and dev cache control.
 *
 * DEV: Disables caching for fresh builds after code changes.
 * PROD: Normal caching for performance.
 */
export function middleware(request: NextRequest) {
  const start = Date.now();
  const response = NextResponse.next();

  // DEV ONLY: Disable HTTP caching to always get fresh builds
  if (process.env.NODE_ENV === 'development') {
    response.headers.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
  }

  // Log API requests so activity is visible in the terminal
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const duration = Date.now() - start;
    console.log(
      `[API] ${request.method} ${request.nextUrl.pathname} (${duration}ms)`
    );
  }

  // NOTE: For now we rely on client-side AuthProvider + ProtectedRoute
  // for redirecting unauthenticated users to /login.
  // If we add server-side session checks later, we can use this middleware.

  return response;
}

export const config = {
  matcher: [
    // Apply to API routes (no caching in dev)
    '/api/:path*',

    // Apply to app pages (no caching in dev)
    '/mealplan/:path*',
    '/grocery/:path*',
    '/(tabs)/:path*',
    '/app',
    '/onboarding',
    '/onboarding/first-task',
  ],
};

