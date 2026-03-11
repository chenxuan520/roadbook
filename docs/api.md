# RoadbookMaker后端API文档

本文档概述了RoadbookMaker后端API的请求和响应结构。除了登录接口和计划分享接口外，所有API端点都需要JWT认证。所有API的基础路径为 `/api/v1`。

## 通用响应结构

### ErrorResponse (错误响应)
用于所有API错误。

```go
type ErrorResponse struct {
	Message string `json:"message"`
	Code    int    `json:"code,omitempty"` // 可选：具体的错误码
}
```

**示例 ErrorResponse:**

```json
{
  "message": "用户凭证无效",
  "code": 1001
}
```

## 认证模块

### 1. 用户登录

用户认证并颁发JWT令牌。此接口对每个IP地址限制为每秒1次请求。

*   **端点:** `POST /api/v1/login`
*   **认证:** 无
*   **限流:** 每个IP每秒1次请求

#### 请求体: `LoginRequest`

```go
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}
```

**示例 LoginRequest:**

```json
{
  "username": "testuser",
  "password": "password123"
}
```

#### 响应体 (成功): `LoginResponse`

```go
type LoginResponse struct {
	Token string `json:"token"` // 用于后续认证请求的JWT令牌
}
```

**示例 LoginResponse:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InRlc3R1c2VyIiwiaWF0IjoxNzA0MDY3MjAwLCJleHAiOjE3MDQwNzQ0MDB9.some-jwt-token-string"
}
```

#### 响应体 (错误): `ErrorResponse` (例如：401 未授权, 429 请求过多)

### 2. 刷新 Token

刷新当前的 JWT Token。需要有效的 Token 才能刷新。

*   **端点:** `POST /api/v1/refresh`
*   **认证:** 需要 (JWT)

#### 响应体 (成功): `LoginResponse` (包含新的 Token)

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.new-token-string..."
}
```

## 健康检查

### 2. Ping（包含版本信息）

返回服务健康状态与构建版本信息。

* **端点:** `GET /api/ping`
* **认证:** 无

#### 响应体 (成功)

```json
{
  "status": "pong",
  "version": "v0.0.1",
  "commit": "e0b5a87",
  "buildTime": "2025-12-08T06:55:00Z"
}
```

> 注：version/commit/buildTime 来自构建时注入的 -ldflags。


## 计划管理

所有计划管理端点都需要在 `Authorization: Bearer <token>` 请求头中提供有效的JWT令牌。

### 2. 创建计划

创建一个新的路书计划，并将其内容保存为JSON文件。

*   **端点:** `POST /api/v1/plans`
*   **认证:** 需要 (JWT)

#### 请求体: `CreatePlanRequest`

```go
import "encoding/json"

type CreatePlanRequest struct {
	Name        string          `json:"name"`        // 计划名称
	Description string          `json:"description"` // 计划描述或备注
	StartTime   string          `json:"startTime"`   // 计划开始日期，格式 YYYYMMDD (例如: 20250125)
	EndTime     string          `json:"endTime"`     // 计划结束日期，格式 YYYYMMDD (例如: 20250130)
	Labels      []string        `json:"labels"`      // 计划标签列表，用于扩展性
	Content     json.RawMessage `json:"content"`     // 前端提供的任意JSON内容
}
```

**示例 CreatePlanRequest:**

```json
{
  "name": "我的第一次欧洲之旅",
  "description": "一次为期五天的欧洲自驾游",
  "startTime": "20250601",
  "endTime": "20250605",
  "labels": ["自驾", "欧洲", "旅行"],
  "content": {
    "version": "2.0",
    "exportTime": "2025-11-23T17:02:55.370Z",
    "currentLayer": "gaode",
    "currentSearchMethod": "auto",
    "markers": [
      {
        "id": 1763917369175,
        "position": [
          38.62551111591997,
          112.13441255011988
        ],
        "title": "标记点1",
        "labels": [],
        "createdAt": "2025-11-24 01:02:49",
        "dateTimes": [
          "2025-11-24 00:00:00"
        ],
        "icon": {
          "type": "number",
          "icon": "1",
          "color": "#667eea"
        }
      },
      {
        "id": 1763917369616,
        "position": [
          31.416905302147537,
          113.46809486227804
        ],
        "title": "标记点2",
        "labels": [],
        "createdAt": "2025-11-24 01:02:49",
        "dateTimes": [
          "2025-11-24 00:00:00"
        ],
        "icon": {
          "type": "number",
          "icon": "2",
          "color": "#667eea"
        }
      }
    ],
    "connections": [
      {
        "id": 1763917372993,
        "startId": 1763917369175,
        "endId": 1763917369616,
        "transportType": "plane",
        "dateTime": "2025-11-24 00:00:00",
        "label": "",
        "duration": 0,
        "startTitle": "标记点1",
        "endTitle": "标记点2"
      }
    ],
    "labels": [],
    "dateNotes": {}
  }
}
```

