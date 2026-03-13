import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { prepareApp, addMarker, confirmSwal, maybeStartJSCoverage, maybeStopJSCoverage } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await maybeStartJSCoverage(page);
});

test.afterEach(async ({ page }, testInfo) => {
  await maybeStopJSCoverage(page, testInfo);
});

async function importRoadbookJson(page, data) {
  const json = JSON.stringify(data);
  await page.setInputFiles('#importFile', {
    name: 'import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json)
  });
  return json;
}

test('图标选择：自定义 emoji + 颜色可生效并写入 marker.icon', async ({ page }) => {
  await prepareApp(page);
  await addMarker(page, 0.5, 0.5);

  await page.click('#changeIconBtn');
  await expect(page.locator('#iconModal')).toBeVisible();

  await page.fill('#customIcon', '🎯');
  await page.fill('#iconColor', '#ff0000');
  await page.click('#confirmIcon');

  await expect(page.locator('#iconModal')).toBeHidden();
  await expect(page.locator('#currentIconPreview')).toHaveText('🎯');

  const icon = await page.evaluate(() => window.app.currentMarker.icon);
  expect(icon).toMatchObject({ type: 'custom', icon: '🎯' });
});

test('标注链接预览：输入 Markdown 链接后生成可点击预览', async ({ page }) => {
  await prepareApp(page);
  await addMarker(page, 0.5, 0.5);

  await page.fill('#markerLabelsInput', '[示例](https://example.com)');
  const link = page.locator('#markerLabelsLinks a').first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://example.com');
  await expect(link).toHaveText('示例');
});

test('扩大编辑弹窗：标记点备注可同步回原输入框与数据', async ({ page }) => {
  await prepareApp(page);
  await addMarker(page, 0.5, 0.5);

  await page.click('#expandMarkerLabelsBtn');
  await expect(page.locator('#expandModal')).toBeVisible();
  await page.fill('#expandModalTextarea', '[链接](https://example.com); 备注2');
  await page.click('.expand-modal-close');
  await expect(page.locator('#expandModal')).toBeHidden();

  await expect(page.locator('#markerLabelsInput')).toHaveValue('[链接](https://example.com); 备注2');
  const labels = await page.evaluate(() => window.app.currentMarker.labels);
  expect(labels).toEqual(['[链接](https://example.com)', '备注2']);
});

test('连接线详情编辑：修改耗时/标注/交通方式会写回 connection 并更新样式', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.45, 0.5);
  await addMarker(page, 0.55, 0.55);
  await page.click('#connectMarkersBtn');
  await page.click('#confirmConnect');
  await page.waitForFunction(() => window.app.connections.length === 1);
  await expect(page.locator('#connectionDetailPanel')).toBeVisible();

  await page.fill('#connectionDuration', '3.5');
  await page.fill('#connectionLabelsInput', '[导航](https://example.com)');

  // 切换交通方式（限定在连接线详情面板，避免与 connectModal 的按钮冲突）
  await page.locator('#connectionDetailPanel .transport-btn[data-transport="plane"]').click();

  const conn = await page.evaluate(() => {
    const c = window.app.connections[0];
    return {
      duration: c.duration,
      label: c.label,
      transportType: c.transportType,
      color: c.polyline && c.polyline.options && c.polyline.options.color
    };
  });

  expect(conn.duration).toBeCloseTo(3.5);
  expect(conn.label).toContain('https://example.com');
  expect(conn.transportType).toBe('plane');
  expect(typeof conn.color).toBe('string');
});

test('导出 TXT：选择“复制到剪贴板”会写入测试 clipboard', async ({ page }) => {
  await prepareApp(page);
  await addMarker(page, 0.5, 0.5);
  await page.fill('#markerNameInput', 'TXT 测试点');

  await page.click('#exportDropdownBtn');
  await page.click('#exportTxtBtn');

  // 选择“复制到剪贴板”（deny 按钮）
  await page.locator('.swal2-container .swal2-deny').click();

  await expect
    .poll(async () => page.evaluate(() => window.__clipboardText || ''))
    .toContain('行程安排');
});

