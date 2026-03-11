export type TaskViewIdentity =
  | { kind: 'appUserId'; appUserId: string }
  | { kind: 'authUserId'; authUserId: string }
  | { kind: 'phone'; phoneE164: string };

export type TaskViewView =
  | 'all'
  | 'today'
  | 'upcoming'
  | 'inbox'
  | 'digest'
  | 'reminderWindow'
  | 'search';

export interface TaskViewFilters {
  status?: 'active' | 'completed';
  /** ISO date (YYYY-MM-DD) or special values like 'today' resolved by engine */
  date?: string;
  category?: string;
  term?: string;
}

export interface TaskViewPagination {
  /** Opaque cursor produced by previous call; null/undefined for first page */
  cursor?: string | null;
  /** Maximum number of tasks to return; engine enforces sane upper bound */
  limit?: number;
}

export interface TaskViewRequest {
  identity: TaskViewIdentity;
  view: TaskViewView;
  filters?: TaskViewFilters;
  pagination?: TaskViewPagination;
  /** Optional explicit base date/time for testing or jobs; defaults to now() */
  now?: Date;
  /** Optional IANA timezone identifier for local day boundaries (e.g. 'America/Los_Angeles') */
  timezone?: string;
}

export interface TaskViewTask {
  id: string;
  appUserId: string;
  title: string;
  status: string;
  dueAt: string | null;
  remindAt: string | null;
  category: string | null;
  parseConfidence: number | null;
  createdAt: string;
  /** Present when row has is_done; derived from status otherwise for UI parity. */
  is_done?: boolean;
  /** Legacy display; derived from dueAt when not on row (YYYY-MM-DD). */
  due_date?: string | null;
  /** Legacy display; derived from dueAt when not on row (HH:mm). */
  due_time?: string | null;
  /** Legacy alias for createdAt. */
  created_at?: string;
}

export interface TaskViewPageInfo {
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface TaskViewResult {
  tasks: TaskViewTask[];
  pageInfo: TaskViewPageInfo;
  /** When false, identity could not be resolved (e.g. no app_user for this auth/phone). */
  identityResolved?: boolean;
}

