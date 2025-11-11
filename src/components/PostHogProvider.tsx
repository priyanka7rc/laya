'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialized = useRef(false);

  useEffect(() => {
    // Only run on client side and only once
    if (typeof window === 'undefined' || initialized.current) return;
    
    // Access env vars inline for Next.js to embed them at build time
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

    if (!key) {
      console.log('[Analytics] PostHog key not configured. Skipping analytics.');
      return;
    }

    posthog.init(key, {
      api_host: host || 'https://app.posthog.com',
      person_profiles: 'identified_only', // Only create profiles for logged-in users
      capture_pageview: false, // We'll capture manually
      capture_pageleave: true,
    });

    initialized.current = true;
    console.log('[Analytics] PostHog initialized');
  }, []);

  // Track page views on route change
  useEffect(() => {
    if (initialized.current && pathname) {
      let url = window.origin + pathname;
      if (searchParams && searchParams.toString()) {
        url = url + '?' + searchParams.toString();
      }
      
      posthog.capture('$pageview', {
        $current_url: url,
      });
    }
  }, [pathname, searchParams]);

  return <>{children}</>;
}


