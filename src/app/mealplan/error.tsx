'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 pb-24 md:pb-8">
      <div className="max-w-md w-full bg-gray-900 border border-red-900/50 rounded-lg p-6 md:p-8 text-center">
        <div className="text-6xl mb-4">📅</div>
        <h2 className="text-xl md:text-2xl font-bold text-white mb-2">
          Couldn't load your meal plan
        </h2>
        <p className="text-sm md:text-base text-gray-400 mb-6">
          Something went wrong. Check your connection and try again.
        </p>
        <button
          onClick={reset}
          className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white rounded-lg font-medium transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}