test('导出 TXT：选择“导出文件”会触发下载', async ({ page }) => {
  await prepareApp(page);
  await addMarker(page, 0.5, 0.5);
  await page.fill('#markerNameInput', 'TXT 下载测试');

  const downloadPromise = page.waitForEvent('download');
  await page.click('#exportDropdownBtn');
  await page.click('#exportTxtBtn');
  await page.locator('.swal2-container .swal2-confirm').click();
  const download = await downloadPromise;

  const p = await download.path();
  expect(p).toBeTruthy();
  const txt = await fs.readFile(p, 'utf-8');
  expect(txt).toContain('行程安排');
  expect(txt).toContain('TXT 下载测试');
});

test('导入 HTML：导出 HTML 后再导入，能恢复标记点', async ({ page }) => {
  await prepareApp(page);
  await addMarker(page, 0.5, 0.5);
  await page.fill('#markerNameInput', 'HTML 导入测试点');
  await page.waitForFunction(() => window.app.currentMarker && window.app.currentMarker.title === 'HTML 导入测试点');

  const downloadPromise = page.waitForEvent('download');
  await page.click('#exportDropdownBtn');
  await page.click('#exportHtmlBtn');
  const download = await downloadPromise;
  const p = await download.path();
  expect(p).toBeTruthy();
  const html = await fs.readFile(p, 'utf-8');

  // 清空数据后导入 html
  await page.evaluate(() => {
    window.app.clearAll();
    localStorage.removeItem('roadbookData');
  });
  await page.waitForFunction(() => window.app.markers.length === 0);

  await page.setInputFiles('#importFile', {
    name: 'import.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html)
  });

  await page.waitForFunction(() => window.app.markers.length === 1);
  const title = await page.evaluate(() => window.app.markers[0].title);
  expect(title).toBe('HTML 导入测试点');
});

test('导入版本兼容提示：导入版本高于当前版本会显示“版本警告”', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    // 覆盖当前版本（用于稳定验证 compareVersions 分支）
    window.ROADBOOK_APP_VERSION = 'v0.0.10';
  });

  await importRoadbookJson(page, {
    version: 'v0.0.11',
    exportTime: new Date().toISOString(),
    currentLayer: 'osm',
    currentSearchMethod: 'nominatim',
    markers: [],
    connections: [],
    labels: [],
    dateNotes: {}
  });

  const swal = page.locator('.swal2-container');
  await expect(swal).toBeVisible();
  await expect(page.locator('.swal2-html-container')).toContainText('版本警告');
  await expect(page.locator('.swal2-html-container')).toContainText('v0.0.11');
  await expect(page.locator('.swal2-html-container')).toContainText('v0.0.10');
  await confirmSwal(page);
});

test('导入版本兼容提示：导入版本低于当前版本默认不展示“版本警告”', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    window.ROADBOOK_APP_VERSION = 'v0.0.10';
  });

  await importRoadbookJson(page, {
    version: 'v0.0.9-4-gb666551',
    exportTime: new Date().toISOString(),
    currentLayer: 'osm',
    currentSearchMethod: 'nominatim',
    markers: [],
    connections: [],
    labels: [],
    dateNotes: {}
  });

  const swal = page.locator('.swal2-container');
  await expect(swal).toBeVisible();
  await expect(page.locator('.swal2-html-container')).not.toContainText('版本警告');
  await confirmSwal(page);
});