#### 响应体 (成功): `CreatePlanResponse`

```go
import "time"

type CreatePlanResponse struct {
	ID        string    `json:"id"`        // 创建的计划的唯一ID
	Name      string    `json:"name"`      // 创建的计划名称
	CreatedAt time.Time `json:"createdAt"` // 计划创建时间戳
}
```

**示例 CreatePlanResponse:**

```json
{
  "id": "plan-12345",
  "name": "我的第一次欧洲之旅",
  "createdAt": "2025-01-25T10:00:00Z"
}
```

#### 响应体 (错误): `ErrorResponse`

### 3. 列出所有计划

检索所有可用的路书计划列表，仅返回其摘要信息。

*   **端点:** `GET /api/v1/plans`
*   **认证:** 需要 (JWT)

#### 响应体 (成功): `ListPlansResponse`

```go
import "time"

type PlanSummary struct {
	ID          string    `json:"id"`          // 计划的唯一ID
	Name        string    `json:"name"`        // 计划名称
	CreatedAt   time.Time `json:"createdAt"`   // 计划创建时间戳
	Description string    `json:"description"` // 计划的简短描述或备注
	StartTime   string    `json:"startTime"`   // 计划开始日期，格式 YYYYMMDD (例如: 20250125)
	EndTime     string    `json:"endTime"`     // 计划结束日期，格式 YYYYMMDD (例如: 20250130)
	Labels      []string  `json:"labels"`      // 计划标签列表，用于扩展性
}

type ListPlansResponse struct {
	Plans []PlanSummary `json:"plans"`
}
```

**示例 ListPlansResponse:**

```json
{
  "plans": [
    {
      "id": "plan-12345",
      "name": "我的第一次欧洲之旅",
      "createdAt": "2025-01-25T10:00:00Z",
      "description": "一次为期五天的欧洲自驾游",
      "startTime": "20250601",
      "endTime": "20250605",
      "labels": ["自驾", "欧洲", "旅行"]
    },
    {
      "id": "plan-67890",
      "name": "日本东京美食探险",
      "createdAt": "2025-01-20T09:30:00Z",
      "description": "三天两夜的东京美食之旅",
      "startTime": "20250310",
      "endTime": "20250312",
      "labels": ["美食", "日本", "短途"]
    }
  ]
}
```

#### 响应体 (错误): `ErrorResponse`

### 4. 获取指定计划

根据计划ID检索路书计划的完整详细信息和内容。

*   **端点:** `GET /api/v1/plans/{id}`
*   **认证:** 需要 (JWT)

#### 路径参数:
*   `id` (string): 计划的唯一ID。

#### 响应体 (成功): `GetPlanResponse`

```go
import "encoding/json"
import "time"

type Plan struct {
	ID          string          `json:"id"`          // 计划的唯一ID
	Name        string          `json:"name"`        // 计划名称
	CreatedAt   time.Time       `json:"createdAt"`   // 计划创建时间戳
	Description string          `json:"description"` // 计划的简短描述或备注
	StartTime   string          `json:"startTime"`   // 计划开始日期，格式 YYYYMMDD (例如: 20250125)
	EndTime     string          `json:"endTime"`     // 计划结束日期，格式 YYYYMMDD (例如: 20250130)
	Labels      []string        `json:"labels"`      // 计划标签列表，用于扩展性
	Content     json.RawMessage `json:"content"`     // 计划的完整任意JSON内容
}

type GetPlanResponse struct {
	Plan Plan `json:"plan"`
}
```

