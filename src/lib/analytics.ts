// Analytics utility with PostHog
// Never blocks UI - all tracking wrapped in try/catch

import posthog from 'posthog-js';

// Safe event tracking - never throws
export function trackEvent(eventName: string, properties?: Record<string, any>) {
  try {
    // Check if PostHog is initialized
    if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      return;
    }
    
    posthog.capture(eventName, properties);
  } catch (error) {
    // Silent fail - log but don't throw
    console.warn(`[Analytics] Failed to track event: ${eventName}`, error);
  }
}

// Track session start
export function trackSessionStart() {
  trackEvent('session_start', {
    timestamp: new Date().toISOString(),
  });
}

// Track task add
export function trackTaskAdd() {
  trackEvent('task_add', {
    timestamp: new Date().toISOString(),
  });
}

// Track task toggle
export function trackTaskToggle(taskId: string, isDone: boolean) {
  trackEvent('task_toggle', {
    task_id: taskId,
    is_done: isDone,
    timestamp: new Date().toISOString(),
  });
}

// Track brain dump parse
export function trackDumpParse(tasksCount: number) {
  trackEvent('dump_parse', {
    tasks_count: tasksCount,
    timestamp: new Date().toISOString(),
  });
}

// Track page view
export function trackPageView(path: string) {
  trackEvent('$pageview', {
    $current_url: path,
  });
}

