import { test, expect } from '@playwright/test';
import { prepareApp, maybeStartJSCoverage, maybeStopJSCoverage } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await maybeStartJSCoverage(page);
});

test.afterEach(async ({ page }, testInfo) => {
  await maybeStopJSCoverage(page, testInfo);
});

test('默认不开启调试模式：不显示调试按钮', async ({ page }) => {
  await prepareApp(page);
  await expect(page.locator('#debugBtn')).toBeHidden();
});

test('开启调试模式：显示调试按钮，并可打开/关闭调试信息弹窗', async ({ page }) => {
  await prepareApp(page, { entryPath: '/static/index.html?debug=true' });

  const debugBtn = page.locator('#debugBtn');
  await expect(debugBtn).toBeVisible();

  await debugBtn.click();
  await expect(page.locator('#debugInfoModal')).toBeVisible();
  await expect(page.getByText('🔧 调试信息')).toBeVisible();

  // 通过弹窗的关闭按钮关闭（弹窗会遮住 debugBtn，无法直接再点 debugBtn）
  await page.click('#debugInfoModal .debug-modal-close');
  await expect(page.locator('#debugInfoModal')).toHaveCount(0);
});

test('调试信息弹窗：包含分组并支持展开/折叠', async ({ page }) => {
  await prepareApp(page, { entryPath: '/static/index.html?debug=true' });

  await page.click('#debugBtn');
  await expect(page.locator('#debugInfoModal')).toBeVisible();

  const localStorageGroup = page.locator('#debugGroupsContainer [data-group="localStorage"]');
  await expect(localStorageGroup).toBeVisible();

  const header = localStorageGroup.locator('.debug-group-header');
  const content = localStorageGroup.locator('.debug-group-content');

  await expect(content).not.toHaveClass(/\bexpanded\b/);
  await header.click();
  await expect(content).toHaveClass(/\bexpanded\b/);
  await header.click();
  await expect(content).not.toHaveClass(/\bexpanded\b/);
});
