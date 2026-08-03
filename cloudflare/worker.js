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

// --- Configuration Defaults ---
const DEFAULTS = {
  JWT_SECRET: "changeme-to-a-secure-random-string-please",
  ADMIN_USER: "admin",
  ADMIN_PASSWORD: "password",
  TIAN_KEY: "75f0434f240669f4a2df6359275146d2",
  GAODE_KEY: "",
  GAODE_LOGIN_REQUIRED: "false",
  AI_ENABLED: "false",
  AI_BASE_URL: "https://api.openai.com/v1",
  AI_KEY: "",
  AI_MODEL: "gpt-3.5-turbo",
  // Cloudflare AI defaults
  CF_AI_MODEL: "@cf/zai-org/glm-4.7-flash",
  USE_CF_AI: "false",
  // Plan Expiration
  PLAN_TTL_HOURS: "0",
};

// --- Global Cache (Warm Start) ---
let cachedAirports = null;
let cachedStations = null;
let cachedUsers = null;
const mapActionQueues = new Map();

// --- Main Worker Logic ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    // 1. Environment Variables & Config Merge
    const jwtSecret = env.JWT_SECRET || DEFAULTS.JWT_SECRET;
    const gaodeKey = env.GAODE_KEY || DEFAULTS.GAODE_KEY;
    const tianKey = env.TIAN_KEY || DEFAULTS.TIAN_KEY;
    const gaodeLoginRequired = (env.GAODE_LOGIN_REQUIRED || DEFAULTS.GAODE_LOGIN_REQUIRED) === "true";

    // AI Config
    const aiEnabledStr = env.AI_ENABLED || DEFAULTS.AI_ENABLED;
    const aiKey = env.AI_KEY || DEFAULTS.AI_KEY;
    const aiBaseUrl = (env.AI_BASE_URL || DEFAULTS.AI_BASE_URL).replace(/\/$/, ""); // Remove trailing slash
    const aiModel = env.AI_MODEL || DEFAULTS.AI_MODEL;

    // Cloudflare AI Config
    const useCfAiStr = env.USE_CF_AI || DEFAULTS.USE_CF_AI;
    const useCfAi = (useCfAiStr === "true");
    const cfAiModel = env.CF_AI_MODEL || DEFAULTS.CF_AI_MODEL;
    const planTtlHours = parseInt(env.PLAN_TTL_HOURS || DEFAULTS.PLAN_TTL_HOURS, 10);

    // AI is enabled if (AI_ENABLED=true AND AI_KEY exists) OR (USE_CF_AI=true AND AI binding exists)
    const aiEnabled = (aiEnabledStr === "true" && !!aiKey) || (useCfAi && !!env.AI);

    // Parse Users Config
    // If USERS_JSON is provided, use it.
    // Otherwise, generate a user based on ADMIN_USER/ADMIN_PASSWORD env vars (or defaults).
    if (!cachedUsers) {
        if (env.USERS_JSON) {
            try {
                cachedUsers = JSON.parse(env.USERS_JSON);
            } catch (e) {
                console.error("Failed to parse USERS_JSON env var", e);
                cachedUsers = {}; // Fallback empty to prevent crash, but login will fail
            }
        } else {
            const adminUser = env.ADMIN_USER || DEFAULTS.ADMIN_USER;
            const adminPass = env.ADMIN_PASSWORD || DEFAULTS.ADMIN_PASSWORD;

            // Generate salt and hash on the fly for this worker instance
            // We use a fixed salt for consistency if needed, but random is better security.
            // Since this runs on every request in a new isolate (or cached),
            // for a single user config, generating it once per worker start is fine.
            const salt = crypto.randomUUID().replace(/-/g, "");
            const hash = await sha256(salt + adminPass);

            cachedUsers = {
                [adminUser]: {
                    salt: salt,
                    hash: hash
                }
            };
        }
    }
    const users = cachedUsers;

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
        const ttl = planTtlHours > 0 ? planTtlHours * 3600 : undefined;
        await env.ROADBOOK_KV.put(`plan:${id}`, JSON.stringify(plan), ttl ? { expirationTtl: ttl } : {});
        return json({
            id: plan.id,
            name: plan.name,
            createdAt: plan.createdAt
        }, 201);
      }
    }

    // 5. Plan Map Actions: server-side map edits for local agents
    const mapActionsMatch = path.match(/^\/api\/v1\/plans\/([a-zA-Z0-9-]+)\/map\/actions$/);
    if (mapActionsMatch && method === "POST") {
      if (!(await requireAuth())) return err("Unauthorized", 401);
      const id = mapActionsMatch[1];

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return err("Bad Request", 400);
      }
      if (!body || !Array.isArray(body.actions) || body.actions.length === 0) {
        return err("actions must be a non-empty array", 400);
      }

      const previous = mapActionQueues.get(id) || Promise.resolve();
      const operation = previous
        .catch(() => {})
        .then(async () => {
          const key = `plan:${id}`;
          const existing = await env.ROADBOOK_KV.get(key, "json");
          if (!existing) {
            const notFound = new Error("Plan not found");
            notFound.status = 404;
            throw notFound;
          }
          const now = new Date();
          const { content, results } = applyMapActions(existing.content, body.actions, now);
          const updated = {
            ...existing,
            content,
            updatedAt: now.toISOString()
          };
          const ttl = planTtlHours > 0 ? planTtlHours * 3600 : undefined;
          await env.ROADBOOK_KV.put(key, JSON.stringify(updated), ttl ? { expirationTtl: ttl } : {});
          return { updated, results };
        });
      const queued = operation.finally(() => {
        if (mapActionQueues.get(id) === queued) {
          mapActionQueues.delete(id);
        }
      });
      mapActionQueues.set(id, queued);

      try {
        const { updated, results } = await operation;
        return json({ id: updated.id, updatedAt: updated.updatedAt, results, content: updated.content });
      } catch (e) {
        if (e && e.isMapActionError) {
          return json({
            message: e.message,
            code: 400,
            actionIndex: e.index,
            action: e.action || ""
          }, 400);
        }
        if (e && e.status === 404) return err("Plan not found", 404);
        return err(`Map edit failed: ${e.message || e}`, 400);
      }
    }

    // 6. Plan: Detail (GET), Update (PUT), Delete (DELETE)
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
        const ttl = planTtlHours > 0 ? planTtlHours * 3600 : undefined;
        await env.ROADBOOK_KV.put(key, JSON.stringify(updated), ttl ? { expirationTtl: ttl } : {});
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
            model: useCfAi ? cfAiModel : aiModel
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
            const ttl = planTtlHours > 0 ? planTtlHours * 3600 : undefined;
            await env.ROADBOOK_KV.put(key, JSON.stringify(body.messages), ttl ? { expirationTtl: ttl } : {});
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

            // Providers only accept {role, content}. Strip UI-only fields like display.
            const providerMessages = messages
                .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
                .map(m => ({ role: m.role, content: m.content }));

            // Prepare OpenAI Request
            let streamResponse;

            if (useCfAi && env.AI) {
                 // Use Cloudflare Workers AI
                 try {
                     const response = await env.AI.run(cfAiModel, {
                         messages: providerMessages,
                         stream: true
                     });
                     streamResponse = response;
                 } catch (aiErr) {
                     return json({ error: "Cloudflare AI Error", details: aiErr.message }, 500);
                 }
            } else {
                 // Use OpenAI Compatible API
                 const openAIReq = {
                     model: aiModel,
                     messages: providerMessages,
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
                 streamResponse = resp.body;
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
            let reader;
            try {
                reader = streamResponse.getReader ? streamResponse.getReader() : streamResponse;
            } catch (readerErr) {
                 return json({ error: "Stream Error", details: "Failed to get reader from stream: " + readerErr.message }, 500);
            }
            
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
                                        // Handle both OpenAI and Cloudflare AI response formats
                                        // OpenAI: choices[0].delta.content
                                        // Cloudflare: response (sometimes just the string or object with response)
                                        // Actually Cloudflare Workers AI stream returns SSE similar to OpenAI but payload might differ slightly
                                        // Let's check common patterns.

                                        if (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) {
                                            fullResponse += json.choices[0].delta.content;
                                        } else if (json.response) {
                                            // Some Cloudflare models return { response: "token" }
                                            fullResponse += json.response;
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
                    // Try to write error to stream if still open, then close
                    try {
                        const errorMsg = new TextEncoder().encode(`\n\n[Error: ${e.message}]\n`);
                        await writer.write(errorMsg);
                        await writer.close();
                    } catch (ignore) {}
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
                    const ttl = planTtlHours > 0 ? planTtlHours * 3600 : undefined;
                    await env.ROADBOOK_KV.put(key, JSON.stringify(msgsToSave), ttl ? { expirationTtl: ttl } : {});
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
            return json({ error: "Internal Server Error", details: e.message, stack: e.stack }, 500);
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

    // --- Static Assets Handling (Frontend) ---
    // Only handle GET requests for non-API paths
    if (method === "GET" && !path.startsWith("/api/")) {
        // 1. Try env.ASSETS (Cloudflare Pages / Workers Sites)
        if (env.ASSETS) {
            try {
                const asset = await env.ASSETS.fetch(request);
                if (asset.status < 400) {
                    return asset;
                }
            } catch (e) {
                // Ignore
            }
        }
    }

    // Root (Project Info Page) - Fallback if index.html not found
    if (path === "/") {
        return new Response(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Roadbook Backend (Cloudflare)</title>
    <style>
        :root {
            --bg-color: #f4f4f5;
            --card-bg: #ffffff;
            --text-color: #18181b;
            --border-color: #e4e4e7;
            --primary-color: #2563eb;
            --primary-hover: #1d4ed8;
            --success-color: #10b981;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg-color: #18181b;
                --card-bg: #27272a;
                --text-color: #f4f4f5;
                --border-color: #3f3f46;
                --primary-color: #3b82f6;
                --primary-hover: #60a5fa;
            }
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
        }
        .container {
            background-color: var(--card-bg);
            padding: 2rem;
            border-radius: 1rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            max-width: 480px;
            width: 100%;
            border: 1px solid var(--border-color);
            text-align: center;
        }
        h1 { margin: 0 0 1rem 0; font-size: 1.5rem; font-weight: 700; }
        p { color: #71717a; margin-bottom: 2rem; font-size: 0.95rem; line-height: 1.6; }
        @media (prefers-color-scheme: dark) { p { color: #a1a1aa; } }
        
        .api-box {
            background: var(--bg-color);
            padding: 1rem;
            border-radius: 0.5rem;
            border: 1px solid var(--border-color);
            margin-bottom: 1.5rem;
            text-align: left;
        }
        .label {
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
            color: #71717a;
            margin-bottom: 0.5rem;
            display: block;
        }
        .url-display {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            word-break: break-all;
            font-size: 0.9rem;
            user-select: all;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            padding: 0.75rem;
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: 0.5rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 1rem;
        }
        .btn:hover { background-color: var(--primary-hover); }
        .btn:active { transform: translateY(1px); }
        .btn.success { background-color: var(--success-color); }
        
        .footer {
            margin-top: 2rem;
            font-size: 0.8rem;
            color: #71717a;
        }
        .footer a { color: var(--primary-color); text-decoration: none; }
        .footer a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Roadbook Backend</h1>
        <p>
            这是 RoadbookMaker 的 Serverless 后端服务（Cloudflare Worker）。<br>
            提供数据存储、AI 助手与地图搜索代理功能。
        </p>
        
        <div class="api-box">
            <span class="label">前端 API Base URL</span>
            <div class="url-display" id="url">...</div>
        </div>

        <button class="btn" id="copyBtn">
            复制 API 地址
        </button>

        <div class="footer">
            Powered by <a href="https://workers.cloudflare.com/" target="_blank">Cloudflare Workers</a>
            &bull;
            <a href="https://github.com/chenxuan520/roadbook" target="_blank">GitHub</a>
        </div>
    </div>

    <script>
        const urlEl = document.getElementById('url');
        const btn = document.getElementById('copyBtn');
        const origin = window.location.origin;
        
        urlEl.textContent = origin;

        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(origin).then(() => {
                const originalText = btn.textContent;
                btn.textContent = '已复制!';
                btn.classList.add('success');
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('success');
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy:', err);
                alert('复制失败，请手动复制 URL');
            });
        });
    </script>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
    } catch(e) {
        console.error("Baidu parse error:", text.slice(0, 200));
        return [];
    }

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

    const text = await resp.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`Failed to parse Tianmap response: ${e.message}. Raw data: ${text.slice(0, 200)}...`);
    }
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

    const text = await resp.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`Failed to parse Gaode response: ${e.message}. Raw data: ${text.slice(0, 200)}...`);
    }

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

