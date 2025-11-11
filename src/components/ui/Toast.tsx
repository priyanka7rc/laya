'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToastContext, Toast as ToastType } from '@/context/ToastContext';

export function ToastViewport() {
  const { toasts, removeToast } = useToastContext();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render anything on server or before mount
  if (!mounted) return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2rem)] md:max-w-md">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>,
    document.body
  );
}

function ToastItem({ toast, onClose }: { toast: ToastType; onClose: () => void }) {
  useEffect(() => {
    // Ensure cleanup if component unmounts
    return () => {};
  }, []);

  const variantStyles = {
    success: 'bg-green-900/90 border-green-700 text-green-100',
    error: 'bg-red-900/90 border-red-700 text-red-100',
    info: 'bg-blue-900/90 border-blue-700 text-blue-100',
  };

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
  };

  return (
    <div
      className={`
        pointer-events-auto
        min-w-[280px] md:min-w-[320px]
        rounded-lg border backdrop-blur-sm
        p-4 shadow-lg
        animate-slide-in-right
        ${variantStyles[toast.variant || 'info']}
      `}
      role="alert"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">
          {icons[toast.variant || 'info']}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm md:text-base leading-tight">
            {toast.title}
          </p>
          {toast.description && (
            <p className="text-xs md:text-sm opacity-90 mt-1 leading-snug">
              {toast.description}
            </p>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity p-1 -mr-1 -mt-1"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </div>
  );
}