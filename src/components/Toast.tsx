"use client";

import { useEffect } from 'react';

interface ToastProps {
  message: string;
  onClose: () => void;
  duration?: number;
}

export default function Toast({ message, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] animate-slide-down">
      <div className="bg-success border border-success-border text-success-foreground px-6 py-4 rounded-xl shadow-md flex items-center gap-3 max-w-md">
        <span className="text-2xl">✨</span>
        <p className="font-medium">{message}</p>
        <button
          onClick={onClose}
          className="ml-2 opacity-70 hover:opacity-100 transition-opacity"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-5 h-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
