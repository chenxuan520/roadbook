# RoadbookMaker 代码库架构概览（给 Agent / 开发者）

> 本文件用于帮助快速理解仓库结构与运行方式，便于开发、重构、测试与排障。

## 1. 项目概览

RoadbookMaker 是一个基于网页的地图标记与行程规划工具：

- **前端**：`static/` 下的纯原生 JavaScript + Leaflet，直接在浏览器运行，无构建步骤（`static/index.html` 引入 `static/script.js`、`static/online_mode.js`、`static/html_export.js`）。
- **后端**：`backend/` 下的 Go + Gin API 服务（入口 `backend/cmd/roadbook-api/main.go`），提供：
  - 在线模式（登录/JWT、计划 CRUD、分享读取）
  - 地图搜索聚合与代理（`/api/cnmap/search`、`/api/tianmap/search`）
  - `trafficpos` 等辅助 API（`/api/trafficpos`）
- **部署**：Nginx 提供静态资源，并反向代理 `/api/` 到后端（见 `nginx.prod.conf:25`）；Docker 镜像把前端 + 后端打包在一起（见 `Dockerfile`、`Dockerfile.local`、`docker-entrypoint.sh`）。

在线模式数据持久化是“文件系统仓库”：计划以 `data/<id>.json` 形式写入磁盘（见 `backend/internal/plan/repository.go:16`）。

## 2. 构建与常用命令

### 前端

- 纯静态资源：直接打开 `static/index.html` 或由 Nginx 提供。
- 前端对后端基址的判定：
  - `localhost/127.0.0.1/file://` 时使用 `http://127.0.0.1:5436`（见 `static/script.js:5`）
  - 否则使用当前域名（见 `static/script.js:8`）

### 后端

- 生成后端配置（交互式）：`./scripts/generate_config.sh`（写入 `backend/configs/config.json`，见 `scripts/generate_config.sh:23`）
- 编译后端：`./backend/scripts/build.sh`（产物：`backend/roadbook-api`，见 `backend/scripts/build.sh:34`）
- 启动后端：在 `backend/` 目录执行 `./roadbook-api`（README 与 `backend/cmd/roadbook-api/main.go:41`）

### Docker

- 从项目根目录构建本地镜像：`./build.sh`（会先在 `backend/` 里 `go build` 再 `docker build -f./Dockerfile.local`，见 `build.sh:16`、`build.sh:21`）
- 镜像运行示例：`docker run -d -p 5215:80 roadbook`（见 `build.sh:26`）

容器启动逻辑：`docker-entrypoint.sh` 会启动 Nginx，并在 `/app` 下启动后端二进制（见 `docker-entrypoint.sh:4`、`docker-entrypoint.sh:7`）。

## 3. 代码风格与约定（基于仓库现状）

### Go（`backend/`）

- 模块：`module github.com/chenxuan520/roadmap/backend`，`go 1.18`（见 `backend/go.mod:1`、`backend/go.mod:3`）。
- 框架与库：Gin（HTTP）、`golang-jwt/jwt/v4`（JWT）、`google/uuid`（计划ID）、`golang.org/x/time/rate`（限流）（见 `backend/go.mod:6`-`backend/go.mod:9`）。
- 路由组织：在 `backend/internal/server/server.go` 内组装 Gin Engine；`/api/v1` 下是认证/计划接口，`/api` 下保留搜索与其它公共接口（见 `backend/internal/server/server.go:65`、`backend/internal/server/server.go:97`）。

### 前端（`static/`）

- 无框架：主要逻辑集中在 `static/script.js`（地图、标记点、连接线、导入导出等）与 `static/online_mode.js`（在线模式/云端保存/登录）。
- 在线 token 存储：`localStorage` 的 key 为 `online_token`（见 `static/online_mode.js:6`）。

本仓库未提供统一格式化/校验工具配置文件（例如 ESLint/Prettier/Go fmt hook），修改时建议保持周边代码的现有缩进与命名风格。

## 4. 测试

### Go 单元测试