const ALLOWED_TRANSPORT_TYPES = new Set(["car", "walk", "train", "plane", "subway", "bus", "cruise"]);

function mapActionError(index, action, msg) {
    const prefix = action ? `action ${index} (${action}) failed` : `action ${index} failed`;
    const err = new Error(`${prefix}: ${msg}`);
    err.isMapActionError = true;
    err.index = index;
    err.action = action || "";
    return err;
}

function applyMapActions(content, actions, now) {
    const root = cloneMapContent(content);
    ensureMapContentShape(root);
    const results = [];

    actions.forEach((action, index) => {
        if (!action || typeof action !== "object" || Array.isArray(action)) {
            throw mapActionError(index, "", "action must be an object");
        }
        const actionName = String(action.action || "").trim();
        if (!actionName) {
            throw mapActionError(index, "", "action is required");
        }
        results.push(applyOneMapAction(root, action, index, actionName, now));
    });

    root.exportTime = now.toISOString();
    return { content: root, results };
}

function cloneMapContent(content) {
    if (!content || content === null) return {};
    if (typeof content !== "object" || Array.isArray(content)) {
        throw mapActionError(-1, "", "plan content must be a JSON object");
    }
    return JSON.parse(JSON.stringify(content));
}

function ensureMapContentShape(root) {
    if (!Array.isArray(root.markers)) root.markers = [];
    if (!Array.isArray(root.connections)) root.connections = [];
    if (!Array.isArray(root.labels)) root.labels = [];
    if (!root.dateNotes || typeof root.dateNotes !== "object" || Array.isArray(root.dateNotes)) root.dateNotes = {};
}

