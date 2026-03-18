"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getCurrentAppUser } from "@/lib/users/linking";
import { supabase } from "@/lib/supabaseClient";

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
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
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

      // Pre-fill if name already saved
      if (appUser.display_name) {
        setDisplayName(appUser.display_name);
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const handleSave = async (nameToSave: string) => {
    setError(null);
    setSaving(true);

    const appUser = await getCurrentAppUser();
    if (!appUser) {
      router.replace("/app");
      return;
    }

    const { error: updateError } = await supabase
      .from("app_users")
      .update({
        onboarding_state: "onboarding_complete",
        ...(nameToSave.trim() ? { display_name: nameToSave.trim() } : {}),
      })
      .eq("id", appUser.id);

    if (updateError) {
      console.error("[onboarding] update error", updateError);
      setError("Could not save. Please try again.");
      setSaving(false);
      return;
    }

    router.replace("/onboarding/first-task");
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-8 bg-background">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center text-primary font-bold text-xl select-none">
            L
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Welcome to Laya</h1>
          <p className="text-sm text-muted-foreground text-center">
            What should we call you?
          </p>
        </div>

        {/* Name input */}
        <div className="space-y-2">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && displayName.trim()) {
                handleSave(displayName);
              }
            }}
            placeholder="Your first name"
            maxLength={50}
            autoFocus
            className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground text-base placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => handleSave(displayName)}
            disabled={saving || !displayName.trim()}
            className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
          <button
            type="button"
            onClick={() => handleSave("")}
            disabled={saving}
            className="w-full text-sm text-muted-foreground py-2 hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>
    </main>
  );
}

