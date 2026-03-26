/**
 * Vitest shim: the real `server-only` package throws outside Next.js RSC.
 * Resolves `import "server-only"` during unit tests without touching app code.
 */
export {};