function applyOneMapAction(root, action, index, actionName, now) {
    switch (actionName) {
        case "add_marker":
            return applyAddMarker(root, action, index, actionName, now);
        case "update_marker":
            return applyUpdateMarker(root, action, index, actionName);
        case "remove_marker":
            return applyRemoveMarker(root, action, index, actionName);
        case "connect_markers":
            return applyConnectMarkers(root, action, index, actionName, now);
        case "update_connection":
            return applyUpdateConnection(root, action, index, actionName);
        case "remove_connection":
            return applyRemoveConnection(root, action, index, actionName);
        case "update_date_note":
            return applyUpdateDateNote(root, action, index, actionName);
        case "remove_date_note":
            return applyRemoveDateNote(root, action, index, actionName);
        case "set_map_settings":
            return applySetMapSettings(root, action, index, actionName);
        default:
            throw mapActionError(index, actionName, "unsupported action");
    }
}

function applyAddMarker(root, action, index, actionName, now) {
    const lat = requiredNumber(action, "lat", index, actionName);
    const lng = requiredNumber(action, "lng", index, actionName);
    if (!validLatLng(lat, lng)) throw mapActionError(index, actionName, "lat/lng out of range");

    const title = String(action.title || "").trim() || `标记点${root.markers.length + 1}`;
    const { id, generated } = idForAdd(action.id, root.markers, now, index);
    const dateTimes = markerDateTimesForAdd(action, root.markers, now, index, actionName);

    const marker = {
        id,
        position: [lat, lng],
        title,
        labels: Array.isArray(action.labels) ? action.labels : [],
        logo: Object.prototype.hasOwnProperty.call(action, "logo") ? action.logo : null,
        icon: action.icon || { type: "default", icon: "📍", color: "#667eea" },
        createdAt: formatDateTimeForRoadbook(now),
        dateTimes,
        dateTime: dateTimes[0]
    };
    root.markers.push(marker);

    const result = { index, action: actionName, status: "applied", id };
    if (generated) result.generatedId = id;
    return result;
}

