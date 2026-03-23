"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card, Button } from "@/components/ui";
import { ImportTasksModal } from "@/components/ImportTasksModal";
import { useToast } from "@/hooks/useToast";
import { getCurrentAppUser } from "@/lib/users/linking";
import { supabase } from "@/lib/supabaseClient";
import { TASK_SOURCES } from "@/lib/taskSources";

type ReviewTask = {
  id: string;
  title: string;
  originalTitle: string;
  due_date: string;
  due_time: string;
  category: string | null;
  inferred_date: boolean;
  inferred_time: boolean;
  dueDateWasDefaulted: boolean;
  rejected: boolean;
};

type ReviewListItem = {
  id: string;
  item: string;
  originalItem: string;
  listName: string;
  originalListName: string;
  rejected: boolean;
};

function formatReviewDate(task: ReviewTask): string | null {
  if (task.dueDateWasDefaulted && !task.inferred_date) return null;
  const d = new Date(task.due_date);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function CapturePage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [brainDump, setBrainDump] = useState("");
  const [brainDumpLoading, setBrainDumpLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [parsedTasks, setParsedTasks] = useState<ReviewTask[]>([]);
  const [parsedListItems, setParsedListItems] = useState<ReviewListItem[]>([]);
  const [savingItems, setSavingItems] = useState(false);

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

      const { tasks, listItems: rawListItems } = await parseRes.json();
      if (!tasks?.length && !rawListItems?.length) {
        toast.error("Couldn't find anything to save in that text");
        return;
      }

      const ts = Date.now();
      const reviewTasks: ReviewTask[] = (tasks ?? []).map(
        (
          t: {
            title: string;
            due_date: string;
            due_time: string;
            category?: string | null;
            inferred_date?: boolean;
            inferred_time?: boolean;
            dueDateWasDefaulted?: boolean;
          },
          i: number
        ) => ({
          id: `task-${i}-${ts}`,
          title: t.title,
          originalTitle: t.title,
          due_date: t.due_date,
          due_time: t.due_time,
          category: t.category ?? null,
          inferred_date: !!t.inferred_date,
          inferred_time: !!t.inferred_time,
          dueDateWasDefaulted: !!t.dueDateWasDefaulted,
          rejected: false,
        })
      );

      const reviewListItems: ReviewListItem[] = (rawListItems ?? []).map(
        (li: { item: string; listName: string }, i: number) => ({
          id: `list-${i}-${ts}`,
          item: li.item,
          originalItem: li.item,
          listName: li.listName,
          originalListName: li.listName,
          rejected: false,
        })
      );

      setParsedTasks(reviewTasks);
      setParsedListItems(reviewListItems);
      setReviewMode(true);
    } catch (err) {
      console.error("Unload error:", err);
      toast.error("Couldn't save changes");
    } finally {
      setBrainDumpLoading(false);
    }
  };

  const updateTaskTitle = (id: string, title: string) => {
    setParsedTasks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  };

  const undoTask = (id: string) => {
    setParsedTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title: t.originalTitle, rejected: false } : t))
    );
  };

  const rejectTask = (id: string) => {
    setParsedTasks((prev) => prev.map((t) => (t.id === id ? { ...t, rejected: true } : t)));
  };

  const updateListItemField = (id: string, patch: Partial<Pick<ReviewListItem, "item" | "listName">>) => {
    setParsedListItems((prev) => prev.map((li) => (li.id === id ? { ...li, ...patch } : li)));
  };

  const undoListItem = (id: string) => {
    setParsedListItems((prev) =>
      prev.map((li) =>
        li.id === id ? { ...li, item: li.originalItem, listName: li.originalListName, rejected: false } : li
      )
    );
  };

  const rejectListItem = (id: string) => {
    setParsedListItems((prev) => prev.map((li) => (li.id === id ? { ...li, rejected: true } : li)));
  };

  const handleSave = async () => {
    const tasksToSave = parsedTasks.filter((t) => !t.rejected);
    const listItemsToSave = parsedListItems.filter((li) => !li.rejected);

    console.log("[unload/save] tasksToSave:", tasksToSave.length, tasksToSave.map(t => t.title));
    console.log("[unload/save] listItemsToSave:", listItemsToSave.length, listItemsToSave.map(li => `${li.item} → ${li.listName}`));

    if (!tasksToSave.length && !listItemsToSave.length) {
      toast.error("No items to save");
      return;
    }

    setSavingItems(true);
    try {
      const appUser = await getCurrentAppUser();
      console.log("[unload/save] appUser:", appUser?.id ?? "null");

      const { data: { session } } = await supabase.auth.getSession();
      console.log("[unload/save] session token present:", !!session?.access_token);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      let taskCount = 0;
      let listItemCount = 0;

      // Save tasks
      if (tasksToSave.length) {
        const proposedTasks = tasksToSave.map((t) => ({
          title: t.title,
          due_date: t.due_date,
          due_time: t.due_time,
          category: t.category ?? "Tasks",
          inferred_date: t.inferred_date,
          inferred_time: t.inferred_time,
          rawCandidate: t.originalTitle,
        }));

        console.log("[unload/save] sending tasks to import/confirm:", JSON.stringify(proposedTasks));

        const insertRes = await fetch("/api/tasks/import/confirm", {
          method: "POST",
          headers,
          body: JSON.stringify({
            tasks: proposedTasks,
            source: TASK_SOURCES.WEB_BRAIN_DUMP,
            app_user_id: appUser?.id ?? null,
          }),
        });

        console.log("[unload/save] import/confirm status:", insertRes.status);

        if (!insertRes.ok) {
          const errBody = await insertRes.json().catch(() => ({}));
          console.error("[unload/save] import/confirm error body:", errBody);
          throw new Error(`Task insert failed (${insertRes.status}): ${JSON.stringify(errBody)}`);
        }

        const confirmData = await insertRes.json();
        console.log("[unload/save] import/confirm response:", JSON.stringify(confirmData));
        taskCount = Array.isArray(confirmData.inserted) ? confirmData.inserted.length : 0;

        if (confirmData.duplicates?.length) {
          console.warn("[unload/save] duplicates skipped:", confirmData.duplicates);
        }
      }

      // Save list items (find-or-create list, then add item)
      for (const li of listItemsToSave) {
        console.log("[unload/save] saving list item:", li.item, "→", li.listName);
        const res = await fetch("/api/lists/find-or-create-and-add", {
          method: "POST",
          headers,
          body: JSON.stringify({ listName: li.listName, item: li.item }),
        });
        console.log("[unload/save] list item save status:", res.status);
        if (res.ok) {
          const liData = await res.json();
          console.log("[unload/save] list item save response:", JSON.stringify(liData));
          listItemCount++;
        } else {
          const errBody = await res.json().catch(() => ({}));
          console.error("[unload/save] list item save error:", errBody);
        }
      }

      const parts: string[] = [];
      if (taskCount > 0) parts.push(taskCount === 1 ? "1 task" : `${taskCount} tasks`);
      if (listItemCount > 0) parts.push(listItemCount === 1 ? "1 list item" : `${listItemCount} list items`);

      if (parts.length === 0) {
        // Everything was silently skipped (e.g. duplicates)
        console.warn("[unload/save] nothing new was saved (all duplicates or errors)");
        toast.error("Nothing new saved — items may already exist");
      } else {
        toast.success(`Saved: ${parts.join(" and ")}`);
      }

      setReviewMode(false);
      setParsedTasks([]);
      setParsedListItems([]);
      router.refresh();
    } catch (err) {
      console.error("[unload/save] error:", err);
      toast.error("Couldn't save changes");
    } finally {
      setSavingItems(false);
    }
  };

  const handleStartOver = () => {
    setReviewMode(false);
    setParsedTasks([]);
    setParsedListItems([]);
    // brainDump text is intentionally preserved
  };

  const handleImportClick = () => setImportModalOpen(true);
  const handleImportSuccess = () => {
    router.refresh();
    toast.success("Import complete");
  };

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

  const activeTasks = parsedTasks.filter((t) => !t.rejected);
  const activeListItems = parsedListItems.filter((li) => !li.rejected);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl lg:max-w-6xl">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-2">
            Unload
          </h1>
          <p className="text-muted-foreground mb-8">
            Get it out of your head. We&apos;ll organize it later.
          </p>

          {/* Unified capture box */}
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
              {/* Image upload */}
              <button
                type="button"
                onClick={handleImportClick}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Upload a screenshot or photo"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </button>

              {/* PDF upload */}
              <button
                type="button"
                onClick={handleImportClick}
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

          {/* Review panel — appears below capture box after parsing */}
          {reviewMode && (
            <div className="animate-slide-down">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-5">
                {/* Tasks column */}
                <Card className="rounded-2xl border border-border shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tasks</h3>
                    <span className="text-xs font-medium text-foreground bg-muted rounded-full px-2 py-0.5">
                      {activeTasks.length}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {parsedTasks.map((task) => {
                      const isEdited = task.title !== task.originalTitle;
                      const showUndo = isEdited || task.rejected;
                      const dateLabel = formatReviewDate(task);
                      return (
                        <div
                          key={task.id}
                          className={`px-5 py-3.5 flex items-start gap-3 group transition-colors ${
                            task.rejected ? "bg-muted/20" : "hover:bg-muted/10"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <input
                              type="text"
                              value={task.title}
                              onChange={(e) => updateTaskTitle(task.id, e.target.value)}
                              disabled={task.rejected}
                              className={`w-full bg-transparent border-none focus:outline-none focus:ring-0 text-sm font-medium leading-snug p-0 ${
                                task.rejected
                                  ? "line-through text-muted-foreground cursor-not-allowed"
                                  : "text-foreground"
                              }`}
                            />
                            {!task.rejected && (dateLabel || task.category) && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {[dateLabel, task.category].filter(Boolean).join(" · ")}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0 mt-0.5">
                            {/* Undo — visible when edited or rejected */}
                            {showUndo && (
                              <button
                                onClick={() => undoTask(task.id)}
                                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                title="Undo"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                </svg>
                              </button>
                            )}
                            {/* Remove — visible on hover when not rejected */}
                            {!task.rejected && (
                              <button
                                onClick={() => rejectTask(task.id)}
                                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors opacity-0 group-hover:opacity-100"
                                title="Remove"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Lists column */}
                <Card className="rounded-2xl border border-border shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lists</h3>
                    <span className="text-xs font-medium text-foreground bg-muted rounded-full px-2 py-0.5">
                      {activeListItems.length}
                    </span>
                  </div>
                  {parsedListItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                      <p className="text-sm text-muted-foreground">No lists found</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {parsedListItems.map((li) => {
                        const itemEdited = li.item !== li.originalItem;
                        const nameEdited = li.listName !== li.originalListName;
                        const showUndo = itemEdited || nameEdited || li.rejected;
                        return (
                          <div
                            key={li.id}
                            className={`px-5 py-3.5 flex items-start gap-3 group transition-colors ${
                              li.rejected ? "bg-muted/20" : "hover:bg-muted/10"
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <input
                                type="text"
                                value={li.item}
                                onChange={(e) => updateListItemField(li.id, { item: e.target.value })}
                                disabled={li.rejected}
                                className={`w-full bg-transparent border-none focus:outline-none focus:ring-0 text-sm font-medium leading-snug p-0 ${
                                  li.rejected
                                    ? "line-through text-muted-foreground cursor-not-allowed"
                                    : "text-foreground"
                                }`}
                              />
                              {!li.rejected && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="text-xs text-muted-foreground">→</span>
                                  <input
                                    type="text"
                                    value={li.listName}
                                    onChange={(e) => updateListItemField(li.id, { listName: e.target.value })}
                                    className="text-xs text-muted-foreground bg-transparent border-none focus:outline-none focus:ring-0 p-0 min-w-0"
                                    title="List name (editable)"
                                  />
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1 shrink-0 mt-0.5">
                              {showUndo && (
                                <button
                                  onClick={() => undoListItem(li.id)}
                                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                  title="Undo"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                                  </svg>
                                </button>
                              )}
                              {!li.rejected && (
                                <button
                                  onClick={() => rejectListItem(li.id)}
                                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors opacity-0 group-hover:opacity-100"
                                  title="Remove"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-end gap-4">
                <button
                  type="button"
                  onClick={handleStartOver}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Start over
                </button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={savingItems || (activeTasks.length === 0 && activeListItems.length === 0)}
                  loading={savingItems}
                >
                  Save
                </Button>
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
    </ProtectedRoute>
  );
}
