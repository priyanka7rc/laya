"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getCurrentAppUser } from "@/lib/users/linking";
import { saveRequiredProfile } from "@/lib/onboarding/service";

export default function OnboardingRequiredPage() {
  return (
    <ProtectedRoute>
      <OnboardingRequiredInner />
    </ProtectedRoute>
  );
}

function OnboardingRequiredInner() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("India");

  useEffect(() => {
    let active = true;
    (async () => {
      const appUser = await getCurrentAppUser();
      if (!active) return;

      if (!appUser) {
        router.replace("/login");
        return;
      }

      if (appUser.onboarding_state === "preferences_done") {
        router.replace("/onboarding/first-task");
        return;
      }
      if (appUser.onboarding_state === "onboarding_complete") {
        router.replace("/app");
        return;
      }

      setDisplayName(appUser.display_name ?? "");
      setEmail(appUser.email ?? "");
      setCity(appUser.city ?? "");
      setCountry(appUser.country ?? "India");
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await saveRequiredProfile({ displayName, email, city, country });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace("/onboarding/preferences");
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </main>
    );
  }

  const inputClass =
    "w-full border border-border rounded px-3 py-2 bg-elevated text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-background">
      <form onSubmit={handleContinue} className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Tell us about you</h1>
        <p className="text-sm text-muted-foreground">All fields are required. Times are shown in IST.</p>

        <input
          type="text"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClass}
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className={inputClass}
        />

        {error ? <p className="text-sm text-danger-foreground">{error}</p> : null}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-primary text-primary-foreground py-2 rounded disabled:opacity-60 hover:bg-primary/90 transition-colors"
        >
          {saving ? "Saving..." : "Continue"}
        </button>
      </form>
    </main>
  );
}