function applyUpdateMarker(root, action, index, actionName) {
    const { value: id, key } = requiredID(action, "id", index, actionName);
    const marker = root.markers.find(m => idKey(m.id) === key);
    if (!marker) throw mapActionError(index, actionName, "marker not found");

    let updated = false;
    let titleChanged = false;
    if (Object.prototype.hasOwnProperty.call(action, "title")) {
        const title = String(action.title || "").trim();
        if (!title) throw mapActionError(index, actionName, "title must not be empty");
        marker.title = title;
        updated = true;
        titleChanged = true;
    }

    const hasLat = Object.prototype.hasOwnProperty.call(action, "lat");
    const hasLng = Object.prototype.hasOwnProperty.call(action, "lng");
    if (hasLat || hasLng) {
        if (!hasLat || !hasLng) throw mapActionError(index, actionName, "lat and lng must be provided together");
        const lat = requiredNumber(action, "lat", index, actionName);
        const lng = requiredNumber(action, "lng", index, actionName);
        if (!validLatLng(lat, lng)) throw mapActionError(index, actionName, "lat/lng out of range");
        marker.position = [lat, lng];
        updated = true;
    }

    if (Object.prototype.hasOwnProperty.call(action, "dateTime")) {
        const dateTimes = normalizeMarkerDateTimes(action.dateTime, index, actionName);
        marker.dateTimes = dateTimes;
        marker.dateTime = dateTimes[0];
        updated = true;
    }
    ["labels", "logo", "icon"].forEach(field => {
        if (Object.prototype.hasOwnProperty.call(action, field)) {
            marker[field] = action[field];
            updated = true;
        }
    });
    if (!updated) throw mapActionError(index, actionName, "no marker fields to update");

    if (titleChanged) {
        root.connections.forEach(connection => {
            if (idKey(connection.startId) === key) connection.startTitle = marker.title;
            if (idKey(connection.endId) === key) connection.endTitle = marker.title;
        });
    }
    return { index, action: actionName, status: "applied", id };
}

