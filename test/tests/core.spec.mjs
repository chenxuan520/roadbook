import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { prepareApp, addMarker, confirmSwal, maybeStartJSCoverage, maybeStopJSCoverage } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await maybeStartJSCoverage(page);
});

test.afterEach(async ({ page }, testInfo) => {
  await maybeStopJSCoverage(page, testInfo);
});

test('页面禁用浏览器缩放，避免和地图缩放冲突', async ({ page }) => {
  await prepareApp(page);

  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /maximum-scale=1\.0, user-scalable=no/
  );

  const wheelPrevented = await page.locator('#addMarkerBtn').evaluate((el) => {
    const event = new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: 120,
      bubbles: true,
      cancelable: true
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(wheelPrevented).toBe(true);

  const keydownPrevented = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: '+',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(keydownPrevented).toBe(true);
});

test('主题切换可用，并能在刷新后保持', async ({ page }) => {
  await prepareApp(page);

  await page.click('#themeToggleBtn');
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('roadbook-theme'))).toBe('dark');

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.app);
  await expect(page.locator('body')).toHaveClass(/dark-mode/);
});

test('添加标记点后可编辑名称，Ctrl+Z 可撤销添加', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.45, 0.5);
  await page.fill('#markerNameInput', '测试标记点 1');
  await page.waitForFunction(() => window.app.currentMarker && window.app.currentMarker.title === '测试标记点 1');

  await expect.poll(async () => page.evaluate(() => window.app.markers.length)).toBe(1);

  // 撤销：确保焦点不在输入框上；并保证触发小写 z
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => window.app.markers.length === 0);
});

test('删除标记点需要确认弹窗，并可成功删除', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.52, 0.52);
  await expect.poll(async () => page.evaluate(() => window.app.markers.length)).toBe(1);

  await page.click('#deleteMarkerBtn');
  await confirmSwal(page);
  await page.waitForFunction(() => window.app.markers.length === 0);
});

test('清除缓存：需要确认弹窗，并会清空本地数据', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.48, 0.52);
  await expect.poll(async () => page.evaluate(() => window.app.markers.length)).toBe(1);

  await page.click('#clearCacheBtn');
  await confirmSwal(page);

  await page.waitForFunction(() => window.app.markers.length === 0);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('roadbookData'))).toBe(null);
});

test('连接两个标记点：创建连接线并可删除', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.45, 0.5);
  await addMarker(page, 0.55, 0.55);
  await expect.poll(async () => page.evaluate(() => window.app.markers.length)).toBe(2);

  await page.click('#connectMarkersBtn');
  await expect(page.locator('#connectModal')).toBeVisible();
  await page.click('#confirmConnect');
  await page.waitForFunction(() => window.app.connections.length === 1);
  await expect(page.locator('#connectionDetailPanel')).toBeVisible();

  await page.click('#deleteConnectionBtn');
  await confirmSwal(page);
  await page.waitForFunction(() => window.app.connections.length === 0);
});

test('搜索（Nominatim）不依赖后端：可出结果并可选中落点', async ({ page }) => {
  await prepareApp(page);

  await page.selectOption('#searchMethodSelect', 'nominatim');
  await page.fill('#searchInput', '天安门');
  await page.keyboard.press('Enter');

  await expect(page.locator('#searchResults')).toBeVisible();
  const first = page.locator('#resultsList li').first();
  await expect(first).toBeVisible();
  await first.click();

  await page.waitForFunction(() => !!window.app.searchMarker);
});

test('导出 HTML 可用（不依赖后端），下载内容包含路书数据', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.5, 0.5);
  await page.fill('#markerNameInput', 'HTML 导出测试点');
  await page.waitForFunction(() => window.app.currentMarker && window.app.currentMarker.title === 'HTML 导出测试点');

  const downloadPromise = page.waitForEvent('download');
  await page.click('#exportDropdownBtn');
  await page.click('#exportHtmlBtn');
  const download = await downloadPromise;
  const p = await download.path();
  expect(p).toBeTruthy();

  const html = await fs.readFile(p, 'utf-8');
  expect(html).toContain('<!DOCTYPE html>');
  expect(html).toContain('const roadbookData');
  expect(html).toContain(encodeURIComponent('HTML 导出测试点'));
});

test('帮助与快捷键：H 打开帮助，/ 聚焦搜索框', async ({ page }) => {
  await prepareApp(page);

  await page.keyboard.press('H');
  await expect(page.locator('#helpModal')).toBeVisible();

  await page.click('#closeHelp');
  await expect(page.locator('#helpModal')).toBeHidden();

  await page.keyboard.press('/');
  await expect(page.locator('#searchInput')).toBeFocused();
});

test('新手引导：首次打开会自动弹出，可跳过', async ({ page }) => {
  // 确保“首次打开”判定成立（help_tour.js 加载时 localStorage 为空）
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  await prepareApp(page, { skipHelpTour: false });

  const overlay = page.locator('#rb-help-tour-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.rb-tour-title')).toContainText('欢迎');

  // 点击“跳过”
  await overlay.locator('[data-action="skip"]').click();
  await expect(overlay).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('roadbook_help_tour_v1'))).toBe('skipped');
});

test('新手引导：help=false 不弹出；help=true 强制弹出', async ({ page }) => {
  // help=false：即使 localStorage 为空也不弹
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });
  await prepareApp(page, { entryPath: '/static/index.html?help=false', skipHelpTour: false });
  await page.waitForFunction(() => !!window.app);
  await page.waitForTimeout(800);
  await expect(page.locator('#rb-help-tour-overlay')).toHaveCount(0);

  // help=true：即使 localStorage 里已有设置也强制弹
  await page.addInitScript(() => {
    try {
      localStorage.setItem('roadbook-theme', 'dark');
    } catch {
      // ignore
    }
  });
  await prepareApp(page, { entryPath: '/static/index.html?help=true', skipHelpTour: false });
  await expect(page.locator('#rb-help-tour-overlay')).toBeVisible();
});
