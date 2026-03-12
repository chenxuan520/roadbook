# 前端自动化测试（Playwright）

本目录用于跑 RoadbookMaker 的前端端到端测试（E2E），不依赖后端接口（搜索等外部请求已在测试里 mock）。

## 目录结构

- `playwright.config.mjs`：Playwright 配置（本地默认复用系统 Chrome；CI 默认 headless）
- `server.mjs`：静态资源服务器（把仓库根目录作为静态根，默认入口 `/static/index.html`）
- `tests/*.spec.mjs`：测试用例

## 环境要求

- Node.js 20+
- 本地运行建议已安装 Chrome（测试默认复用系统 Chrome，不会下载 Playwright 浏览器内核）

## 本地运行（不下载浏览器内核）

在项目根目录执行：

```bash
cd test
npm run setup:local
npm run test:local
```

说明：

- `setup:local` 会设置 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`，只安装 Node 依赖，不会下载 Chromium/WebKit/Firefox。
- `test:local` 会设置 `USE_SYSTEM_CHROME=1`，让 Playwright 使用系统 Chrome channel。

## CI 运行（GitHub Actions）

CI 会在 runner 上安装 Chromium（只装 Chromium，不装其它内核），再以 headless 方式运行：

```bash
cd test
npm run setup:ci
npm run test:ci
```

对应 workflow：`/.github/workflows/ci_frontend.yml`。

## 测试策略说明

- 测试用例全部基于 `static/index.html` 的 UI 交互，不依赖后端。
- 地图瓦片请求：为了避免网络波动导致 flaky，用例会屏蔽“所有地图源通用”的瓦片请求（按 URL 特征识别 z/x/y 等），不影响地图交互逻辑验证。

