import { TaskViewResult } from '@/lib/taskView/contracts';

export interface WebTaskViewItem {
  id: string;
  title: string;
  status: string;
  dueLabel: string | null;
  category: string | null;
}

export interface WebTaskViewList {
  items: WebTaskViewItem[];
}

export function toWebTaskList(result: TaskViewResult): WebTaskViewList {
  const items: WebTaskViewItem[] = result.tasks.map((task) => {
    const dueLabel = task.dueAt
      ? new Date(task.dueAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    return {
      id: task.id,
      title: task.title,
      status: task.status,
      dueLabel,
      category: task.category,
    };
  });

  return { items };
}