function applyRemoveMarker(root, action, index, actionName) {
    const { value: id, key } = requiredID(action, "id", index, actionName);
    const markerIndex = root.markers.findIndex(m => idKey(m.id) === key);
    if (markerIndex < 0) throw mapActionError(index, actionName, "marker not found");

    root.markers.splice(markerIndex, 1);
    adjustLabelsAfterMarkerRemoval(root, markerIndex);
    const removedConnectionIds = [];
    root.connections = root.connections.filter(connection => {
        if (idKey(connection.startId) === key || idKey(connection.endId) === key) {
            removedConnectionIds.push(connection.id);
            return false;
        }
        return true;
    });
    return { index, action: actionName, status: "applied", id, removedConnectionIds };
}

function applyConnectMarkers(root, action, index, actionName, now) {
    const { value: startId, key: startKey } = requiredID(action, "start_id", index, actionName);
    const { value: endId, key: endKey } = requiredID(action, "end_id", index, actionName);
    if (startKey === endKey) throw mapActionError(index, actionName, "start_id and end_id must be different");

    const startMarker = root.markers.find(m => idKey(m.id) === startKey);
    const endMarker = root.markers.find(m => idKey(m.id) === endKey);
    if (!startMarker || !endMarker) throw mapActionError(index, actionName, "start or end marker not found");

    const transport = transportFieldOrDefault(action, "transport", "car", index, actionName);
    const dateTime = Object.prototype.hasOwnProperty.call(action, "dateTime")
        ? normalizeConnectionDateTime(action.dateTime, index, actionName)
        : defaultConnectionDateTime(startMarker, now);
    const existing = root.connections.find(c => idKey(c.startId) === startKey && idKey(c.endId) === endKey);
    if (existing) return { index, action: actionName, status: "skipped", id: existing.id };

    const { id, generated } = idForAdd(action.id, root.connections, now, index);
    const connection = {
        id,
        startId: startMarker.id,
        endId: endMarker.id,
        transportType: transport,
        dateTime,
        label: typeof action.label === "string" ? action.label : "",
        logo: Object.prototype.hasOwnProperty.call(action, "logo") ? action.logo : null,
        duration: typeof action.duration === "number" ? action.duration : estimateRoadbookDuration(startMarker, endMarker, transport),
        startTitle: String(startMarker.title || ""),
        endTitle: String(endMarker.title || "")
    };
    root.connections.push(connection);

    if (Object.prototype.hasOwnProperty.call(action, "dateTime")) {
        ensureMarkerDateTime(startMarker, dateTime);
        ensureMarkerDateTime(endMarker, dateTime);
    }

    const result = { index, action: actionName, status: "applied", id };
    if (generated) result.generatedId = id;
    return result;
}

