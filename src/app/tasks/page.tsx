// export default function TasksPage() {
//     return (
//       <div className="min-h-screen p-4 pb-20 md:pb-4">
//         <h1 className="text-2xl font-bold">Tasks</h1>
//       </div>
//     );
//   }
"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import ProtectedRoute from '@/components/ProtectedRoute';
import TaskForm from '@/components/TaskForm';

interface Task {
  id: string;
  title: string;
  notes: string | null;
  is_done: boolean;
  due_date: string | null;
  due_time: string | null;
  category: string | null;  // Now accepts any text
}

export default function TasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (user) {
      fetchTasks();
    }
  }, [user]);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user?.id)
        .order('due_date', { ascending: true });

      if (error) throw error;
      setTasks(data || []);
    } catch (err: any) {
      setError(err.message);
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleTask = async (taskId: string, currentStatus: boolean) => {
    // Optimistic update - update UI immediately
    setTasks(tasks.map(task =>
      task.id === taskId ? { ...task, is_done: !currentStatus } : task
    ));
  
    try {
      // Update Supabase in background
      const { error } = await supabase
        .from('tasks')
        .update({ is_done: !currentStatus })
        .eq('id', taskId);
  
      if (error) throw error;
    } catch (err: any) {
      // Rollback on error - revert the optimistic update
      console.error('Error updating task:', err);
      setTasks(tasks.map(task =>
        task.id === taskId ? { ...task, is_done: currentStatus } : task
      ));
      alert('Failed to update task. Please try again.');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'No date';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (timeString: string | null) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-black pb-20 md:pb-4">
        <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-white">Tasks</h1>
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              {showForm ? '− Cancel' : '+ Add Task'}
            </button>
          </div>

          {showForm && (
            <div className="mb-6">
              <TaskForm 
                onSuccess={() => {
                  setShowForm(false);
                  fetchTasks();
                }} 
              />
            </div>
          )}

          {loading && (
            <p className="text-gray-400">Loading tasks...</p>
          )}
        

          {error && (
            <div className="bg-red-900/50 text-red-200 p-4 rounded-lg mb-4">
              Error: {error}
            </div>
          )}

          {!loading && !error && tasks.length === 0 && (
            <p className="text-gray-400">No tasks yet. Click "Add Task" to create one!</p>
          )}

          {!loading && tasks.length > 0 && (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={task.is_done}
                      onChange={() => toggleTask(task.id, task.is_done)}
                      className="mt-1 h-5 w-5 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {task.category && (
                          <span className="px-2 py-1 text-xs bg-gray-800 text-gray-300 rounded">
                            {task.category}
                          </span>
                        )}
                        <h3
                          className={`text-lg font-medium ${
                            task.is_done
                              ? 'text-gray-500 line-through'
                              : 'text-white'
                          }`}
                        >
                          {task.title}
                        </h3>
                      </div>
                      {task.notes && (
                        <p className="text-sm text-gray-400 mt-1">{task.notes}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
                        {task.due_date && (
                          <span className="flex items-center gap-1">
                            📅 {formatDate(task.due_date)}
                          </span>
                        )}
                        {task.due_time && (
                          <span className="flex items-center gap-1">
                            🕐 {formatTime(task.due_time)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}