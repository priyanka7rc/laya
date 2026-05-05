"use client";

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { validateTaskQuickAdd } from '@/lib/validation';
import { toHHMM } from '@/lib/taskRulesParser';
import { DatePickerDropdown } from '@/components/DatePickerDropdown';
import { TimePickerDropdown } from '@/components/TimePickerDropdown';

interface TaskFormProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
  editTask?: {
    id: string;
    title?: string | null;
    notes?: string | null;
    category?: string | null;
    due_date?: string | null;
    due_time?: string | null;
  } | null;
  panelMode?: boolean;
}

export default function TaskForm({ onSuccess, onError, editTask, panelMode }: TaskFormProps) {
  const [title, setTitle] = useState(editTask?.title || '');
  const [notes, setNotes] = useState(editTask?.notes || '');
  const [category, setCategory] = useState(editTask?.category || '');
  const [dueDate, setDueDate] = useState(editTask?.due_date || '');
  const [dueTime, setDueTime] = useState(editTask?.due_time || '');
  const [loading, setLoading] = useState(false);

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
      const { ...dbData } = validation.data!;

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
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            (data &&
              typeof data === 'object' &&
              'error' in data &&
              (data as { error?: string }).error) ||
            'Failed to save task';
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
    } catch (error: unknown) {
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
        className="p-4 space-y-3"
      >
        {/* Title — visibly editable input */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Title
          </label>
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title..."
            maxLength={120}
            rows={2}
            className={`w-full px-3 py-2.5 rounded-xl border bg-background text-sm text-foreground placeholder-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
              validationErrors.title ? 'border-destructive' : 'border-border'
            }`}
          />
          {validationErrors.title && (
            <p className="mt-1 text-xs text-destructive">⚠ {validationErrors.title}</p>
          )}
        </div>

        {/* Due Date + Time — side by side */}
        <div className="grid grid-cols-2 gap-2">
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
            maxLength={50}
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
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
            placeholder="Add notes..."
            maxLength={500}
            className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground placeholder-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
          />
        </div>

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