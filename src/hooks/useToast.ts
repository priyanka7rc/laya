'use client';

import { useToastContext } from '@/context/ToastContext';

export function useToast() {
  const { addToast } = useToastContext();

  const toast = ({
    title,
    description,
    variant = 'info',
    duration = 3000,
  }: {
    title: string;
    description?: string;
    variant?: 'success' | 'error' | 'info';
    duration?: number;
  }) => {
    addToast({ title, description, variant, duration });
  };

  // Convenience methods
  toast.success = (title: string, description?: string) => {
    toast({ title, description, variant: 'success' });
  };

  toast.error = (title: string, description?: string) => {
    toast({ title, description, variant: 'error' });
  };

  toast.info = (title: string, description?: string) => {
    toast({ title, description, variant: 'info' });
  };

  return { toast };
}