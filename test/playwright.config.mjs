import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

// 默认：本地复用系统 Chrome（不下载 Playwright 浏览器）；CI 用 Playwright 的 Chromium（由 setup:ci 显式安装）
const useSystemChrome = !isCI && process.env.USE_SYSTEM_CHROME !== '0';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: isCI ? 1 : undefined,
  expect: {
    timeout: 10_000
  },
  reporter: isCI
    ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173',
    headless: isCI,
    acceptDownloads: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  webServer: {
    command: 'node ./server.mjs',
    port: 4173,
    reuseExistingServer: !isCI
  },
  projects: [
    {
      name: useSystemChrome ? 'chrome' : 'chromium',
      use: {
        browserName: 'chromium',
        channel: useSystemChrome ? 'chrome' : undefined,
        viewport: { width: 1280, height: 720 }
      }
    }
  ]
});
