import { Card } from "@/components/ui";

export default function ProfileLoading() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
        <div className="h-10 bg-muted rounded-lg w-24 mb-8 animate-pulse" />

        <div className="space-y-6">
          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-muted" />
              <div className="flex-1">
                <div className="h-6 bg-muted rounded w-32 mb-2" />
                <div className="h-4 bg-muted rounded w-48" />
              </div>
            </div>
          </Card>

          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-muted rounded" />
              <div className="h-6 bg-muted rounded-lg w-20" />
            </div>
            <div className="h-20 bg-muted/50 rounded-xl" />
            <div className="h-10 bg-muted rounded-lg w-full mt-4" />
          </Card>

          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-muted rounded" />
              <div className="h-6 bg-muted rounded-lg w-28" />
            </div>
            <div className="h-12 bg-muted rounded" />
          </Card>

          <div className="pt-4">
            <div className="h-12 bg-muted rounded-xl animate-pulse" />
          </div>
        </div>
      </main>
    </div>
  );
}
