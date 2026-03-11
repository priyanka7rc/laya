"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getCurrentAppUser } from "@/lib/users/linking";
import { supabase } from "@/lib/supabaseClient";

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
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const appUser = await getCurrentAppUser();
      if (!active) return;

      if (!appUser) {
        router.replace("/app");
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const markOnboardingState = async () => {
    const appUser = await getCurrentAppUser();
    if (!appUser) return;

    const { error: updateError } = await supabase
      .from("app_users")
      .update({ onboarding_state: "first_task_done" })
      .eq("id", appUser.id);

    if (updateError) {
      console.error("[first-task] update error", updateError);
    }
  };

  const handleSkip = async () => {
    await markOnboardingState();
    router.replace("/app");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Add a short task or skip for now.");
      return;
    }

    const appUser = await getCurrentAppUser();
    if (!appUser) {
      router.replace("/app");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/tasks/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        text: title.trim(),
        allowDuplicate: true,
        app_user_id: appUser.id,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data && data.error) || "Could not save task. Please try again.");
      return;
    }

    await markOnboardingState();
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
            className="w-full bg-black text-white py-2 rounded"
          >
            Save task
          </button>
        </form>

        <button
          type="button"
          onClick={handleSkip}
          className="w-full border border-gray-300 py-2 rounded text-sm"
        >
          Skip for now
        </button>
      </div>
    </main>
  );
}

