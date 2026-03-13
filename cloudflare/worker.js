/**
 * Roadbook Backend on Cloudflare Worker
 *
 * Provides full backend functionality matching the Go implementation.
 *
 * Setup:
 * 1. Create a KV Namespace and bind it as `ROADBOOK_KV`.
 * 2. Set environment variables (optional, defaults provided in CONFIG):
 *    - JWT_SECRET
 *    - USERS_JSON (JSON string of users map, optional override)
 *    - GAODE_KEY (for Gaode search)
 *    - TIAN_KEY (for Tianditu search)
 */

// --- Configuration ---
const CONFIG = {
  JWT_SECRET: "changeme-to-a-secure-random-string-please",
  // Default Users Configuration (matches Go backend structure)
  // Password is "password", Salt is "2d133fd795f2dd1e5815ca4db70d779d"
  // echo -n "2d133fd795f2dd1e5815ca4db70d779d" | shasum -a 256
  USERS: {
    "admin": {
      "salt": "2d133fd795f2dd1e5815ca4db70d779d",
      "hash": "560179c13d7f5a5b179040648fb1845b29ea014edbf9f23dfe62d6acf7c8d686"
    }
  },
  // Tianditu Token (default from Go backend)
  TIAN_KEY: "75f0434f240669f4a2df6359275146d2",
  // Gaode Key (leave empty to require env var, or set here)
  GAODE_KEY: "",
  // Whether login is required for Gaode search (default false)
  GAODE_LOGIN_REQUIRED: false,
  // AI Config
  AI_ENABLED: false,
  AI_BASE_URL: "https://api.openai.com/v1",
  AI_KEY: "",
  AI_MODEL: "gpt-3.5-turbo",
};

// --- Global Cache (Warm Start) ---
let cachedAirports = null;
let cachedStations = null;

