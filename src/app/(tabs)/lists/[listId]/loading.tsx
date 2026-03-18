import { Card } from "@/components/ui";

export default function ListDetailLoading() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
        <div className="mb-6">
          <div className="h-4 bg-muted rounded w-24 mb-2 animate-pulse" />
          <div className="h-10 bg-muted rounded-lg w-48 animate-pulse" />
        </div>

        <Card className="mb-6 animate-pulse p-4">
          <div className="h-11 bg-muted rounded-xl" />
        </Card>

        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse p-4">
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 bg-muted rounded flex-shrink-0" />
                <div className="h-5 bg-muted rounded w-3/4" />
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