test('连接线起点/终点改选：修改 connectionStartMarker/connectionEndMarker 会同步更新连接与本地缓存', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    const m1 = window.app.createMarkerEntity(39.90923, 116.397428, '点1', 101, null, '2026-01-01 08:00:00');
    const m2 = window.app.createMarkerEntity(39.91923, 116.407428, '点2', 102, null, '2026-01-01 09:00:00');
    const m3 = window.app.createMarkerEntity(39.92923, 116.417428, '点3', 103, null, '2026-01-01 10:00:00');
    window.app.markers.push(m1, m2, m3);
    window.app.createConnection(m1, m2, 'car', '2026-01-01 08:30:00');
    window.app.updateMarkerList();
    window.app.showConnectionDetail(window.app.connections[0]);
  });

  await expect(page.locator('#connectionDetailPanel')).toBeVisible();
  await expect(page.locator('#connectionStartMarker')).toBeVisible();
  await expect(page.locator('#connectionEndMarker')).toBeVisible();

  // 改为：点3 -> 点1（索引 2 -> 0）
  await page.selectOption('#connectionStartMarker', '2');
  await page.selectOption('#connectionEndMarker', '0');

  await expect
    .poll(async () => page.evaluate(() => ({
      startId: window.app.currentConnection?.startId,
      endId: window.app.currentConnection?.endId,
      startTitle: window.app.currentConnection?.startTitle,
      endTitle: window.app.currentConnection?.endTitle
    })))
    .toMatchObject({ startId: 103, endId: 101, startTitle: '点3', endTitle: '点1' });

  const visual = await page.evaluate(() => {
    const c = window.app.currentConnection;
    const latlngs = c.polyline.getLatLngs();
    return {
      latlngs: latlngs.map(p => [p.lat, p.lng]),
      color: c.polyline.options.color,
      iconHtml: c.iconMarker && c.iconMarker.options && c.iconMarker.options.icon && c.iconMarker.options.icon.options && c.iconMarker.options.icon.options.html
    };
  });

  expect(visual.latlngs[0][0]).toBeCloseTo(39.92923);
  expect(visual.latlngs[0][1]).toBeCloseTo(116.417428);
  expect(visual.latlngs[1][0]).toBeCloseTo(39.90923);
  expect(visual.latlngs[1][1]).toBeCloseTo(116.397428);
  expect(typeof visual.color).toBe('string');
  expect(String(visual.iconHtml || '')).toContain('border');

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('roadbookData') || '{}'));
  expect(saved.connections[0]).toMatchObject({ startId: 103, endId: 101, startTitle: '点3', endTitle: '点1' });
});

test('筛选模式下便签链接点击：点击 dateNotesSticky 内链接不应触发退出筛选模式', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    const m = window.app.createMarkerEntity(39.90923, 116.397428, '便签链接测试', 201, null, '2026-01-01 08:00:00');
    window.app.markers.push(m);
    window.app.dateNotes = window.app.dateNotes || {};
    window.app.dateNotes['2026-01-01'] = '看一下：[链接](https://example.com)';
    window.app.updateMarkerList();
  });

  await page.locator('.date-group-header h4').first().click();
  await expect(page.locator('#dateNotesSticky')).toBeVisible();

  await expect.poll(async () => page.evaluate(() => ({ filterMode: window.app.filterMode, filteredDate: window.app.filteredDate })))
    .toMatchObject({ filterMode: true, filteredDate: '2026-01-01' });

  const link = page.locator('#dateNotesContent a').first();
  await expect(link).toBeVisible();

  const popupPromise = page.waitForEvent('popup').catch(() => null);
  await link.click();
  const popup = await popupPromise;
  if (popup) await popup.close();

  await expect.poll(async () => page.evaluate(() => ({ filterMode: window.app.filterMode, filteredDate: window.app.filteredDate })))
    .toMatchObject({ filterMode: true, filteredDate: '2026-01-01' });
  await expect(page.locator('#dateNotesSticky')).toBeVisible();
});

test('搜索临时点行为：选择 Photon 结果会创建 searchMarker；点击聚焦；3 秒后自动关闭 popup', async ({ page }) => {
  await prepareApp(page);

  await page.selectOption('#searchMethodSelect', 'photon');
  await page.fill('#searchInput', '天安门');
  await page.keyboard.press('Enter');

  await expect(page.locator('#searchResults')).toBeVisible();
  await page.locator('#resultsList li').first().click();

  await expect.poll(async () => page.evaluate(() => !!window.app.searchMarker)).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.app.searchMarker && window.app.searchMarker.isPopupOpen && window.app.searchMarker.isPopupOpen())).toBe(true);

  // 先把视图移走，再点临时点应能回到结果位置（zoom=15）
  await page.evaluate(() => {
    window.app.map.setView([0, 0], 2);
    window.app.searchMarker.fire('click', { latlng: window.app.searchMarker.getLatLng() });
  });
  await expect.poll(async () => page.evaluate(() => window.app.map.getZoom())).toBe(15);

  // 3 秒后自动关闭 popup
  await page.waitForTimeout(3200);
  await expect.poll(async () => page.evaluate(() => window.app.searchMarker && window.app.searchMarker.isPopupOpen && window.app.searchMarker.isPopupOpen())).toBe(false);
});

