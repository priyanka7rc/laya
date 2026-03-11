'use client';

import { useState, useRef } from 'react';
import { Card, Button } from '@/components/ui';

const NAME_MAX_LENGTH = 120;

type Step = 'upload' | 'ocr' | 'review' | 'done';

interface ListPreviewItem {
  name_prefill: string | null;
  heading_confidence: 'high' | 'low' | 'none';
  suggested_names: string[];
  candidatesCount: number;
  sample: string[];
  candidates: { text: string; classification?: string; sourceLine?: number }[];
}

interface ImportListsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  getToken: () => Promise<string | null>;
  toast: {
    success: (t: string, d?: string) => void;
    error: (t: string, d?: string) => void;
    info: (t: string, d?: string) => void;
  };
}

export function ImportListsModal({
  isOpen,
  onClose,
  onSuccess,
  getToken,
  toast,
}: ImportListsModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [previewLists, setPreviewLists] = useState<ListPreviewItem[]>([]);
  const [editedNames, setEditedNames] = useState<Record<number, string>>({});
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
      const ocrData = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(ocrData.error || 'OCR failed');
        return;
      }
      const token2 = await getToken();
      if (!token2) return;
      const previewRes = await fetch('/api/lists/import/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token2}`,
        },
        body: JSON.stringify({ mediaId }),
      });
      const previewData = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        toast.error(previewData.error || 'Preview failed');
        return;
      }
      if (Array.isArray(previewData.lists) && previewData.lists.length > 0) {
        setPreviewLists(previewData.lists);
        setEditedNames({});
        setStep('review');
      } else {
        toast.error('No list detected. Try another image.');
      }
    } catch (err) {
      console.error(err);
      toast.error('OCR failed');
    } finally {
      setOcrLoading(false);
    }
  };

  const updateName = (index: number, name: string) => {
    setEditedNames((prev) => ({ ...prev, [index]: name }));
  };

  const getDisplayName = (index: number) => {
    const base = previewLists[index];
    return editedNames[index] ?? base?.name_prefill ?? '';
  };

  const handleConfirm = async () => {
    if (previewLists.length === 0 || !mediaId) {
      toast.error('No list to create');
      return;
    }
    setConfirmLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error('Please sign in again');
        return;
      }
      const listsToConfirm = previewLists.map((item, i) => ({
        name:
          (editedNames[i] ?? item.name_prefill ?? '').trim() ||
          item.name_prefill ||
          '',
        candidates: item.candidates,
      }));
      const res = await fetch('/api/lists/import/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mediaId, lists: listsToConfirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to create list');
        return;
      }
      setStep('done');
      onSuccess();
      const count = data.created?.length ?? 0;
      toast.success(count === 1 ? 'List created' : `${count} lists created`);
      if (Array.isArray(data.created) && data.created.length > 0) {
        toast.info('Imported items captured (pending conversion).');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to create list');
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleClose = () => {
    setStep('upload');
    setMediaId(null);
    setPreviewLists([]);
    setEditedNames({});
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={handleClose}
    >
      <Card
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Import list from screenshot
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
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
            <p className="text-sm text-gray-500 dark:text-gray-400">
              JPEG, PNG, GIF, WebP or PDF. Max 10MB.
            </p>
          </div>
        )}

        {step === 'ocr' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              File uploaded. Extract text to detect list and items.
            </p>
            <Button
              onClick={runOcr}
              loading={ocrLoading}
              disabled={ocrLoading}
              className="w-full"
            >
              {ocrLoading ? 'Extracting…' : 'Extract text'}
            </Button>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Edit the list name if needed. Candidate items are captured for later.
            </p>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {previewLists.map((item, index) => (
                <div
                  key={index}
                  className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 space-y-2"
                >
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    List name
                  </label>
                  <input
                    type="text"
                    value={getDisplayName(index)}
                    onChange={(e) =>
                      updateName(index, e.target.value.slice(0, NAME_MAX_LENGTH))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white text-sm"
                    placeholder="List name"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {item.candidatesCount} candidate item(s) captured (will be
                    added later).
                  </p>
                  {item.sample.length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      e.g. {item.sample.slice(0, 3).join(', ')}
                      {item.candidatesCount > 3 ? '…' : ''}
                    </p>
                  )}
                  {item.suggested_names.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {item.suggested_names.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() =>
                            updateName(
                              index,
                              name.length > NAME_MAX_LENGTH
                                ? name.slice(0, NAME_MAX_LENGTH)
                                : name
                            )
                          }
                          className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700"
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                onClick={async () => {
                  if (previewLists.length === 0) {
                    toast.error('No list to save');
                    return;
                  }
                  if (!mediaId) {
                    toast.error('Missing import context. Please run OCR again.');
                    return;
                  }
                  try {
                    const token = await getToken();
                    if (!token) {
                      toast.error('Please sign in again');
                      return;
                    }
                    const inboxCandidates = previewLists[0]!.candidates;
                    const res = await fetch('/api/lists/import/save-inbox', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({ mediaId, candidates: inboxCandidates }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      toast.error(data.error || 'Failed to save to Inbox');
                      return;
                    }
                    toast.success('Saved to Inbox');
                    onSuccess();
                    handleClose();
                  } catch (err) {
                    console.error(err);
                    toast.error('Failed to save to Inbox');
                  }
                }}
                className="flex-1"
              >
                Save to Inbox
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={
                  previewLists.length === 0 ||
                  previewLists.some(
                    (_, i) =>
                      !(
                        (editedNames[i] ??
                          previewLists[i].name_prefill ??
                          '').trim()
                      )
                  ) ||
                  confirmLoading
                }
                loading={confirmLoading}
                variant="secondary"
              >
                Create list
              </Button>
              <Button type="button" variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              List created. You can add items to it later from the Lists tab.
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