- 计划仓库测试：`backend/internal/plan/repository_test.go`（覆盖 Save/FindAll/Delete 等；测试会把 `dataDir` 指向临时目录，见 `backend/internal/plan/repository_test.go:14`-`backend/internal/plan/repository_test.go:34`）。
- 限流器惰性清理测试：`backend/internal/middleware/middleware_test.go`（覆盖 TTL/清理间隔/阈值等，见 `backend/internal/middleware/middleware_test.go:22`）。

运行方式（在 `backend/` 下）：`go test ./...`。

### 后端集成测试脚本

`backend/scripts/backend_test.sh` 会：

- 生成临时 `backend/configs/config.json`（包含 `jwtSecret` 与用户 salted SHA256 hash）
- 编译并启动后端，然后用 `curl`/`jq` 走一组 API（含登录、计划 CRUD、分享）

该脚本依赖：`openssl`、`sha256sum`、`jq`、`curl`（见 `backend/scripts/backend_test.sh:47`、`backend/scripts/backend_test.sh:102`、`backend/scripts/backend_test.sh:115`）。

## 5. 安全与数据保护

### 配置与密钥

- 后端必须配置 `jwtSecret` 且用户列表不能为空（见 `backend/internal/config/config.go:42`-`backend/internal/config/config.go:50`）。
- `scripts/generate_config.sh` 会用 `openssl rand` 生成 `jwtSecret`，并对密码做 salted SHA256（见 `scripts/generate_config.sh:71`、`scripts/generate_config.sh:80`）。

### 认证与访问控制

- JWT 认证通过 `Authorization: Bearer <token>` 传递（见 `backend/internal/middleware/middleware.go:90`-`backend/internal/middleware/middleware.go:112`）。
- `/api/v1/login` 有 IP 限流中间件（见 `backend/internal/server/server.go:69` 与 `backend/internal/middleware/middleware.go:69`）。
- 计划文件仓库包含路径遍历防御：对 `id` 做 `filepath.Base(id) == id` 校验（见 `backend/internal/plan/repository.go:54`、`backend/internal/plan/repository.go:76`、`backend/internal/plan/repository.go:148`）。

### 公开接口提醒

- 分享接口无需认证：`GET /api/v1/share/plans/:id`（见 `backend/internal/server/server.go:71`-`backend/internal/server/server.go:75`）。
- Nginx 仅将 `/api/` 反代到后端（见 `nginx.prod.conf:25`），前端静态文件直接由 Nginx 读取。

### 浏览器本地数据

- 离线数据保存在浏览器 `localStorage`（例如路书数据与在线 token）。共享电脑使用时需注意清理。

## 6. 配置与环境

### 后端配置文件

- 默认读取路径：运行目录下的 `configs/config.json`（见 `backend/internal/config/config.go:26`）。
- 生成位置：项目根目录脚本写入 `backend/configs/config.json`（见 `scripts/generate_config.sh:23`、`scripts/generate_config.sh:114`）。
- 字段：`port`、`allowed_origins`、`allow_null_origin_for_dev`、`jwtSecret`、`users`（见 `backend/internal/config/config.go:15`-`backend/internal/config/config.go:21`）。

### CORS

Gin 内置了一个“允许来源列表 + 可选 null origin”逻辑：

- `allowed_origins` 命中时回写 `Access-Control-Allow-Origin` 等头
- 若 `allow_null_origin_for_dev=true` 且 `Origin: null`，允许用于 `file://` 本地开发测试

见 `backend/internal/server/server.go:19`-`backend/internal/server/server.go:41`。

### 数据目录

- 后端计划文件目录是相对路径 `data/`（见 `backend/internal/plan/repository.go:17`）。
- Docker 镜像会创建 `/app/data` 并将后端工作目录设置为 `/app`（见 `Dockerfile:35`、`docker-entrypoint.sh:7`），保证相对路径落在容器内可写目录。

## 附：可选 Cloudflare Worker

`cloudflare/` 目录包含一个 Cloudflare Worker 的部署说明，用于“交通枢纽定位服务 (TrafficPos)”（见 `cloudflare/README.md:1`）。这属于可选组件，不影响本仓库主应用运行。

