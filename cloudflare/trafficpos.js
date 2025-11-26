/**
 * Cloudflare Worker: Traffic Position Locator (Airport & Train Station)
 *
 * 功能：
 * 1. 输入经纬度，返回最近的机场（IATA三字码）和高铁站（中文名）。
 * 2. 使用 Cloudflare KV 存储 GitHub 数据，极速响应。
 * 3. 支持手动 URL 触发更新或 Cron 定时自动更新。
 */

const DATA_SOURCES = {
  // 机场数据源 (JSON) - 用户自定义源
  airports: "https://github.com/chenxuan520/gh-action-shell/releases/download/v0.0.1/airports.json",
  // 高铁站数据源 (JSON) - 用户自定义源
  stations: "https://github.com/chenxuan520/gh-action-shell/releases/download/v0.0.1/station_geo.json"
};

// KV 存储键名
const KEY_AIRPORTS = "airports_data";
const KEY_STATIONS = "stations_data";

export default {
  async fetch(request, env, _ctx) {
    // 1. 安全检查：确保 KV 已绑定
    if (!env.GEO_KV) {
      return new Response("配置错误: 未绑定 KV Namespace，请在后台 Settings -> Variables 中绑定变量名为 'GEO_KV'。", { status: 500 });
    }

    const url = new URL(request.url);

    // 2.【后门模式】强制更新数据
    // 访问: https://你的域名/?action=force_update
    if (url.searchParams.get('action') === 'force_update') {
      try {
        await updateAllData(env.GEO_KV);
        return new Response("✅ 数据已从 GitHub 下载并成功更新至 KV 存储！", {
          headers: { 'content-type': 'text/plain; charset=utf-8' }
        });
      } catch (e) {
        return new Response("❌ 更新失败: " + e.message, { status: 500 });
      }
    }

    // 3.【查询模式】正常用户请求
    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));

    if (isNaN(lat) || isNaN(lon)) {
      return new Response(JSON.stringify({ error: "请提供有效的 'lat' 和 'lon' 参数" }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    // 从 KV 读取数据 (并行读取，极速)
    let [airportsData, stationsData] = await Promise.all([
      env.GEO_KV.get(KEY_AIRPORTS, { type: "json" }),
      env.GEO_KV.get(KEY_STATIONS, { type: "json" })
    ]);

    // 兜底逻辑：如果 KV 是空的（刚部署完还没初始化），临时下载一次
    if (!airportsData || !stationsData) {
      console.log("KV 为空，执行紧急下载...");
      const freshData = await updateAllData(env.GEO_KV);
      airportsData = freshData.airports;
      stationsData = freshData.stations;
    }

    // 计算最近点
    const nearestAirport = findNearestAirport(lat, lon, airportsData);
    const nearestStation = findNearestStation(lat, lon, stationsData);

    // 返回结果
    return new Response(JSON.stringify({
      input: { lat, lon },
      nearest_airport: nearestAirport,
      nearest_station: nearestStation
    }, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  },

  // 定时任务入口 (Cron Triggers)
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(updateAllData(env.GEO_KV));
  }
};

// --- 核心工具函数 ---

// 下载并写入 KV
async function updateAllData(kv) {
  console.log("正在从 GitHub 下载数据...");

  // 添加 User-Agent 头，防止 GitHub 拒绝请求
  const fetchOptions = {
    headers: {
      'User-Agent': 'Cloudflare-Worker-GeoLocator'
    }
  };

  const [airportsResp, stationsResp] = await Promise.all([
    fetch(DATA_SOURCES.airports, fetchOptions),
    fetch(DATA_SOURCES.stations, fetchOptions)
  ]);

  if (!airportsResp.ok) {
    throw new Error(`Airports data fetch failed: ${airportsResp.status} ${airportsResp.statusText}`);
  }
  if (!stationsResp.ok) {
    throw new Error(`Stations data fetch failed: ${stationsResp.status} ${stationsResp.statusText}`);
  }

  const airportsData = await airportsResp.json();
  const stationsData = await stationsResp.json();

  // 写入 KV
  await Promise.all([
    kv.put(KEY_AIRPORTS, JSON.stringify(airportsData)),
    kv.put(KEY_STATIONS, JSON.stringify(stationsData))
  ]);

  return { airports: airportsData, stations: stationsData };
}

// 查找最近机场
function findNearestAirport(targetLat, targetLon, data) {
  let minDist = Infinity; let nearest = null;
  for (const icao in data) {
    const d = data[icao];
    // 你的数据源里可能包含 iata, lat, lon 等字段，请确保字段名匹配
    if (!d.lat || !d.lon || !d.iata) continue;
    const dist = getDistanceFromLatLonInKm(targetLat, targetLon, d.lat, d.lon);
    if (dist < minDist) {
      minDist = dist;
      nearest = { code: d.iata, name: d.name, dist_km: parseFloat(dist.toFixed(2)) };
    }
  }
  return nearest;
}

// 查找最近高铁站
function findNearestStation(targetLat, targetLon, data) {
  let minDist = Infinity; let nearest = null;
  for (const [name, coords] of Object.entries(data)) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    // 源数据格式 [lon, lat]
    const dist = getDistanceFromLatLonInKm(targetLat, targetLon, coords[1], coords[0]);
    if (dist < minDist) {
      minDist = dist;
      nearest = { name: name, dist_km: parseFloat(dist.toFixed(2)) };
    }
  }
  return nearest;
}

// Haversine 距离公式
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; const dLat = deg2rad(lat2 - lat1); const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function deg2rad(deg) { return deg * (Math.PI / 180); }
