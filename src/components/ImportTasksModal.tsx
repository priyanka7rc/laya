'use client';

import { useState, useRef } from 'react';
import { Card, Button } from '@/components/ui';
import { ConfirmInferenceBadge } from '@/components/ConfirmInferenceBadge';
import type { ProposedTask } from '@/lib/ocrCandidates';

const TITLE_MAX_LENGTH = 120;

type Step = 'upload' | 'ocr' | 'review' | 'done';

interface ImportTasksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  getToken: () => Promise<string | null>;
  toast: { success: (t: string, d?: string) => void; error: (t: string, d?: string) => void; info: (t: string, d?: string) => void };
}

export function ImportTasksModal({ isOpen, onClose, onSuccess, getToken, toast }: ImportTasksModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [previewTasks, setPreviewTasks] = useState<ProposedTask[]>([]);
  const [confirmResult, setConfirmResult] = useState<{ inserted: number; duplicates: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error('Please sign in again');
        return;
      }
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Upload failed');
        return;
      }
      setMediaId(data.mediaId);
      setStep('ocr');
      toast.info('Uploaded. Click "Extract text" to continue.');
    } catch (err) {
      console.error(err);
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const runOcr = async () => {
    if (!mediaId) return;
    setOcrLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error('Please sign in again');
        return;
      }
      const res = await fetch(`/api/media/${mediaId}/ocr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'OCR failed');
        return;
      }
      const token2 = await getToken();
      if (!token2) return;
      const previewRes = await fetch('/api/tasks/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token2}` },
        body: JSON.stringify({ mediaId }),
      });
      const previewData = await previewRes.json().catch(() => ({}));
      if (previewRes.ok && Array.isArray(previewData.tasks)) {
        setPreviewTasks(previewData.tasks);
      }
      setStep('review');
    } catch (err) {
      console.error(err);
      toast.error('OCR failed');
    } finally {
      setOcrLoading(false);
    }
  };

  const updateTask = (index: number, updates: Partial<ProposedTask>) => {
    setPreviewTasks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...updates } : t))
    );
  };

  const removeTask = (index: number) => {
    setPreviewTasks((prev) => prev.filter((_, i) => i !== index));
  };

  const handleConfirm = async () => {
    if (previewTasks.length === 0) {
      toast.error('No tasks to add');
      return;
    }
    setConfirmLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error('Please sign in again');
        return;
      }
      const res = await fetch('/api/tasks/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mediaId, tasks: previewTasks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to add tasks');
        return;
      }
      const inserted = data.inserted?.length ?? 0;
      const duplicates = data.duplicates?.length ?? 0;
      setConfirmResult({ inserted, duplicates });
      setStep('done');
      onSuccess();
      if (inserted > 0) toast.success("Import complete");
      if (duplicates > 0) toast.info(`${duplicates} skipped (duplicate)`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to add tasks');
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleClose = () => {
    setStep('upload');
    setMediaId(null);
    setPreviewTasks([]);
    setConfirmResult(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay" onClick={handleClose}>
      <Card
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-foreground">
            Import from image or PDF
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {step === 'upload' && (
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              loading={uploading}
              className="w-full"
            >
              {uploading ? 'Uploading…' : 'Choose file'}
            </Button>
            <p className="text-sm text-muted-foreground">
              JPEG, PNG, GIF, WebP or PDF. Max 10MB.
            </p>
          </div>
        )}

        {step === 'ocr' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">File uploaded. Extract text to detect tasks.</p>
            <Button onClick={runOcr} loading={ocrLoading} disabled={ocrLoading} className="w-full">
              {ocrLoading ? 'Extracting…' : 'Extract text'}
            </Button>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Review and edit. Then add tasks.
            </p>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {previewTasks.map((task, index) => (
                <div
                  key={index}
                  className="p-3 rounded-xl border border-border space-y-2"
                >
                  <div className="flex justify-between gap-2">
                    <input
                      type="text"
                      value={task.title}
                      onChange={(e) => updateTask(index, { title: e.target.value.slice(0, TITLE_MAX_LENGTH) })}
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-elevated border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Title"
                    />
                    <button
                      type="button"
                      onClick={() => removeTask(index)}
                      className="shrink-0 px-2 py-1 text-danger-foreground text-sm"
                      aria-label="Remove"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="date"
                      value={task.due_date}
                      onChange={(e) => updateTask(index, { due_date: e.target.value, inferred_date: false })}
                      className="px-2 py-1 rounded border border-border bg-elevated text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <input
                      type="time"
                      value={(task.due_time || '').slice(0, 5)}
                      onChange={(e) => updateTask(index, { due_time: e.target.value || '20:00', inferred_time: false })}
                      className="px-2 py-1 rounded border border-border bg-elevated text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <input
                      type="text"
                      value={task.category}
                      onChange={(e) => updateTask(index, { category: e.target.value })}
                      className="w-24 px-2 py-1 rounded border border-border bg-elevated text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Category"
                    />
                    {(task.inferred_date || task.inferred_time) && (
                      <ConfirmInferenceBadge
                        inferred_date={task.inferred_date}
                        inferred_time={task.inferred_time}
                        taskId={`preview-${index}`}
                        onConfirmed={() => updateTask(index, { inferred_date: false, inferred_time: false })}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {previewTasks.length === 0 && (
              <p className="text-sm text-muted-foreground">No tasks detected. Try another image.</p>
            )}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleConfirm}
                disabled={previewTasks.length === 0 || confirmLoading}
                loading={confirmLoading}
                className="flex-1"
              >
                Add {previewTasks.length} task(s)
              </Button>
              <Button type="button" variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4">
            <p className="text-foreground">
              {confirmResult?.inserted ?? 0} task(s) added.
              {confirmResult && confirmResult.duplicates > 0 && (
                <span className="block mt-1 text-sm text-warning-foreground">
                  {confirmResult.duplicates} skipped (duplicate).
                </span>
              )}
            </p>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
