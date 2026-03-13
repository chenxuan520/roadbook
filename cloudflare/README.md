# Roadbook Cloudflare Worker 后端服务

这是一个基于 Cloudflare Worker 的全功能后端服务，旨在替代 Go 后端（`roadbook-api`）。它提供了完整的路书管理、用户认证、地图搜索代理以及交通枢纽定位功能。

**核心特性：**
*   **全功能替代**：支持计划 CRUD、用户认证、分享、地图代理（高德/百度/天地图）。
*   **KV 存储**：所有数据（用户计划、缓存）均存储在 Cloudflare KV 中，无需额外数据库。
*   **单文件部署**：所有逻辑封装在 `worker.js` 中。
*   **兼容性**：前端无需改动代码，只需配置 BaseURL 即可无缝切换。

## 维护与同步

Cloudflare Worker 代码（`worker.js`）被设计为与 Go 后端保持功能完全一致。

**重要规则：**

*   **API 同步**：任何对 Go 后端 API（路径、参数、响应结构）的修改，都必须同步更新到 `worker.js`。
*   **数据兼容**：Worker 产生的 KV 数据结构应尽量保持与 Go 后端产生的文件 JSON 结构一致（使用 CamelCase 字段名）。
*   **功能对齐**：新增加的功能（如 AI 助手、新的搜索源）需要在两端同时实现。

---

## 🚀 部署指南

### 方式一：使用 Wrangler CLI 部署 (推荐)

此方式配置最全，支持一键启用 AI、日志跟踪等，无需在控制台手动配置。

1.  **安装 Wrangler**：
    ```bash
    npm install -g wrangler
    ```

2.  **登录 Cloudflare**：
    ```bash
    wrangler login
    ```

3.  **创建 KV 命名空间**：
    ```bash
    wrangler kv:namespace create ROADBOOK_KV
    ```
    执行后，终端会输出 `id` 和 `preview_id`。请复制这两个 ID，修改 `cloudflare/wrangler.toml` 文件中的 `[[kv_namespaces]]` 部分：
    ```toml
    [[kv_namespaces]]
    binding = "ROADBOOK_KV"
    id = "<你的_KV_ID>"
    preview_id = "<你的_PREVIEW_KV_ID>"
    ```

4.  **修改配置 (可选)**：
    打开 `cloudflare/wrangler.toml`，在 `[vars]` 部分修改环境变量，如 `JWT_SECRET`。
    *默认已启用 Cloudflare AI 和日志跟踪。*

5.  **部署**：
    在 `cloudflare/` 目录下执行：
    ```bash
    cd cloudflare
    wrangler deploy
    ```

### 方式二：手动复制到控制台 (旧方式)

### 第一步：创建 KV 命名空间

1.  登录 Cloudflare Dashboard。
2.  在左侧菜单点击 **Workers & Pages** -> **KV**。
3.  点击 **Create a Namespace**。
4.  输入名称：`ROADBOOK_DATA` (或者你喜欢的名字)，点击 **Add**。
5.  **记下这个 KV 的 ID**。

### 第二步：创建 Worker 并绑定 KV

1.  **创建 Worker**：
    *   回到 **Workers & Pages** -> **Overview**。
    *   点击 **Create Application** -> **Create Worker**。
    *   命名为 `roadbook-backend` (或其他)，点击 **Deploy**。

2.  **绑定 KV (关键步骤)**：
    *   进入刚创建的 Worker 详情页。
    *   点击顶部的 **Settings** (设置) -> **Variables** (变量)。
    *   向下滚动找到 **KV Namespace Bindings**。
    *   点击 **Add Binding**。
    *   **Variable name (变量名)**：填写 `ROADBOOK_KV` (**必须完全一致**)。
    *   **KV Namespace**：选择你在第一步创建的 `ROADBOOK_DATA`。
    *   点击 **Save and Deploy**。

3.  **绑定 AI 模块 (可选 - 用于启用免费 AI)**：
    *   进入 Worker 详情页 -> **Settings** -> **Variables**。
    *   向下滚动找到 **Workers AI Bindings** (或类似名称)。
    *   点击 **Add Binding**。
    *   **Variable name (变量名)**：填写 `AI` (**必须完全一致**)。
    *   点击 **Save and Deploy**。
    *   然后在环境变量中设置 `USE_CF_AI` 为 `true` 即可。

### 第三步：部署代码

1.  点击 Worker 详情页右上角的 **Edit code**。
2.  打开本项目中的 `cloudflare/worker.js` 文件。
3.  将 `worker.js` 中的**所有内容**复制并粘贴到 Cloudflare 编辑器中（覆盖原有内容）。
4.  点击右上角的 **Deploy**。

---

## 🛠️ 本地开发

添加的配置（日志、AI）**不会影响本地测试**，但需要注意以下几点：

1.  **启动本地开发服务器**：
    ```bash
    cd cloudflare
    npm run dev
    # 或者
    npx wrangler dev
    ```
    *此时 KV 存储使用的是本地模拟文件，不会影响线上数据。*

2.  **关于 AI 功能**：
    *   默认的 `npm run dev` 在本地运行时，通常无法直接调用 Cloudflare Workers AI（`env.AI`），导致 AI 功能不可用或报错。
    *   **解决方案**：使用远程模式开发。
        ```bash
        npm run dev:remote
        # 或者
        npx wrangler dev --remote
        ```
        这样本地代码会调用真实的云端 AI 和 KV 数据，体验与线上一致。

