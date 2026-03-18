"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthProvider';
import { validateTaskQuickAdd } from '@/lib/validation';
import { getCurrentAppUser } from '@/lib/users/linking';
import { TASK_SOURCES } from '@/lib/taskSources';
import { toHHMM } from '@/lib/taskRulesParser';

interface TaskFormProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
  editTask?: any;
  panelMode?: boolean;
}

export default function TaskForm({ onSuccess, onError, editTask, panelMode }: TaskFormProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState(editTask?.title || '');
  const [notes, setNotes] = useState(editTask?.notes || '');
  const [category, setCategory] = useState(editTask?.category || '');
  const [dueDate, setDueDate] = useState(editTask?.due_date || '');
  const [dueTime, setDueTime] = useState(editTask?.due_time || '');
  const [loading, setLoading] = useState(false);
  const [generatingCategory, setGeneratingCategory] = useState(false);

  // ← Add validation errors state
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // ... existing generateCategory function ...

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setValidationErrors({});  // ← Clear previous errors

    try {
      // ← Validate input
      const taskData = {
        title,
        notes: notes || null,
        category: category || null,
        due_date: dueDate || null,
        due_time: dueTime || null,
        alert_count: 0,
        alert_offsets: [],
      };

      const validation = validateTaskQuickAdd(taskData);
      
      if (!validation.success) {
        setValidationErrors(validation.errors || {});
        if (onError) {
          onError(validation.message || 'Validation failed');
        }
        return;  // Stop here if validation fails
      }

      // ← Continue with save (use validated data)
      const { alert_count, alert_offsets, ...dbData } = validation.data!;

      if (editTask) {
        // Edit: route through canonical update API (schedule recompute + ownership in server).
        const todayStr = new Date().toISOString().slice(0, 10);
        const DEFAULT_TASK_TIME = '20:00';
        const rawDate = dbData.due_date;
        const dueDateFinal =
          rawDate && /^\d{4}-\d{2}-\d{2}$/.test(String(rawDate).trim())
            ? String(rawDate).trim()
            : todayStr;
        const rawTime = dbData.due_time;
        const dueTimeFinal =
          (rawTime && toHHMM(String(rawTime).trim())) || DEFAULT_TASK_TIME;

        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/tasks/update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            taskId: editTask.id,
            title: dbData.title,
            category: dbData.category ?? null,
            due_date: dueDateFinal,
            due_time: dueTimeFinal,
            notes: dbData.notes ?? null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) || 'Failed to update task';
          if (onError) onError(msg);
          return;
        }
      } else {
        // Create mode: route through canonical /api/tasks/create so parsing,
        // schedule defaults, inferred flags, and dedupe are handled centrally.

        // Optional app user linkage (non-blocking)
        let appUserId: string | null = null;
        try {
          const appUser = await getCurrentAppUser();
          appUserId = appUser?.id ?? null;
        } catch {
          // If app user lookup fails, fall back to auth user only.
        }

        const { data: { session } } = await supabase.auth.getSession();

        const res = await fetch('/api/tasks/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            text: dbData.title,
            due_date: dbData.due_date || undefined,
            due_time: dbData.due_time || undefined,
            allowDuplicate: true,
            app_user_id: appUserId,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = (data && typeof data === 'object' && 'error' in data && (data as any).error) || 'Failed to save task';
          if (onError) onError(msg);
          return;
        }
      }

      // Reset form
      setTitle('');
      setNotes('');
      setCategory('');
      setDueDate('');
      setDueTime('');
      setValidationErrors({});  // ← Clear errors on success
      
      if (onSuccess) onSuccess();
    } catch (error: any) {
      console.error('Error saving task:', error);
      
      if (onError) {
        onError("That didn\'t work - want to try again?");
      } else {
        alert("That didn\'t work - want to try again?");
      }
    } finally {
      setLoading(false);
    }
  };

  const inputBase = "w-full h-11 px-4 py-2 text-base bg-card border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors";

  if (panelMode) {
    return (
      <form
        id="desktop-edit-form"
        onSubmit={handleSubmit}
        className="p-4 space-y-4"
      >
        {/* Title — transparent textarea */}
        <div>
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title..."
            maxLength={120}
            rows={2}
            className={`w-full bg-transparent border-none focus:outline-none focus:ring-0 text-lg text-foreground placeholder-muted-foreground resize-none min-h-[60px] ${
              validationErrors.title ? 'placeholder-destructive' : ''
            }`}
          />
          {validationErrors.title && (
            <p className="mt-1 text-xs text-destructive">⚠ {validationErrors.title}</p>
          )}
        </div>

        {/* Due Date — property row */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Due Time — property row */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Category — property row */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          </div>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category"
            maxLength={50}
            className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Notes */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Add notes..."
          maxLength={500}
          className="w-full bg-muted/30 rounded-xl p-3 text-sm text-foreground placeholder-muted-foreground resize-none min-h-[120px] border-none focus:outline-none focus:ring-0"
        />

        {/* Hidden submit (triggered externally via form.requestSubmit()) */}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-4 space-y-4">
      {/* Title Field */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Task Title *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`${inputBase} ${
            validationErrors.title 
              ? 'border-destructive focus-visible:ring-destructive' 
              : 'border-border focus-visible:ring-primary'
          }`}
          placeholder="What do you need to do?"
          maxLength={120}
        />
        {validationErrors.title && (
          <p className="mt-1 text-sm text-destructive flex items-center gap-1">
            <span>⚠</span> {validationErrors.title}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {title.length}/120 characters
        </p>
      </div>

      {/* Notes Field */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={`w-full px-4 py-3 text-base bg-card border rounded-xl text-foreground placeholder-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none transition-colors ${
            validationErrors.notes
              ? 'border-destructive focus-visible:ring-destructive'
              : 'border-border focus-visible:ring-primary'
          }`}
          placeholder="Additional details..."
          maxLength={500}
        />
        {validationErrors.notes && (
          <p className="mt-1 text-sm text-destructive flex items-center gap-1">
            <span>⚠</span> {validationErrors.notes}
          </p>
        )}
      </div>

      {/* Category Field */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Category
        </label>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={`${inputBase} ${
            validationErrors.category
              ? 'border-destructive focus-visible:ring-destructive'
              : 'border-border focus-visible:ring-primary'
          }`}
          placeholder="e.g., Work, Personal, Shopping"
          maxLength={50}
        />
        {validationErrors.category && (
          <p className="mt-1 text-sm text-destructive flex items-center gap-1">
            <span>⚠</span> {validationErrors.category}
          </p>
        )}
      </div>

      {/* Due Date & Time */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Due Date
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={`${inputBase} ${
              validationErrors.due_date
                ? 'border-destructive focus-visible:ring-destructive'
                : 'border-border focus-visible:ring-primary'
            }`}
          />
          {validationErrors.due_date && (
            <p className="mt-1 text-xs text-destructive flex items-center gap-1">
              <span>⚠</span> {validationErrors.due_date}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Due Time
          </label>
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className={`${inputBase} ${
              validationErrors.due_time
                ? 'border-destructive focus-visible:ring-destructive'
                : 'border-border focus-visible:ring-primary'
            }`}
          />
          {validationErrors.due_time && (
            <p className="mt-1 text-xs text-destructive flex items-center gap-1">
              <span>⚠</span> {validationErrors.due_time}
            </p>
          )}
        </div>
      </div>

      {/* Submit Button */}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="flex-1 h-11 min-w-[120px] px-6 bg-primary text-primary-foreground text-base font-medium rounded-xl hover:bg-primary/90 active:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
        >
          {loading ? 'Saving...' : editTask ? 'Save Changes' : 'Add Task'}
        </button>
      </div>
    </form>
  );
}