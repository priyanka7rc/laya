"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card, Button } from "@/components/ui";
import { supabase } from "@/lib/supabaseClient";

export default function LinkWhatsAppPage() {
  const { user } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Pre-fill from auth session phone (phone-OTP login stores phone in user.phone)
  useEffect(() => {
    if (user?.phone && !phoneNumber) {
      setPhoneNumber(user.phone);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!phoneNumber.trim()) {
      setError("Phone number is required");
      return;
    }

    if (!user) {
      setError("Please sign in to continue");
      return;
    }

    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("That didn't work — want to try again?");
      }

      const response = await fetch("/api/link-whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ phone_number: phoneNumber.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to link WhatsApp");
      }

      setSuccess(true);
    } catch (err: unknown) {
      console.error("Error linking WhatsApp:", err);
      setError(
        err instanceof Error ? err.message : "That didn't work — want to try again?"
      );
    } finally {
      setLoading(false);
    }
  };

  const waNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background pb-24 md:pb-8 transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-xl">
          <div className="mb-6">
            <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
              Link WhatsApp
            </h1>
            <p className="text-muted-foreground">
              Connect your phone number to receive tasks via WhatsApp
            </p>
          </div>

          <Card className="p-6">
            {success ? (
              /* Inline success state */
              <div className="text-center space-y-5 py-2">
                <div className="w-16 h-16 rounded-full bg-success flex items-center justify-center mx-auto">
                  <svg
                    className="w-8 h-8 text-success-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-foreground mb-1">
                    WhatsApp linked!
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Send a message to Laya on WhatsApp to get started. Laya will
                    respond once you send your first message.
                  </p>
                </div>
                {waNumber && (
                  <a
                    href={`https://wa.me/${waNumber.replace(/\D/g, "")}?text=Hello`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                  >
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    Message Laya on WhatsApp
                  </a>
                )}
                <Link
                  href="/home"
                  className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Go to Home
                </Link>
              </div>
            ) : (
              /* Link form */
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+91234567890"
                    className="w-full h-11 px-4 bg-elevated border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    disabled={loading}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Include country code (e.g., +91 for India)
                  </p>
                </div>

                {error && (
                  <div className="p-3 bg-destructive border border-destructive-border rounded-xl">
                    <p className="text-sm text-destructive-foreground">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                loading={loading}
                  disabled={loading || !phoneNumber.trim()}
                className="w-full"
              >
                  Link WhatsApp
              </Button>
            </form>
            )}
          </Card>
        </main>
      </div>
    </ProtectedRoute>
  );
}
