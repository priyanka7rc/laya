"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getCurrentAppUser } from "@/lib/users/linking";
import { supabase } from "@/lib/supabaseClient";

type FocusArea = "work" | "home" | "kids" | "other" | null;

export default function OnboardingPage() {
  return (
    <ProtectedRoute>
      <OnboardingInner />
    </ProtectedRoute>
  );
}

function OnboardingInner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<FocusArea>(null);
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

      // If onboarding is already complete, skip ahead
      if (appUser.onboarding_state === "onboarding_complete" || appUser.onboarding_state === "first_task_done") {
        router.replace("/onboarding/first-task");
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const updateStateAndContinue = async (nextState: "onboarding_complete") => {
    setError(null);
    setLoading(true);

    const appUser = await getCurrentAppUser();
    if (!appUser) {
      router.replace("/app");
      return;
    }

    const { error: updateError } = await supabase
      .from("app_users")
      .update({
        onboarding_state: nextState,
      })
      .eq("id", appUser.id);

    if (updateError) {
      console.error("[onboarding] update error", updateError);
      setError("Could not save. Please try again.");
      setLoading(false);
      return;
    }

    router.replace("/onboarding/first-task");
  };

  const handleSkip = async () => {
    await updateStateAndContinue("onboarding_complete");
  };

  const handleSave = async () => {
    // For now we just persist onboarding_state; focus area can later be stored in meta/settings.
    await updateStateAndContinue("onboarding_complete");
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
        <h1 className="text-2xl font-semibold">Set a few defaults</h1>
        <p className="text-sm text-gray-600">
          This helps Laya prioritise what matters. You can change this later.
        </p>

        <section className="space-y-3">
          <p className="text-sm font-medium">I mostly use Laya for:</p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "work", label: "Work" },
              { id: "home", label: "Home" },
              { id: "kids", label: "Kids" },
              { id: "other", label: "Other" },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFocus(opt.id as FocusArea)}
                className={`px-3 py-1 rounded border text-sm ${
                  focus === opt.id ? "bg-black text-white" : "bg-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleSave}
            className="w-full bg-black text-white py-2 rounded"
          >
            Continue
          </button>
          <button
            type="button"
            onClick={handleSkip}
            className="w-full border border-gray-300 py-2 rounded text-sm"
          >
            Skip for now
          </button>
        </div>
      </div>
    </main>
  );
}

