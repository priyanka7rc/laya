/**
 * Appearance preference (persisted) vs resolved light/dark (applied to <html>).
 */

export type Appearance = 'light' | 'dark' | 'system';

export type EffectiveTheme = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'laya-appearance';

const VALID: Appearance[] = ['light', 'dark', 'system'];

export function parseStoredAppearance(raw: string | null): Appearance {
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw;
  }
  return 'system';
}

export function getEffectiveTheme(
  appearance: Appearance,
  prefersDark: boolean
): EffectiveTheme {
  if (appearance === 'light') return 'light';
  if (appearance === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

/**
 * Applies exactly one of `light` or `dark` on document.documentElement.
 */
export function applyEffectiveThemeToDocument(effective: EffectiveTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(effective);
}

export function readStoredAppearance(): Appearance {
  if (typeof window === 'undefined') return 'system';
  try {
    return parseStoredAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function writeStoredAppearance(appearance: Appearance): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
  } catch {
    /* ignore quota / private mode */
  }
}

export function isAppearance(value: string): value is Appearance {
  return (VALID as string[]).includes(value);
}