test('日期范围筛选：应用后会保存 lastDateRange 到 localStorage', async ({ page }) => {
  await prepareApp(page);

  // 构造两个不同日期的点
  await page.evaluate(() => {
    const m1 = window.app.createMarkerEntity(39.90923, 116.397428, '1号点', 1, null, '2026-01-01 08:00:00');
    const m2 = window.app.createMarkerEntity(39.91923, 116.407428, '2号点', 2, null, '2026-01-10 08:00:00');
    window.app.markers.push(m1, m2);
    window.app.updateMarkerList();
  });

  // 直接调用 API 打开日期范围选择器（比 hover 1s 更稳定）
  await page.evaluate(() => {
    const picker = document.getElementById('dateRangePicker');
    picker.style.display = 'flex';
  });

  await page.fill('#startDate', '2026-01-01');
  await page.fill('#endDate', '2026-01-05');
  await page.click('#applyDateRangeFilter');

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('roadbookData') || '{}').lastDateRange);
  expect(saved).toMatchObject({ start: '2026-01-01', end: '2026-01-05' });
});

test('筛选模式：ESC 可退出筛选模式并隐藏日期详情', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    const m = window.app.createMarkerEntity(39.90923, 116.397428, '筛选退出测试', 1, null, '2026-01-01 08:00:00');
    window.app.markers.push(m);
    window.app.updateMarkerList();
  });

  // 点击日期标题进入筛选并打开日期详情
  await page.locator('.date-group-header h4').first().click();
  await expect(page.locator('#dateDetailPanel')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#dateDetailPanel')).toBeHidden();
});

test('快捷键：ESC 可退出添加标记点模式', async ({ page }) => {
  await prepareApp(page);
  await page.keyboard.press('A');
  await expect.poll(async () => page.evaluate(() => window.app.currentMode)).toBe('addMarker');
  await page.keyboard.press('Escape');
  await expect.poll(async () => page.evaluate(() => window.app.currentMode)).toBe('view');
});

test('小红书链接：标记点详情打开后链接会包含标题关键词', async ({ page }) => {
  await prepareApp(page);
  await addMarker(page, 0.5, 0.5);
  await page.fill('#markerNameInput', '小红书测试');
  await page.waitForFunction(() => window.app.currentMarker && window.app.currentMarker.title === '小红书测试');

  // 链接更新逻辑依赖 showMarkerDetail 时重算，这里通过关闭再打开来覆盖该行为
  await page.click('#closeMarkerDetailBtn');
  await page.evaluate(() => {
    const m = window.app.markers[0];
    window.app.showMarkerDetail(m);
  });
  await expect(page.locator('#markerDetailPanel')).toBeVisible();

  const href = await page.getAttribute('#xiaohongshuMarkerLink', 'href');
  expect(href).toContain(encodeURIComponent('小红书测试'));
});

test('导出下拉菜单：点击页面其它区域会自动关闭', async ({ page }) => {
  await prepareApp(page);

  await page.click('#exportDropdownBtn');
  await expect(page.locator('#exportDropdownContent')).toHaveClass(/show/);

  await page.click('#mapContainer');
  await expect(page.locator('#exportDropdownContent')).not.toHaveClass(/show/);
});

test('连接线删除快捷键：选中连接线后按 Delete 删除（带确认）', async ({ page }) => {
  await prepareApp(page);

  await addMarker(page, 0.45, 0.5);
  await addMarker(page, 0.55, 0.55);
  await page.click('#connectMarkersBtn');
  await page.click('#confirmConnect');
  await page.waitForFunction(() => window.app.connections.length === 1);
  await expect(page.locator('#connectionDetailPanel')).toBeVisible();

  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.press('Delete');
  await confirmSwal(page);
  await page.waitForFunction(() => window.app.connections.length === 0);
});

