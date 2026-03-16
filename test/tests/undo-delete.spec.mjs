import { test, expect } from '@playwright/test';
import { prepareApp, addMarker, confirmSwal, getMapBox, maybeStartJSCoverage, maybeStopJSCoverage } from './helpers.mjs';

async function pressUndo(page, times = 1) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  for (let i = 0; i < times; i++) {
    await page.keyboard.down('Control');
    await page.keyboard.press('z');
    await page.keyboard.up('Control');
  }
}

test.beforeEach(async ({ page }) => {
  await maybeStartJSCoverage(page);
});

test.afterEach(async ({ page }, testInfo) => {
  await maybeStopJSCoverage(page, testInfo);
});

test('撤销删除连接线：删除后 Ctrl+Z 可恢复', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.45, 0.5);
  await addMarker(page, 0.55, 0.55);

  await page.click('#connectMarkersBtn');
  await expect(page.locator('#connectModal')).toBeVisible();
  await page.click('#confirmConnect');
  await page.waitForFunction(() => window.app.connections.length === 1);
  await expect(page.locator('#connectionDetailPanel')).toBeVisible();

  await page.click('#deleteConnectionBtn');
  await confirmSwal(page);
  await page.waitForFunction(() => window.app.connections.length === 0);

  await pressUndo(page, 1);
  await page.waitForFunction(() => window.app.connections.length === 1);
});

test('撤销删除标记点（连带删除连接线）：删除点后 Ctrl+Z 可恢复点与线', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.45, 0.5);
  await addMarker(page, 0.55, 0.55);
  await expect.poll(async () => page.evaluate(() => window.app.markers.length)).toBe(2);

  await page.click('#connectMarkersBtn');
  await page.click('#confirmConnect');
  await page.waitForFunction(() => window.app.connections.length === 1);

  // 选中第一个点并删除（确保走“删除点”逻辑，而不是批量）
  await page.evaluate(() => {
    const m = window.app.markers[0];
    m.marker.fire('click', { latlng: m.marker.getLatLng() });
  });
  await expect(page.locator('#markerDetailPanel')).toBeVisible();

  await page.click('#deleteMarkerBtn');
  await confirmSwal(page);
  await page.waitForFunction(() => window.app.markers.length === 1);
  await page.waitForFunction(() => window.app.connections.length === 0);

  await pressUndo(page, 1);
  await page.waitForFunction(() => window.app.markers.length === 2);
  await page.waitForFunction(() => window.app.connections.length === 1);
});

test('撤销框选批量删除：删除 2 个点后连续 Ctrl+Z 可恢复 2 个点与连接线', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.45, 0.5);
  await addMarker(page, 0.55, 0.55);
  await page.click('#connectMarkersBtn');
  await page.click('#confirmConnect');
  await page.waitForFunction(() => window.app.connections.length === 1);

  const box = await getMapBox(page);
  const x1 = box.x + box.width * 0.42;
  const y1 = box.y + box.height * 0.46;
  const x2 = box.x + box.width * 0.58;
  const y2 = box.y + box.height * 0.60;

  // 右键拖拽框选（空白处起拖即可进入框选模式）
  await page.mouse.move(x1, y1);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x2, y2);
  await page.mouse.up({ button: 'right' });

  // 批量操作弹窗：先点“删除”，再确认
  await confirmSwal(page);
  await confirmSwal(page);

  await page.waitForFunction(() => window.app.markers.length === 0);
  await page.waitForFunction(() => window.app.connections.length === 0);

  // 两次撤销：恢复 2 个点，第二次撤销会触发延迟恢复的连接线
  await pressUndo(page, 2);
  await page.waitForFunction(() => window.app.markers.length === 2);
  await page.waitForFunction(() => window.app.connections.length === 1);
});

