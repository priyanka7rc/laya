import { Card } from "@/components/ui";

export default function HomeLoading() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
        <div className="mb-8 md:mb-12 animate-pulse">
          <div className="h-10 bg-muted rounded-lg w-48 mb-2" />
          <div className="h-5 bg-muted rounded-lg w-36" />
        </div>

        <div className="space-y-6">
          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-muted rounded" />
              <div className="h-6 bg-muted rounded-lg w-32" />
            </div>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-xl">
                <div className="h-5 w-5 bg-muted rounded" />
                <div className="flex-1">
                  <div className="h-5 bg-muted rounded w-3/4 mb-2" />
                  <div className="h-4 bg-muted rounded w-24" />
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-xl">
                <div className="h-5 w-5 bg-muted rounded" />
                <div className="flex-1">
                  <div className="h-5 bg-muted rounded w-2/3 mb-2" />
                  <div className="h-4 bg-muted rounded w-32" />
                </div>
              </div>
            </div>
          </Card>

          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-muted rounded" />
              <div className="h-6 bg-muted rounded-lg w-32" />
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="h-8 bg-muted rounded-full w-36" />
              <div className="h-8 bg-muted rounded-full w-32" />
              <div className="h-8 bg-muted rounded-full w-40" />
            </div>
          </Card>

          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-muted rounded" />
              <div className="h-6 bg-muted rounded-lg w-40" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="h-5 bg-muted rounded w-32 mb-2" />
                <div className="h-4 bg-muted rounded w-24" />
              </div>
              <div className="h-12 w-12 bg-muted rounded-lg" />
            </div>
          </Card>

          <div className="pt-4">
            <div className="h-14 bg-muted rounded-xl animate-pulse" />
          </div>
        </div>
      </main>
    </div>
  );
}

