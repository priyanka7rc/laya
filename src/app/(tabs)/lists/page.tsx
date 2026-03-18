'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/components/AuthProvider';
import { Card, Button } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import type { ListViewList, ListViewResult } from '@/lib/listView/contracts';
import { ImportListsModal } from '@/components/ImportListsModal';
import { emojiForListName } from '@/components/Icons';
import { supabase } from '@/lib/supabaseClient';

function formatUpdated(updatedAt: string): string {
  const d = new Date(updatedAt);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((now.getTime() - day.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Updated today';
  if (diffDays === 1) return 'Updated yesterday';
  if (diffDays < 7) return `Updated ${diffDays} days ago`;
  return 'Updated last week';
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameListId, setRenameListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newListModalOpen, setNewListModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const PAGE_LIMIT = 50;

  const filteredLists = searchTerm.trim()
    ? lists.filter((l) => l.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : lists;

  const fetchLists = useCallback(async (opts?: { cursor?: string | null; append?: boolean }) => {
    const { cursor: cur, append } = opts ?? {};
    const run = async () => {
      if (!user) return;
      if (!append) setLoading(true);

      const params = new URLSearchParams();
      if (cur) params.set('cursor', cur);
      params.set('limit', String(PAGE_LIMIT));

      const token = await getToken();
      const res = await fetch(`/api/lists/view?${params.toString()}`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ListViewResult> & {
        error?: string;
      };

      if (!res.ok) {
        const msg = data.error || "Couldn't load lists.";
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
    };
    run()
      .catch(() => {
        if (!append) setLists([]);
        toast.error("Couldn't load lists");
      })
      .finally(() => { if (!opts?.append) setLoading(false); });
  }, [user, toast]);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (menuOpenId && !target.closest('[data-list-menu]')) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [menuOpenId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Enter a list name');
      return;
    }
    setCreating(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/lists/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: trimmed }),
      });
      type CreateListResponse = ListViewList & { error?: string };
      const data = (await res.json().catch(() => ({}))) as Partial<CreateListResponse>;
      if (!res.ok) {
        const msg = (typeof data === 'object' && data && 'error' in data && data.error) || 'Couldn\'t save changes';
        toast.error(msg ?? 'Couldn\'t save changes');
        return;
      }
      setName('');
      const created = data as { id: string; name: string; app_user_id?: string; source?: string; created_at?: string; updated_at?: string };
      setLists((prev) => [{
        id: created.id,
        appUserId: created.app_user_id ?? '',
        name: created.name,
        source: created.source ?? 'web',
        createdAt: created.created_at ?? new Date().toISOString(),
        updatedAt: created.updated_at ?? new Date().toISOString(),
        itemCount: 0,
        doneCount: 0,
      }, ...prev]);
      toast.success('List created');
      setNewListModalOpen(false);
    } catch (err) {
      console.error('Error creating list:', err);
      toast.error('Couldn\'t save changes');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = (list: ListViewList) => {
    setMenuOpenId(null);
    setRenameListId(list.id);
    setRenameValue(list.name);
  };

  const handleRenameSubmit = async () => {
    if (!renameListId || !renameValue.trim()) {
      setRenameListId(null);
      return;
    }
    const trimmed = renameValue.trim();
    setRenaming(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/lists/${renameListId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        toast.error('Couldn\'t save changes');
        return;
      }
      setLists((prev) =>
        prev.map((l) => (l.id === renameListId ? { ...l, name: trimmed } : l))
      );
      toast.success('List updated');
      setRenameListId(null);
    } catch {
      toast.error('Couldn\'t save changes');
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async (list: ListViewList) => {
    setMenuOpenId(null);
    setDeletingId(list.id);
    try {
      const token = await getToken();
      const res = await fetch(`/api/lists/${list.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        toast.error('Couldn\'t save changes');
        return;
      }
      setLists((prev) => prev.filter((l) => l.id !== list.id));
      toast.success('List deleted');
    } catch {
      toast.error('Couldn\'t save changes');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteClick = (list: ListViewList) => {
    setMenuOpenId(null);
    if (window.confirm('Delete this list?')) {
      handleDelete(list);
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors pb-24 md:pb-8">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl lg:max-w-6xl">
          {/* Header */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-1">
                Lists
              </h1>
              <p className="text-muted-foreground text-sm hidden lg:block">
                Keep related items together.
              </p>
              <p className="text-muted-foreground text-sm lg:hidden">
                {lists.length} {lists.length === 1 ? 'list' : 'lists'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Import from image
              </button>
              <Button
                onClick={() => setNewListModalOpen(true)}
                className="flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                + New list
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className="mb-6">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="search"
                placeholder="Search lists"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-11 pl-10 pr-4 rounded-xl border border-border bg-card text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <ImportListsModal
            isOpen={importModalOpen}
            onClose={() => setImportModalOpen(false)}
            onSuccess={() => fetchLists()}
            getToken={async () => getToken()}
            toast={toast}
          />

          {/* New list modal */}
          {newListModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20">
              <Card className="w-full max-w-sm p-5">
                <h3 className="text-lg font-semibold text-foreground mb-4">New list</h3>
                <form onSubmit={handleCreate} className="space-y-4">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter a list name"
                    maxLength={120}
                    className="w-full h-11 px-4 rounded-xl border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 text-base"
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setNewListModalOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      loading={creating}
                      disabled={!name.trim() || creating}
                    >
                      Create
                    </Button>
                  </div>
                </form>
              </Card>
            </div>
          )}

          {/* Rename modal */}
          {renameListId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20">
              <Card className="w-full max-w-sm p-4">
                <h3 className="text-lg font-semibold text-foreground mb-3">Rename list</h3>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit();
                    if (e.key === 'Escape') setRenameListId(null);
                  }}
                  placeholder="Enter a list name"
                  className="w-full h-11 px-4 rounded-xl border border-border bg-background text-foreground mb-4"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setRenameListId(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleRenameSubmit}
                    loading={renaming}
                    disabled={!renameValue.trim() || renaming}
                  >
                    Save
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* Lists */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Card key={i} className="animate-pulse p-4">
                  <div className="h-5 bg-muted rounded w-3/4 mb-2" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </Card>
              ))}
            </div>
          ) : filteredLists.length === 0 ? (
            <Card className="text-center py-12 rounded-2xl">
              <p className="text-muted-foreground text-lg mb-2">
                {searchTerm.trim() ? "No lists match your search." : "No lists yet"}
              </p>
              <p className="text-muted-foreground text-sm mb-4">
                {searchTerm.trim() ? "Try a different search." : "Tap + New list to create one."}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLists.map((list) => {
                const done = list.doneCount ?? 0;
                const total = list.itemCount ?? 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                <Card
                  key={list.id}
                  className="rounded-2xl shadow-sm border border-border p-5 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/lists/${list.id}`}
                      className="flex-1 min-w-0"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-lg leading-none flex-shrink-0">
                          {emojiForListName(list.name)}
                        </div>
                        <p className="font-semibold text-foreground truncate">{list.name}</p>
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">
                        {done}/{total} items
                      </p>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-2">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatUpdated(list.updatedAt)}
                      </p>
                    </Link>
                    <div className="relative flex-shrink-0" data-list-menu>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setMenuOpenId(menuOpenId === list.id ? null : list.id);
                      }}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="List actions"
                      disabled={!!deletingId}
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="6" r="1.5" />
                        <circle cx="12" cy="12" r="1.5" />
                        <circle cx="12" cy="18" r="1.5" />
                      </svg>
                    </button>
                    {menuOpenId === list.id && (
                      <div className="absolute right-0 top-full mt-1 py-1 rounded-lg border border-border bg-card shadow-md z-10 min-w-[120px]">
                        <button
                          type="button"
                          onClick={() => handleRename(list)}
                          className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                        >
                          Rename list
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(list)}
                          className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
                        >
                          Delete list
                        </button>
                      </div>
                    )}
                  </div>
                  </div>
                </Card>
              );
            })}
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
