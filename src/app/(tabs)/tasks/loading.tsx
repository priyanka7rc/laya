import { Card } from '@/components/ui';

export default function TasksLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-blue-950/10 to-black pb-24 md:pb-8">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
        {/* Header Skeleton */}
        <div className="mb-6 animate-pulse">
          <div className="h-10 bg-gray-800 rounded-lg w-32 mb-2"></div>
          <div className="h-5 bg-gray-800 rounded-lg w-48"></div>
        </div>

        {/* Quick Add Skeleton */}
        <Card className="mb-6 border-blue-800/30 animate-pulse">
          <div className="h-11 bg-gray-800/50 rounded-xl"></div>
        </Card>

        {/* Task List Skeletons */}
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="flex items-start gap-3">
                <div className="h-11 w-11 bg-gray-800 rounded-xl flex-shrink-0"></div>
                <div className="flex-1 pt-1">
                  <div className="h-5 bg-gray-800 rounded w-3/4 mb-2"></div>
                  <div className="flex gap-2">
                    <div className="h-6 bg-gray-700 rounded w-20"></div>
                    <div className="h-6 bg-gray-700 rounded w-16"></div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}

