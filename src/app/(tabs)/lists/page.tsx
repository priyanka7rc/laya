'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/components/AuthProvider';
import { Card, Button } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import type { ListViewList, ListViewResult } from '@/lib/listView/contracts';
import { ImportListsModal } from '@/components/ImportListsModal';
import { supabase } from '@/lib/supabaseClient';

export default function ListsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [lists, setLists] = useState<ListViewList[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const PAGE_LIMIT = 50;

  const fetchLists = async (opts?: { cursor?: string | null; append?: boolean }) => {
    const { cursor: cur, append } = opts ?? {};
    try {
      if (!user) return;
      if (!append) setLoading(true);

      const params = new URLSearchParams();
      if (cur) params.set('cursor', cur);
      params.set('limit', String(PAGE_LIMIT));

      const res = await fetch(`/api/lists/view?${params.toString()}`, {
        method: 'GET',
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ListViewResult> & {
        error?: string;
      };

      if (!res.ok) {
        const msg = data.error || 'Could not load lists.';
        if (!append) setLists([]);
        setCursor(null);
        setHasMore(false);
        toast.error(msg);
        return;
      }

      const result = data as ListViewResult;

      if (append) {
        setLists((prev) => [...prev, ...result.lists]);
      } else {
        setLists(result.lists);
      }
      setCursor(result.pageInfo.nextCursor ?? null);
      setHasMore(result.pageInfo.hasMore);
    } catch (err) {
      console.error('Error fetching lists:', err);
      if (!append) setLists([]);
      toast.error('Could not load lists.');
    } finally {
      if (!opts?.append) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('List name cannot be empty.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/lists/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      type CreateListResponse = ListViewList & { error?: string };
      const data = (await res.json().catch(() => ({}))) as Partial<CreateListResponse>;
      if (!res.ok) {
        const msg = (typeof data === 'object' && data && 'error' in data && data.error) || 'Failed to create list';
        toast.error(msg ?? 'Failed to create list');
        return;
      }
      setName('');
      setLists((prev) => [data as ListViewList, ...prev]);
      toast.success('List created');
    } catch (err) {
      console.error('Error creating list:', err);
      toast.error("That didn't work - want to try again?");
    } finally {
      setCreating(false);
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-24 md:pb-8 transition-colors">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl">
          {/* Header */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2">
                Lists
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                {lists.length} {lists.length === 1 ? 'list' : 'lists'}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setImportModalOpen(true)}
              className="shrink-0"
              title="Create list from screenshot, photo, or PDF"
            >
              Import from image
            </Button>
          </div>

          <ImportListsModal
            isOpen={importModalOpen}
            onClose={() => setImportModalOpen(false)}
            onSuccess={() => fetchLists()}
            getToken={async () => {
              const { data: { session } } = await supabase.auth.getSession();
              return session?.access_token ?? null;
            }}
            toast={toast}
          />

          {/* Create list */}
          <Card className="mb-6 border-blue-300/30 dark:border-blue-800/30">
            <form onSubmit={handleCreate} className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Create a new list…"
                maxLength={120}
                className="w-full h-11 px-4 bg-gray-100 dark:bg-gray-800/50 border border-gray-300 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-base"
              />
              <div className="flex justify-end">
                <Button
                  type="submit"
                  loading={creating}
                  disabled={!name.trim() || creating}
                >
                  Create list
                </Button>
              </div>
            </form>
          </Card>

          {/* Lists */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Card key={i} className="animate-pulse">
                  <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-1/2" />
                </Card>
              ))}
            </div>
          ) : lists.length === 0 ? (
            <Card className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full mb-4">
                <span className="text-3xl">📋</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                No lists yet
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-1">
                Use the box above to create your first list.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {lists.map((list) => (
                <Link key={list.id} href={`/lists/${list.id}`}>
                  <Card className="flex items-center justify-between px-4 py-3 hover:border-blue-500/50 dark:hover:border-blue-700/50 transition-colors cursor-pointer">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{list.name}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Updated {new Date(list.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="text-gray-400 dark:text-gray-500">→</span>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {!loading && hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="secondary"
                onClick={() => fetchLists({ cursor, append: true })}
                disabled={!cursor}
              >
                Load more
              </Button>
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}

