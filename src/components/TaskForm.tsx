"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthProvider';

interface TaskFormProps {
  onSuccess?: () => void;
  editTask?: any;
}

export default function TaskForm({ onSuccess, editTask }: TaskFormProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState(editTask?.title || '');
  const [notes, setNotes] = useState(editTask?.notes || '');
  const [category, setCategory] = useState(editTask?.category || '');
  const [dueDate, setDueDate] = useState(editTask?.due_date || '');
  const [dueTime, setDueTime] = useState(editTask?.due_time || '');
  const [loading, setLoading] = useState(false);
  const [generatingCategory, setGeneratingCategory] = useState(false);

  const generateCategory = async () => {
    if (!title.trim()) return;
    
    setGeneratingCategory(true);
    try {
      const response = await fetch('/api/generate-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, notes }),
      });

      const data = await response.json();
      if (data.category) {
        setCategory(data.category);
      }
    } catch (error) {
      console.error('Error generating category:', error);
    } finally {
      setGeneratingCategory(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const taskData = {
        title,
        notes: notes || null,
        category: category || null,
        due_date: dueDate || null,
        due_time: dueTime || null,
        user_id: user?.id,
      };

      if (editTask) {
        const { error } = await supabase
          .from('tasks')
          .update(taskData)
          .eq('id', editTask.id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('tasks')
          .insert([taskData]);
        
        if (error) throw error;
      }

      // Reset form
      setTitle('');
      setNotes('');
      setCategory('');
      setDueDate('');
      setDueTime('');
      
      if (onSuccess) onSuccess();
    } catch (error: any) {
      console.error('Error saving task:', error);
      alert('Error saving task: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Task Title *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        //   onBlur={generateCategory}
          required
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter task title"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Add any notes"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-300">
            Category
          </label>
          {/* <button
            type="button"
            onClick={generateCategory}
            disabled={!title.trim() || generatingCategory}
            className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-600"
          >
            {generatingCategory ? '✨ Generating...' : '✨ AI Suggest'}
          </button> */}
        </div>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        //   placeholder="Category (AI-generated or custom)"
        placeholder="e.g., Work, Personal, Shopping"/>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Due Date
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Due Time
          </label>
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Saving...' : editTask ? 'Update Task' : 'Add Task'}
      </button>
    </form>
  );
}