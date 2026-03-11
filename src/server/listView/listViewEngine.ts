import { ListViewRequest, ListViewResult } from '@/lib/listView/contracts';
import { queryAllLists } from './listViewQueries';

export async function executeListView(req: ListViewRequest): Promise<ListViewResult> {
  const limit = req.limit ?? 50;
  return queryAllLists(req.appUserId, req.cursor, limit);
}

