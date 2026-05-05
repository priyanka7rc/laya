'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import type { Appearance } from '@/lib/theme/appearance';

const OPTIONS: { value: Appearance; label: string; title: string }[] = [
  { value: 'light', label: 'Light', title: 'Use light theme' },
  { value: 'dark', label: 'Dark', title: 'Use dark theme' },
  { value: 'system', label: 'System', title: 'Match system appearance' },
];

export default function ThemeToggle() {
  const { appearance, setAppearance, effectiveTheme } = useTheme();
  // Suppress server/client mismatch: the inline <script> in layout.tsx applies the
  // correct theme class before React hydrates, so the visual is already correct.
  // We just need to keep the toggle itself from rendering mismatched HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  return (
    <div
      className="fixed z-[200] top-4 right-4 flex flex-col items-end gap-1 pointer-events-auto"
      role="group"
      aria-label="Appearance"
    >
      <div className="flex rounded-xl border border-border bg-card p-1 shadow-md">
        {OPTIONS.map((opt) => {
          const selected = appearance === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.title}
              aria-pressed={selected}
              onClick={() => setAppearance(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors tap-target ${
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {appearance === 'system' && (
        <span className="text-[10px] text-muted-foreground px-1" aria-live="polite">
          Using {effectiveTheme === 'dark' ? 'dark' : 'light'} (system)
        </span>
      )}
    </div>
  );
}
