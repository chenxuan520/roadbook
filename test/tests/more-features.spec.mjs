import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { prepareApp, addMarker, confirmSwal } from './helpers.mjs';

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
