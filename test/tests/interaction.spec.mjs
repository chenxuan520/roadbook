import { test, expect } from '@playwright/test';
import { prepareApp, addMarker, confirmSwal } from './helpers.mjs';

test('点击地图上的标记点可打开编辑面板', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.5, 0.5);
  await page.fill('#markerNameInput', '点我编辑');
  await page.waitForFunction(() => window.app.currentMarker && window.app.currentMarker.title === '点我编辑');

  await page.click('#closeMarkerDetailBtn');
  await expect(page.locator('#markerDetailPanel')).toBeHidden();

  // 直接触发 Leaflet marker click（比像素点选更稳定）
  await page.evaluate(() => {
    const m = window.app.markers[0];
    m.marker.fire('click', { latlng: m.marker.getLatLng() });
  });

  await expect(page.locator('#markerDetailPanel')).toBeVisible();
  await expect(page.locator('#markerNameInput')).toHaveValue('点我编辑');
});

test('日程列表：展开日期分组后点击条目进入标记点详情', async ({ page }) => {
  await prepareApp(page);

  // 用固定时间创建，确保稳定生成日期分组
  await page.evaluate(() => {
    const m = window.app.createMarkerEntity(39.90923, 116.397428, '列表点击测试', null, null, '2026-01-01 08:00:00');
    window.app.markers.push(m);
    window.app.updateMarkerList();
  });

  const header = page.locator('.date-group-header').first();
  await expect(header).toBeVisible();

  // 默认收起，先点展开图标
  await header.locator('.expand-toggle').click();
  const itemInfo = page.locator('.marker-item .marker-info').first();
  await expect(itemInfo).toBeVisible();

  await itemInfo.click();
  await expect(page.locator('#markerDetailPanel')).toBeVisible();
  await expect(page.locator('#markerNameInput')).toHaveValue('列表点击测试');
});

test('时间点：点击“添加时间点”会新增一个时间点并更新到数据', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    const m = window.app.createMarkerEntity(39.90923, 116.397428, '时间点测试', null, null, '2026-01-01 08:00:00');
    window.app.markers.push(m);
    window.app.showMarkerDetail(m);
  });

  await expect(page.locator('#markerDetailPanel')).toBeVisible();
  await expect(page.locator('#dateTimesContainer input[type="datetime-local"]')).toHaveCount(1);

  await page.click('#addDateTimeBtn');
  await expect(page.locator('#dateTimesContainer input[type="datetime-local"]')).toHaveCount(2);

  const dateTimes = await page.evaluate(() => window.app.currentMarker.dateTimes);
  expect(dateTimes.length).toBe(2);
  // 规则：基于最后一个时间点 +1 天，并置为 00:00:00
  expect(dateTimes[1]).toBe('2026-01-02 00:00:00');
});

test('日期详情：点击日期标题进入筛选并可添加消费，侧边栏显示总花费', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    const m = window.app.createMarkerEntity(39.90923, 116.397428, '消费测试点', null, null, '2026-01-01 08:00:00');
    window.app.markers.push(m);
    window.app.updateMarkerList();
  });

  // 点击日期标题（不要点 expand-toggle），会进入筛选并打开日期详情
  await page.locator('.date-group-header h4').first().click();
  await expect(page.locator('#dateDetailPanel')).toBeVisible();
  await expect(page.locator('#dateDisplay')).toHaveText('2026-01-01');

  await page.fill('#expenseCostInput', '12.34');
  await page.fill('#expenseRemarkInput', '午餐');
  await page.click('#addExpenseBtn');

  await expect(page.locator('#dateExpensesList')).toContainText('午餐');
  await expect(page.locator('#totalExpensesContainer')).toBeVisible();
  await expect(page.locator('#totalExpensesAmount')).toHaveText(/12\.34/);
});

test('连接线：点击线段可打开连接线详情面板', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.45, 0.5);
  await addMarker(page, 0.55, 0.55);
  await page.click('#connectMarkersBtn');
  await page.click('#confirmConnect');
  await page.waitForFunction(() => window.app.connections.length === 1);

  // 先关掉面板，再验证“点击线段”能打开
  await page.click('#closeConnectionDetailBtn');
  await expect(page.locator('#connectionDetailPanel')).toBeHidden();

  await page.evaluate(() => {
    const c = window.app.connections[0];
    c.polyline.fire('click', { latlng: c.polyline.getLatLngs()[0] });
  });

  await expect(page.locator('#connectionDetailPanel')).toBeVisible();
});

test('拖拽移动：标记点位置变化会同步更新连接线坐标', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    const m1 = window.app.createMarkerEntity(39.90923, 116.397428, '拖拽点1', 1, null, '2026-01-01 08:00:00');
    const m2 = window.app.createMarkerEntity(39.91923, 116.407428, '拖拽点2', 2, null, '2026-01-01 09:00:00');
    window.app.markers.push(m1, m2);
    window.app.createConnection(m1, m2, null, '2026-01-01 08:30:00');
    window.app.updateMarkerList();
  });

  const before = await page.evaluate(() => {
    const c = window.app.connections[0];
    return c.polyline.getLatLngs().map(p => [p.lat, p.lng]);
  });

  await page.evaluate(() => {
    const m = window.app.markers[0];
    // 模拟拖拽：先 setLatLng，再触发 dragend
    m.marker.setLatLng([39.92923, 116.417428]);
    m.marker.fire('dragend', { target: m.marker });
  });

  const after = await page.evaluate(() => {
    const c = window.app.connections[0];
    return c.polyline.getLatLngs().map(p => [p.lat, p.lng]);
  });

  expect(after[0][0]).not.toBe(before[0][0]);
  expect(after[0][1]).not.toBe(before[0][1]);
});

test('地图源切换：选择框切换会更新 currentLayer，刷新后仍保持', async ({ page }) => {
  await prepareApp(page);

  await page.selectOption('#mapSourceSelect', 'osm');
  await expect.poll(async () => page.evaluate(() => window.app.currentLayer)).toBe('osm');

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.app);
  await expect.poll(async () => page.evaluate(() => window.app.currentLayer)).toBe('osm');
  await expect(page.locator('#mapSourceSelect')).toHaveValue('osm');
});

test('适配视窗：点击 🎯 会把地图中心拉回到标记点附近', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.5, 0.5);
  await page.evaluate(() => window.app.map.setView([0, 0], 2));

  await page.click('#fitViewBtn');
  // autoFitMapView/fitBounds 可能带动画，这里用 poll 等待中心点收敛
  await expect
    .poll(async () => {
      const [lat, lng] = await page.evaluate(() => {
        const center = window.app.map.getCenter();
        return [center.lat, center.lng];
      });
      return Math.abs(lat - 39.9) < 5 && Math.abs(lng - 116.4) < 5;
    })
    .toBe(true);
});

test('快捷键：D 删除当前选中标记点（带确认）', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.5, 0.5);
  await page.fill('#markerNameInput', '键盘删除');
  await page.waitForFunction(() => window.app.currentMarker && window.app.currentMarker.title === '键盘删除');

  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.press('D');
  await confirmSwal(page);

  await page.waitForFunction(() => window.app.markers.length === 0);
});
