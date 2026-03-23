"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card, Button } from "@/components/ui";
import { Users, Settings, MessageSquare, ChevronRight } from "@/components/Icons";
import { supabase } from "@/lib/supabaseClient";
import { getCurrentAppUser } from "@/lib/users/linking";

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const [isWhatsAppLinked, setIsWhatsAppLinked] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState<string>("");

  useEffect(() => {
    if (!user) return;

    // Load WhatsApp status
    supabase
      .from("whatsapp_users")
      .select("auth_user_id")
      .eq("auth_user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setIsWhatsAppLinked(!!data));

    // Load display_name from app_users
    getCurrentAppUser().then((appUser) => {
      if (appUser?.display_name) {
        setDisplayName(appUser.display_name);
      } else if (user.email) {
        // Fallback: derive from email
        const emailPart = user.email.split("@")[0];
        setDisplayName(emailPart.charAt(0).toUpperCase() + emailPart.slice(1));
      }
    });
  }, [user]);

  const initial = (displayName || user?.email || "P").charAt(0).toUpperCase();

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl lg:max-w-6xl">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-8">
            Profile
          </h1>

          <div className="space-y-6 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0">
            {/* Profile Header */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-xl shrink-0">
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold text-foreground">{displayName}</h2>
                  <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
                </div>
              </div>
              <button
                type="button"
                className="text-sm text-primary hover:underline font-medium"
                onClick={() => {/* edit profile — future */ }}
              >
                Edit profile
              </button>
            </Card>

            {/* Household */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-accent" />
                  <h3 className="text-lg font-semibold text-foreground">Household</h3>
                </div>
                <button
                  type="button"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Add household member"
                  onClick={() => {/* add member — future */ }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              <div className="rounded-xl p-6 text-center bg-muted/30">
                <p className="text-sm text-muted-foreground">No members yet.</p>
              </div>
            </Card>

            {/* Preferences */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center gap-3 mb-3">
                <Settings className="w-5 h-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold text-foreground">Preferences</h3>
              </div>
              <div className="space-y-0 divide-y divide-border">
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm text-foreground">Timezone</span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    Pacific Time
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm text-foreground">Notifications</span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    On
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm text-foreground">Default reminders</span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    1 hour before
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm text-foreground">Default task category</span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    Personal
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </div>
            </Card>

            {/* WhatsApp */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center gap-3 mb-3">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold text-foreground">WhatsApp</h3>
              </div>
              {isWhatsAppLinked === null ? (
                <p className="text-sm text-muted-foreground py-2">Loading…</p>
              ) : isWhatsAppLinked ? (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Connected</span>
                  <Link href="/link-whatsapp" className="text-sm text-primary hover:underline">
                    Manage
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-4">Not connected</p>
                  <div className="flex justify-center">
                    <Link href="/link-whatsapp">
                      <span className="inline-flex items-center justify-center h-9 px-6 rounded-xl border border-border bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors">
                        Link WhatsApp
                      </span>
                    </Link>
                  </div>
                </>
              )}
            </Card>

            {/* Footer links + Sign out — spans full width */}
            <div className="lg:col-span-2 pt-2 space-y-4">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Help &amp; Support
                </a>
                <span className="text-muted-foreground/40 text-xs">·</span>
                <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Privacy Policy
                </a>
                <span className="text-muted-foreground/40 text-xs">·</span>
                <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Terms of Service
                </a>
              </div>
              <div className="flex justify-center">
                <Button
                  variant="secondary"
                  className="h-9 px-8 text-sm"
                  onClick={() => signOut()}
                >
                  Sign out
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