---

## ⚙️ 配置说明

您可以通过修改 `worker.js` 顶部的 `CONFIG` 对象，或者直接修改 `wrangler.toml` 文件来配置服务（推荐）。

**推荐使用 `wrangler.toml` 进行管理，这样无需修改代码，且部署更方便。**

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `JWT_SECRET` | `changeme...` | **必须修改**。用于签发 Token 的密钥，越长越安全。 |
| `GAODE_KEY` | (空) | **可选**。高德地图 API Key (Web服务类型)，用于高德搜索代理。 |
| `TIAN_KEY` | `75f0434f...` | **可选**。天地图 API Key，默认使用内置 Key。 |
| `USERS_JSON` | (无) | **可选**。用于配置多用户（见下文）。 |
| `USE_CF_AI` | `true` | **默认启用**。使用 Cloudflare Workers AI（需绑定 AI 模块）。 |
| `CF_AI_MODEL` | `@cf/zai-org/glm-4.7-flash` | **可选**。Cloudflare Workers AI 模型名称。 |
| `PLAN_TTL_HOURS` | `24` | **可选**。计划与会话过期时间（小时）。`0` 表示永不过期。 |
| `AI_ENABLED` | `false` | **可选**。设置为 `true` 启用外部 AI 助手功能 (如 OpenAI)。 |
| `AI_KEY` | (空) | **启用外部 AI 时必需**。OpenAI 格式的 API Key。 |
| `AI_BASE_URL` | `https://api.openai.com/v1` | **可选**。AI API 的 Base URL。 |
| `AI_MODEL` | `gpt-3.5-turbo` | **可选**。使用的模型名称。 |

### 🔐 用户管理

Worker 支持两种用户配置方式：

#### 方式一：简单管理员配置 (推荐)

直接设置环境变量，系统会自动处理哈希：

*   `ADMIN_USER`: 管理员用户名 (默认 `admin`)
*   `ADMIN_PASSWORD`: 管理员密码 (默认 `password`)

#### 方式二：高级多用户配置 (USERS_JSON)

如果需要多个用户，或兼容旧版配置，可以使用 `USERS_JSON` 环境变量。

**1. 生成密码哈希**
在您的电脑终端（Mac/Linux）运行以下命令：
```bash
# 格式: echo -n "SALT+PASSWORD" | shasum -a 256
# 例如：Salt 是 "mysalt123"，密码是 "mypassword"
echo -n "mysalt123mypassword" | shasum -a 256
```
会得到类似 `5e884898da28...` 的哈希值。

**2. 配置 Cloudflare 环境变量**
在 Worker 的 **Settings** -> **Variables** 中添加一个名为 `USERS_JSON` 的变量，值为 JSON 字符串：

```json
{
  "admin": {
    "salt": "randomsalt123",
    "hash": "55235b4ea8c4dfb2056be247a067d077eb4217d16bae7553cf25a353b13b72bc"
  },
  "user2": {
    "salt": "mysalt123",
    "hash": "生成的哈希值..."
  }
}
```
**注意：** 如果设置了 `USERS_JSON`，则忽略 `ADMIN_USER` 和 `ADMIN_PASSWORD` 配置。

---

## 💻 前端对接指南

前端页面已经内置了对自定义后端的支持。

1.  部署好 Worker 后，获取 Worker 的 URL（例如 `https://roadbook-backend.yourname.workers.dev`）。
2.  打开您的 Roadbook 前端页面。
3.  **双击页面顶部的标题 "RoadbookMaker"**。
4.  在弹出的输入框中填入 Worker URL（**注意：不要带末尾的 `/`**）。
5.  刷新页面。

现在，前端的所有 API 请求（登录、搜索、保存计划等）都会发送到您的 Cloudflare Worker。

---

## 📡 API 功能列表

Worker 实现了以下后端 API：

*   **基础**：`/api/ping` (健康检查)
*   **认证**：
    *   `POST /api/v1/login` (登录)
    *   `POST /api/v1/refresh` (Token 续期)
*   **计划管理**：
    *   `GET /api/v1/plans` (列表)
    *   `POST /api/v1/plans` (创建)
    *   `GET /api/v1/plans/:id` (详情)
    *   `PUT /api/v1/plans/:id` (更新)
    *   `DELETE /api/v1/plans/:id` (删除)
    *   `GET /api/share/plans/:id` (公开分享)
*   **搜索代理**：
    *   `GET /api/cnmap/search` (百度搜索)
    *   `GET /api/tianmap/search` (天地图搜索)
    *   `GET /api/gaode/search` (高德搜索)
    *   `GET /api/search/providers` (搜索源状态)
*   **工具**：
    *   `GET /api/trafficpos` (最近交通枢纽查询，自动从 GitHub 拉取数据缓存到 KV)
*   **AI 助手**：
    *   `GET /api/v1/ai/config` (获取 AI 配置)
    *   `GET /api/v1/ai/session` (获取对话历史)
    *   `POST /api/v1/ai/session` (保存对话历史)
    *   `POST /api/v1/ai/chat` (发送对话消息，支持流式响应)
