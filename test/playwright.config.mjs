import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

// 默认：本地复用系统 Chrome（不下载 Playwright 浏览器）；CI 用 Playwright 的 Chromium（由 setup:ci 显式安装）
const useSystemChrome = !isCI && process.env.USE_SYSTEM_CHROME !== '0';

// 端口/基址可经环境变量覆盖，避免本地默认端口被其它服务占用时 reuseExistingServer 复用到错误服务
const port = Number(process.env.E2E_PORT || 4173);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

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
    baseURL,
    headless: isCI,
    acceptDownloads: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  webServer: {
    command: 'node ./server.mjs',
    url: baseURL,
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