function applyUpdateConnection(root, action, index, actionName) {
    const { value: id, key } = requiredID(action, "id", index, actionName);
    const connection = root.connections.find(c => idKey(c.id) === key);
    if (!connection) throw mapActionError(index, actionName, "connection not found");

    let updated = false;
    if (Object.prototype.hasOwnProperty.call(action, "transport")) {
        const transport = transportFieldOrDefault(action, "transport", "", index, actionName);
        if (transport) {
            connection.transportType = transport;
            updated = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(action, "dateTime")) {
        connection.dateTime = normalizeConnectionDateTime(action.dateTime, index, actionName);
        updated = true;
    }
    ["label", "logo", "duration"].forEach(field => {
        if (Object.prototype.hasOwnProperty.call(action, field)) {
            connection[field] = action[field];
            updated = true;
        }
    });
    if (!updated) throw mapActionError(index, actionName, "no connection fields to update");
    return { index, action: actionName, status: "applied", id };
}

function applyRemoveConnection(root, action, index, actionName) {
    const { value: id, key } = requiredID(action, "id", index, actionName);
    const connectionIndex = root.connections.findIndex(c => idKey(c.id) === key);
    if (connectionIndex < 0) throw mapActionError(index, actionName, "connection not found");
    root.connections.splice(connectionIndex, 1);
    return { index, action: actionName, status: "applied", id };
}

function applyUpdateDateNote(root, action, index, actionName) {
    const date = normalizedDateField(action, "date", index, actionName);
    const note = typeof action.note === "string" ? action.note : "";
    if (!note.trim()) throw mapActionError(index, actionName, "note must not be empty");
    if (!dateInItinerary(root, date)) throw mapActionError(index, actionName, "date not found in itinerary");

    const existing = root.dateNotes[date];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        existing.notes = note;
    } else {
        root.dateNotes[date] = { notes: note, expenses: [] };
    }
    return { index, action: actionName, status: "applied", id: date };
}

function applyRemoveDateNote(root, action, index, actionName) {
    const date = normalizedDateField(action, "date", index, actionName);
    if (!Object.prototype.hasOwnProperty.call(root.dateNotes, date)) {
        throw mapActionError(index, actionName, "date note not found");
    }
    delete root.dateNotes[date];
    return { index, action: actionName, status: "applied", id: date };
}

function applySetMapSettings(root, action, index, actionName) {
    let updated = false;
    ["currentLayer", "currentSearchMethod", "lastDateRange"].forEach(field => {
        if (Object.prototype.hasOwnProperty.call(action, field)) {
            root[field] = action[field];
            updated = true;
        }
    });
    if (!updated) throw mapActionError(index, actionName, "no map settings to update");
    return { index, action: actionName, status: "applied" };
}

