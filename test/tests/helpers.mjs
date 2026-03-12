import { expect } from '@playwright/test';

function looksLikeMapTile(url) {
  // 各地图源的瓦片 URL 不统一，这里用一些通用特征来识别：
  // 1) /{z}/{x}/{y}.(png|jpg|jpeg|webp)
  // 2) /tile/{z}/{y}/{x}
  // 3) query 中包含 z/x/y
  const pathname = url.pathname || '';
  const search = url.search || '';

  if (/\/tile\//i.test(pathname)) return true;
  if (/\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)(\?.*)?$/i.test(pathname)) return true;
  if (/(^|[?&])z=\d+(&|$)/i.test(search) && /(^|[?&])x=\d+(&|$)/i.test(search) && /(^|[?&])y=\d+(&|$)/i.test(search)) return true;
  return false;
}

export async function prepareApp(page) {
  // 0) 避免 geolocation 弹窗/超时影响测试
  await page.addInitScript(() => {
    try {
      const geolocation = {
        getCurrentPosition: (success, error) => {
          // 直接走失败分支，让应用使用默认位置（北京）
          if (typeof error === 'function') {
            error({ code: 1, message: 'E2E: geolocation disabled' });
          }
        },
        watchPosition: () => 0,
        clearWatch: () => {}
      };

      Object.defineProperty(navigator, 'geolocation', {
        value: geolocation,
        configurable: true
      });
    } catch {
      // ignore
    }
  });

  // 0.5) 让 clipboard 在测试环境可控（用于“复制到剪贴板”类功能）
  await page.addInitScript(() => {
    try {
      if (!navigator.clipboard) {
        Object.defineProperty(navigator, 'clipboard', {
          value: {},
          configurable: true
        });
      }
      navigator.clipboard.writeText = async (text) => {
        window.__clipboardText = String(text);
      };
    } catch {
      // ignore
    }
  });

  // 1) mock 外部搜索（不依赖后端）
  await page.route(/https:\/\/nominatim\.openstreetmap\.org\/search\?.*/i, async (route) => {
    const body = JSON.stringify([
      {
        display_name: '测试地点 A',
        lat: '39.90923',
        lon: '116.397428',
        type: 'test'
      }
    ]);
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body });
  });

  await page.route(/https:\/\/photon\.komoot\.io\/api\/.*/i, async (route) => {
    const body = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [116.397428, 39.90923] },
          properties: { name: '测试地点 A', country: 'CN', city: '北京' }
        }
      ]
    });
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body });
  });

  // 2) 屏蔽所有地图瓦片（覆盖所有地图源，不限定某一家）
  await page.route('**/*', async (route) => {
    const req = route.request();
    try {
      const url = new URL(req.url());
      const isLocal = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
      if (!isLocal && req.resourceType() === 'image' && looksLikeMapTile(url)) {
        await route.abort();
        return;
      }
    } catch {
      // ignore
    }
    await route.continue();
  });

  // 3) 打开页面并等待初始化完成
  const resp = await page.goto('/static/index.html', { waitUntil: 'load' });
  if (!resp || !resp.ok()) {
    const status = resp ? resp.status() : 'no-response';
    throw new Error(`Failed to load app page, status=${status}`);
  }

  await page.waitForSelector('#mapContainer', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => window.app && window.app.map && Array.isArray(window.app.markers));
}

export async function getMapBox(page) {
  const box = await page.locator('#mapContainer').boundingBox();
  expect(box).toBeTruthy();
  return box;
}

export async function clickMap(page, xRatio = 0.5, yRatio = 0.5) {
  const box = await getMapBox(page);
  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
}

export async function addMarker(page, xRatio = 0.5, yRatio = 0.5) {
  const before = await page.evaluate(() => window.app.markers.length);
  await page.click('#addMarkerBtn');
  await clickMap(page, xRatio, yRatio);
  await page.waitForFunction((n) => window.app.markers.length === n + 1, before);
  await expect(page.locator('#markerDetailPanel')).toBeVisible();
}

export async function confirmSwal(page) {
  const btn = page.locator('.swal2-container .swal2-confirm');
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
}
