'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  type Appearance,
  type EffectiveTheme,
  applyEffectiveThemeToDocument,
  getEffectiveTheme,
  readStoredAppearance,
  writeStoredAppearance,
} from '@/lib/theme/appearance';

export interface ThemeContextValue {
  /** User preference: explicit light/dark or follow OS */
  appearance: Appearance;
  /** Resolved theme applied to `<html>` */
  effectiveTheme: EffectiveTheme;
  setAppearance: (appearance: Appearance) => void;
  /** Cycles light → dark → system */
  cycleAppearance: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readInitialAppearance(): Appearance {
  if (typeof window === 'undefined') return 'system';
  return readStoredAppearance();
}

function readInitialPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(readInitialAppearance);
  const [prefersDark, setPrefersDark] = useState<boolean>(readInitialPrefersDark);

  const effectiveTheme = useMemo(
    () => getEffectiveTheme(appearance, prefersDark),
    [appearance, prefersDark]
  );

  useEffect(() => {
    writeStoredAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    applyEffectiveThemeToDocument(effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
  }, []);

  const cycleAppearance = useCallback(() => {
    setAppearanceState((prev) => {
      const order: Appearance[] = ['light', 'dark', 'system'];
      const i = order.indexOf(prev);
      return order[(i + 1) % order.length];
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      appearance,
      effectiveTheme,
      setAppearance,
      cycleAppearance,
    }),
    [appearance, effectiveTheme, setAppearance, cycleAppearance]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
