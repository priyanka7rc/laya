import { supabase } from "@/lib/supabaseClient";

export async function createFirstTask(params: {
  title: string;
  appUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { title, appUserId } = params;
  const trimmed = title.trim();

  if (!trimmed) {
    return { ok: false, error: "Task title is required." };
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch("/api/tasks/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify({
        text: trimmed,
        allowDuplicate: true,
        app_user_id: appUserId,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        typeof body?.error === "string" ? body.error : "Could not create task.";
      return { ok: false, error: message };
    }

    return { ok: true };
  } catch (err) {
    console.error("[tasks][createFirstTask] unexpected error", err);
    return { ok: false, error: "Could not create task. Please try again." };
  }
}
