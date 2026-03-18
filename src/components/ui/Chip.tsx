'use client';

import { HTMLAttributes, forwardRef } from 'react';

export interface ChipProps extends HTMLAttributes<HTMLButtonElement> {
  variant?: 'filter' | 'category' | 'status';
  selected?: boolean;
  children: React.ReactNode;
}

const Chip = forwardRef<HTMLButtonElement, ChipProps>(
  ({ variant = 'filter', selected = false, className = '', children, ...props }, ref) => {
    const base = 'px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background tap-target';
    const variants = {
      filter: selected
        ? 'bg-primary text-primary-foreground'
        : 'bg-card text-foreground border border-border hover:bg-muted',
      category: 'bg-muted text-foreground border border-border',
      status: 'bg-warning/20 text-foreground border border-warning/40',
    };
    return (
      <button
        ref={ref}
        type="button"
        className={`${base} ${variants[variant]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Chip.displayName = 'Chip';

export { Chip };
