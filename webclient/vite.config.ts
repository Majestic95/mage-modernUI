import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    css: true,
    // Slice 62 — keep Playwright e2e specs out of the vitest run.
    // Playwright uses its own test() runtime (incompatible with
    // vitest); they live in ./e2e and are executed via `pnpm e2e`.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
