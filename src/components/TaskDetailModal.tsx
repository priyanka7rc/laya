"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { DatePickerDropdown } from "@/components/DatePickerDropdown";
import { TimePickerDropdown } from "@/components/TimePickerDropdown";

interface TaskDetail {
  id: string;
  title: string;
  notes: string | null;
  category: string | null;
  due_date: string | null;
  due_time: string | null;
  remind_at: string | null;
  status: string;
  priority: "low" | "medium" | "high" | "urgent" | null;
  tags: string[] | null;
  location: string | null;
}

interface TaskDetailModalProps {
  taskId: string | null;
  onClose: () => void;
  onSuccess: () => void;
  toast: {
    success: (t: string) => void;
    error: (t: string) => void;
  };
}

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low", color: "text-blue-500 border-blue-300 bg-blue-50 dark:bg-blue-950/30" },
  { value: "medium", label: "Medium", color: "text-amber-500 border-amber-300 bg-amber-50 dark:bg-amber-950/30" },
  { value: "high", label: "High", color: "text-orange-500 border-orange-300 bg-orange-50 dark:bg-orange-950/30" },
  { value: "urgent", label: "Urgent", color: "text-destructive border-destructive/40 bg-destructive/5" },
] as const;

const REMINDER_OPTIONS = [
  { label: "15 min", ms: 15 * 60 * 1000 },
  { label: "30 min", ms: 30 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "2 hours", ms: 2 * 60 * 60 * 1000 },
  { label: "1 day", ms: 24 * 60 * 60 * 1000 },
];

export function TaskDetailModal({
  taskId,
  onClose,
  onSuccess,
  toast,
}: TaskDetailModalProps) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent" | null>(null);
  const [tagsInput, setTagsInput] = useState(""); // comma-separated string
  const [location, setLocation] = useState("");

  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    supabase
      .from("tasks")
      .select("id, title, notes, category, due_date, due_time, remind_at, status, priority, tags, location")
      .eq("id", taskId)
      .is("deleted_at", null)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          toast.error("Couldn't load task details");
          onClose();
          return;
        }
        const t = data as TaskDetail | null;
        if (!t) { onClose(); return; }
        setTask(t);
        setTitle(t.title ?? "");
        setNotes(t.notes ?? "");
        setCategory(t.category ?? "");
        setDueDate(t.due_date ?? "");
        setDueTime(t.due_time ?? "");
        setRemindAt(t.remind_at ?? "");
        setPriority(t.priority ?? null);
        setTagsInput(t.tags ? t.tags.join(", ") : "");
        setLocation(t.location ?? "");
        setLoading(false);
        setTimeout(() => titleRef.current?.focus(), 50);
      });
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskId, onClose]);

  if (!taskId) return null;

  const parsedDueAt =
    dueDate
      ? new Date(`${dueDate}T${dueTime || "00:00"}:00`).getTime()
      : null;

  const reminderChipValue = (offsetMs: number) => {
    if (!parsedDueAt) return null;
    return new Date(parsedDueAt - offsetMs).toISOString();
  };

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Title is required");
      titleRef.current?.focus();
      return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tagsArr = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch("/api/tasks/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          taskId: task!.id,
          title: trimmedTitle,
          notes: notes.trim() || null,
          category: category.trim() || null,
          due_date: dueDate || null,
          due_time: dueTime || null,
          priority: priority ?? null,
          tags: tagsArr.length ? tagsArr : null,
          location: location.trim() || null,
          remind_at: remindAt || null,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Couldn't save changes");
        return;
      }

      toast.success("Task updated");
      onSuccess();
      onClose();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />

      <div className="relative w-full sm:max-w-lg bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl border border-border flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">Task Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {loading ? (
            <div className="space-y-4 animate-pulse">
              {[80, 60, 40, 40].map((w, i) => (
                <div key={i} className={`h-4 bg-muted rounded w-${w}`} />
              ))}
            </div>
          ) : (
            <>
              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Title <span className="text-destructive">*</span>
                </label>
                <textarea
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  rows={2}
                  maxLength={120}
                  placeholder="Task title..."
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm resize-none"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="Add details, context, or anything else..."
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm resize-none"
                />
              </div>

              {/* Due date + time */}
              <div className="grid grid-cols-2 gap-3">
                <DatePickerDropdown
                  label="Due date"
                  value={dueDate}
                  onChange={setDueDate}
                />
                <TimePickerDropdown
                  label="Due time"
                  value={dueTime}
                  onChange={setDueTime}
                />
              </div>

              {/* Reminder */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Reminder
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {REMINDER_OPTIONS.map((opt) => {
                    const rv = reminderChipValue(opt.ms);
                    const isSelected = rv !== null && remindAt === rv;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        disabled={!parsedDueAt}
                        onClick={() => setRemindAt(isSelected ? "" : (rv ?? ""))}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-foreground hover:bg-primary/10 hover:border-primary hover:text-primary"
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        {opt.label} before
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setRemindAt("")}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      !remindAt
                        ? "bg-muted text-muted-foreground border-border"
                        : "border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    None
                  </button>
                </div>
              </div>

              <div className="h-px bg-border" />

              {/* Priority */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-2">
                  Priority
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPriority(priority === opt.value ? null : opt.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        priority === opt.value
                          ? opt.color
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Tags
                  <span className="font-normal ml-1 text-muted-foreground/60">(comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="e.g. work, urgent, Q2"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                />
                {tagsInput.trim() && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {tagsInput.split(",").map((t) => t.trim()).filter(Boolean).map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Category
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Work, Personal"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                />
              </div>

              {/* Location */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Office, Home, Online"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="flex gap-3 px-5 py-4 border-t border-border bg-muted/20 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-border text-foreground text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