**示例 GetPlanResponse:**

```json
{
  "plan": {
    "id": "plan-12345",
    "name": "我的第一次欧洲之旅",
    "createdAt": "2025-01-25T10:00:00Z",
    "description": "一次为期五天的欧洲自驾游",
    "startTime": "20250601",
    "endTime": "20250605",
    "labels": ["自驾", "欧洲", "旅行"],
    "content": {
      "version": "2.0",
      "exportTime": "2025-11-23T17:02:55.370Z",
      "currentLayer": "gaode",
      "currentSearchMethod": "auto",
      "markers": [
        {
          "id": 1763917369175,
          "position": [
            38.62551111591997,
            112.13441255011988
          ],
          "title": "标记点1",
          "labels": [],
          "createdAt": "2025-11-24 01:02:49",
          "dateTimes": [
            "2025-11-24 00:00:00"
          ],
          "icon": {
            "type": "number",
            "icon": "1",
            "color": "#667eea"
          }
        },
        {
          "id": 1763917369616,
          "position": [
            31.416905302147537,
            113.46809486227804
          ],
          "title": "标记点2",
          "labels": [],
          "createdAt": "2025-11-24 01:02:49",
          "dateTimes": [
            "2025-11-24 00:00:00"
          ],
          "icon": {
            "type": "number",
            "icon": "2",
            "color": "#667eea"
          }
        }
      ],
      "connections": [
        {
          "id": 1763917372993,
          "startId": 1763917369175,
          "endId": 1763917369616,
          "transportType": "plane",
          "dateTime": "2025-11-24 00:00:00",
          "label": "",
          "duration": 0,
          "startTitle": "标记点1",
          "endTitle": "标记点2"
        }
      ],
      "labels": [],
      "dateNotes": {}
    }
  }
}
```

#### 响应体 (错误): `ErrorResponse` (例如：404 未找到)
### 5. 更新/保存计划

使用新的属性和内容更新现有的路书计划。这将覆盖现有计划的详细信息。

*   **端点:** `PUT /api/v1/plans/{id}`
*   **认证:** 需要 (JWT)

#### 路径参数:
*   `id` (string): 要更新的计划的唯一ID。

#### 请求体: `SavePlanRequest`

```go
import "encoding/json"

type SavePlanRequest struct {
	Name        string          `json:"name"`        // 计划的新名称
	Description string          `json:"description"` // 计划的新描述
	StartTime   string          `json:"startTime"`   // 计划开始日期，格式 YYYYMMDD (例如: 20250125)
	EndTime     string          `json:"endTime"`     // 计划结束日期，格式 YYYYMMDD (例如: 20250130)
	Labels      []string        `json:"labels"`      // 计划标签列表，用于扩展性
	Content     json.RawMessage `json:"content"`     // 计划的新的任意JSON内容
}
```

**示例 SavePlanRequest:**

```json
{
  "name": "我的第一次欧洲之旅 (更新)",
  "description": "更新后的欧洲自驾游计划",
  "startTime": "20250601",
  "endTime": "20250607",
  "labels": ["自驾", "欧洲", "旅行", "更新"],
      "content": {
        "version": "2.0",
        "exportTime": "2025-11-23T17:02:55.370Z",
        "currentLayer": "gaode",
        "currentSearchMethod": "auto",
        "markers": [
          {
            "id": 1763917369175,
            "position": [
              38.62551111591997,
              112.13441255011988
            ],
            "title": "标记点1",
            "labels": [],
            "createdAt": "2025-11-24 01:02:49",
            "dateTimes": [
              "2025-11-24 00:00:00"
            ],
            "icon": {
              "type": "number",
              "icon": "1",
              "color": "#667eea"
            }
          },
          {
            "id": 1763917369616,
            "position": [
              31.416905302147537,
              113.46809486227804
            ],
            "title": "标记点2",
            "labels": [],
            "createdAt": "2025-11-24 01:02:49",
            "dateTimes": [
              "2025-11-24 00:00:00"
            ],
            "icon": {
              "type": "number",
              "icon": "2",
              "color": "#667eea"
            }
          }
        ],
        "connections": [
          {
            "id": 1763917372993,
            "startId": 1763917369175,
            "endId": 1763917369616,
            "transportType": "plane",
            "dateTime": "2025-11-24 00:00:00",
            "label": "",
            "duration": 0,
            "startTitle": "标记点1",
            "endTitle": "标记点2"
          }
        ],
        "labels": [],
        "dateNotes": {}
      }}
```

