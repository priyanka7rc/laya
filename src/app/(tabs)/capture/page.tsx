"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Card, Button } from "@/components/ui";
import { ImportTasksModal } from "@/components/ImportTasksModal";
import { TypeTask, Brain, Upload, ListPlus, MessageSquare } from "@/components/Icons";
import { useToast } from "@/hooks/useToast";
import { getCurrentAppUser } from "@/lib/users/linking";
import { supabase } from "@/lib/supabaseClient";
import { TASK_SOURCES } from "@/lib/taskSources";

const TITLE_MAX_LENGTH = 120;

export default function CapturePage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [quickTask, setQuickTask] = useState("");
  const [brainDump, setBrainDump] = useState("");
  const [adding, setAdding] = useState(false);
  const [brainDumpLoading, setBrainDumpLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [isWhatsAppLinked, setIsWhatsAppLinked] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) fetchWhatsAppStatus();
  }, [user]);

  const fetchWhatsAppStatus = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("whatsapp_users")
      .select("auth_user_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    setIsWhatsAppLinked(!!data);
  };

  const handleQuickAdd = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = quickTask.trim();
    if (!trimmed) return;
    if (trimmed.length > TITLE_MAX_LENGTH) {
      toast.error(`Task title must be ${TITLE_MAX_LENGTH} characters or less`);
      return;
    }

    setAdding(true);
    try {
      const appUser = await getCurrentAppUser();
      const { data: { session } } = await supabase.auth.getSession();
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
          app_user_id: appUser?.id ?? null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Couldn't save changes");
        return;
      }

      if (data.inserted?.length > 0) {
        setQuickTask("");
        toast.success("Task created");
        router.refresh();
      }
    } catch (err) {
      console.error("Error adding task:", err);
      toast.error("Couldn't save changes");
    } finally {
      setAdding(false);
    }
  };

  const handleBrainDump = async () => {
    const trimmed = brainDump.trim();
    if (!trimmed || !user) return;

    setBrainDumpLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

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

      const { tasks } = await parseRes.json();
      if (!tasks?.length) {
        toast.error("No tasks found in that text");
        return;
      }

      const appUser = await getCurrentAppUser();
      const proposedTasks = tasks.map((t: { title: string; due_date?: string; due_time?: string; category?: string; inferred_date?: boolean; inferred_time?: boolean }) => ({
        title: t.title,
        due_date: t.due_date,
        due_time: t.due_time,
        category: t.category ?? "Tasks",
        inferred_date: !!t.inferred_date,
        inferred_time: !!t.inferred_time,
        rawCandidate: t.title,
      }));

      const insertRes = await fetch("/api/tasks/import/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          tasks: proposedTasks,
          source: TASK_SOURCES.WEB_BRAIN_DUMP,
          app_user_id: appUser?.id ?? null,
        }),
      });

      if (!insertRes.ok) {
        throw new Error("Insert failed");
      }

      const { inserted } = await insertRes.json();
      const count = Array.isArray(inserted) ? inserted.length : 0;
      setBrainDump("");
      toast.success(
        count === 1 ? "Task created" : `Import complete. ${count} tasks created.`
      );
      router.refresh();
    } catch (err) {
      console.error("Brain dump error:", err);
      toast.error("Couldn't save changes");
    } finally {
      setBrainDumpLoading(false);
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (files?.length) {
      setImportModalOpen(true);
      // ImportTasksModal uses file input - we need to trigger it
      // For simplicity, we open the modal; user can select file there
      // ImportTasksModal has its own file input
    }
  };

  const handleImportClick = () => {
    setImportModalOpen(true);
  };

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
    if (e.dataTransfer.files?.length) {
      setImportModalOpen(true);
      // Modal will need file - for drag-drop we could pass file to modal
      // ImportTasksModal manages its own file input, so we just open it
      // and user can also drop/select - the modal flow is click-to-select
      // For now opening the modal is sufficient
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl lg:max-w-6xl">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-8">
            Capture
          </h1>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quick Add */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center gap-3 mb-3">
                <TypeTask className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Quick add</h3>
              </div>
              <form onSubmit={handleQuickAdd}>
                <input
                  type="text"
                  placeholder="Type a task and press enter"
                  value={quickTask}
                  onChange={(e) => setQuickTask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleQuickAdd(e)}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 input-mobile"
                  maxLength={TITLE_MAX_LENGTH}
                />
                <Button
                  type="submit"
                  loading={adding}
                  disabled={!quickTask.trim() || adding}
                  className="mt-3"
                >
                  Add task
                </Button>
              </form>
            </Card>

            {/* Brain Dump */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center gap-3 mb-3">
                <Brain className="w-5 h-5 text-accent" />
                <h3 className="text-lg font-semibold text-foreground">Brain dump</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Write everything on your mind. Laya will split it into tasks.
              </p>
              <textarea
                placeholder="I need to call the dentist, pick up groceries, and finish the quarterly report..."
                value={brainDump}
                onChange={(e) => setBrainDump(e.target.value)}
                rows={5}
                className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none input-mobile"
              />
              <Button
                type="button"
                onClick={handleBrainDump}
                disabled={!brainDump.trim() || brainDumpLoading}
                loading={brainDumpLoading}
                className="mt-3 w-full"
              >
                Process
              </Button>
            </Card>

            {/* Upload */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center gap-3 mb-3">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold text-foreground">Upload</h3>
              </div>
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  dragActive ? "border-primary bg-muted/30" : "border-border"
                }`}
              >
                <p className="text-foreground mb-1">
                  Drop a screenshot, photo, or PDF
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  Laya will extract tasks for you
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleImportClick}
                  data-capture-upload-trigger
                >
                  Choose file
                </Button>
              </div>
            </Card>

            {/* Create List */}
            <Card className="rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center gap-3 mb-3">
                <ListPlus className="w-5 h-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold text-foreground">
                  Create a list
                </h3>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => router.push("/lists")}
              >
                Go to Lists
              </Button>
            </Card>

            {/* WhatsApp */}
            <Card className={`rounded-2xl p-5 shadow-sm border lg:col-span-2 ${
              isWhatsAppLinked ? "bg-[#25D366]/5 border-[#25D366]/20" : "border-border"
            }`}>
              <div className="flex items-center gap-3 mb-3">
                <MessageSquare className={`w-5 h-5 ${isWhatsAppLinked ? "text-[#25D366]" : "text-muted-foreground"}`} />
                <h3 className="text-lg font-semibold text-foreground">
                  WhatsApp commands
                </h3>
              </div>
              {isWhatsAppLinked ? (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    Send these to Laya via WhatsApp:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "Pay rent tomorrow 10am",
                      "What do I have today?",
                      "Edit milk task",
                      "Create list groceries",
                    ].map((cmd) => (
                      <span
                        key={cmd}
                        className="px-3 py-2 rounded-xl bg-muted/50 text-sm text-foreground border border-border"
                      >
                        {cmd}
                      </span>
                    ))}
                  </div>
                  <Button
                    variant="secondary"
                    className="mt-4"
                    onClick={() => router.push("/link-whatsapp")}
                  >
                    Manage WhatsApp
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    Connect WhatsApp to manage tasks via messaging.
                  </p>
                  <Button onClick={() => router.push("/link-whatsapp")}>
                    Connect WhatsApp
                  </Button>
                </>
              )}
            </Card>
          </div>
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
