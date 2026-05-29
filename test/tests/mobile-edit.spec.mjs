import { test, expect } from '@playwright/test';
import { prepareApp, confirmSwal } from './helpers.mjs';

// 移动端视口（<=768，与 CSS @media 及 isMobileDevice() 对齐，触发底部抽屉态）
test.use({ viewport: { width: 390, height: 740 } });

test.describe('移动端轻量编辑', () => {
  test('点击标记弹出只读气泡，并可删除标记点', async ({ page }) => {
    await prepareApp(page);

    // 直接通过 API 在当前地图中心加一个标记点（移动端禁用地图点击加点，故不走 UI 点击）
    await page.evaluate(() => window.app.addMarker(window.app.map.getCenter()));
    await page.waitForFunction(() => window.app.markers.length === 1);

    // 关闭加点后弹出的详情抽屉，露出地图上的标记
    await page.locator('#closeMarkerDetailBtn').click();
    await expect(page.locator('#markerDetailPanel')).toBeHidden();

    // 点击地图标记 → 移动端弹出只读气泡（含删除入口）。
    // 用 leaflet 事件触发（与项目其它用例一致，比对 divIcon 派发 DOM 点击更可靠）
    await page.evaluate(() => {
      const m = window.app.markers[0];
      m.marker.fire('click', { latlng: m.marker.getLatLng() });
    });
    const delBtn = page.locator('.popup-delete-marker');
    await expect(delBtn).toBeVisible();

    // 删除并确认 → 标记被移除
    await delBtn.click();
    await confirmSwal(page);
    await page.waitForFunction(() => window.app.markers.length === 0);
  });

  test('日期详情以底部抽屉呈现，可编辑备注/花销并通过遮罩关闭', async ({ page }) => {
    await prepareApp(page);

    // 移动端已支持轻量编辑，标题不再标注“只读模式”
    await expect(page.locator('#mainTitle')).not.toContainText('只读模式');

    const date = '2030-01-01';
    await page.evaluate((d) => window.app.showDateDetail(d), date);

    // 底部抽屉态：面板可见 + 遮罩激活 + 背景滚动锁
    await expect(page.locator('#dateDetailPanel')).toBeVisible();
    await expect(page.locator('#mobileSheetOverlay')).toHaveClass(/active/);
    await expect(page.locator('body')).toHaveClass(/sheet-open/);

    // 轻量编辑：日期备注（实时保存到 dateNotes）
    await page.fill('#dateNotesInput', '移动端备注测试');
    await expect
      .poll(() => page.evaluate((d) => window.app.getDateNotes(d), date))
      .toBe('移动端备注测试');

    // 轻量编辑：记一笔花销
    await page.fill('#expenseCostInput', '128');
    await page.fill('#expenseRemarkInput', '午餐');
    await page.click('#addExpenseBtn');
    await expect
      .poll(() => page.evaluate((d) => window.app.getDateExpenses(d).length, date))
      .toBe(1);

    // 点击遮罩（顶部空白处，避开底部抽屉）关闭
    await page.locator('#mobileSheetOverlay').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#dateDetailPanel')).toBeHidden();
    await expect(page.locator('#mobileSheetOverlay')).not.toHaveClass(/active/);
  });
});
