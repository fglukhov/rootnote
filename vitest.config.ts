import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const dirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    workspace: [
      {
        extends: true,
        test: {
          environment: 'node',
          include: ['__tests__/**/*.test.ts'],
        },
      },
    ],
  },
});
