import { defineConfig } from 'vitest/config';

// Security-rules tests; run inside `firebase emulators:exec` (npm run test:rules).
export default defineConfig({
  test: { include: ['tests/rules/**/*.test.ts'], testTimeout: 20_000, fileParallelism: false },
});
