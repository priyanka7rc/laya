import { Card } from '@/components/ui';

export default function MealsLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-orange-950/10 to-black pb-24 md:pb-8">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-4xl">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between mb-6 animate-pulse">
          <div>
            <div className="h-10 bg-gray-800 rounded-lg w-48 mb-2"></div>
            <div className="h-5 bg-gray-800 rounded-lg w-32"></div>
          </div>
          <div className="flex gap-2">
            <div className="h-11 w-28 bg-gray-800 rounded-2xl"></div>
            <div className="h-11 w-32 bg-gray-800 rounded-2xl"></div>
          </div>
        </div>

        {/* Recipe Card Skeletons */}
        <div className="grid gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="h-6 bg-gray-800 rounded w-3/4 mb-2"></div>
                  <div className="flex gap-3">
                    <div className="h-5 bg-gray-700 rounded w-20"></div>
                    <div className="h-5 bg-gray-700 rounded w-24"></div>
                  </div>
                </div>
                <div className="h-8 w-8 bg-gray-800 rounded"></div>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}

