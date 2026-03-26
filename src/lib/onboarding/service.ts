import { supabase } from "@/lib/supabaseClient";
import { createFirstTask } from "@/lib/tasks/service";
import { getCurrentAppUser } from "@/lib/users/linking";

export async function saveRequiredProfile(input: {
  displayName: string;
  email: string;
  city: string;
  country: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const appUser = await getCurrentAppUser();
  if (!appUser) return { ok: false, error: "Could not find your account." };

  const displayName = input.displayName.trim();
  const email = input.email.trim().toLowerCase();
  const city = input.city.trim();
  const country = input.country.trim() || "India";

  if (!displayName || !email || !city || !country) {
    return { ok: false, error: "Please fill all required fields." };
  }

  try {
    const { error } = await supabase
      .from("app_users")
      .update({
        display_name: displayName,
        email,
        city,
        country,
        onboarding_state: "profile_required_done",
      })
      .eq("id", appUser.id);

    if (error) {
      console.error("[onboarding][saveRequiredProfile] error", error);
      return { ok: false, error: "Could not save profile details." };
    }

    return { ok: true };
  } catch (err) {
    console.error("[onboarding][saveRequiredProfile] unexpected error", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function savePreferencesOrSkip(input: {
  householdMode: "run_most" | "shared" | "support" | null;
  reminderWindowPref: "morning" | "afternoon" | "evening" | null;
  whatsappAssistantEnabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const appUser = await getCurrentAppUser();
  if (!appUser) return { ok: false, error: "Could not find your account." };

  try {
    const { error } = await supabase
      .from("app_users")
      .update({
        household_mode: input.householdMode,
        reminder_window_pref: input.reminderWindowPref,
        whatsapp_assistant_enabled: input.whatsappAssistantEnabled,
        onboarding_state: "preferences_done",
      })
      .eq("id", appUser.id);

    if (error) {
      console.error("[onboarding][savePreferencesOrSkip] error", error);
      return { ok: false, error: "Could not save preferences." };
    }

    return { ok: true };
  } catch (err) {
    console.error("[onboarding][savePreferencesOrSkip] unexpected error", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function completeWithFirstTaskOrSkip(input: {
  title?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const appUser = await getCurrentAppUser();
  if (!appUser) return { ok: false, error: "Could not find your account." };

  if (input.title && input.title.trim()) {
    const taskResult = await createFirstTask({
      appUserId: appUser.id,
      title: input.title,
    });
    if (!taskResult.ok) return taskResult;
  }

  try {
    const { error } = await supabase
      .from("app_users")
      .update({ onboarding_state: "onboarding_complete" })
      .eq("id", appUser.id);

    if (error) {
      console.error("[onboarding][completeWithFirstTaskOrSkip] error", error);
      return { ok: false, error: "Could not finish onboarding." };
    }

    return { ok: true };
  } catch (err) {
    console.error("[onboarding][completeWithFirstTaskOrSkip] unexpected error", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
