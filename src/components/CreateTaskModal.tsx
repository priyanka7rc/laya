"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getCurrentAppUser } from "@/lib/users/linking";
import { DatePickerDropdown } from "@/components/DatePickerDropdown";
import { TimePickerDropdown } from "@/components/TimePickerDropdown";

const TITLE_MAX_LENGTH = 120;

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  toast: {
    success: (t: string, d?: string) => void;
    error: (t: string, d?: string) => void;
  };
}

export function CreateTaskModal({
  isOpen,
  onClose,
  onSuccess,
  toast,
}: CreateTaskModalProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addAnywayPending, setAddAnywayPending] = useState(false);

  // Focus title on open; reset state on close
  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setNotes("");
      setDueDate("");
      setDueTime("");
      setRemindAt("");
      setCategory("");
      setAddAnywayPending(false);
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (opts?: { allowDuplicate?: boolean }) => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Task title is required");
      titleRef.current?.focus();
      return;
    }
    if (trimmed.length > TITLE_MAX_LENGTH) {
      toast.error(`Title must be ${TITLE_MAX_LENGTH} characters or less`);
      return;
    }

    setSubmitting(true);
    try {
      let appUserId: string | null = null;
      try {
        const appUser = await getCurrentAppUser();
        appUserId = appUser?.id ?? null;
      } catch {
        // non-blocking
      }

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
          due_date: dueDate || undefined,
          due_time: dueTime || undefined,
          notes: notes.trim() || undefined,
          remind_at: remindAt || undefined,
          category: category.trim() || undefined,
          allowDuplicate: opts?.allowDuplicate ?? false,
          app_user_id: appUserId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Couldn't create task");
        return;
      }

      const { inserted, duplicates } = data;
      if (duplicates?.length > 0 && (!inserted || inserted.length === 0)) {
        setAddAnywayPending(true);
        return;
      }

      toast.success("Task added");
      onSuccess();
      onClose();
    } catch (err) {
      console.error("CreateTaskModal error:", err);
      toast.error("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-2xl shadow-lg border border-border p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">New Task</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label
              htmlFor="ct-title"
              className="block text-xs font-medium text-muted-foreground mb-1.5"
            >
              Title <span className="text-destructive">*</span>
            </label>
            <input
              ref={titleRef}
              id="ct-title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setAddAnywayPending(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              maxLength={TITLE_MAX_LENGTH}
              placeholder="What needs doing?"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
          </div>

          {/* Date + Time row */}
          <div className="grid grid-cols-2 gap-3">
            <DatePickerDropdown
              label="Due date"
              value={dueDate}
              onChange={setDueDate}
            />
            <TimePickerDropdown
              label="Time"
              value={dueTime}
              onChange={setDueTime}
            />
          </div>

          {/* Category */}
          <div>
            <label
              htmlFor="ct-category"
              className="block text-xs font-medium text-muted-foreground mb-1.5"
            >
              Category
            </label>
            <input
              id="ct-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Work, Personal"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
            />
          </div>

          {/* Reminder */}
          <div>
            <label
              htmlFor="ct-remind"
              className="block text-xs font-medium text-muted-foreground mb-1.5"
            >
              Reminder
            </label>
            <input
              id="ct-remind"
              type="datetime-local"
              value={remindAt ? new Date(remindAt).toISOString().slice(0, 16) : ""}
              onChange={(e) =>
                setRemindAt(e.target.value ? new Date(e.target.value).toISOString() : "")
              }
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="ct-notes"
              className="block text-xs font-medium text-muted-foreground mb-1.5"
            >
              Notes
            </label>
            <textarea
              id="ct-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add any details..."
              maxLength={500}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm resize-none"
            />
          </div>
        </div>

        {/* Duplicate warning */}
        {addAnywayPending && (
          <div className="px-3 py-2.5 rounded-xl bg-warning border border-warning-border text-sm text-warning-foreground">
            <p className="font-medium mb-2">This task looks like a duplicate.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleSubmit({ allowDuplicate: true })}
                disabled={submitting}
                className="flex-1 py-1.5 rounded-lg border border-warning-border bg-background text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
              >
                Add anyway
              </button>
              <button
                type="button"
                onClick={() => setAddAnywayPending(false)}
                className="flex-1 py-1.5 rounded-lg bg-warning-border text-warning-foreground text-sm font-medium hover:opacity-80 transition-opacity"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        {!addAnywayPending && (
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={submitting || !title.trim()}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Adding…" : "Add Task"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