#### 响应体 (成功): `SavePlanResponse`

```go
import "time"

type SavePlanResponse struct {
	ID        string    `json:"id"`        // 更新的计划的唯一ID
	Name      string    `json:"name"`      // 计划的新名称
	UpdatedAt time.Time `json:"updatedAt"` // 更新时间戳
}
```

**示例 SavePlanResponse:**

```json
{
  "id": "plan-12345",
  "name": "我的第一次欧洲之旅 (更新)",
  "updatedAt": "2025-01-25T11:30:00Z"
}
```

#### 响应体 (错误): `ErrorResponse` (例如：404 未找到)
### 6. 删除计划

根据计划ID删除路书计划。

*   **端点:** `DELETE /api/v1/plans/{id}`
*   **认证:** 需要 (JWT)

#### 路径参数:
*   `id` (string): 要删除的计划的唯一ID。

#### 响应体 (成功): `DeletePlanResponse`

```go
type DeletePlanResponse struct {
	Message string `json:"message"` // 确认消息，例如："Plan {id} deleted successfully"
}
```

**示例 DeletePlanResponse:**

```json
{
  "message": "Plan plan-12345 deleted successfully"
}
```

#### 响应体 (错误): `ErrorResponse` (例如：404 未找到)
### 7. 分享计划 (无需授权)

根据计划ID获取计划的完整详细信息和内容，无需认证。

*   **端点:** `GET /api/v1/share/plans/{id}`
*   **认证:** 无

#### 路径参数:
*   `id` (string): 要分享的计划的唯一ID。

#### 响应体 (成功): `GetPlanResponse` (与获取指定计划接口的响应体相同)

**示例 SharePlanResponse:**

```json
{
  "plan": {
    "id": "plan-12345",
    "name": "我的第一次欧洲之旅",
    "createdAt": "2025-01-25T10:00:00Z",
    "description": "一次为期五天的欧洲自驾游",
    "startTime": "20250601",
    "endTime": "20250605",
    "labels": ["自驾", "欧洲", "旅行"],
    "content": {
      "version": "2.0",
      "exportTime": "2025-11-23T17:02:55.370Z",
      "currentLayer": "gaode",
      "currentSearchMethod": "auto",
      "markers": [
        {
          "id": 1763917369175,
          "position": [
            38.62551111591997,
            112.13441255011988
          ],
          "title": "标记点1",
          "labels": [],
          "createdAt": "2025-11-24 01:02:49",
          "dateTimes": [
            "2025-11-24 00:00:00"
          ],
          "icon": {
            "type": "number",
            "icon": "1",
            "color": "#667eea"
          }
        },
        {
          "id": 1763917369616,
          "position": [
            31.416905302147537,
            113.46809486227804
          ],
          "title": "标记点2",
          "labels": [],
          "createdAt": "2025-11-24 01:02:49",
          "dateTimes": [
            "2025-11-24 00:00:00"
          ],
          "icon": {
            "type": "number",
            "icon": "2",
            "color": "#667eea"
          }
        }
      ],
      "connections": [
        {
          "id": 1763917372993,
          "startId": 1763917369175,
          "endId": 1763917369616,
          "transportType": "plane",
          "dateTime": "2025-11-24 00:00:00",
          "label": "",
          "duration": 0,
          "startTitle": "标记点1",
          "endTitle": "标记点2"
        }
      ],
      "labels": [],
      "dateNotes": {}
    }
  }
}
```

#### 响应体 (错误): `ErrorResponse` (例如：404 未找到)

## AI 助手模块

AI 助手相关的所有端点都需要 JWT 认证。

### 1. 获取 AI 配置

获取后端配置的 AI 助手信息。

*   **端点:** `GET /api/v1/ai/config`
*   **认证:** 需要 (JWT)

#### 响应体 (成功)

