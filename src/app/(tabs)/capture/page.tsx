"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { FirstRunDemo } from "@/components/FirstRunDemo";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card, Button } from "@/components/ui";
import { ImportTasksModal } from "@/components/ImportTasksModal";
import { useToast } from "@/hooks/useToast";
import { getCurrentAppUser } from "@/lib/users/linking";
import { getFirstRunDemoSeen, markFirstRunDemoSeen } from "@/lib/firstRunDemo";
import { supabase } from "@/lib/supabaseClient";
import { TASK_SOURCES } from "@/lib/taskSources";

// ─── Types ────────────────────────────────────────────────────────────────

type Candidate = { id: string; label: string };

type NeedsInput = {
  question: string;
  candidates: Candidate[];
};

type ApiTaskData = {
  title: string;
  due_date: string;
  due_time: string;
  category: string | null;
  inferred_date: boolean;
  inferred_time: boolean;
  dueDateWasDefaulted: boolean;
  dueTimeWasDefaulted: boolean;
  rawSegmentText: string;
};

type ApiPatch = {
  title?: string;
  due_date?: string | null;
  due_time?: string | null;
  category?: string;
};

type ApiActionRow = {
  id: string;
  actionType: "create_task" | "add_list_items" | "create_list" | "update_task";
  label: string;
  primaryText: string;
  secondaryText?: string;
  status: "ready" | "needs_input";
  needsInput?: NeedsInput;
  task?: ApiTaskData;
  items?: string[];
  listName?: string;
  taskTerm?: string;
  patch?: ApiPatch;
};

// Frontend-only extension: tracks user selection + rejection state
type ActionRow = ApiActionRow & {
  selectedCandidateId?: string;
  rejected: boolean;
};

function isResolved(row: ActionRow): boolean {
  if (row.rejected) return true;
  if (row.status === "ready") return true;
  // needs_input: resolved when user picked a candidate (or there are no candidates to pick from)
  if (row.needsInput && row.needsInput.candidates.length === 0) return false;
  return !!row.selectedCandidateId;
}

// ─── Status pill ──────────────────────────────────────────────────────────

function StatusPill({ row }: { row: ActionRow }) {
  if (row.rejected) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        Removed
      </span>
    );
  }
  if (row.status === "ready" || (row.status === "needs_input" && row.selectedCandidateId)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
        Ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
      Needs input
    </span>
  );
}

// ─── Action label pill ────────────────────────────────────────────────────

function ActionLabelPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
      {label}
    </span>
  );
}

// ─── Individual action card ───────────────────────────────────────────────

type RowPatch =
  | { kind: "task"; title: string; due_date: string; due_time: string }
  | { kind: "list"; listName: string; items: string[] };

