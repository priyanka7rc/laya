import { Card } from '@/components/ui';

export default function TasksLoading() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8 lg:py-12 max-w-3xl lg:max-w-5xl">
        <div className="mb-6 animate-pulse">
          <div className="h-10 bg-muted rounded-lg w-32 mb-2" />
          <div className="h-5 bg-muted rounded-lg w-48" />
        </div>
        <Card className="mb-6 animate-pulse">
          <div className="h-11 bg-muted/50 rounded-xl" />
        </Card>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="flex items-start gap-4 py-1">
                <div className="h-5 w-5 bg-muted rounded flex-shrink-0 mt-1" />
                <div className="flex-1">
                  <div className="h-5 bg-muted rounded w-3/4 mb-2" />
                  <div className="flex gap-2">
                    <div className="h-5 bg-muted/70 rounded w-20" />
                    <div className="h-5 bg-muted/70 rounded w-16" />
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

