"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card, Button } from "@/components/ui";
import { Users, Settings, MessageSquare, HelpCircle, ChevronRight } from "@/components/Icons";
import { supabase } from "@/lib/supabaseClient";

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const [isWhatsAppLinked, setIsWhatsAppLinked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("whatsapp_users")
      .select("auth_user_id")
      .eq("auth_user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setIsWhatsAppLinked(!!data));
  }, [user]);

  const displayName = user?.email
    ? user.email.split("@")[0].charAt(0).toUpperCase() + user.email.split("@")[0].slice(1)
    : "Profile";

  const initial = displayName.charAt(0).toUpperCase();

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
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-xl">
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold text-foreground">{displayName}</h2>
                  <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
                </div>
              </div>
            </Card>

            {/* Family */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center gap-3 mb-3">
                <Users className="w-5 h-5 text-accent" />
                <h3 className="text-lg font-semibold text-foreground">Family</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Set up the people in your household.
              </p>
              <div className="rounded-xl p-6 text-center mb-4 bg-muted/30">
                <p className="text-sm text-muted-foreground">
                  No family members added yet.
                </p>
              </div>
              <Button variant="secondary" className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled>
                Add family member (coming soon)
              </Button>
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
            <Card className="rounded-2xl p-5 shadow-sm border border-border lg:col-span-2">
              <div className="flex items-center gap-3 mb-3">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold text-foreground">WhatsApp</h3>
              </div>
              {isWhatsAppLinked === null ? (
                <p className="text-sm text-muted-foreground py-2">Loading…</p>
              ) : isWhatsAppLinked ? (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">Connected</span>
                  <Link
                    href="/link-whatsapp"
                    className="text-sm text-primary hover:underline"
                  >
                    Manage
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    Not connected
                  </p>
                  <Link
                    href="/link-whatsapp"
                    className="block w-full"
                  >
                    <span className="inline-flex items-center justify-center w-full h-11 px-4 rounded-xl border border-border bg-muted text-foreground font-medium hover:bg-muted/80 transition-colors">
                      Link WhatsApp
                    </span>
                  </Link>
                </>
              )}
            </Card>

            {/* Support */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center gap-3 mb-3">
                <HelpCircle className="w-5 h-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold text-foreground">Support</h3>
              </div>
              <div className="space-y-0 divide-y divide-border">
                <a href="#" className="flex items-center justify-between py-3 text-sm text-foreground hover:text-primary">
                  <span>Help</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </a>
                <a href="#" className="flex items-center justify-between py-3 text-sm text-foreground hover:text-primary">
                  <span>Privacy</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </a>
                <a href="#" className="flex items-center justify-between py-3 text-sm text-foreground hover:text-primary">
                  <span>Terms</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </a>
                <a href="mailto:support@laya.app" className="flex items-center justify-between py-3 text-sm text-foreground hover:text-primary">
                  <span>Contact support</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </a>
              </div>
            </Card>

            {/* Sign out */}
            <div className="pt-4">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => signOut()}
              >
                Sign out
              </Button>
            </div>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
