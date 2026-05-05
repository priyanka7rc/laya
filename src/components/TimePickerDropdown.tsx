"use client";

import { useEffect, useRef, useState } from "react";

interface TimePickerDropdownProps {
  value: string; // HH:mm or ""
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}

function formatDisplay(hhmm: string): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${ampm}`;
}

const SLOTS: { label: string; value: string }[] = [
  { label: "6:00 AM", value: "06:00" },
  { label: "7:00 AM", value: "07:00" },
  { label: "8:00 AM", value: "08:00" },
  { label: "9:00 AM", value: "09:00" },
  { label: "10:00 AM", value: "10:00" },
  { label: "12:00 PM", value: "12:00" },
  { label: "1:00 PM", value: "13:00" },
  { label: "3:00 PM", value: "15:00" },
  { label: "5:00 PM", value: "17:00" },
  { label: "6:00 PM", value: "18:00" },
  { label: "8:00 PM", value: "20:00" },
  { label: "9:00 PM", value: "21:00" },
];

export function TimePickerDropdown({
  value,
  onChange,
  placeholder = "Pick a time",
  className = "",
  label,
}: TimePickerDropdownProps) {
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);

  const isSlot = SLOTS.some((s) => s.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCustomMode(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
    setCustomMode(false);
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
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
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
            aria-label="Clear time"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 right-0 w-56 bg-card border border-border rounded-xl shadow-lg py-2 animate-in fade-in slide-in-from-top-1 duration-100">
          {!customMode ? (
            <>
              <div className="px-2 grid grid-cols-3 gap-1 pb-2">
                {SLOTS.map((slot) => (
                  <button
                    key={slot.value}
                    type="button"
                    onClick={() => select(slot.value)}
                    className={`py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      value === slot.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-foreground hover:bg-primary/10 hover:border-primary hover:text-primary"
                    }`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
              <div className="h-px bg-border mx-2 mb-2" />
              <div className="px-2">
                <button
                  type="button"
                  onClick={() => {
                    setCustomMode(true);
                    setTimeout(() => nativeRef.current?.focus(), 50);
                  }}
                  className={`w-full py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    value && !isSlot
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-foreground hover:bg-primary/10 hover:border-primary hover:text-primary"
                  }`}
                >
                  {value && !isSlot ? formatDisplay(value) : "Custom time"}
                </button>
              </div>
            </>
          ) : (
            <div className="px-2 space-y-2">
              <input
                ref={nativeRef}
                type="time"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => { if (value) select(value); }}
                  className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  Set
                </button>
                <button
                  type="button"
                  onClick={() => setCustomMode(false)}
                  className="flex-1 py-1.5 rounded-lg border border-border text-foreground text-xs font-medium hover:bg-muted transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
