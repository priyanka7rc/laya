export interface ListViewList {
  id: string;
  appUserId: string;
  name: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  /** Item count (non-deleted). Optional for backward compat. */
  itemCount?: number;
  /** Completed item count. Optional for backward compat. */
  doneCount?: number;
}

export interface ListViewPageInfo {
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface ListViewRequest {
  appUserId: string;
  cursor?: string | null;
  limit?: number;
}

export interface ListViewResult {
  lists: ListViewList[];
  pageInfo: ListViewPageInfo;
}

