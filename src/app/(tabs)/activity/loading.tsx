import { Card } from '@/components/ui';

export default function ActivityLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-green-950/10 to-black pb-24 md:pb-8">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
        {/* Header Skeleton */}
        <div className="mb-8 animate-pulse">
          <div className="h-10 bg-gray-800 rounded-lg w-40 mb-3"></div>
          <div className="h-6 bg-gray-800 rounded-lg w-64"></div>
        </div>

        {/* Stats Cards Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-gray-800 rounded-full"></div>
                <div className="h-8 bg-gray-800 rounded w-12"></div>
              </div>
              <div className="h-4 bg-gray-700 rounded w-28"></div>
            </Card>
          ))}
        </div>

        {/* Chart Skeleton */}
        <Card className="animate-pulse">
          <div className="h-6 bg-gray-800 rounded w-48 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 bg-gray-800 rounded w-10"></div>
                <div className="flex-1 h-8 bg-gray-800 rounded-lg"></div>
                <div className="h-4 bg-gray-800 rounded w-8"></div>
              </div>
            ))}
          </div>
        </Card>
      </main>
    </div>
  );
}

