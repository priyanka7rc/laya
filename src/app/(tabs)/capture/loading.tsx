import { Card } from "@/components/ui";

export default function CaptureLoading() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
        <div className="mb-8 animate-pulse">
          <div className="h-10 bg-muted rounded-lg w-32 mb-2" />
        </div>

        <div className="space-y-6">
          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-muted rounded" />
              <div className="h-6 bg-muted rounded-lg w-24" />
            </div>
            <div className="h-11 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-lg w-24 mt-3" />
          </Card>

          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-muted rounded" />
              <div className="h-6 bg-muted rounded-lg w-28" />
            </div>
            <div className="h-4 bg-muted rounded w-full mb-3" />
            <div className="h-28 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-lg w-full mt-3" />
          </Card>

          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-muted rounded" />
              <div className="h-6 bg-muted rounded-lg w-20" />
            </div>
            <div className="h-32 bg-muted/50 rounded-xl border-2 border-dashed border-muted" />
          </Card>

          <Card className="animate-pulse p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 bg-muted rounded" />
              <div className="h-6 bg-muted rounded-lg w-28" />
            </div>
            <div className="h-10 bg-muted rounded-lg w-full" />
          </Card>
        </div>
      </main>
    </div>
  );
}
