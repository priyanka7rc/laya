"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { normalizeIndianPhone } from "@/lib/phone";
import { sendOtp, verifyOtp } from "@/lib/auth/otp";
import { linkAuthUserToAppUser, getCurrentAppUser } from "@/lib/users/linking";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [rawPhone, setRawPhone] = useState("");
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in, go to app
  if (!loading && user) {
    router.replace("/app");
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalized = normalizeIndianPhone(rawPhone);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }

    setSubmitting(true);
    const result = await sendOtp(normalized.value);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    setPhoneE164(normalized.value);
    setStep("otp");
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneE164) return;

    setSubmitting(true);
    setError(null);

    const verifyResult = await verifyOtp(phoneE164, otp.trim());

    if (!verifyResult.ok) {
      setSubmitting(false);
      setError(verifyResult.error.message);
      return;
    }

    // Supabase session is now set; fetch user and link to app_user
    const { data: { user: authedUser } } = await (await import("@/lib/supabaseClient")).supabase.auth.getUser();

    if (!authedUser) {
      setSubmitting(false);
      setError("Login failed. Please try again.");
      return;
    }

    const linkResult = await linkAuthUserToAppUser({
      authUserId: authedUser.id,
      phoneE164,
      email: authedUser.email ?? null,
    });

    if (!linkResult.ok) {
      setSubmitting(false);
      setError(linkResult.error);
      return;
    }

    // Decide where to go based on onboarding_state
    const appUser = await getCurrentAppUser();
    setSubmitting(false);

    if (!appUser) {
      router.replace("/app");
      return;
    }

    if (
      appUser.onboarding_state === "whatsapp_started" ||
      appUser.onboarding_state === "app_verified"
    ) {
      router.replace("/onboarding");
    } else if (
      appUser.onboarding_state === "onboarding_complete"
    ) {
      router.replace("/onboarding/first-task");
    } else {
      router.replace("/app");
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-center">Sign in</h1>
        <p className="text-sm text-center text-gray-500">
          Enter your phone number to get a one-time code.
        </p>

        {step === "phone" && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm">Phone number</label>
              <input
                type="tel"
                className="w-full border rounded px-3 py-2 text-base"
                placeholder="10-digit Indian mobile"
                value={rawPhone}
                onChange={(e) => setRawPhone(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-black text-white py-2 rounded disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send code"}
            </button>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm">Enter code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                className="w-full border rounded px-3 py-2 text-base tracking-widest text-center"
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </div>
            {phoneE164 && (
              <p className="text-xs text-gray-500">
                Code sent to {phoneE164}. It may take a moment to arrive.
              </p>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-black text-white py-2 rounded disabled:opacity-60"
            >
              {submitting ? "Verifying..." : "Verify and continue"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

