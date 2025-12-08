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