function adjustLabelsAfterMarkerRemoval(root, removedIndex) {
    if (!Array.isArray(root.labels)) return;
    root.labels = root.labels
        .filter(label => {
            if (!label || typeof label !== "object" || !Number.isInteger(Number(label.markerIndex))) return true;
            return Number(label.markerIndex) !== removedIndex;
        })
        .map(label => {
            if (!label || typeof label !== "object" || !Number.isInteger(Number(label.markerIndex))) return label;
            const markerIndex = Number(label.markerIndex);
            if (markerIndex > removedIndex) return { ...label, markerIndex: markerIndex - 1 };
            return label;
        });
}

function requiredNumber(object, field, index, actionName) {
    if (!Object.prototype.hasOwnProperty.call(object, field) || object[field] === null || object[field] === undefined) {
        throw mapActionError(index, actionName, `${field} is required`);
    }
    const value = object[field];
    if (typeof value !== "number" && typeof value !== "string") {
        throw mapActionError(index, actionName, `${field} must be a number`);
    }
    if (typeof value === "string" && value.trim() === "") {
        throw mapActionError(index, actionName, `${field} must be a number`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) throw mapActionError(index, actionName, `${field} must be a number`);
    return n;
}

function validLatLng(lat, lng) {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function requiredID(object, field, index, actionName) {
    if (!Object.prototype.hasOwnProperty.call(object, field) || object[field] === null || object[field] === undefined) {
        throw mapActionError(index, actionName, `${field} is required`);
    }
    const key = idKey(object[field]);
    if (!key) throw mapActionError(index, actionName, `${field} must be a string or number`);
    return { value: object[field], key };
}

function idKey(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return "";
        return Number.isInteger(value) ? String(value) : String(value);
    }
    if (typeof value === "string") return value.trim();
    return "";
}

function idForAdd(rawID, objects, now, index) {
    const key = idKey(rawID);
    if (key && !objects.some(item => idKey(item.id) === key)) return { id: rawID, generated: false };
    let generated = now.getTime() + index;
    while (objects.some(item => idKey(item.id) === String(generated))) generated += 1;
    return { id: generated, generated: true };
}

function markerDateTimesForAdd(action, markers, now, index, actionName) {
    if (Object.prototype.hasOwnProperty.call(action, "dateTime")) {
        return normalizeMarkerDateTimes(action.dateTime, index, actionName);
    }
    if (markers.length > 0) {
        const last = markers[markers.length - 1];
        if (Array.isArray(last.dateTimes) && typeof last.dateTimes[0] === "string" && last.dateTimes[0].trim()) return [last.dateTimes[0]];
        if (typeof last.dateTime === "string" && last.dateTime.trim()) return [last.dateTime];
    }
    return [`${now.toISOString().slice(0, 10)} 00:00:00`];
}

function normalizeMarkerDateTimes(value, index, actionName) {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) throw mapActionError(index, actionName, "dateTime must not be empty");
    const byDay = new Map();
    values.forEach(raw => {
        if (typeof raw !== "string") throw mapActionError(index, actionName, "dateTime must be a string or string array");
        const normalized = normalizeRoadbookDateTime(raw, index, actionName);
        const day = normalized.slice(0, 10);
        const existing = byDay.get(day);
        if (!existing || normalized < existing) byDay.set(day, normalized);
    });
    return Array.from(byDay.values()).sort();
}

function normalizeConnectionDateTime(value, index, actionName) {
    if (typeof value !== "string") throw mapActionError(index, actionName, "dateTime must be a string");
    return normalizeRoadbookDateTime(value, index, actionName);
}

function normalizeRoadbookDateTime(raw, index, actionName) {
    const s = String(raw || "").trim();
    if (!s) throw mapActionError(index, actionName, "dateTime must not be empty");
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m && validDateParts(m[1], m[2], m[3])) return `${m[1]}-${m[2]}-${m[3]} 00:00:00`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (m && validDateParts(m[1], m[2], m[3]) && validTimeParts(m[4], m[5], m[6])) {
        return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
    }
    throw mapActionError(index, actionName, "dateTime must use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS");
}

