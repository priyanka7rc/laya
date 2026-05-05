"use client";

import { useEffect, useRef, useState } from "react";

interface DatePickerDropdownProps {
  value: string; // YYYY-MM-DD or ""
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}

function toYMD(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatDisplay(ymd: string): string {
  if (!ymd) return "";
  const [year, month, day] = ymd.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

export function DatePickerDropdown({
  value,
  onChange,
  placeholder = "Pick a date",
  className = "",
  label,
}: DatePickerDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getWeekend = () => {
    const d = new Date(today);
    const day = d.getDay();
    const daysUntilSat = (6 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSat);
    return toYMD(d);
  };

  const getNextWeek = () => {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    return toYMD(d);
  };

  const CHIPS = [
    { label: "Today", value: toYMD(today) },
    {
      label: "Tomorrow",
      value: (() => {
        const d = new Date(today);
        d.setDate(d.getDate() + 1);
        return toYMD(d);
      })(),
    },
    { label: "This weekend", value: getWeekend() },
    { label: "Next week", value: getNextWeek() },
  ];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const displayText = value ? formatDisplay(value) : "";

  return (
    <div ref={ref} className={`relative ${className}`}>
      {label && (
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
          displayText ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <svg
          className="w-4 h-4 text-muted-foreground shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="flex-1 text-left truncate">
          {displayText || placeholder}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onChange("");
              }
            }}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
            aria-label="Clear date"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 w-full min-w-[220px] bg-card border border-border rounded-xl shadow-lg py-2 animate-in fade-in slide-in-from-top-1 duration-100">
          {/* Relative chips */}
          <div className="px-2 pb-2 flex flex-wrap gap-1.5">
            {CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => select(chip.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  value === chip.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-foreground hover:bg-primary/10 hover:border-primary hover:text-primary"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <div className="h-px bg-border mx-2 mb-2" />

          {/* Native date input styled to match */}
          <div className="px-2">
            <input
              ref={nativeRef}
              type="date"
              value={value}
              onChange={(e) => select(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
}
