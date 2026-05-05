'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import { FirstRunDemo } from '@/components/FirstRunDemo';
import { useAuth } from '@/components/AuthProvider';
import { Card, Button } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { getFirstRunDemoSeen, markFirstRunDemoSeen } from '@/lib/firstRunDemo';
import type { ListViewList, ListViewResult } from '@/lib/listView/contracts';
import { ImportListsModal } from '@/components/ImportListsModal';
import { CreateListModal } from '@/components/CreateListModal';
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

function formatCreated(createdAt: string): string {
  return 'Created ' + new Date(createdAt).toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric',
  });
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function ListsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [lists, setLists] = useState<ListViewList[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [togglingStarId, setTogglingStarId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'recent' | 'az' | 'za' | 'oldest' | 'newest'>('recent');
  const [demoReady, setDemoReady] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  const PAGE_LIMIT = 50;

  const filteredLists = (() => {
    let result = searchTerm.trim()
      ? lists.filter((l) => l.name.toLowerCase().includes(searchTerm.toLowerCase()))
      : [...lists];
    if (sortOrder === 'az')     result = result.sort((a, b) => a.name.localeCompare(b.name));
    if (sortOrder === 'za')     result = result.sort((a, b) => b.name.localeCompare(a.name));
    if (sortOrder === 'oldest') result = result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (sortOrder === 'newest') result = result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return result;
  })();

  // Top 3 most recently updated — shown only when not searching
  const recentLists = !searchTerm.trim() ? lists.slice(0, 3) : [];

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
    let mounted = true;
    if (authLoading || !user) return;
    void getFirstRunDemoSeen("lists").then((seen) => {
      if (!mounted) return;
      setShowDemo(!seen);
      setDemoReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [authLoading, user]);

  const dismissDemo = () => {
    setShowDemo(false);
    void markFirstRunDemoSeen("lists");
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (menuOpenId && !target.closest('[data-list-menu]')) {
        setMenuOpenId(null);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [menuOpenId]);

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

  const handleDeleteClick = (listId: string) => {
    setConfirmDeleteId(listId);
  };

  const handleToggleStar = async (list: ListViewList) => {
    setMenuOpenId(null);
    const newStarred = !list.isStarred;
    // Optimistic update
    setLists((prev) =>
      prev.map((l) => (l.id === list.id ? { ...l, isStarred: newStarred } : l))
    );
    setTogglingStarId(list.id);
    try {
      const token = await getToken();
      const res = await fetch(`/api/lists/${list.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ is_starred: newStarred }),
      });
      if (!res.ok) {
        // Revert on failure
        setLists((prev) =>
          prev.map((l) => (l.id === list.id ? { ...l, isStarred: list.isStarred } : l))
        );
        toast.error("Couldn't update list");
      }
    } catch {
      setLists((prev) =>
        prev.map((l) => (l.id === list.id ? { ...l, isStarred: list.isStarred } : l))
      );
      toast.error("Couldn't update list");
    } finally {
      setTogglingStarId(null);
    }
  };

  const starredLists = filteredLists.filter((l) => l.isStarred);
  const otherLists = filteredLists.filter((l) => !l.isStarred);

  const ListCard = ({ list, sectionKey }: { list: ListViewList; sectionKey: string }) => {
    const menuKey = `${sectionKey}:${list.id}`;
    const isMenuOpen = menuOpenId === menuKey;
    return (
      <Card
        key={list.id}
        className="rounded-xl border border-border px-3 py-2.5 hover:border-primary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {/* Compact emoji square */}
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-lg leading-none shrink-0">
            {emojiForListName(list.name)}
          </div>

          {/* Content */}
          <Link href={`/lists/${list.id}`} className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-foreground leading-tight truncate">{list.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatCreated(list.createdAt)}
              {(list.itemCount ?? 0) > 0 && (
                <span> · {list.itemCount} {list.itemCount === 1 ? 'item' : 'items'}</span>
              )}
            </p>
          </Link>

          {/* Meatball menu */}
          <div className="relative shrink-0" data-list-menu>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setConfirmDeleteId(null);
                setMenuOpenId(isMenuOpen ? null : menuKey);
              }}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="List actions"
              disabled={!!deletingId}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="6" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="18" r="1.5" />
              </svg>
            </button>
            {isMenuOpen && (
              <div className="absolute right-0 top-full mt-1 py-1 rounded-lg border border-border bg-card shadow-md z-10 min-w-[160px]">
                {confirmDeleteId === list.id ? (
                  /* Inline delete confirmation */
                  <div className="px-3 py-2">
                    <p className="text-xs text-foreground mb-2">Delete this list?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setConfirmDeleteId(null); setMenuOpenId(null); handleDelete(list); }}
                        disabled={deletingId === list.id}
                        className="flex-1 px-2 py-1 rounded text-xs font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="flex-1 px-2 py-1 rounded text-xs font-medium border border-border hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleToggleStar(list)}
                      disabled={togglingStarId === list.id}
                      className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted flex items-center gap-2"
                    >
                      <svg className={`w-4 h-4 shrink-0 ${list.isStarred ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                      </svg>
                      {list.isStarred ? 'Unstar' : 'Star'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRename(list)}
                      className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                    >
                      Rename list
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(list.id)}
                      className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-muted"
                    >
                      Delete list
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-background transition-colors pb-24 md:pb-8">
        <main className="container mx-auto px-4 py-8 md:py-12 max-w-3xl lg:max-w-6xl">
          {/* Header */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-3xl md:text-4xl font-semibold text-foreground">
                Lists
              </h1>
            <Button onClick={() => setNewListModalOpen(true)}>
              New list
            </Button>
          </div>

          {/* Search + Sort */}
          <div className="mb-6 flex gap-3 items-center">
            <div className="relative flex-1">
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
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'recent' | 'az' | 'za' | 'oldest' | 'newest')}
              className="md:hidden h-11 px-3 rounded-xl border border-border bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 shrink-0"
            >
              <option value="recent">Recent</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="az">A → Z</option>
              <option value="za">Z → A</option>
            </select>
          </div>

          <ImportListsModal
            isOpen={importModalOpen}
            onClose={() => setImportModalOpen(false)}
            onSuccess={() => fetchLists()}
            getToken={async () => getToken()}
            toast={toast}
          />

          <CreateListModal
            isOpen={newListModalOpen}
            onClose={() => setNewListModalOpen(false)}
            onSuccess={(listId) => { setNewListModalOpen(false); router.push(`/lists/${listId}`); }}
            toast={toast}
          />

          {/* Rename modal */}
          {renameListId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay">
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
                  maxLength={50}
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse px-3 py-2.5 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-muted shrink-0" />
                    <div className="flex-1">
                      <div className="h-4 bg-muted rounded w-3/4 mb-1.5" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : filteredLists.length === 0 ? (
            <Card className="text-center py-12 rounded-2xl">
              <p className="text-muted-foreground text-lg mb-2">
                {searchTerm.trim() ? "No lists match your search." : "No lists yet"}
              </p>
              <p className="text-muted-foreground text-sm mb-4">
                {searchTerm.trim() ? "Try a different search." : "Click New list to create one."}
              </p>
            </Card>
          ) : (
            <div className="space-y-8">
              {/* Recent section — top 3 by updatedAt, hidden during search */}
              {recentLists.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent</h2>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {recentLists.map((list) => <ListCard key={list.id} list={list} sectionKey="recent" />)}
                  </div>
                </div>
              )}

              {/* Starred section */}
              {starredLists.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Starred</h2>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {starredLists.map((list) => <ListCard key={list.id} list={list} sectionKey="starred" />)}
                  </div>
                </div>
              )}

              {/* All lists section */}
              <div>
                {starredLists.length > 0 && (
                  <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">All Lists</h2>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {otherLists.map((list) => <ListCard key={list.id} list={list} sectionKey="all" />)}
                </div>
              </div>
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
      <FirstRunDemo
        page="lists"
        isOpen={demoReady && showDemo}
        onComplete={dismissDemo}
        onSkip={dismissDemo}
      />
    </ProtectedRoute>
  );
}
