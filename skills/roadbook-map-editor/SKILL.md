---
name: roadbook-map-editor
description: Edit RoadbookMaker map plans through the server-side map action API. Use when a user wants a local agent to create or modify Roadbook markers, routes, date notes, or map settings without opening the browser UI.
---

# Roadbook Map Editor

Use this skill to create or edit RoadbookMaker online plans by calling the HTTP API directly. Do not wrap the workflow in local helper scripts.

## API Order

1. Determine the API base URL.
   - Local Go backend: `http://127.0.0.1:5436`
   - Deployed Worker/backend: ask the user or inspect project config.
   - The static-only site cannot save online plans by itself.
2. Get a JWT once with `POST /api/v1/login`, unless the user already provided one. Do not print passwords or tokens. Avoid repeated login calls because login is rate-limited.
3. Create a plan with `POST /api/v1/plans` if the user did not provide an existing plan id.
4. Search coordinates with `/api/gaode/search`, `/api/tianmap/search`, or `/api/cnmap/search` when the user gives place names without lat/lng.
5. Edit map content with `POST /api/v1/plans/:id/map/actions`.
6. Verify with `GET /api/v1/plans/:id`.

Prefer `map/actions` over `GET` + manual JSON modification + full `PUT`, because the action endpoint validates and applies a compact edit batch instead of asking the agent to rewrite the whole document.

## Login

Purpose: exchange username/password for a JWT used by all authenticated APIs.

```bash
curl -sS "$ROADBOOK_API_BASE_URL/api/v1/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"password"}'
```

Store the returned `token` in memory or an environment variable such as `ROADBOOK_TOKEN`. Never echo it back to the user.

## Create Plan

Purpose: create a cloud plan record. Use this when no suitable existing plan id is available.

```bash
curl -sS "$ROADBOOK_API_BASE_URL/api/v1/plans" \
  -H "Authorization: Bearer $ROADBOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Beijing Weekend",
    "description": "Agent-created roadbook",
    "startTime": "20261001",
    "endTime": "20261003",
    "labels": ["北京", "周末"],
    "content": {
      "version": "agent",
      "exportTime": "2026-10-01T00:00:00.000Z",
      "currentLayer": "gaode",
      "currentSearchMethod": "auto",
      "markers": [],
      "connections": [],
      "labels": [],
      "dateNotes": {}
    }
  }'
```

Use the returned `id` as the plan id for later edits.

## Search Coordinates

Purpose: resolve a place name to coordinates before `add_marker`. Search results use a Nominatim-like shape. Read `display_name` or `name`, `lat`, and `lon`; use `lon` as `lng` in `add_marker`.

Provider endpoints and purpose:

- `GET /api/search/providers`: inspect which backend search providers are enabled and whether login is required.
- `GET /api/gaode/search?q=...`: preferred for China POI search when enabled.
- `GET /api/tianmap/search?q=...`: fallback China POI/search provider.
- `GET /api/cnmap/search?q=...`: Baidu fallback; may be less stable.

Example:

```bash
curl -sS "$ROADBOOK_API_BASE_URL/api/tianmap/search?q=天安门"
```

Provider preference:

1. `gaode` if `/api/search/providers` reports it enabled.
2. `tianmap`.
3. `baidu`.

If several candidates are plausible, ask the user to choose. Do not invent coordinates.

## Action Format

Send an object with an `actions` array.

```json
{
  "actions": [
    {
      "action": "add_marker",
      "id": 1715000000000,
      "title": "Tiananmen Square",
      "lat": 39.9042,
      "lng": 116.4074,
      "dateTime": "2026-10-01 09:00:00"
    },
    {
      "action": "connect_markers",
      "id": 1715000000001,
      "start_id": 1715000000000,
      "end_id": 1715000000002,
      "transport": "walk",
      "dateTime": "2026-10-01 10:00:00"
    }
  ]
}
```

Supported actions:

- `add_marker`: `id` optional but recommended, `title`, `lat`, `lng`, `dateTime`.
- `update_marker`: `id`, optional `title`, `lat` + `lng`, `dateTime`, `labels`, `logo`, `icon`.
- `remove_marker`: `id`; also deletes connected routes and affected marker labels.
- `connect_markers`: `id` optional, `start_id`, `end_id`, optional `transport`, `dateTime`.
- `update_connection`: `id`, optional `transport`, `dateTime`, `label`, `logo`, `duration`.
- `remove_connection`: `id`.
- `update_date_note`: `date`, `note`; the date must already exist in the itinerary.
- `remove_date_note`: `date`.
- `set_map_settings`: optional `currentLayer`, `currentSearchMethod`, `lastDateRange`.

`transport` must be one of `car`, `walk`, `train`, `plane`, `subway`, `bus`, `cruise`.

`dateTime` must be `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`. Marker visits keep at most one time per calendar day.

## Apply Actions

Purpose: edit plan `content` without replacing the whole document. The server applies the action batch atomically: if one action fails, none of the batch is saved.

```bash
curl -sS "$ROADBOOK_API_BASE_URL/api/v1/plans/$ROADBOOK_PLAN_ID/map/actions" \
  -H "Authorization: Bearer $ROADBOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "actions": [
      {
        "action": "add_marker",
        "id": 1715000000000,
        "title": "Tiananmen Square",
        "lat": 39.9042,
        "lng": 116.4074,
        "dateTime": "2026-10-01 09:00:00"
      }
    ]
  }'
```

On failure, the server returns `actionIndex` and `action`; fix that action and retry the whole batch.