function ActionRowCard({
  row,
  onSelect,
  onReject,
  onUndo,
  onUpdate,
}: {
  row: ActionRow;
  onSelect: (candidateId: string) => void;
  onReject: () => void;
  onUndo: () => void;
  onUpdate: (patch: RowPatch) => void;
}) {
  const resolved = isResolved(row);
  const showResolver =
    !row.rejected &&
    row.status === "needs_input" &&
    !row.selectedCandidateId &&
    row.needsInput;

  const resolvedLabel =
    row.selectedCandidateId && row.needsInput
      ? row.needsInput.candidates.find((c) => c.id === row.selectedCandidateId)?.label
      : null;

  // ── Edit mode state ────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);

  // Task edit fields
  const [editTitle, setEditTitle] = useState(row.task?.title ?? row.primaryText);
  const [editDate, setEditDate] = useState(row.task?.due_date ?? "");
  const [editTime, setEditTime] = useState(row.task?.due_time ?? "");

  // List edit fields
  const [editListName, setEditListName] = useState(row.listName ?? "");
  const [editItems, setEditItems] = useState<string[]>(row.items ?? []);

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && titleRef.current) titleRef.current.focus();
  }, [editing]);

  const isTask = row.actionType === "create_task";
  const isList = row.actionType === "create_list" || row.actionType === "add_list_items";
  const canEdit = !row.rejected && (isTask || isList);

  const handleSaveEdit = () => {
    if (isTask) {
      onUpdate({ kind: "task", title: editTitle.trim() || (row.task?.title ?? ""), due_date: editDate, due_time: editTime });
    } else if (isList) {
      onUpdate({ kind: "list", listName: editListName.trim() || (row.listName ?? ""), items: editItems.filter(Boolean) });
    }
    setEditing(false);
  };

  const handleCancelEdit = () => {
    // Reset to current row values
    setEditTitle(row.task?.title ?? row.primaryText);
    setEditDate(row.task?.due_date ?? "");
    setEditTime(row.task?.due_time ?? "");
    setEditListName(row.listName ?? "");
    setEditItems(row.items ?? []);
    setEditing(false);
  };

  const updateItem = (idx: number, value: string) => {
    setEditItems((prev) => prev.map((it, i) => (i === idx ? value : it)));
  };

  const removeItem = (idx: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const addItem = () => {
    setEditItems((prev) => [...prev, ""]);
  };

  return (
    <div
      className={`rounded-xl border transition-colors ${
        row.rejected
          ? "border-border bg-muted/20 opacity-50"
          : resolved
          ? "border-border bg-card"
          : "border-amber-200 bg-amber-50/30 dark:border-amber-800/40 dark:bg-amber-950/10"
      }`}
    >
      {/* Card header row */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <ActionLabelPill label={row.label} />
            <StatusPill row={row} />
          </div>
          <p
            className={`text-sm font-medium leading-snug ${
              row.rejected ? "line-through text-muted-foreground" : "text-foreground"
            }`}
          >
            {resolvedLabel
              ? row.actionType === "update_task"
                ? `${resolvedLabel}${row.secondaryText ? ` · ${row.secondaryText}` : ""}`
                : `${row.primaryText.split("→")[0]?.trim() ?? row.primaryText} → ${resolvedLabel}`
              : row.primaryText}
          </p>
          {row.secondaryText && !resolvedLabel && !row.rejected && (
            <p className="text-xs text-muted-foreground mt-0.5">{row.secondaryText}</p>
          )}
        </div>

        {/* Row actions */}
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {row.rejected ? (
            <button
              onClick={onUndo}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Undo remove"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </button>
          ) : (
            <>
              {canEdit && !editing && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-transparent hover:border-border"
                  title="Edit"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
                  </svg>
                  <span>Edit</span>
                </button>
              )}
              {row.selectedCandidateId && (
                <button
                  onClick={onUndo}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Change selection"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                </button>
              )}
              <button
                onClick={onReject}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                title="Remove"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inline edit form */}
      {editing && (
        <div className="px-4 pb-3.5 border-t border-border/50 mt-0.5 pt-3">
          {isTask && (
            <div className="space-y-2.5">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Title</label>
                <input
                  ref={titleRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") handleCancelEdit(); }}
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Date</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Time</label>
                  <input
                    type="time"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>
          )}

          {isList && (
            <div className="space-y-2.5">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">List name</label>
                <input
                  ref={titleRef}
                  value={editListName}
                  onChange={(e) => setEditListName(e.target.value)}
                  className="w-full text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                  onKeyDown={(e) => { if (e.key === "Escape") handleCancelEdit(); }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Items</label>
                <div className="space-y-1.5">
                  {editItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={item}
                        onChange={(e) => updateItem(idx, e.target.value)}
                        className="flex-1 text-sm px-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                        placeholder={`Item ${idx + 1}`}
                      />
                      <button
                        onClick={() => removeItem(idx)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                        title="Remove item"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addItem}
                    className="text-xs text-primary hover:underline mt-0.5"
                  >
                    + Add item
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleSaveEdit}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
            >
              Save
            </button>
            <button
              onClick={handleCancelEdit}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Inline resolver */}
      {showResolver && !editing && (
        <div className="px-4 pb-3.5">
          <p className="text-xs text-muted-foreground mb-2">{row.needsInput!.question}</p>
          {row.needsInput!.candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No matching {row.actionType === "update_task" ? "tasks" : "lists"} found. Remove this action or type a name manually.
            </p>
          ) : (
            <div className="space-y-1.5">
              {row.needsInput!.candidates.map((c) => {
                const isCreateNew = c.id === "__create_new__";
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors text-left group ${
                      isCreateNew
                        ? "border-dashed border-border bg-background hover:bg-primary/5 hover:border-primary/50"
                        : "border-border bg-background hover:bg-muted hover:border-primary/40"
                    }`}
                  >
                    {isCreateNew ? (
                      <span className="w-3.5 h-3.5 flex items-center justify-center text-primary flex-shrink-0">
                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </span>
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground group-hover:border-primary flex-shrink-0 transition-colors" />
                    )}
                    <span className={`text-sm ${isCreateNew ? "text-primary font-medium" : "text-foreground"}`}>
                      {c.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function CapturePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [brainDump, setBrainDump] = useState("");
  const [brainDumpLoading, setBrainDumpLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [actionRows, setActionRows] = useState<ActionRow[]>([]);
  const [savingItems, setSavingItems] = useState(false);
  // Audit: track the turn_id returned by parseDump for feedback writes
  const [currentTurnId, setCurrentTurnId] = useState<string | null>(null);
  const [demoReady, setDemoReady] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (authLoading || !user) return;
    void getFirstRunDemoSeen("unload").then((seen) => {
      if (!mounted) return;
      setShowDemo(!seen);
      setDemoReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [authLoading, user]);

  const dismissDemo = () => {
    setShowDemo(false);
    void markFirstRunDemoSeen("unload");
  };

  // ── Unload: call parseDump, build action rows ──────────────────────────────
  const handleUnload = async () => {
    const trimmed = brainDump.trim();
    if (!trimmed || !user) return;

    setBrainDumpLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

      const parseRes = await fetch("/api/parseDump", {
        method: "POST",
        headers,
        body: JSON.stringify({ text: trimmed }),
      });

      if (!parseRes.ok) {
        if (parseRes.status === 429) {
          const errData = await parseRes.json().catch(() => ({}));
          toast.error(errData.error || "Try again in a minute");
          return;
        }
        throw new Error("Parse failed");
      }

      const data = await parseRes.json();
      const apiActions: ApiActionRow[] = data.actions ?? [];

      if (apiActions.length === 0) {
        toast.error("Couldn't find anything to save in that text");
        return;
      }

      // Store turn_id for feedback — parseDump embeds it in the response
      setCurrentTurnId(data.turnId ?? null);
      setActionRows(apiActions.map((a) => ({ ...a, rejected: false })));
      setReviewMode(true);
    } catch (err) {
      console.error("Unload error:", err);
      toast.error("Couldn't parse that — please try again");
    } finally {
      setBrainDumpLoading(false);
    }
  };

  // ── Row state helpers ──────────────────────────────────────────────────────
  const selectCandidate = (rowId: string, candidateId: string) => {
    setActionRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, selectedCandidateId: candidateId } : r))
    );
  };

  const rejectRow = (rowId: string) => {
    setActionRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, rejected: true, selectedCandidateId: undefined } : r))
    );
  };

  const undoRow = (rowId: string) => {
    setActionRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, rejected: false, selectedCandidateId: undefined } : r))
    );
  };

  const updateRow = (rowId: string, patch: RowPatch) => {
    setActionRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        if (patch.kind === "task") {
          const updatedTask: ApiTaskData = {
            ...(r.task ?? {
              due_date: "", due_time: "", category: null,
              inferred_date: false, inferred_time: false,
              dueDateWasDefaulted: false, dueTimeWasDefaulted: false,
              rawSegmentText: "",
            }),
            title: patch.title,
            due_date: patch.due_date,
            due_time: patch.due_time,
          };
          return {
            ...r,
            primaryText: patch.title,
            task: updatedTask,
          };
        } else {
          const itemsText = patch.items.join(', ');
          const isCreate = r.actionType === "create_list";
          const newPrimaryText = isCreate
            ? `${patch.listName} (new) · ${itemsText}`
            : `${itemsText} → ${patch.listName}`;
          return {
            ...r,
            listName: patch.listName,
            items: patch.items,
            primaryText: newPrimaryText,
          };
        }
      })
    );
  };

  // ── Feedback helper (fire-and-forget) ────────────────────────────────────
  const sendFeedback = (
    outcome: "accepted" | "partially_accepted" | "discarded",
    rejectedActions?: ApiActionRow[]
  ) => {
    if (!currentTurnId) return;
    void fetch("/api/parseDump/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turn_id: currentTurnId,
        outcome,
        rejected_actions: rejectedActions?.map((r) => ({ id: r.id, actionType: r.actionType })),
      }),
    }).catch(() => {});
  };

  // ── Apply all ─────────────────────────────────────────────────────────────
  const handleApplyAll = async () => {
    const activeRows = actionRows.filter((r) => !r.rejected);
    if (activeRows.length === 0) {
      toast.error("No actions to apply");
      return;
    }

    setSavingItems(true);
    try {
      const appUser = await getCurrentAppUser();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

      let taskCount = 0;
      let listItemCount = 0;
      let listCreatedCount = 0;
      let updateCount = 0;

      // Group create_task rows for a single batch call
      const taskRows = activeRows.filter((r) => r.actionType === "create_task" && r.task);
      if (taskRows.length > 0) {
        const proposedTasks = taskRows.map((r) => ({
          title: r.task!.title,
          due_date: r.task!.due_date,
          due_time: r.task!.due_time,
          category: r.task!.category ?? "Tasks",
          inferred_date: r.task!.inferred_date,
          inferred_time: r.task!.inferred_time,
          rawCandidate: r.task!.rawSegmentText,
        }));

        const insertRes = await fetch("/api/tasks/import/confirm", {
          method: "POST",
          headers,
          body: JSON.stringify({
            tasks: proposedTasks,
            source: TASK_SOURCES.WEB_BRAIN_DUMP,
            app_user_id: appUser?.id ?? null,
          }),
        });

        if (insertRes.ok) {
          const confirmData = await insertRes.json();
          taskCount = Array.isArray(confirmData.inserted) ? confirmData.inserted.length : 0;
        }
      }

      // List rows (create_list + add_list_items) — one call per item
      const listRows = activeRows.filter(
        (r) => r.actionType === "add_list_items" || r.actionType === "create_list"
      );
      for (const row of listRows) {
        const items = row.items ?? [];
        // "__create_new__" means user explicitly chose to create a new list → use original parsed name
        const isCreateNew = row.selectedCandidateId === "__create_new__";
        const resolvedListName = isCreateNew
          ? row.listName
          : row.selectedCandidateId && row.needsInput
            ? row.needsInput.candidates.find((c) => c.id === row.selectedCandidateId)?.label ?? row.listName
            : row.listName;

        let listCreatedThisRow = false;
        for (const item of items) {
          if (!item) continue;
          const res = await fetch("/api/lists/find-or-create-and-add", {
            method: "POST",
            headers,
            body: JSON.stringify({ listName: resolvedListName, item }),
          });
          if (res.ok) {
            const resData = await res.json().catch(() => ({}));
            if (!listCreatedThisRow && resData.created) {
              listCreatedCount++;
              listCreatedThisRow = true;
            }
            listItemCount++;
          }
        }
      }

      // update_task rows
      const updateRows = activeRows.filter((r) => r.actionType === "update_task");
      for (const row of updateRows) {
        const taskId = row.selectedCandidateId;
        if (!taskId || !row.patch) continue;

        const res = await fetch("/api/tasks/update", {
          method: "POST",
          headers,
          body: JSON.stringify({ taskId, ...row.patch }),
        });
        if (res.ok) updateCount++;
      }

      const parts: string[] = [];
      if (taskCount > 0) parts.push(taskCount === 1 ? "1 task" : `${taskCount} tasks`);
      if (listCreatedCount > 0) parts.push(listCreatedCount === 1 ? "1 list created" : `${listCreatedCount} lists created`);
      if (listItemCount > listCreatedCount) {
        const itemsAdded = listItemCount - listCreatedCount;
        parts.push(itemsAdded === 1 ? "1 item added" : `${itemsAdded} items added`);
      } else if (listItemCount > 0 && listCreatedCount === 0) {
        parts.push(listItemCount === 1 ? "1 list item" : `${listItemCount} list items`);
      }
      if (updateCount > 0) parts.push(updateCount === 1 ? "1 task updated" : `${updateCount} tasks updated`);

      if (parts.length === 0) {
        toast.error("Nothing new saved — items may already exist");
      } else {
        toast.success(`Saved: ${parts.join(" and ")}`);
      }

      // Feedback: note which rows the user rejected before applying
      const rejectedRows = actionRows.filter((r) => r.rejected);
      const outcome = rejectedRows.length === 0 ? "accepted" : "partially_accepted";
      sendFeedback(outcome, rejectedRows);

      setReviewMode(false);
      setActionRows([]);
      setCurrentTurnId(null);
      setBrainDump("");
      router.refresh();
    } catch (err) {
      console.error("[capture/applyAll] error:", err);
      toast.error("Couldn't save — please try again");
    } finally {
      setSavingItems(false);
    }
  };

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = () => {
    sendFeedback("discarded");
    setReviewMode(false);
    setActionRows([]);
    setCurrentTurnId(null);
    // brainDump text intentionally preserved
  };

  // ── Computed state ────────────────────────────────────────────────────────
  const activeRows = actionRows.filter((r) => !r.rejected);
  const readyCount = activeRows.filter((r) => isResolved(r)).length;
  const needsInputCount = activeRows.filter((r) => !isResolved(r)).length;
  const allResolved = needsInputCount === 0 && activeRows.length > 0;

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) setImportModalOpen(true);
  };

  const handleImportSuccess = () => {
    router.refresh();
    toast.success("Import complete");
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl lg:max-w-4xl">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-2">Unload</h1>
          <p className="text-muted-foreground mb-8">Get it out of your head. We&apos;ll organize it later.</p>

          {/* Capture box */}
          <Card
            className={`rounded-2xl p-6 shadow-sm border transition-colors mb-6 ${
              dragActive ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <textarea
              placeholder="Type anything — tasks, ideas, a to-do list, a shopping run... Laya will figure it out."
              value={brainDump}
              onChange={(e) => setBrainDump(e.target.value)}
              rows={8}
              className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-foreground placeholder-muted-foreground resize-none text-base leading-relaxed"
            />

            <div className="flex items-center justify-end pt-4 border-t border-border mt-2 gap-3">
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Upload a screenshot or photo"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Upload a PDF"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
              <Button
                type="button"
                onClick={handleUnload}
                disabled={!brainDump.trim() || brainDumpLoading}
                loading={brainDumpLoading}
              >
                Unload
              </Button>
            </div>
          </Card>

          {/* Action tray */}
          {reviewMode && (
            <div className="animate-slide-down">
              {/* Header */}
              <div className="mb-4">
                <h2 className="text-base font-semibold text-foreground">What Laya understood</h2>
                {needsInputCount > 0 && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Some actions need your input before applying.
                  </p>
                )}
              </div>

              {/* Action cards */}
              <div className="space-y-3 mb-5">
                {actionRows.map((row) => (
                  <ActionRowCard
                    key={row.id}
                    row={row}
                    onSelect={(candidateId) => selectCandidate(row.id, candidateId)}
                    onReject={() => rejectRow(row.id)}
                    onUndo={() => undoRow(row.id)}
                    onUpdate={(patch) => updateRow(row.id, patch)}
                  />
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-4 pt-3 border-t border-border">
                {/* Summary */}
                <p className="text-sm text-muted-foreground">
                  {readyCount > 0 && (
                    <span className="text-foreground font-medium">
                      {readyCount} {readyCount === 1 ? "action" : "actions"} ready
                    </span>
                  )}
                  {readyCount > 0 && needsInputCount > 0 && " · "}
                  {needsInputCount > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      {needsInputCount} {needsInputCount === 1 ? "needs" : "need"} your input
                    </span>
                  )}
                  {activeRows.length === 0 && "All actions removed"}
                </p>

                {/* CTAs */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <Button
                    type="button"
                    onClick={handleApplyAll}
                    disabled={!allResolved || savingItems}
                    loading={savingItems}
                    title={!allResolved ? "Resolve all inputs before applying" : undefined}
                  >
                    Apply all
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <ImportTasksModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={handleImportSuccess}
        getToken={async () => {
          const { data: { session } } = await supabase.auth.getSession();
          return session?.access_token ?? null;
        }}
        toast={toast}
      />
      <FirstRunDemo
        page="unload"
        isOpen={demoReady && showDemo}
        onComplete={dismissDemo}
        onSkip={dismissDemo}
      />
    </ProtectedRoute>
  );
}
