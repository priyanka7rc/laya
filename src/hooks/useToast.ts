'use client';

import { useToastContext, ToastAction } from '@/context/ToastContext';

export function useToast() {
  const { addToast } = useToastContext();

  const base = ({
    title,
    description,
    variant = 'info',
    duration = 3000,
    action,
  }: {
    title: string;
    description?: string;
    variant?: 'success' | 'error' | 'info';
    duration?: number;
    action?: ToastAction;
  }) => {
    addToast({ title, description, variant, duration, action });
  };

  // Convenience methods
  const success = (title: string, description?: string) => {
    base({ title, description, variant: 'success' });
  };

  const error = (title: string, description?: string) => {
    base({ title, description, variant: 'error' });
  };

  const info = (title: string, description?: string) => {
    base({ title, description, variant: 'info' });
  };

  const toast = Object.assign(base, { success, error, info });

  return { toast };
}