"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getCurrentAppUser } from "@/lib/users/linking";
import { completeWithFirstTaskOrSkip } from "@/lib/onboarding/service";

export default function FirstTaskPage() {
  return (
    <ProtectedRoute>
      <FirstTaskInner />
    </ProtectedRoute>
  );
}

function FirstTaskInner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const appUser = await getCurrentAppUser();
      if (!active) return;

      if (!appUser) {
        router.replace("/login");
        return;
      }
      if (appUser.onboarding_state === "app_verified") {
        router.replace("/onboarding/required");
        return;
      }
      if (appUser.onboarding_state === "profile_required_done") {
        router.replace("/onboarding/preferences");
        return;
      }
      if (appUser.onboarding_state === "onboarding_complete") {
        router.replace("/app");
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const handleSkip = async () => {
    setSaving(true);
    const result = await completeWithFirstTaskOrSkip({});
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace("/app");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    setSaving(true);
    const result = await completeWithFirstTaskOrSkip({ title });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.replace("/app");
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col px-4 py-8 bg-background">
      <div className="w-full max-w-md mx-auto space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">One thing for today</h1>
        <p className="text-sm text-muted-foreground">
          Add just one thing that's on your mind. You can always add more later.
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <textarea
            className="w-full border border-border rounded px-3 py-2 text-base min-h-[80px] bg-elevated text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Send kid in costume tomorrow, pay electricity bill, call Amma…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {error && <p className="text-sm text-danger-foreground">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-primary text-primary-foreground py-2 rounded disabled:opacity-60 hover:bg-primary/90 transition-colors"
          >
            {saving ? "Saving..." : "Save task"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleSkip}
          disabled={saving}
          className="w-full border border-border py-2 rounded text-sm text-foreground disabled:opacity-60 hover:bg-muted transition-colors"
        >
          Skip for now
        </button>
      </div>
    </main>
  );
}
