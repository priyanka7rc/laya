'use client';

import { Button, Card } from '@/components/ui';

export default function TasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-background pb-24 md:pb-8 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <Card className="text-center border-danger-border">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-danger rounded-full mb-4">
              <span className="text-3xl">😕</span>
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Couldn't load tasks
            </h2>
            <p className="text-muted-foreground">
              We hit a snag loading your tasks. Don't worry, your data is safe.
            </p>
          </div>

          <div className="space-y-3">
            <Button onClick={reset} className="w-full">
              Try again
            </Button>
            <Button
              variant="secondary"
              onClick={() => { window.location.href = '/home'; }}
              className="w-full"
            >
              Go to Home
            </Button>
          </div>

          {error.message && (
            <details className="mt-4 text-left">
              <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
                Technical details
              </summary>
              <p className="mt-2 text-xs text-muted-foreground font-mono break-all">
                {error.message}
              </p>
            </details>
          )}
        </Card>
      </div>
    </div>
  );
}
