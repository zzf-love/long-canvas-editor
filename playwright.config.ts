import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:7912', viewport: { width: 1440, height: 1000 }, acceptDownloads: true },
  webServer: {
    command: 'npm run serve',
    url: 'http://127.0.0.1:7912',
    env: { LONG_CANVAS_PORT: '7912', LONG_CANVAS_DATA_DIR: join(tmpdir(), `long-canvas-e2e-${process.pid}`) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
