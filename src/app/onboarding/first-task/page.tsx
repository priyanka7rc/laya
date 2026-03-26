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
      <main className="min-h-screen flex items-center justify-center">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col px-4 py-8">
      <div className="w-full max-w-md mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">One thing for today</h1>
        <p className="text-sm text-gray-600">
          Add just one thing that’s on your mind. You can always add more later.
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <textarea
            className="w-full border rounded px-3 py-2 text-base min-h-[80px]"
            placeholder="Send kid in costume tomorrow, pay electricity bill, call Amma…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-black text-white py-2 rounded disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save task"}
          </button>
        </form>

        <button
          type="button"
          onClick={handleSkip}
          disabled={saving}
          className="w-full border border-gray-300 py-2 rounded text-sm disabled:opacity-60"
        >
          Skip for now
        </button>
      </div>
    </main>
  );
}

