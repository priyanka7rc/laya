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
}

export default function TaskForm({ onSuccess, onError, editTask }: TaskFormProps) {
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

  return (
    <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
      {/* Title Field */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Task Title *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`w-full h-11 px-4 py-2 text-base bg-gray-800 border rounded-2xl text-white placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-colors ${
            validationErrors.title 
              ? 'border-red-500 focus-visible:ring-red-500' 
              : 'border-gray-700 focus-visible:ring-blue-500'
          }`}
          placeholder="What do you need to do?"
          maxLength={120}
        />
        {/* ← Inline error */}
        {validationErrors.title && (
          <p className="mt-1 text-sm text-red-400 flex items-center gap-1">
            <span>⚠</span> {validationErrors.title}
          </p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {title.length}/120 characters
        </p>
      </div>

      {/* Notes Field */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={`w-full px-4 py-3 text-base bg-gray-800 border rounded-2xl text-white placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black resize-none transition-colors ${
            validationErrors.notes
              ? 'border-red-500 focus-visible:ring-red-500'
              : 'border-gray-700 focus-visible:ring-blue-500'
          }`}
          placeholder="Additional details..."
          maxLength={500}
        />
        {validationErrors.notes && (
          <p className="mt-1 text-sm text-red-400 flex items-center gap-1">
            <span>⚠</span> {validationErrors.notes}
          </p>
        )}
      </div>

      {/* Category Field */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
            Category
          </label>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={`w-full h-11 px-4 py-2 text-base bg-gray-800 border rounded-2xl text-white placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-colors ${
            validationErrors.category
              ? 'border-red-500 focus-visible:ring-red-500'
              : 'border-gray-700 focus-visible:ring-blue-500'
          }`}
          placeholder="e.g., Work, Personal, Shopping"
          maxLength={50}
        />
        {validationErrors.category && (
          <p className="mt-1 text-sm text-red-400 flex items-center gap-1">
            <span>⚠</span> {validationErrors.category}
          </p>
        )}
      </div>

      {/* Due Date & Time */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Due Date
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={`w-full h-11 px-4 py-2 text-base bg-gray-800 border rounded-2xl text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-colors ${
              validationErrors.due_date
                ? 'border-red-500 focus-visible:ring-red-500'
                : 'border-gray-700 focus-visible:ring-blue-500'
            }`}
          />
          {validationErrors.due_date && (
            <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
              <span>⚠</span> {validationErrors.due_date}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Due Time
          </label>
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className={`w-full h-11 px-4 py-2 text-base bg-gray-800 border rounded-2xl text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-colors ${
              validationErrors.due_time
                ? 'border-red-500 focus-visible:ring-red-500'
                : 'border-gray-700 focus-visible:ring-blue-500'
            }`}
          />
          {validationErrors.due_time && (
            <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
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
          className="flex-1 h-11 min-w-[120px] px-6 bg-blue-600 text-white text-base font-medium rounded-2xl hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-colors"
      >
        {loading ? 'Saving...' : editTask ? 'Update Task' : 'Add Task'}
      </button>
      </div>
    </form>
  );
}