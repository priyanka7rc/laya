import { supabase } from "@/lib/supabaseClient";
import { getCurrentAppUser } from "@/lib/users/linking";
import type { FirstRunDemoPage } from "@/lib/firstRunDemoConfig";

const PAGE_TO_COLUMN: Record<FirstRunDemoPage, keyof DemoColumns> = {
  home: "seen_home_demo",
  tasks: "seen_tasks_demo",
  lists: "seen_lists_demo",
  unload: "seen_unload_demo",
};

type DemoColumns = {
  seen_home_demo: boolean;
  seen_tasks_demo: boolean;
  seen_lists_demo: boolean;
  seen_unload_demo: boolean;
};

function localKeyFor(page: FirstRunDemoPage) {
  return `laya_first_run_demo_seen_${page}`;
}

export async function getFirstRunDemoSeen(page: FirstRunDemoPage): Promise<boolean> {
  try {
    const appUser = await getCurrentAppUser();
    if (!appUser) {
      return typeof window !== "undefined" && localStorage.getItem(localKeyFor(page)) === "true";
    }

    const column = PAGE_TO_COLUMN[page];
    return Boolean(appUser[column]);
  } catch {
    return typeof window !== "undefined" && localStorage.getItem(localKeyFor(page)) === "true";
  }
}

export async function markFirstRunDemoSeen(page: FirstRunDemoPage): Promise<void> {
  const column = PAGE_TO_COLUMN[page];

  if (typeof window !== "undefined") {
    localStorage.setItem(localKeyFor(page), "true");
  }

  try {
    const appUser = await getCurrentAppUser();
    if (!appUser) return;

    await supabase.from("app_users").update({ [column]: true }).eq("id", appUser.id);
  } catch {
    // Intentionally silent. Demo state persistence should never block UX.
  }
}
