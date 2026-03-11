'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { Card, Button } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { supabase } from '@/lib/supabaseClient';
import type { ListItem } from '@/lib/listItems';

type ListDetailResponse = {
  list: { id: string; name: string };
  items: ListItem[];
  doneCount: number;
  totalCount: number;
};

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function ItemInput({
  listId,
  onAdded,
  disabled,
}: {
  listId: string;
  onAdded: () => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/lists/${listId}/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data as { error?: string }).error || 'Failed to add item');
        return;
      }
      setValue('');
      onAdded();
      inputRef.current?.focus();
    } catch (err) {
      console.error(err);
      toast.error('Failed to add item');
    } finally {
      setSubmitting(false);
    }
  }, [listId, value, submitting, onAdded, toast]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      }}
      placeholder="Add an item…"
      disabled={disabled}
      className="w-full h-11 px-4 bg-gray-100 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-base"
      aria-label="New list item"
    />
  );
}

function ItemRow({
  item,
  onToggle,
  onUpdateText,
  onDelete,
}: {
  item: ListItem;
  onToggle: (item: ListItem) => void;
  onUpdateText: (item: ListItem, newText: string) => void;
  onDelete: (item: ListItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.text);
  const { toast } = useToast();

  const saveEdit = useCallback(async () => {
    const trimmed = editValue.trim();
    if (trimmed === item.text) {
      setEditing(false);
      setEditValue(item.text);
      return;
    }
    if (!trimmed) {
      setEditValue(item.text);
      setEditing(false);
      return;
    }
    try {
      const token = await getToken();
      const res = await fetch(`/api/list-items/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        toast.error('Failed to update item');
        return;
      }
      onUpdateText(item, trimmed);
      setEditValue(trimmed);
      setEditing(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to update item');
    }
  }, [item, editValue, onUpdateText, toast]);

  return (
    <div className="flex items-center gap-3 py-2">
      <button
        type="button"
        onClick={() => onToggle(item)}
        className="flex-shrink-0 h-8 w-8 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 hover:border-blue-500 flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label={item.is_done ? `Mark "${item.text}" as incomplete` : `Mark "${item.text}" as complete`}
      >
        {item.is_done && (
          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveEdit();
              if (e.key === 'Escape') {
                setEditValue(item.text);
                setEditing(false);
              }
            }}
            autoFocus
            className="w-full px-2 py-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`text-left w-full px-2 py-1 -mx-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800/50 ${
              item.is_done
                ? 'text-gray-500 dark:text-gray-400 line-through'
                : 'text-gray-900 dark:text-white font-medium'
            }`}
          >
            {item.text}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDelete(item)}
        className="flex-shrink-0 h-8 w-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center"
        aria-label={`Delete "${item.text}"`}
        title="Delete item"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}

function ItemList({
  items,
  onToggle,
  onUpdateText,
  onDelete,
  onRefresh,
}: {
  items: ListItem[];
  onToggle: (item: ListItem) => void;
  onUpdateText: (item: ListItem, newText: string) => void;
  onDelete: (item: ListItem) => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();

  const handleToggle = useCallback(
    async (item: ListItem) => {
      const next = !item.is_done;
      onToggle(item);
      try {
        const token = await getToken();
        const res = await fetch(`/api/list-items/${item.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ is_done: next }),
        });
        if (!res.ok) {
          onRefresh();
          toast.error('Failed to update item');
        }
      } catch (err) {
        console.error(err);
        onRefresh();
        toast.error('Failed to update item');
      }
    },
    [onToggle, onRefresh, toast]
  );

  const handleDelete = useCallback(
    async (item: ListItem) => {
      onDelete(item);
      try {
        const token = await getToken();
        const res = await fetch(`/api/list-items/${item.id}`, {
          method: 'DELETE',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) {
          onRefresh();
          toast.error('Failed to delete item');
        }
      } catch (err) {
        console.error(err);
        onRefresh();
        toast.error('Failed to delete item');
      }
    },
    [onDelete, onRefresh, toast]
  );

  if (items.length === 0) {
    return (
      <Card className="text-center py-12">
        <p className="text-gray-600 dark:text-gray-400">No items yet</p>
      </Card>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <Card key={item.id} className="px-4">
          <ItemRow
            item={item}
            onToggle={handleToggle}
            onUpdateText={onUpdateText}
            onDelete={handleDelete}
          />
        </Card>
      ))}
    </div>
  );
}

export default function ListDetailPage() {
  const params = useParams();
  const listId = typeof params?.listId === 'string' ? params.listId : null;
  const [listName, setListName] = useState<string>('');
  const [items, setItems] = useState<ListItem[]>([]);
  const [doneCount, setDoneCount] = useState<number>(0);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { toast } = useToast();

  const fetchItems = useCallback(async (id: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/lists/${id}/items`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json().catch(() => ({}))) as ListDetailResponse & { error?: string };
      if (!res.ok) {
        if (res.status === 404) setNotFound(true);
        else toast.error(data.error || 'Failed to load list');
        setItems([]);
        return;
      }
      const result = data as ListDetailResponse;
      setListName(result.list.name);
      setItems(result.items);
      setDoneCount(result.doneCount);
      setTotalCount(result.totalCount);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load list');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (listId) {
      setLoading(true);
      setNotFound(false);
      fetchItems(listId);
    } else {
      setLoading(false);
    }
  }, [listId, fetchItems]);

  const handleItemAdded = useCallback(() => {
    if (listId) fetchItems(listId);
  }, [listId, fetchItems]);

  const handleUpdateText = useCallback((item: ListItem, newText: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, text: newText } : i))
    );
  }, []);

  const handleDelete = useCallback((item: ListItem) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }, []);

  const handleToggle = useCallback((item: ListItem) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, is_done: !i.is_done } : i
      )
    );
  }, []);

  if (notFound) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24 md:pb-8">
          <main className="container mx-auto px-4 py-8 max-w-3xl">
            <p className="text-gray-600 dark:text-gray-400">List not found.</p>
            <Link href="/lists" className="text-blue-600 dark:text-blue-400 mt-2 inline-block">
              Back to lists
            </Link>
          </main>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24 md:pb-8 transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
          <div className="mb-6">
            <Link
              href="/lists"
              className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-2"
            >
              ← Back to lists
            </Link>
            {!loading && (
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white">
                {listName || 'List'}
              </h1>
            )}
          </div>

          {loading ? (
            <div className="space-y-3">
              <div className="h-11 bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse" />
              <Card className="animate-pulse">
                <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-3/4 mb-2" />
                <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-1/2" />
              </Card>
            </div>
          ) : listId ? (
            <>
              <Card className="mb-6 border-blue-300/30 dark:border-blue-800/30">
                <ItemInput listId={listId} onAdded={handleItemAdded} />
              </Card>
              {!loading && (
                <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                  {doneCount} / {totalCount} completed
                </div>
              )}
              <ItemList
                items={items}
                onToggle={handleToggle}
                onUpdateText={handleUpdateText}
                onDelete={handleDelete}
                onRefresh={() => fetchItems(listId)}
              />
            </>
          ) : null}
        </main>
      </div>
    </ProtectedRoute>
  );
}
