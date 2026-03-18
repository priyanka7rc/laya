import { Card } from "@/components/ui";

export default function ListsLoading() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="h-10 bg-muted rounded-lg w-20 mb-2 animate-pulse" />
            <div className="h-4 bg-muted rounded w-16 animate-pulse" />
          </div>
        </div>

        <Card className="mb-6 animate-pulse p-4">
          <div className="h-11 bg-muted rounded-xl" />
          <div className="h-10 bg-muted rounded-lg w-24 mt-3" />
        </Card>

        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse p-4">
              <div className="h-5 bg-muted rounded w-3/4 mb-2" />
              <div className="h-4 bg-muted rounded w-1/2" />
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