// --- Main Worker Logic ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // 1. Environment Variables & Config Merge
    const jwtSecret = env.JWT_SECRET || CONFIG.JWT_SECRET;
    const gaodeKey = env.GAODE_KEY || CONFIG.GAODE_KEY;
    const tianKey = env.TIAN_KEY || CONFIG.TIAN_KEY;
    const gaodeLoginRequired = env.GAODE_LOGIN_REQUIRED === "true" || CONFIG.GAODE_LOGIN_REQUIRED;

    // AI Config
    const aiEnabled = (env.AI_ENABLED === "true" || CONFIG.AI_ENABLED) && !!(env.AI_KEY || CONFIG.AI_KEY);
    const aiBaseUrl = (env.AI_BASE_URL || CONFIG.AI_BASE_URL).replace(/\/$/, ""); // Remove trailing slash
    const aiKey = env.AI_KEY || CONFIG.AI_KEY;
    const aiModel = env.AI_MODEL || CONFIG.AI_MODEL;

    // Parse Users Config
    let users = CONFIG.USERS;
    if (env.USERS_JSON) {
        try {
            users = JSON.parse(env.USERS_JSON);
        } catch (e) {
            console.error("Failed to parse USERS_JSON env var", e);
        }
    }

    // 2. CORS Handling
    const corsHeaders = {
      "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true",
    };

    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- Helpers ---
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const err = (msg, status = 400) => json({ message: msg, code: status }, status);

    // Convert internal plan (KV) to API Plan format (CamelCase)
    // Assuming KV stores data using same JSON tags as Go backend (CamelCase)
    const toApiPlan = (p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        description: p.description || "",
        startTime: p.startTime || "",
        endTime: p.endTime || "",
        labels: p.labels || [],
        content: p.content
    });

    const toApiPlanSummary = (p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        description: p.description || "",
        startTime: p.startTime || "",
        endTime: p.endTime || "",
        labels: p.labels || []
    });

    const requireAuth = async () => {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
      const token = authHeader.split(" ")[1];
      const payload = await verifyJwt(token, jwtSecret);
      if (!payload) return false;
      return payload; // Return payload to get user info
    };

    // --- Routes ---

    // 1. Health Check
    if (path === "/api/ping") {
        if (method === "GET" || method === "HEAD") {
            return new Response("pong", { status: 200, headers: corsHeaders });
        }
    }

    // 2. Auth: Login (Multi-user support via Config)
    if (path === "/api/v1/login" && method === "POST") {
      try {
        const body = await request.json();
        const { username, password } = body;

        const userCreds = users[username];
        if (!userCreds) {
            return err("Invalid credentials", 401);
        }

        // Verify password: SHA256(salt + password)
        const computedHash = await sha256(userCreds.salt + password);

        if (computedHash === userCreds.hash) {
            // Generate Token (30 days to match Go backend default)
            const token = await signJwt({
                username: username,
                sub: username,
                exp: Math.floor(Date.now() / 1000) + 86400 * 30
            }, jwtSecret);
            return json({ token });
        }

        return err("Invalid credentials", 401);
      } catch (e) {
        return err("Bad Request", 400);
      }
    }

    // 3. Auth: Refresh
    if (path === "/api/v1/refresh" && method === "POST") {
       const userPayload = await requireAuth();
       if (!userPayload) return err("Unauthorized", 401);

       const token = await signJwt({
           username: userPayload.username || userPayload.sub,
           sub: userPayload.sub || userPayload.username,
           exp: Math.floor(Date.now() / 1000) + 86400 * 30
       }, jwtSecret);
       return json({ token });
    }

    // 4. Plan: List (GET) & Create (POST)
    if (path === "/api/v1/plans") {
      const userPayload = await requireAuth();
      if (!userPayload) return err("Unauthorized", 401);

      if (method === "GET") {
        const list = await env.ROADBOOK_KV.list({ prefix: "plan:" });
        const plans = [];
        for (const key of list.keys) {
            const plan = await env.ROADBOOK_KV.get(key.name, "json");
            if (plan) {
                plans.push(toApiPlanSummary(plan));
            }
        }
        return json({ plans: plans });
      }

      if (method === "POST") {
        const body = await request.json();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const plan = {
          id: id,
          name: body.name,
          description: body.description,
          startTime: body.startTime,
          endTime: body.endTime,
          labels: body.labels,
          content: body.content,
          owner: userPayload.username || userPayload.sub,
          createdAt: now,
          updatedAt: now,
        };
        await env.ROADBOOK_KV.put(`plan:${id}`, JSON.stringify(plan));
        return json({
            id: plan.id,
            name: plan.name,
            createdAt: plan.createdAt
        }, 201);
      }
    }

    // 5. Plan: Detail (GET), Update (PUT), Delete (DELETE)
    const planMatch = path.match(/^\/api\/v1\/plans\/([a-zA-Z0-9-]+)$/);
    if (planMatch) {
      if (!(await requireAuth())) return err("Unauthorized", 401);
      const id = planMatch[1];
      const key = `plan:${id}`;

      if (method === "GET") {
        const plan = await env.ROADBOOK_KV.get(key, "json");
        return plan ? json({ plan: toApiPlan(plan) }) : err("Plan not found", 404);
      }

      if (method === "PUT") {
        const existing = await env.ROADBOOK_KV.get(key, "json");
        if (!existing) return err("Plan not found", 404);
        const body = await request.json();
        const now = new Date().toISOString();
        const updated = {
            ...existing,
            name: body.name,
            description: body.description,
            startTime: body.startTime,
            endTime: body.endTime,
            labels: body.labels,
            content: body.content,
            updatedAt: now
        };
        await env.ROADBOOK_KV.put(key, JSON.stringify(updated));
        return json({
            id: updated.id,
            name: updated.name,
            updatedAt: updated.updatedAt
        });
      }

      if (method === "DELETE") {
        await env.ROADBOOK_KV.delete(key);
        return json({ message: `计划 ${id} 删除成功` });
      }
    }

    // --- AI Routes ---

    // AI Config
    if (path === "/api/v1/ai/config" && method === "GET") {
        if (!(await requireAuth())) return err("Unauthorized", 401);
        return json({
            enabled: aiEnabled,
            model: aiModel
        });
    }

    // AI Session: Get
    if (path === "/api/v1/ai/session" && method === "GET") {
        const userPayload = await requireAuth();
        if (!userPayload) return err("Unauthorized", 401);

        // Use username for isolation, or global if preferred.
        // Go backend uses a single file, so it's shared. Let's use user-specific for better UX.
        const username = userPayload.username || userPayload.sub;
        const key = `ai:session:${username}`;

        const messages = await env.ROADBOOK_KV.get(key, "json");
        return json({ messages: messages || [] });
    }

    // AI Session: Save
    if (path === "/api/v1/ai/session" && method === "POST") {
        const userPayload = await requireAuth();
        if (!userPayload) return err("Unauthorized", 401);

        const username = userPayload.username || userPayload.sub;
        const key = `ai:session:${username}`;

        try {
            const body = await request.json();
            if (!body.messages || !Array.isArray(body.messages)) {
                return err("Invalid messages format");
            }
            await env.ROADBOOK_KV.put(key, JSON.stringify(body.messages));
            return new Response(null, { status: 200, headers: corsHeaders });
        } catch (e) {
            return err("Bad Request", 400);
        }
    }

    // AI Chat
    if (path === "/api/v1/ai/chat" && method === "POST") {
        const userPayload = await requireAuth();
        if (!userPayload) return err("Unauthorized", 401);

        if (!aiEnabled) return err("AI service is disabled", 503);

        const username = userPayload.username || userPayload.sub;

        try {
            const body = await request.json();
            const messages = body.messages;
            if (!messages || !Array.isArray(messages)) return err("Invalid messages");

            // Prepare OpenAI Request
            const openAIReq = {
                model: aiModel,
                messages: messages,
                stream: true
            };

            const resp = await fetch(`${aiBaseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${aiKey}`
                },
                body: JSON.stringify(openAIReq)
            });

            if (!resp.ok) {
                const errText = await resp.text();
                return json({ error: "AI Provider Error", details: errText }, resp.status);
            }

            // Handle Stream
            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();

            // We need to tee the stream to:
            // 1. Send back to client
            // 2. Accumulate response to save to KV

            // Note: Cloudflare Workers fetch response body is a ReadableStream.
            // We can iterate it.

            // To process without blocking the response, we use ctx.waitUntil
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();

            let fullResponse = "";

            // Custom processing loop
            const processStream = async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            await writer.close();
                            break;
                        }

                        // Write to client
                        await writer.write(value);

                        // Process for storage (accumulate content)
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split("\n");
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed.startsWith("data: ")) {
                                const data = trimmed.slice(6);
                                if (data !== "[DONE]") {
                                    try {
                                        const json = JSON.parse(data);
                                        if (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) {
                                            fullResponse += json.choices[0].delta.content;
                                        }
                                    } catch (e) {
                                        // Ignore parse errors for partial chunks
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("Stream processing error", e);
                    await writer.abort(e);
                }
            };

            // Start processing (doesn't await here to return response immediately)
            const streamPromise = processStream();

            // Wait for stream to finish, then save to KV
            ctx.waitUntil(streamPromise.then(async () => {
                if (fullResponse) {
                    // Filter system messages and append new response
                    const msgsToSave = messages.filter(m => m.role !== "system");
                    msgsToSave.push({ role: "assistant", content: fullResponse });

                    const key = `ai:session:${username}`;
                    await env.ROADBOOK_KV.put(key, JSON.stringify(msgsToSave));
                }
            }));

            return new Response(readable, {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive"
                }
            });

        } catch (e) {
            console.error(e);
            return err("Internal Server Error", 500);
        }
    }

    // 6. Share: Public Plan (GET)
    const shareMatch = path.match(/^\/api\/v1\/share\/plans\/([a-zA-Z0-9-]+)$/);
    if (shareMatch && method === "GET") {
      const id = shareMatch[1];
      const plan = await env.ROADBOOK_KV.get(`plan:${id}`, "json");
      return plan ? json({ plan: toApiPlan(plan) }) : err("Plan not found", 404);
    }

    // 7. Search Providers Config (GET)
    if (path === "/api/search/providers" && method === "GET") {
        return json([
            { name: "tianmap", enabled: true, label: "天地图", login_required: false },
            { name: "baidu", enabled: true, label: "百度", login_required: false },
            { name: "gaode", enabled: !!gaodeKey, label: "高德", login_required: gaodeLoginRequired }
        ]);
    }

    // 8. Search: Baidu (Proxied + Coord Conversion)
    if (path === "/api/cnmap/search" && method === "GET") {
        const q = url.searchParams.get("q");
        if (!q) return err("Missing query");
        try {
            const results = await baiduSearch(q);
            return json(results);
        } catch (e) {
            return json({ error: e.message }, 500);
        }
    }

    // 9. Search: Tianditu (Proxied)
    if (path === "/api/tianmap/search" && method === "GET") {
        const q = url.searchParams.get("q");
        if (!q) return err("Missing query");
        try {
            const results = await tianmapSearch(q, tianKey);
            return json(results);
        } catch (e) {
            return json({ error: e.message }, 500);
        }
    }

    // 10. Search: Gaode (Proxied)
    if (path === "/api/gaode/search" && method === "GET") {
        // Check auth if configured
        if (gaodeLoginRequired && !(await requireAuth())) {
            return err("Unauthorized", 401);
        }
        if (!gaodeKey) return err("Gaode API Key not configured", 500);

        const q = url.searchParams.get("q");
        if (!q) return err("Missing query");
        try {
            const results = await gaodeSearch(q, gaodeKey);
            return json(results);
        } catch (e) {
            return json({ error: e.message }, 500);
        }
    }

    // 11. TrafficPos (Nearest Airport/Station)
    if (path === "/api/trafficpos" && method === "GET") {
        const lat = parseFloat(url.searchParams.get("lat"));
        const lon = parseFloat(url.searchParams.get("lon"));
        if (isNaN(lat) || isNaN(lon)) return err("Invalid coordinates");

        // Load data lazy with KV fallback
        if (!cachedAirports || !cachedStations) {
            cachedAirports = await env.ROADBOOK_KV.get("data:airports", "json");
            cachedStations = await env.ROADBOOK_KV.get("data:stations", "json");

            // Fetch from GitHub if missing in KV
            if (!cachedAirports || !cachedStations) {
                try {
                    const [airRes, stnRes] = await Promise.all([
                        fetch("https://raw.githubusercontent.com/chenxuan520/roadbook/master/backend/configs/airports.json"),
                        fetch("https://raw.githubusercontent.com/chenxuan520/roadbook/master/backend/configs/station_geo.json")
                    ]);

                    if (airRes.ok) {
                        cachedAirports = await airRes.json();
                        ctx.waitUntil(env.ROADBOOK_KV.put("data:airports", JSON.stringify(cachedAirports)));
                    }
                    if (stnRes.ok) {
                        cachedStations = await stnRes.json();
                        ctx.waitUntil(env.ROADBOOK_KV.put("data:stations", JSON.stringify(cachedStations)));
                    }
                } catch(e) {
                    console.error("Failed to fetch external data", e);
                }
            }
        }

        if (!cachedAirports || !cachedStations) return err("Data unavailable", 503);

        const nearestAirport = findNearestFromMap(lat, lon, cachedAirports, true);
        const nearestStation = findNearestFromMap(lat, lon, cachedStations, false);

        return json({
            input: { lat, lon },
            nearest_airport: nearestAirport,
            nearest_station: nearestStation
        });
    }

    // Root (Fake Nginx)
    if (path === "/") {
        return new Response(`<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>
<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p>
</body>
</html>`, { headers: { "Content-Type": "text/html" } });
    }

    return err("Not Found", 404);
  },
};

