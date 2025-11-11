# 🌓 Theme Toggle

Laya now supports both **Light** and **Dark** modes with a persistent toggle!

## Features

✅ **Floating toggle button** (top-right corner)  
✅ **Smooth transitions** between themes (300ms)  
✅ **Persists in localStorage** - remembers your choice  
✅ **System-wide** - applies to all pages  
✅ **Beautiful icons** - Sun ☀️ for light mode, Moon 🌙 for dark mode  

---

## Usage

1. **Look for the circular button** in the top-right corner of any page
2. **Click to toggle** between light and dark modes
3. **Your preference is saved** automatically

---

## Implementation Details

### Files Created/Modified:

**New Files:**
- `src/context/ThemeContext.tsx` - Theme state management
- `src/components/ThemeToggle.tsx` - Toggle button component

**Updated Files:**
- `src/app/layout.tsx` - Added ThemeProvider and ThemeToggle
- `src/components/ui/Card.tsx` - Light/dark theme support
- `src/components/ui/Button.tsx` - Secondary button theming
- `src/components/BottomNavigation.tsx` - Navigation theming
- All main pages (home, tasks, meals, activity) - Background and text colors

### How It Works:

1. **ThemeContext** manages the theme state (`'light'` or `'dark'`)
2. **localStorage** persists the user's choice
3. **`.dark` class** on `<html>` element triggers Tailwind's dark mode
4. **All components** use `dark:` prefix for dark mode styles

### Color Scheme:

**Light Mode:**
- Background: `bg-white`, `bg-gray-50`
- Text: `text-gray-900`
- Cards: `bg-white` with `border-gray-200`
- Gradients: Soft pastels (emerald, blue, orange, green)

**Dark Mode:**
- Background: `bg-black`, `bg-gray-900`
- Text: `text-white`, `text-gray-100`
- Cards: `bg-gray-900` with `border-gray-800`
- Gradients: Deep tones with `/10` opacity

---

## Customization

To add theme support to a new component:

```tsx
// Background
className="bg-white dark:bg-black"

// Text
className="text-gray-900 dark:text-white"

// Borders
className="border-gray-200 dark:border-gray-800"

// Transitions (smooth theme switching)
className="transition-colors duration-300"
```

---

## Browser Compatibility

- ✅ Chrome/Edge
- ✅ Firefox
- ✅ Safari
- ✅ Mobile browsers (iOS/Android)

---

## Notes

- Theme persists across page reloads
- Works with server-side rendering (SSR)
- No flash of wrong theme on page load
- Respects user's theme preference