function validDateParts(year, month, day) {
    const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) &&
        d.getUTCFullYear() === Number(year) &&
        d.getUTCMonth() + 1 === Number(month) &&
        d.getUTCDate() === Number(day);
}

function validTimeParts(hour, minute, second) {
    const h = Number(hour), m = Number(minute), s = Number(second);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59;
}

function normalizedDateField(action, field, index, actionName) {
    if (!Object.prototype.hasOwnProperty.call(action, field)) throw mapActionError(index, actionName, `${field} is required`);
    const text = String(action[field] || "").replace(/\u200b/g, "").trim();
    const m = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m || !validDateParts(m[1].slice(0, 4), m[1].slice(5, 7), m[1].slice(8, 10))) {
        throw mapActionError(index, actionName, `${field} must contain YYYY-MM-DD`);
    }
    return m[1];
}

function transportFieldOrDefault(action, field, fallback, index, actionName) {
    const raw = Object.prototype.hasOwnProperty.call(action, field) ? action[field] : fallback;
    const transport = String(raw || "").trim().toLowerCase();
    if (!transport) return "";
    if (!ALLOWED_TRANSPORT_TYPES.has(transport)) throw mapActionError(index, actionName, `${field} is not a supported transport type`);
    return transport;
}

function defaultConnectionDateTime(startMarker, now) {
    if (Array.isArray(startMarker.dateTimes) && typeof startMarker.dateTimes[0] === "string" && startMarker.dateTimes[0].trim()) return startMarker.dateTimes[0];
    if (typeof startMarker.dateTime === "string" && startMarker.dateTime.trim()) return startMarker.dateTime;
    return `${now.toISOString().slice(0, 10)} 00:00:00`;
}

function ensureMarkerDateTime(marker, dateTime) {
    const normalized = String(dateTime || "").trim();
    if (!normalized) return;
    const day = normalized.slice(0, 10);
    const dateTimes = Array.isArray(marker.dateTimes)
        ? marker.dateTimes.filter(item => typeof item === "string" && item.trim())
        : (typeof marker.dateTime === "string" && marker.dateTime.trim() ? [marker.dateTime] : []);
    if (dateTimes.some(existing => existing.startsWith(day))) return;
    dateTimes.push(normalized);
    dateTimes.sort();
    marker.dateTimes = dateTimes;
    marker.dateTime = dateTimes[0];
}

function dateInItinerary(root, date) {
    if (root.dateNotes && Object.prototype.hasOwnProperty.call(root.dateNotes, date)) return true;
    if (root.markers.some(marker =>
        (typeof marker.dateTime === "string" && marker.dateTime.startsWith(date)) ||
        (Array.isArray(marker.dateTimes) && marker.dateTimes.some(dt => typeof dt === "string" && dt.startsWith(date)))
    )) return true;
    return root.connections.some(connection => typeof connection.dateTime === "string" && connection.dateTime.startsWith(date));
}

function estimateRoadbookDuration(startMarker, endMarker, transport) {
    if (!Array.isArray(startMarker.position) || !Array.isArray(endMarker.position)) return 0;
    const lat1 = Number(startMarker.position[0]);
    const lng1 = Number(startMarker.position[1]);
    const lat2 = Number(endMarker.position[0]);
    const lng2 = Number(endMarker.position[1]);
    if (!validLatLng(lat1, lng1) || !validLatLng(lat2, lng2)) return 0;
    const distance = haversine(lat1, lng1, lat2, lng2);
    const speeds = { walk: 5, car: 80, train: 250, plane: 800 };
    const coefficients = { walk: 1.2, car: 1.4, train: 1.3, plane: 1.1 };
    const speed = speeds[transport] || 80;
    const coefficient = coefficients[transport] || 1.4;
    return Math.round(((distance * coefficient) / 1000) / speed);
}

function formatDateTimeForRoadbook(date) {
    return date.toISOString().slice(0, 19).replace("T", " ");
}