// --- Business Logic & Utilities ---

// 1. Search Implementations

async function baiduSearch(query) {
    // Ported from backend/internal/search/baidu/client.go
    const baiduURL = "https://map.baidu.com/";
    const params = new URLSearchParams({
        newmap: "1", reqflag: "pcmap", biz: "1", from: "webmap",
        qt: "s", c: "1", wd: query, rn: "10", ie: "utf-8"
    });

    const resp = await fetch(`${baiduURL}?${params.toString()}`, {
        headers: {
            "Referer": "https://map.baidu.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    });

    // Baidu sometimes returns raw HTML or bad JSON if blocked or error
    const text = await resp.text();
    if (text.trim().startsWith("<")) return []; // Probably HTML error

    let data;
    try {
        data = JSON.parse(text);
    } catch(e) { return []; }

    let contentList = [];
    if (Array.isArray(data.content)) contentList = data.content;
    else if (data.current_city) contentList = [data.current_city];

    const results = [];
    let i = 0;
    for (const item of contentList) {
        if (!item) continue;
        let mx = 0, my = 0, valid = false;

        // Try parsing geo string (Baidu Mercator)
        if (typeof item.geo === 'string') {
            const coords = parseBaiduGeo(item.geo);
            if (coords) {
                mx = coords.x;
                my = coords.y;
                valid = true;
            }
        }

        // Fallback to x,y fields
        if (!valid && typeof item.x === 'number' && typeof item.y === 'number') {
            mx = item.x;
            my = item.y;
            valid = true;
        }

        if (valid && Math.abs(mx) > 10000) {
            // Convert to GPS (WGS84)
            const [gpsLng, gpsLat] = convertBaiduToGPS(mx, my);

            const osmID = Date.now() * 1000000 + i; // Fake ID
            results.push({
                place_id: osmID,
                licence: "Data © Baidu Map",
                osm_type: "node",
                osm_id: osmID,
                boundingbox: [
                    (gpsLat - 0.002).toFixed(7), (gpsLat + 0.002).toFixed(7),
                    (gpsLng - 0.002).toFixed(7), (gpsLng + 0.002).toFixed(7)
                ],
                lat: gpsLat.toFixed(7),
                lon: gpsLng.toFixed(7),
                display_name: `${item.name || ''}, ${item.addr || ''}`,
                class: "place",
                type: "point",
                importance: 0.8 - (i * 0.05)
            });
            i++;
        }
    }
    return results;
}

async function tianmapSearch(query, key) {
    // Ported from backend/internal/search/tianmap/client.go
    const postData = {
        keyWord: query, level: "11", mapBound: "-180,-90,180,90",
        queryType: "1", count: "10", start: "0", yingjiType: 1,
        sourceType: 0, queryTerminal: 10000
    };

    const params = new URLSearchParams();
    params.set("type", "query");
    params.set("postStr", JSON.stringify(postData));
    params.set("tk", key);

    const resp = await fetch(`https://api.tianditu.gov.cn/v2/search?${params.toString()}`, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://map.tianditu.gov.cn/",
            "Origin": "https://map.tianditu.gov.cn"
        }
    });

    const data = await resp.json();
    const results = [];

    if (Array.isArray(data.pois)) {
        let i = 0;
        for (const p of data.pois) {
            const lonlat = p.lonlat || "";
            const parts = lonlat.replace(/,/g, " ").trim().split(/\s+/);
            if (parts.length < 2) continue;

            const lng = parts[0];
            const lat = parts[1];

            let displayName = p.name || "";
            if (p.address) displayName += ", " + p.address;
            if (p.phone) displayName += " (" + p.phone + ")";

            const osmID = Date.now() * 1000000 + i;
            const latVal = parseFloat(lat);
            const lngVal = parseFloat(lng);

            results.push({
                place_id: osmID,
                licence: "Data © Tianditu",
                osm_type: "node",
                osm_id: osmID,
                boundingbox: [
                    (latVal - 0.001).toFixed(6), (latVal + 0.001).toFixed(6),
                    (lngVal - 0.001).toFixed(6), (lngVal + 0.001).toFixed(6)
                ],
                lat: lat,
                lon: lng,
                display_name: displayName,
                class: "place",
                type: "poi",
                importance: 0.8
            });
            i++;
        }
    } else if (data.area) {
        // Area handling
        const lonlat = data.area.lonlat || "";
        const parts = lonlat.replace(/,/g, " ").trim().split(/\s+/);
        if (parts.length >= 2) {
             const osmID = Date.now() * 1000000;
             results.push({
                place_id: osmID,
                licence: "Data © Tianditu",
                osm_type: "relation",
                osm_id: osmID,
                boundingbox: [parts[1], parts[1], parts[0], parts[0]],
                lat: parts[1],
                lon: parts[0],
                display_name: data.area.name,
                class: "boundary",
                type: "administrative",
                importance: 0.9
             });
        }
    }
    return results;
}

async function gaodeSearch(query, key) {
    const apiUrl = `https://restapi.amap.com/v3/place/text?keywords=${encodeURIComponent(query)}&key=${key}&offset=20&page=1&extensions=all`;
    const resp = await fetch(apiUrl);
    const data = await resp.json();

    if (data.status !== "1") {
        throw new Error(data.info || "Gaode API error");
    }

    // Convert Gaode results to Nominatim format
    const results = [];
    if (data.pois) {
        for (let i = 0; i < data.pois.length; i++) {
            const poi = data.pois[i];
            const location = poi.location.split(",");
            if (location.length < 2) continue;

            const lng = parseFloat(location[0]);
            const lat = parseFloat(location[1]);

            // GCJ02 to WGS84 (approximate if needed, but Leaflet usually handles it or we map it)
            // Note: The original Go backend returns Gaode results directly for /api/gaode/search
            // But the front-end might expect Nominatim format if using the same parser.
            // However, the front-end 'gaode' parser in script.js uses 'nominatim' parser!
            // So we MUST convert to Nominatim format.

            const osmID = Date.now() * 1000000 + i; // Simulate nanosecond timestamp like Go

            // Handle address (could be string or array)
            let address = "";
            if (poi.address) {
                if (Array.isArray(poi.address)) {
                    address = poi.address.join("");
                } else if (typeof poi.address === "string") {
                    address = poi.address;
                }
            }

            let displayName = poi.name;
            if (address) {
                displayName += ", " + address;
            }

            results.push({
                 place_id: osmID,
                 licence: "Data © AutoNavi",
                 osm_type: "node",
                 osm_id: osmID,
                 boundingbox: [
                     (lat - 0.001).toFixed(7), (lat + 0.001).toFixed(7),
                     (lng - 0.001).toFixed(7), (lng + 0.001).toFixed(7)
                 ],
                 lat: lat.toString(),
                 lon: lng.toString(),
                 display_name: displayName,
                 class: "place",
                 type: "poi",
                 importance: 0.8
            });
        }
    }
    return results;
}

// 2. Coordinate Conversion (Baidu -> WGS84)
// Ported from backend/internal/coord/coord.go

const PI = 3.1415926535897932384626;
const R_MAJOR = 6378137.0;
const R_MINOR = 6356752.3142;
const X_PI = 3.14159265358979324 * 3000.0 / 180.0;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function mercatorToLngLatEllipsoid(x, y) {
    const E_VAL = Math.sqrt(1 - (R_MINOR/R_MAJOR)*(R_MINOR/R_MAJOR));
    const lng = (x / R_MAJOR) * (180.0 / PI);
    const ts = Math.exp(-y / R_MAJOR);
    let phi = PI/2 - 2*Math.atan(ts);

    let dphi = 1.0;
    let i = 0;
    while (Math.abs(dphi) > 0.0000001 && i < 15) {
        const con = E_VAL * Math.sin(phi);
        dphi = PI/2 - 2*Math.atan(ts * Math.pow((1.0 - con)/(1.0 + con), E_VAL/2.0)) - phi;
        phi += dphi;
        i++;
    }
    const lat = phi * (180.0 / PI);
    return [lng, lat];
}

function bd09ToGcj02(bdLon, bdLat) {
    const x = bdLon - 0.0065;
    const y = bdLat - 0.006;
    const z = Math.sqrt(x*x + y*y) - 0.00002 * Math.sin(y * X_PI);
    const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
    return [z * Math.cos(theta), z * Math.sin(theta)];
}

function gcj02ToWgs84(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    let dlat = transformLat(lng - 105.0, lat - 35.0);
    let dlng = transformLng(lng - 105.0, lat - 35.0);
    const radlat = lat / 180.0 * PI;
    const magic = Math.sin(radlat);
    const magic2 = 1 - EE * magic * magic;
    const sqrtmagic = Math.sqrt(magic2);
    dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic2 * sqrtmagic) * PI);
    dlng = (dlng * 180.0) / (A / sqrtmagic * Math.cos(radlat) * PI);
    const mglat = lat + dlat;
    const mglng = lng + dlng;
    return [lng * 2 - mglng, lat * 2 - mglat];
}

