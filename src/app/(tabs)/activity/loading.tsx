import { Card } from '@/components/ui';

export default function ActivityLoading() {
  return (
    <div className="min-h-screen bg-background pb-24 md:pb-8">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
        {/* Header Skeleton */}
        <div className="mb-8 animate-pulse">
          <div className="h-10 bg-muted rounded-lg w-40 mb-3" />
          <div className="h-6 bg-muted rounded-lg w-64 opacity-90" />
        </div>

        {/* Stats Cards Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-muted rounded-full" />
                <div className="h-8 bg-muted rounded w-12" />
              </div>
              <div className="h-4 bg-muted rounded w-28 opacity-80" />
            </Card>
          ))}
        </div>

        {/* Chart Skeleton */}
        <Card className="animate-pulse">
          <div className="h-6 bg-muted rounded w-48 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 bg-muted rounded w-10" />
                <div className="flex-1 h-8 bg-muted rounded-lg" />
                <div className="h-4 bg-muted rounded w-8" />
              </div>
            ))}
          </div>
        </Card>
      </main>
    </div>
  );
}
