/**
 * Cloudflare Worker: Geo Locator (Preload/Cron Version)
 * 核心思路：通过后台 Cron 任务预加载数据到 KV，用户请求直接读取 KV。
 */

const DATA_SOURCES = {
  airports: "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json",
  stations: "https://raw.githubusercontent.com/epcm/TrainVis/refs/heads/master/data_acquisition_and_processing/data/station_geo.json"
};

// KV 键名常量
const KEY_AIRPORTS = "airports_data";
const KEY_STATIONS = "stations_data";

export default {
  /**
   * 1. HTTP 请求处理 (面向用户)
   * 逻辑：优先读 KV -> 极速返回。只有 KV 为空时的紧急情况才去下载。
   */
  async fetch(request, env, _ctx) {
    if (!env.GEO_KV) return new Response("Error: KV Binding 'GEO_KV' missing", { status: 500 });

    const url = new URL(request.url);
    
    // 如果你是一个强迫症，想手动触发更新，可以保留这个秘密后门
    // 访问: https://你的域名/?action=force_update
    if (url.searchParams.get('action') === 'force_update') {
      await updateAllData(env.GEO_KV);
      return new Response("Data Force Updated Successfully!");
    }

    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));

    if (isNaN(lat) || isNaN(lon)) {
      return new Response(JSON.stringify({ error: "Provide 'lat' and 'lon'" }), { status: 400 });
    }

    // 从 KV 并行读取
    let [airportsData, stationsData] = await Promise.all([
      env.GEO_KV.get(KEY_AIRPORTS, { type: "json" }),
      env.GEO_KV.get(KEY_STATIONS, { type: "json" })
    ]);

    // 【兜底逻辑】万一 KV 是空的（刚部署完还没预加载），为了不报错，临时下载一次
    // 但正常情况下不会走到这里
    if (!airportsData || !stationsData) {
      console.log("KV empty, performing emergency fetch...");
      const freshData = await updateAllData(env.GEO_KV);
      airportsData = freshData.airports;
      stationsData = freshData.stations;
    }

    // 计算逻辑
    const nearestAirport = findNearestAirport(lat, lon, airportsData);
    const nearestStation = findNearestStation(lat, lon, stationsData);

    return new Response(JSON.stringify({
      input: { lat, lon },
      nearest_airport: nearestAirport,
      nearest_station: nearestStation
    }, null, 2), {
      headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  },

  /**
   * 2. Scheduled 定时任务 (面向后台维护)
   * 逻辑：定期（或手动）去 GitHub 下载数据并刷新 KV。
   * 这是实现“预加载”的关键。
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(updateAllData(env.GEO_KV));
  }
};

// --- 核心：数据更新函数 ---

async function updateAllData(kv) {
  console.log("Starting data update...");
  
  // 并行下载
  const [airportsResp, stationsResp] = await Promise.all([
    fetch(DATA_SOURCES.airports),
    fetch(DATA_SOURCES.stations)
  ]);

  if (!airportsResp.ok || !stationsResp.ok) {
    throw new Error("Failed to fetch data from GitHub");
  }

  const airportsData = await airportsResp.json();
  const stationsData = await stationsResp.json();

  // 写入 KV (不设置过期时间，或者设置很长，依靠 Cron 定期覆盖)
  // 这样数据永远存在，不会突然过期
  await Promise.all([
    kv.put(KEY_AIRPORTS, JSON.stringify(airportsData)),
    kv.put(KEY_STATIONS, JSON.stringify(stationsData))
  ]);

  console.log("Data updated successfully in KV.");
  
  return { airports: airportsData, stations: stationsData };
}

// --- 计算工具函数 (保持不变) ---
function findNearestAirport(targetLat, targetLon, data) {
  let minDist = Infinity; let nearest = null;
  for (const icao in data) {
    const d = data[icao];
    if (!d.lat || !d.lon || !d.iata) continue;
    const dist = getDistanceFromLatLonInKm(targetLat, targetLon, d.lat, d.lon);
    if (dist < minDist) { minDist = dist; nearest = { code: d.iata, name: d.name, dist: parseFloat(dist.toFixed(2)) }; }
  }
  return nearest;
}
function findNearestStation(targetLat, targetLon, data) {
  let minDist = Infinity; let nearest = null;
  for (const [name, coords] of Object.entries(data)) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const dist = getDistanceFromLatLonInKm(targetLat, targetLon, coords[1], coords[0]);
    if (dist < minDist) { minDist = dist; nearest = { name: name, dist: parseFloat(dist.toFixed(2)) }; }
  }
  return nearest;
}
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; const dLat = deg2rad(lat2 - lat1); const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function deg2rad(deg) { return deg * (Math.PI / 180); }
