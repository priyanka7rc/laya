# UI Component Kit

A minimal, mobile-first UI kit for Laya built with Tailwind CSS.

## Components

### Button

Primary and secondary button variants with loading states and accessibility features.

```tsx
import { Button } from '@/components/ui/Button';

// Primary button (default)
<Button onClick={handleClick}>
  Save Task
</Button>

// Secondary button
<Button variant="secondary" onClick={handleCancel}>
  Cancel
</Button>

// Loading state
<Button loading={isLoading} disabled={isLoading}>
  {isLoading ? 'Saving...' : 'Save'}
</Button>

// With custom className
<Button className="w-full" onClick={handleSubmit}>
  Submit
</Button>
```

**Props:**
- `variant?: 'primary' | 'secondary'` - Button style (default: 'primary')
- `loading?: boolean` - Shows spinner and disables button
- `disabled?: boolean` - Disables the button
- `className?: string` - Additional Tailwind classes
- All standard button HTML attributes

**Features:**
- ✅ 44px tap target (h-11)
- ✅ Large rounded corners (rounded-2xl)
- ✅ Focus-visible ring for accessibility
- ✅ Loading spinner with aria-busy
- ✅ Disabled state styling

---

### Card

Simple container with consistent styling.

```tsx
import { Card } from '@/components/ui/Card';

<Card>
  <h3 className="font-semibold text-white mb-2">Task Title</h3>
  <p className="text-gray-400">Task description goes here</p>
</Card>

// With custom className
<Card className="hover:border-blue-500 cursor-pointer">
  <p>Clickable card</p>
</Card>
```

**Props:**
- `children: React.ReactNode` - Card content
- `className?: string` - Additional Tailwind classes
- All standard div HTML attributes

**Features:**
- ✅ Rounded corners (rounded-2xl)
- ✅ Border and shadow for depth
- ✅ Dark theme compatible (gray-900 bg)
- ✅ Consistent padding (p-4)

---

### Toast

Global toast notification system with variants.

```tsx
import { useToast } from '@/hooks/useToast';

function MyComponent() {
  const { toast } = useToast();

  const handleSuccess = () => {
    toast({
      title: 'Task added!',
      description: 'Your task has been saved.',
      variant: 'success',
    });
  };

  const handleError = () => {
    toast({
      title: 'Error',
      description: 'Could not save task.',
      variant: 'error',
      duration: 5000, // Custom duration
    });
  };

  // Convenience methods
  toast.success('Done!', 'Task completed');
  toast.error('Failed', 'Please try again');
  toast.info('Note', 'This is informational');

  return <Button onClick={handleSuccess}>Show Toast</Button>;
}
```

**Props:**
- `title: string` - Toast title (required)
- `description?: string` - Optional description text
- `variant?: 'success' | 'error' | 'info'` - Toast style (default: 'info')
- `duration?: number` - Auto-dismiss time in ms (default: 3000)

**Features:**
- ✅ Global portal rendering
- ✅ Auto-dismiss with timer
- ✅ Queue management
- ✅ Success/error/info variants
- ✅ Slide-in animation
- ✅ Mobile-optimized positioning

---

## Importing Components

```tsx
// Individual imports
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/hooks/useToast';

// Or use barrel export
import { Button, Card, ToastViewport } from '@/components/ui';
```

---

## Full Example

```tsx
'use client';

import { useState } from 'react';
import { Button, Card } from '@/components/ui';
import { useToast } from '@/hooks/useToast';

export default function ExamplePage() {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success('Success!', 'Data saved successfully');
    } catch (error) {
      toast.error('Error', 'Failed to save data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <Card>
        <h2 className="text-xl font-bold text-white mb-4">
          Example Form
        </h2>
        <p className="text-gray-400 mb-4">
          This is a card with some content.
        </p>
        <div className="flex gap-2">
          <Button 
            variant="primary" 
            loading={loading}
            onClick={handleSubmit}
          >
            Save
          </Button>
          <Button variant="secondary">
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
```

---

## Design Tokens

All components follow these design principles:

- **Mobile-first**: Optimized for touch interfaces
- **Dark theme**: Gray/black color palette
- **Large tap targets**: Minimum 44px height (iOS HIG)
- **Rounded corners**: Consistent 16px (rounded-2xl)
- **Accessibility**: ARIA labels, focus-visible rings, keyboard navigation
- **No external deps**: Pure Tailwind CSS