function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
}

function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
}

function outOfChina(lng, lat) {
    return (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271);
}

function convertBaiduToGPS(mx, my) {
    const [bdLng, bdLat] = mercatorToLngLatEllipsoid(mx, my);
    const [gcjLng, gcjLat] = bd09ToGcj02(bdLng, bdLat);
    return gcj02ToWgs84(gcjLng, gcjLat);
}

function parseBaiduGeo(geo) {
    if (!geo) return null;
    const parts = geo.split("|");
    if (parts.length < 2) return null;
    const coordStr = parts[1].split(";")[0];
    const xy = coordStr.split(",");
    if (xy.length < 2) return null;
    const x = parseFloat(xy[0]);
    const y = parseFloat(xy[1]);
    if (isNaN(x) || isNaN(y)) return null;
    return { x, y };
}

// 3. JWT & Crypto Utils
async function signJwt(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = b64url(JSON.stringify(header));
    const encodedPayload = b64url(JSON.stringify(payload));
    const signature = await hmacSha256(`${encodedHeader}.${encodedPayload}`, secret);
    return `${encodedHeader}.${encodedPayload}.${b64url(signature)}`;
}

async function verifyJwt(token, secret) {
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [header, payload, signature] = parts;
    const computedSig = await hmacSha256(`${header}.${payload}`, secret);
    if (b64url(computedSig) !== signature) return false;

    try {
        const decodedPayload = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        if (decodedPayload.exp && decodedPayload.exp < Date.now() / 1000) return false;
        return decodedPayload;
    } catch(e) { return false; }
}

async function hmacSha256(message, secret) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    return new Uint8Array(signature);
}

function b64url(input) {
    let str = "";
    if (typeof input === "string") str = btoa(input);
    else str = btoa(String.fromCharCode(...input));
    return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 4. Distance Utils
function findNearestFromMap(lat, lon, mapData, isLatLonOrder) {
    if (!mapData) return null;
    let minDist = Infinity;
    let nearest = null;

    for (const [key, coords] of Object.entries(mapData)) {
        if (!Array.isArray(coords) || coords.length < 2) continue;

        const pLat = isLatLonOrder ? coords[0] : coords[1];
        const pLon = isLatLonOrder ? coords[1] : coords[0];

        const d = haversine(lat, lon, pLat, pLon); // meters
        const dKm = d / 1000.0;

        if (dKm < minDist) {
            minDist = dKm;
            nearest = {
                code: isLatLonOrder ? key : "",
                name: key,
                dist_km: Math.round(dKm * 100) / 100
            };
        }
    }
    return nearest;
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}
