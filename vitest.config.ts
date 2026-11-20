import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // The client tests that touch localStorage / fetch will use jsdom when needed.
    // Individual tests can still use @vitest-environment comments.
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.js'],
  },
});
