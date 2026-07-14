import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,unit.test}.ts', 'tests/**/*.test.ts'],
    // The WebUI suite opens many temporary files and loopback servers. Keep CI
    // below hosted-runner descriptor limits so static-file reads cannot fail
    // transiently with EMFILE/ENFILE while unrelated files run in parallel.
    maxWorkers: process.env.CI ? 2 : undefined,
    testTimeout: 10_000,
  },
});
