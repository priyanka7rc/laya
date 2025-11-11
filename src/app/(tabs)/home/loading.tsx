export default function HomeLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-emerald-950/20 to-black pb-24 md:pb-8">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
        {/* Header Skeleton */}
        <div className="mb-8 md:mb-12 animate-pulse">
          <div className="h-10 bg-gray-800 rounded-lg w-48 mb-2"></div>
          <div className="h-6 bg-gray-800 rounded-lg w-36"></div>
        </div>

        {/* Card Skeletons */}
        <div className="space-y-6">
          {/* Tasks Card Skeleton */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900 shadow-sm p-4 animate-pulse">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-gray-800 rounded"></div>
              <div className="h-6 bg-gray-800 rounded-lg w-32"></div>
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-xl">
                <div className="h-5 w-5 bg-gray-700 rounded"></div>
                <div className="flex-1">
                  <div className="h-5 bg-gray-700 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-gray-700 rounded w-24"></div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-800/50 rounded-xl">
                <div className="h-5 w-5 bg-gray-700 rounded"></div>
                <div className="flex-1">
                  <div className="h-5 bg-gray-700 rounded w-2/3 mb-2"></div>
                  <div className="h-4 bg-gray-700 rounded w-32"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Meals Card Skeleton */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900 shadow-sm p-4 animate-pulse">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-gray-800 rounded"></div>
              <div className="h-6 bg-gray-800 rounded-lg w-32"></div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="h-8 bg-gray-800 rounded-full w-36"></div>
              <div className="h-8 bg-gray-800 rounded-full w-32"></div>
              <div className="h-8 bg-gray-800 rounded-full w-40"></div>
            </div>
          </div>

          {/* Grocery Card Skeleton */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900 shadow-sm p-4 animate-pulse">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-gray-800 rounded"></div>
              <div className="h-6 bg-gray-800 rounded-lg w-40"></div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="h-5 bg-gray-800 rounded w-32 mb-2"></div>
                <div className="h-4 bg-gray-700 rounded w-24"></div>
              </div>
              <div className="h-12 w-12 bg-gray-800 rounded-lg"></div>
            </div>
          </div>

          {/* CTA Button Skeleton */}
          <div className="pt-4">
            <div className="h-14 bg-gray-800 rounded-2xl animate-pulse"></div>
          </div>
        </div>
      </main>
    </div>
  );
}