```json
{
  "enabled": true,
  "model": "generalv3.5"
}
```
- `enabled` (boolean): AI 功能是否在后端开启。
- `model` (string): 后端配置的默认模型名称。

### 2. AI 对话

向 AI 发送消息并发起流式对话。

*   **端点:** `POST /api/v1/ai/chat`
*   **认证:** 需要 (JWT)

#### 请求体: `AIChatRequest`

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are RoadbookAI..."
    },
    {
      "role": "user",
      "content": "帮我在北京故宫添加一个标记"
    }
  ]
}
```
- `messages` (array): 对话历史，遵循 OpenAI 的消息格式。

#### 响应体 (成功): Stream (流式响应)
响应是一个 `text/event-stream` 流。每一条消息都是一个 `data:` 事件，内容是 AI 模型返回的 JSON 块。最后以 `data: [DONE]` 结束。

**流式消息示例:**
```
data: {"choices":[{"delta":{"content":"当然，"}}]}

data: {"choices":[{"delta":{"content":"正在为您添加标记..."}}]}

data: [DONE]
```

### 3. 获取对话历史

从服务器获取最近一次的对话历史记录。

*   **端点:** `GET /api/v1/ai/session`
*   **认证:** 需要 (JWT)

#### 响应体 (成功)

```json
{
  "messages": [
    {
      "role": "user",
      "content": "帮我在北京故宫添加一个标记"
    },
    {
      "role": "assistant",
      "content": "好的，已为您添加标记“故宫”。"
    }
  ]
}
```

### 4. 保存对话历史

将前端的对话历史完整地保存到服务器。

*   **端点:** `POST /api/v1/ai/session`
*   **认证:** 需要 (JWT)

#### 请求体

```json
{
  "messages": [
    {
      "role": "user",
      "content": "帮我在北京故宫添加一个标记"
    },
    {
      "role": "assistant",
      "content": "好的，已为您添加标记“故宫”。"
    }
  ]
}
```

#### 响应体 (成功)
*   **状态码:** `200 OK` (无响应体内容)

## 搜索与地理服务

### 1. 获取搜索提供商配置

获取后端支持的搜索提供商列表及其配置信息。

*   **端点:** `GET /api/search/providers`
*   **认证:** 无

#### 响应体 (成功)

```json
[
  {
    "name": "gaode",
    "login_required": false
  },
  {
    "name": "baidu",
    "login_required": false
  },
  {
    "name": "tianmap",
    "login_required": false
  }
]
```

### 2. 地图搜索 (聚合接口)

后端代理了多种地图服务的搜索接口，统一返回 Nominatim 格式的数据。

*   **高德搜索**: `GET /api/gaode/search?q={query}` (可能需要认证，视配置而定)
*   **百度搜索**: `GET /api/cnmap/search?q={query}` (无需认证)
*   **天地图搜索**: `GET /api/tianmap/search?q={query}` (无需认证)

#### 请求参数:
*   `q` (string): 搜索关键词

#### 响应体 (成功): `NominatimResult[]`

返回 OpenStreetMap Nominatim 格式的 JSON 数组。

```json
[
  {
    "place_id": 123456,
    "licence": "Data © AutoNavi",
    "osm_type": "node",
    "osm_id": 123456,
    "boundingbox": ["39.90", "39.91", "116.39", "116.40"],
    "lat": "39.90923",
    "lon": "116.397428",
    "display_name": "天安门, 北京市, 中国",
    "class": "place",
    "type": "poi",
    "importance": 0.8
  }
]
```

### 3. 交通场站查询 (TrafficPos)

根据经纬度查询附近的交通场站（火车站、机场），用于辅助生成交通连线。

*   **端点:** `GET /api/trafficpos`
*   **认证:** 无

#### 请求参数:
*   `lat` (float): 纬度
*   `lon` (float): 经度

#### 响应体 (成功)

```json
{
  "stations": [
    {
      "name": "北京南站",
      "lat": 39.865,
      "lon": 116.379,
      "distance": 5.2,
      "type": "train"
    }
  ],
  "airports": [
    {
      "name": "北京首都国际机场",
      "iata": "PEK",
      "lat": 40.080,
      "lon": 116.584,
      "distance": 25.5,
      "type": "plane"
    }
  ]
}
```
