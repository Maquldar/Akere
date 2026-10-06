import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false, // one shared test database
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://akere:akere@localhost:5432/akere_test',
      SIGNING_MASTER_KEY: '0'.repeat(64),
      STORAGE_DRIVER: 'local',
      STORAGE_DIR: './data/test-files',
      DEMO_MODE: 'true',
      JOBS_ENABLED: 'false',
      LOG_LEVEL: 'silent',
    },
  },
});
