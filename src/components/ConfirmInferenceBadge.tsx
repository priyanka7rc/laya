'use client';

interface ConfirmInferenceBadgeProps {
  inferred_date: boolean;
  inferred_time: boolean;
  taskId: string;
  onConfirmed: (taskId: string) => void;
}

export function ConfirmInferenceBadge({
  inferred_date,
  inferred_time,
  taskId,
  onConfirmed,
}: ConfirmInferenceBadgeProps) {
  if (!inferred_date && !inferred_time) return null;

  const label =
    inferred_date && inferred_time
      ? 'Confirm schedule'
      : inferred_time
        ? 'Confirm time'
        : 'Confirm date';

  const handleClick = () => {
    onConfirmed(taskId);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center justify-center gap-1 min-h-[32px] px-2.5 py-1.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700/50 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
      aria-label="Confirm inferred schedule"
    >
      {label}
    </button>
  );
}
