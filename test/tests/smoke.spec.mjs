import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { prepareApp, addMarker } from './helpers.mjs';

test('页面可打开并初始化 app', async ({ page }) => {
  await prepareApp(page);
  await expect.poll(async () => page.evaluate(() => !!window.app)).toBe(true);
});

test('可添加标记点，并可导出 JSON 后再导入恢复', async ({ page }) => {
  await prepareApp(page);

  const before = await page.evaluate(() => window.app.markers.length);
  await addMarker(page, 0.5, 0.5);

  // 导出 JSON（捕获下载）
  const downloadPromise = page.waitForEvent('download');
  await page.click('#exportDropdownBtn');
  await page.click('#exportBtn');
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();

  const exportedJson = await fs.readFile(downloadedPath, 'utf-8');
  const exported = JSON.parse(exportedJson);
  expect(Array.isArray(exported.markers)).toBe(true);
  expect(exported.markers.length).toBeGreaterThanOrEqual(before + 1);

  // 清空当前数据
  await page.evaluate(() => {
    window.app.clearAll();
    localStorage.removeItem('roadbookData');
  });
  await page.waitForFunction(() => window.app.markers.length === 0);

  // 通过隐藏 input 触发导入流程
  await page.setInputFiles('#importFile', {
    name: 'import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportedJson)
  });

  await page.waitForFunction((count) => window.app.markers.length === count, exported.markers.length);
});