test('compareVersions：支持语义化版本 + 偏移量比较', async ({ page }) => {
  await prepareApp(page);

  const results = await page.evaluate(() => {
    const fn = window.app.compareVersions.bind(window.app);
    return {
      major: fn('v2.0.0', 'v1.9.9'),
      minor: fn('v1.2.0', 'v1.1.9'),
      patch: fn('v1.2.4', 'v1.2.3'),
      offsetNewer: fn('v0.0.9-4-gb666551', 'v0.0.9-3-gb666551'),
      equal: fn('v0.0.1', 'v0.0.1'),
      invalid: fn('not-a-version', 'v0.0.1')
    };
  });

  expect(results.major).toBe(1);
  expect(results.minor).toBe(1);
  expect(results.patch).toBe(1);
  expect(results.offsetNewer).toBe(1);
  expect(results.equal).toBe(0);
  expect(results.invalid).toBe(0);
});

test('搜索结果下拉框：点击页面其它区域会自动隐藏', async ({ page }) => {
  await prepareApp(page);

  await page.selectOption('#searchMethodSelect', 'photon');
  await page.fill('#searchInput', '天安门');
  await page.keyboard.press('Enter');
  await expect(page.locator('#searchResults')).toBeVisible();

  await page.click('#mapContainer');
  await expect(page.locator('#searchResults')).toBeHidden();
});

test('日期消费：删除一条消费会更新列表与总花费', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    const m = window.app.createMarkerEntity(39.90923, 116.397428, '消费删除测试', 301, null, '2026-01-01 08:00:00');
    window.app.markers.push(m);
    window.app.updateMarkerList();
  });

  await page.locator('.date-group-header h4').first().click();
  await expect(page.locator('#dateDetailPanel')).toBeVisible();

  await page.fill('#expenseCostInput', '10');
  await page.fill('#expenseRemarkInput', '早餐');
  await page.click('#addExpenseBtn');
  await expect(page.locator('#dateExpensesList .delete-expense-btn')).toHaveCount(1);
  await expect(page.locator('#totalExpensesAmount')).toHaveText(/10/);

  await page.locator('#dateExpensesList .delete-expense-btn').first().click();
  await expect(page.locator('#dateExpensesList')).toContainText('暂无消费记录');

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('roadbookData') || '{}').dateNotes);
  expect(saved['2026-01-01']).toBeTruthy();
  expect(Array.isArray(saved['2026-01-01'].expenses)).toBe(true);
  expect(saved['2026-01-01'].expenses.length).toBe(0);
});

test('日期消费：双击编辑后可保存，Enter 可快捷提交', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    const m = window.app.createMarkerEntity(39.90923, 116.397428, '消费编辑测试', 302, null, '2026-01-01 08:00:00');
    window.app.markers.push(m);
    window.app.updateMarkerList();
  });

  await page.locator('.date-group-header h4').first().click();
  await expect(page.locator('#dateDetailPanel')).toBeVisible();

  await page.fill('#expenseCostInput', '12.34');
  await page.fill('#expenseRemarkInput', '午餐');
  await page.click('#addExpenseBtn');
  await expect(page.locator('#dateExpensesList li')).toHaveCount(1);
  await expect(page.locator('#totalExpensesAmount')).toHaveText(/12\.34/);

  const li = page.locator('#dateExpensesList li').first();
  await li.dblclick();
  await expect(li.locator('.expense-edit-form')).toBeVisible();

  await li.locator('input.edit-cost').fill('20');
  await li.locator('input.edit-remark').fill('午餐+饮料');
  await li.locator('input.edit-remark').press('Enter');

  await expect(page.locator('#totalExpensesAmount')).toHaveText(/20/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('roadbookData') || '{}').dateNotes['2026-01-01']);
  expect(saved.expenses[0]).toMatchObject({ cost: 20, remark: '午餐+饮料' });
});

