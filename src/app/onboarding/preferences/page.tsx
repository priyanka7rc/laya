"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getCurrentAppUser } from "@/lib/users/linking";
import { savePreferencesOrSkip } from "@/lib/onboarding/service";

export default function OnboardingPreferencesPage() {
  return (
    <ProtectedRoute>
      <OnboardingPreferencesInner />
    </ProtectedRoute>
  );
}

function OnboardingPreferencesInner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [householdMode, setHouseholdMode] = useState<"run_most" | "shared" | "support" | "">("");
  const [reminderWindow, setReminderWindow] = useState<"morning" | "afternoon" | "evening" | "">("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);

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
      if (appUser.onboarding_state === "onboarding_complete") {
        router.replace("/app");
        return;
      }

      setHouseholdMode(appUser.household_mode ?? "");
      setReminderWindow(appUser.reminder_window_pref ?? "");
      setWhatsappEnabled(appUser.whatsapp_assistant_enabled ?? true);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const handleContinue = async () => {
    setSaving(true);
    setError(null);
    const result = await savePreferencesOrSkip({
      householdMode: householdMode || null,
      reminderWindowPref: reminderWindow || null,
      whatsappAssistantEnabled: whatsappEnabled,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace("/onboarding/first-task");
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </main>
    );
  }

  const selectClass =
    "w-full border border-border rounded px-3 py-2 bg-elevated text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-background">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Preferences (Optional)</h1>
        <p className="text-sm text-muted-foreground">You can skip this and update later.</p>

        <div>
          <label className="text-sm text-foreground block mb-1">Household mode</label>
          <select
            value={householdMode}
            onChange={(e) => setHouseholdMode(e.target.value as typeof householdMode)}
            className={selectClass}
          >
            <option value="">Select (optional)</option>
            <option value="run_most">I run most home tasks</option>
            <option value="shared">Tasks are shared</option>
            <option value="support">I mostly support</option>
          </select>
        </div>

        <div>
          <label className="text-sm text-foreground block mb-1">Reminder window</label>
          <select
            value={reminderWindow}
            onChange={(e) => setReminderWindow(e.target.value as typeof reminderWindow)}
            className={selectClass}
          >
            <option value="">Select (optional)</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={whatsappEnabled}
            onChange={(e) => setWhatsappEnabled(e.target.checked)}
          />
          Enable WhatsApp assistant
        </label>

        {error ? <p className="text-sm text-danger-foreground">{error}</p> : null}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleContinue}
            disabled={saving}
            className="w-full bg-primary text-primary-foreground py-2 rounded disabled:opacity-60 hover:bg-primary/90 transition-colors"
          >
            {saving ? "Saving..." : "Continue"}
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={saving}
            className="w-full border border-border py-2 rounded text-sm text-foreground disabled:opacity-60 hover:bg-muted transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </main>
  );
}
