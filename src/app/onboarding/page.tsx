"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getCurrentAppUser, resolvePostAuthRoute } from "@/lib/users/linking";

export default function OnboardingPage() {
  return (
    <ProtectedRoute>
      <OnboardingInner />
    </ProtectedRoute>
  );
}

function OnboardingInner() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    (async () => {
      const appUser = await getCurrentAppUser();
      if (!active) return;
      router.replace(resolvePostAuthRoute(appUser));
    })();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-background text-foreground">
      <p className="text-muted-foreground">Routing onboarding...</p>
    </main>
  );
}

