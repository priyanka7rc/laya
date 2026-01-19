import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for cache control and security headers
 * 
 * DEV: Disables caching for fresh builds after code changes
 * PROD: Normal caching for performance
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  
  // DEV ONLY: Disable HTTP caching to always get fresh builds
  if (process.env.NODE_ENV === 'development') {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
  }
  
  // PROD: Let Next.js handle caching automatically
  // (API routes and pages use their own cache strategies)
  
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
  ],
};