test('Logo 预览：标记点带 logo 时鼠标悬浮会显示预览', async ({ page }) => {
  await prepareApp(page);

  // 用本地静态资源，确保 onload 在 handler 绑定后触发（避免 data: 过快导致丢 onload）
  const logoUrl = '/static/favicon.png';

  await page.evaluate((logo) => {
    const m = window.app.createMarkerEntity(39.90923, 116.397428, 'logo点', 401, null, '2026-01-01 08:00:00');
    m.logo = logo;
    window.app.markers.push(m);
    window.app.updateMarkerList();
  }, logoUrl);

  await page.evaluate(() => {
    const m = window.app.markers[0];
    m.marker.fire('mouseover', {
      latlng: m.marker.getLatLng(),
      originalEvent: { clientX: 120, clientY: 120 }
    });
  });

  await expect(page.locator('#logoPreview')).toBeVisible();
  await expect(page.locator('#logoPreviewImg')).toHaveAttribute('src', /\/static\/favicon\.png$/);
});

test('批量框选：右键拖拽框选标记点会弹出“批量操作”，确认后可批量删除', async ({ page }) => {
  await prepareApp(page);

  await page.evaluate(() => {
    // 两个点放在地图中心附近，保证被框选到
    const m1 = window.app.createMarkerEntity(39.90923, 116.397428, '框选1', 501, null, '2026-01-01 08:00:00');
    const m2 = window.app.createMarkerEntity(39.9095, 116.3978, '框选2', 502, null, '2026-01-01 08:10:00');
    // 一个点放远一点
    const m3 = window.app.createMarkerEntity(0, 0, '不该被选中', 503, null, '2026-01-01 09:00:00');
    window.app.markers.push(m1, m2, m3);
    window.app.updateMarkerList();
    window.app.map.setView([39.90923, 116.397428], 14);
  });

  // 右键拖拽在地图中间画一个矩形
  const box = await page.locator('#mapContainer').boundingBox();
  expect(box).toBeTruthy();
  const start = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.45 };
  const end = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.55 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(end.x, end.y);
  await page.mouse.up({ button: 'right' });

  await expect(page.locator('.swal2-container')).toBeVisible();
  await expect(page.locator('.swal2-title')).toHaveText('批量操作');
  // 第一次确认：进入批量删除流程
  await page.locator('.swal2-container .swal2-confirm').click();
  // 第二次确认：删除确认弹窗
  await expect(page.locator('.swal2-title')).toHaveText('删除确认');
  await page.locator('.swal2-container .swal2-confirm').click();

  await expect.poll(async () => page.evaluate(() => window.app.markers.length)).toBe(1);
  const remainingTitle = await page.evaluate(() => window.app.markers[0].title);
  expect(remainingTitle).toBe('不该被选中');
});

test('在线模式：切换到 online 且无 token 时会弹出登录框，关闭后回到 offline', async ({ page }) => {
  await prepareApp(page);

  await expect(page.locator('#modeSelector')).toBeVisible();
  await page.selectOption('#modeSelector', 'online');
  await expect(page.locator('#loginModal')).toBeVisible();

  await page.click('#closeLoginModal');
  await expect(page.locator('#loginModal')).toBeHidden();
  await expect(page.locator('#modeSelector')).toHaveValue('offline');
});

test('在线模式：登录成功后会保存 token 并显示云端按钮与计划管理', async ({ page }) => {
  await prepareApp(page);

  // mock 在线模式接口（注意：前端在 localhost/127.0.0.1 会默认请求 127.0.0.1:5436）
  await page.route('**/api/v1/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ token: 'dummy.token.value' })
    });
  });
  await page.route('**/api/v1/plans', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ plans: [] })
    });
  });

  await page.selectOption('#modeSelector', 'online');
  await expect(page.locator('#loginModal')).toBeVisible();
  await page.fill('#loginUsername', 'u');
  await page.fill('#loginPassword', 'p');
  await page.click('#loginForm .login-btn');

  await expect.poll(async () => page.evaluate(() => localStorage.getItem('online_token'))).toBe('dummy.token.value');
  await expect(page.locator('#cloudSaveBtn')).toBeVisible();
  await expect(page.locator('#cloudSettingsBtn')).toBeVisible();
  await expect(page.locator('#cloudLogoutBtn')).toBeVisible();
  await expect(page.locator('#planManager')).toBeVisible();
});
