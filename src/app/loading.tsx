export default function Loading() {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-4">
      <main className="container mx-auto px-3 md:px-4 py-6 md:py-8 max-w-4xl">
        {/* Greeting Skeleton */}
        <div className="mb-6 md:mb-8 animate-pulse">
          <div className="h-8 md:h-10 bg-muted rounded-lg w-3/4 mb-2" />
          <div className="h-4 md:h-5 bg-muted rounded w-1/2" />
        </div>

        <div className="space-y-4 md:space-y-6">
          {/* Stats Cards Skeleton */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-3 md:p-4 animate-pulse">
                <div className="h-6 bg-muted rounded w-8 mb-2" />
                <div className="h-8 bg-muted rounded w-20 mb-1" />
                <div className="h-4 bg-muted rounded w-24" />
              </div>
            ))}
          </div>

          {/* Meals Skeleton */}
          <section>
            <div className="h-6 bg-muted rounded w-32 mb-3 animate-pulse" />
            <div className="grid grid-cols-3 gap-2 md:gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-2 md:p-4 animate-pulse">
                  <div className="h-8 md:h-10 bg-muted rounded-full w-8 md:w-10 mx-auto mb-2" />
                  <div className="h-3 bg-muted rounded w-12 mx-auto mb-1" />
                  <div className="h-4 bg-muted rounded w-full" />
                </div>
              ))}
            </div>
          </section>

          {/* Tasks Skeleton */}
          <section>
            <div className="h-6 bg-muted rounded w-32 mb-3 animate-pulse" />
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-3 md:p-4 flex gap-3 animate-pulse">
                  <div className="h-5 w-5 bg-muted rounded flex-shrink-0" />
                  <div className="flex-1">
                    <div className="h-5 bg-muted rounded w-3/4 mb-2" />
                    <div className="h-4 bg-muted rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
