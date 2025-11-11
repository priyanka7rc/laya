'use client';

import { Button, Card } from '@/components/ui';

export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-emerald-950/20 to-black pb-24 md:pb-8 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <Card className="text-center border-red-900/50">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-900/30 rounded-full mb-4">
              <span className="text-3xl">😕</span>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Something went wrong
            </h2>
            <p className="text-gray-400">
              We couldn't load your home page. Don't worry, your data is safe.
            </p>
          </div>
          
          <div className="space-y-3">
            <Button
              onClick={reset}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
            >
              Try again
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.location.href = '/tasks'}
              className="w-full"
            >
              Go to Tasks
            </Button>
          </div>
          
          {error.message && (
            <details className="mt-4 text-left">
              <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-400">
                Technical details
              </summary>
              <p className="mt-2 text-xs text-gray-600 font-mono break-all">
                {error.message}
              </p>
            </details>
          )}
        </Card>
      </div>
    </div>
  );
}

