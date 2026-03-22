import { test, expect } from '@playwright/test';
import { prepareApp, addMarker, confirmSwal } from './helpers.mjs';

test('导出 ICS 功能可用，下载内容包含日程事件', async ({ page }) => {
    // 使用 prepareApp 进行初始化，包含 mock 和等待加载
    await prepareApp(page);

    // 1. 添加一个标记点 (使用默认中心位置 0.5, 0.5)
    await addMarker(page);

    // 2. 编辑标记点详情：设置名称
    const markerTitle = '测试地点ICS';
    await page.fill('#markerNameInput', markerTitle);

    // 确保时间点存在（默认会添加当前时间），我们不做修改，直接使用
    // 关闭详情面板
    await page.click('#closeMarkerDetailBtn');

    // 3. 监听下载事件
    const downloadPromise = page.waitForEvent('download');

    // 4. 点击导出 -> 导出 ICS
    await page.click('#exportDropdownBtn');
    await expect(page.locator('#exportDropdownContent')).toBeVisible();
    await page.click('#exportIcsBtn');

    // 新增步骤：确认导出提示弹窗
    await confirmSwal(page);

    // 5. 等待下载完成
    const download = await downloadPromise;
    const suggestedFilename = download.suggestedFilename();
    expect(suggestedFilename).toContain('roadbook_');
    expect(suggestedFilename).toContain('.ics');

    // 6. 验证文件内容
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString('utf-8');

    // 检查 ICS 关键字段
    expect(content).toContain('BEGIN:VCALENDAR');
    expect(content).toContain('VERSION:2.0');
    expect(content).toContain('PRODID:-//RoadbookMaker//EN');
    expect(content).toContain('BEGIN:VEVENT');
    expect(content).toContain(`SUMMARY:${markerTitle}`);
    expect(content).toContain('END:VEVENT');
    expect(content).toContain('END:VCALENDAR');
});
