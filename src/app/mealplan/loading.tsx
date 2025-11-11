export default function Loading() {
    return (
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-7xl">
          <div className="h-8 bg-gray-800 rounded w-48 mb-6 animate-pulse"></div>
  
          {/* Table Skeleton */}
          <div className="overflow-x-auto">
            <div className="min-w-[600px] space-y-2">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="flex gap-2 animate-pulse">
                  <div className="h-16 bg-gray-900 border border-gray-800 rounded w-24 flex-shrink-0"></div>
                  <div className="h-16 bg-gray-900 border border-gray-800 rounded flex-1"></div>
                  <div className="h-16 bg-gray-900 border border-gray-800 rounded flex-1"></div>
                  <div className="h-16 bg-gray-900 border border-gray-800 rounded flex-1"></div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }