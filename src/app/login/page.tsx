"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { normalizeToE164India } from "@/lib/auth/phone";
import { sendOtp, verifyOtp } from "@/lib/auth/otp";
import {
  getCurrentAppUser,
  linkAuthUserToAppUser,
  resolvePostAuthRoute,
} from "@/lib/users/linking";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [rawPhone, setRawPhone] = useState("+91 ");
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  useEffect(() => {
    let active = true;
    if (loading || !user) return;

    (async () => {
      const appUser = await getCurrentAppUser();
      if (!active) return;
      router.replace(resolvePostAuthRoute(appUser));
    })();

    return () => {
      active = false;
    };
  }, [loading, user, router]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalized = normalizeToE164India(rawPhone);
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
    setResendSeconds(60);
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

    const {
      data: { user: authedUser },
    } = await supabase.auth.getUser();

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

    const appUser = await getCurrentAppUser();
    setSubmitting(false);
    router.replace(resolvePostAuthRoute(appUser));
  };

  const handleResend = async () => {
    if (!phoneE164 || resendSeconds > 0 || submitting) return;
    setError(null);
    setSubmitting(true);
    const result = await sendOtp(phoneE164);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setResendSeconds(60);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-center text-foreground">Sign in</h1>
        <p className="text-sm text-center text-muted-foreground">
          Enter your phone number to get a one-time code.
        </p>

        {step === "phone" && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-foreground">Phone number</label>
              <input
                type="tel"
                className="w-full border border-border rounded px-3 py-2 text-base bg-elevated text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="+91 9876543210"
                value={rawPhone}
                onChange={(e) => setRawPhone(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-danger-foreground">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary text-primary-foreground py-2 rounded disabled:opacity-60 hover:bg-primary/90 transition-colors"
            >
              {submitting ? "Sending..." : "Send code"}
            </button>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-foreground">Enter code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                className="w-full border border-border rounded px-3 py-2 text-base tracking-widest text-center bg-elevated text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </div>
            {phoneE164 && (
              <p className="text-xs text-muted-foreground">
                Code sent to {phoneE164}. It may take a moment to arrive.
              </p>
            )}
            <button
              type="button"
              onClick={handleResend}
              disabled={submitting || resendSeconds > 0}
              className="w-full border border-border py-2 rounded text-sm text-foreground disabled:opacity-60 hover:bg-muted transition-colors"
            >
              {resendSeconds > 0
                ? `Resend code in ${resendSeconds}s`
                : "Resend code"}
            </button>
            {error && <p className="text-sm text-danger-foreground">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary text-primary-foreground py-2 rounded disabled:opacity-60 hover:bg-primary/90 transition-colors"
            >
              {submitting ? "Verifying..." : "Verify and continue"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
