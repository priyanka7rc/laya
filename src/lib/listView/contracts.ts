export interface ListViewList {
  id: string;
  appUserId: string;
  name: string;
  source: string;
  createdAt: string;
  updatedAt: string;
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

