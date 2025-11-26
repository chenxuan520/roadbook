# Cloudflare Worker: 交通枢纽定位服务 (TrafficPos)

这是一个基于 Cloudflare Worker 的轻量级地理位置服务。它接收用户输入的经纬度，返回最近的**机场（IATA三字码）**和**高铁站（中文名）**。

## ✨ 特性
- **零成本**：完全依赖 Cloudflare 免费版（Workers + KV）。
- **极速响应**：数据预加载至边缘存储（KV），查询时无需请求 GitHub。
- **自定义数据源**：使用托管在 GitHub Release 的优化数据集。
  - 来源：`chenxuan520/gh-action-shell`
- **双模更新**：支持手动 URL 触发更新或 Cron 定时自动更新。

---

## 🚀 部署指南

### 第一步：创建 KV 存储 (数据库)
为了避免每次请求都去下载几 MB 的数据，我们需要创建一个 KV 命名空间来缓存数据。

1. 登录 Cloudflare Dashboard。
2. 在左侧菜单点击 **Workers & Pages** -> **KV**。
3. 点击 **Create a Namespace**。
4. 输入名称：`GEO_DATA` (或者你喜欢的名字)，点击 **Add**。
5. **记下这个名字**，下一步要用。

### 第二步：创建 Worker 并绑定 KV
1. **创建 Worker**：
   - 回到 **Workers & Pages** -> **Overview**。
   - 点击 **Create Application** -> **Create Worker**。
   - 命名为 `geo-locator` (或其他)，点击 **Deploy**。

2. **绑定 KV (关键步骤)**：
   - 进入刚创建的 Worker 详情页。
   - 点击顶部的 **Settings** (设置) -> **Variables** (变量)。
   - 向下滚动找到 **KV Namespace Bindings**。
   - 点击 **Add Binding**。
   - **Variable name (变量名)**：填写 `GEO_KV` (**注意：必须完全一致，否则脚本无法运行**)。
   - **KV Namespace**：选择你在第一步创建的 `GEO_DATA`。
   - 点击 **Save and Deploy**。

### 第三步：写入代码
1. 点击 Worker 详情页右上角的 **Edit code**。
2. 打开本项目中的 `trafficpos.js` 文件。
3. 将 `trafficpos.js` 中的**所有内容**复制并粘贴到 Cloudflare 编辑器中（覆盖原有内容）。
4. 点击右上角的 **Deploy**。

---

## ⚡️ 初始化数据 (必须执行一次)

部署完成后，KV 里面是空的。你需要手动触发一次更新，把 GitHub 的数据拉取下来。

1. 在浏览器访问你的 Worker 地址，并带上 `action=force_update` 参数：
   `https://你的worker名.workers.dev/?action=force_update`

2. 当看到网页显示 **"✅ 数据已从 GitHub 下载并成功更新至 KV 存储！"** 时，说明初始化完成。

---

## 📡 API 使用说明

现在你可以正常调用 API 了。

**请求格式：**
`GET https://你的worker名.workers.dev/?lat={纬度}&lon={经度}`

**请求示例：**
`GET https://你的worker名.workers.dev/?lat=31.2304&lon=121.4737`

**返回结果示例：**
`
{
  "input": {
    "lat": 31.2304,
    "lon": 121.4737
  },
  "nearest_airport": {
    "code": "SHA",
    "name": "Shanghai Hongqiao International Airport",
    "dist_km": 13.5
  },
  "nearest_station": {
    "name": "上海虹桥",
    "dist_km": 14.2
  }
}
`

---

## ⏰ (可选) 设置自动更新

为了保证数据不过时，建议设置每周自动更新一次。

1. 在 Worker 详情页，点击 **Triggers** (触发器)。
2. 找到 **Cron Triggers**，点击 **Add Cron Trigger**。
3. 选择更新频率，例如 `Weekly` (每周)。
4. 点击 **Add Trigger**。

设置完成后，Worker 会在后台自动执行下载更新任务，无需人工干预。
