# 路书制作工具

<p align="center">
  <img src="static/favicon.png" alt="路书制作工具 Logo" width="300" height="300">
</p>

路书制作工具是一个功能强大的基于网页的地图标记和路线规划工具，允许用户在地图上添加标记点、连接路线，并导出分享您的行程规划。

## 🌟 核心功能

### 地图操作
- **多地图源支持**: OpenStreetMap、高德地图、Google地图、ESRI卫星图等
- **智能搜索**: 集成Photon、Nominatim、Overpass、百度地图、天地图等多种搜索服务
- **坐标转换**: 自动处理中国地图坐标系（GCJ-02、BD-09）到标准GPS的转换

### 标记点管理
- **多样化标记**: 支持数字、emoji、自定义图标和颜色
- **时间规划**: 为每个标记点设置多个时间点，支持按日期分组显示
- **详细信息**: 可添加名称、标注内容、坐标信息等
- **拖拽编辑**: 支持鼠标拖拽调整标记点位置

### 路线连接
- **多种交通方式**: 汽车🚗、火车🚄、地铁🚇、飞机✈️、步行🚶
- **智能连接**: 自动计算距离，支持设置耗时
- **导航集成**: 一键生成百度、高德、腾讯导航链接
- **购票服务**: 集成携程火车票查询功能

### 数据管理
- **本地存储**: 自动保存到浏览器本地存储，刷新不丢失
- **导入导出**: 支持JSON格式导入导出，便于备份和分享
- **HTML导出**: 生成独立的HTML文件，包含完整地图信息
- **分享功能**: 支持生成分享链接，他人可导入您的路书

### 用户体验
- **快捷键支持**: A(添加)、C(连接)、D(删除)、F(调整视窗)、H(帮助)等
- **撤销功能**: Ctrl+Z支持撤销操作
- **响应式设计**: 适配不同屏幕尺寸，支持移动端查看
- **实时预览**: 所有编辑操作实时显示在地图上

## 🚀 快速开始

### 在线使用
1. 访问项目网页
2. 点击"添加标记点"或按 `A` 键开始添加地点
3. 点击"连接标记点"或按 `C` 键连接两个地点
4. 编辑详细信息，设置时间和交通方式
5. 导出您的路书进行分享

### 本地部署

#### 环境要求
- Go 1.18+
- Nginx (推荐)
- 现代浏览器

#### 部署步骤

1. **克隆项目**
```bash
git clone https://github.com/chenxuan520/roadbook.git
cd roadbook
```

2. **启动后端服务**
```bash
cd backend
go mod tidy
go run main.go
```

3. **配置Nginx** (可选但推荐)
```bash
sudo cp nginx.conf /etc/nginx/sites-available/roadbook
sudo ln -s /etc/nginx/sites-available/roadbook /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

4. **访问应用**
打开浏览器访问 `http://localhost` 即可使用

详细部署指南请参考 [DEPLOYMENT.md](doc/DEPLOYMENT.md)

## 📋 使用教程

### 添加标记点
1. 点击工具栏"添加标记点"按钮或按 `A` 键
2. 在地图上点击选择位置
3. 在右侧面板编辑标记点信息
4. 可设置自定义图标、时间、标注等

### 连接标记点
1. 点击"连接标记点"按钮或按 `C` 键
2. 选择起始点和目标点
3. 选择交通方式
4. 设置时间和耗时信息

### 搜索地点
1. 在顶部搜索框输入地点名称
2. 选择合适的搜索方式
3. 从搜索结果中选择目标地点

### 导出分享
1. 点击"导出路书"按钮
2. 选择"导出JSON"或"导出HTML"
3. JSON文件可用于备份和后续编辑
4. HTML文件可独立分享，包含完整地图

## 🛠️ 技术架构

### 前端技术
- **纯JavaScript**: 无框架依赖，轻量快速
- **Leaflet地图库**: 提供强大的地图操作功能
- **CSS3**: 现代化样式设计，支持动画效果
- **本地存储**: 使用localStorage保存数据

### 后端技术
- **Go语言**: 高性能后端服务
- **Gin框架**: 轻量级HTTP Web框架
- **坐标转换**: 处理中国地图坐标系转换
- **API代理**: 聚合多个地图搜索服务

### 部署架构
- **前后端分离**: 清晰的职责划分
- **Nginx反向代理**: 统一的API入口
- **跨域支持**: 完善的CORS配置

### 后端核心功能
- **用户认证系统**: JWT-based认证，支持用户登录
- **在线模式**: 支持云端保存和管理路书计划
- **计划管理**: 创建、读取、更新、删除路书计划
- **分享功能**: 生成分享链接，支持公开访问
- **限流保护**: IP-based请求限流，防止滥用
- **数据持久化**: 本地文件系统存储，支持并发访问

## 📁 项目结构

```
roadbook/
├── static/                 # 前端静态文件
│   ├── index.html          # 主页面
│   ├── script.js           # 核心JavaScript逻辑
│   ├── style.css           # 样式文件
│   ├── html_export.js      # HTML导出功能
│   └── favicon.png         # 网站图标
├── backend/                # 后端API服务
│   ├── cmd/roadbook-api/   # 主程序入口
│   ├── internal/           # 内部模块
│   │   ├── handler/        # HTTP处理器
│   │   ├── search/         # 搜索服务
│   │   ├── coord/          # 坐标转换
│   │   └── ...
│   ├── configs/            # 配置文件
│   └── go.mod             # Go模块文件
├── doc/                    # 文档
└── README.md              # 项目说明
```

## 🔧 开发指南

### 前端开发
- 所有前端代码位于 `static/` 目录
- 使用原生JavaScript，无需构建步骤
- 支持现代浏览器（Chrome 60+, Firefox 55+, Safari 12+）

### 后端开发
- 后端代码使用Go语言编写
- 主要API端点：
  - `/api/cnmap/search` - 百度地图搜索
  - `/api/tianmap/search` - 天地图搜索
  - `/api/v1/share/plans/:id` - 分享路书

### 配置说明
- 后端配置文件：`backend/configs/config.json`
- 可配置端口、JWT密钥、允许的来源等

## 📡 后端API完整列表

### 地图搜索服务
- `GET /api/cnmap/search?q={query}` - 百度地图搜索
- `GET /api/tianmap/search?q={query}` - 天地图搜索

### 用户认证
- `POST /api/v1/login` - 用户登录（限流保护）

### 计划管理（需要JWT认证）
- `POST /api/v1/plans` - 创建路书计划
- `GET /api/v1/plans` - 获取用户计划列表
- `GET /api/v1/plans/:id` - 获取指定计划详情
- `PUT /api/v1/plans/:id` - 更新指定计划
- `DELETE /api/v1/plans/:id` - 删除指定计划

### 分享功能（公开访问）
- `GET /api/v1/share/plans/:id` - 获取分享的路书计划

## 🔐 在线模式功能

### 用户认证系统
- **JWT Token认证**: 24小时有效期，支持用户登录
- **用户管理**: 配置文件中的用户账户管理
- **登录接口**: `/api/v1/login` - 用户登录获取token

### 计划管理API
完整的CRUD操作，需要JWT认证：
- **创建计划**: `POST /api/v1/plans` - 创建新路书计划
- **列出计划**: `GET /api/v1/plans` - 获取用户的所有路书计划列表
- **获取计划**: `GET /api/v1/plans/:id` - 获取特定路书计划的详细内容
- **更新计划**: `PUT /api/v1/plans/:id` - 更新路书计划内容
- **删除计划**: `DELETE /api/v1/plans/:id` - 删除路书计划

### 分享功能
- **公开分享**: `GET /api/v1/share/plans/:id` - 无需认证即可访问分享的路书
- **分享链接**: 前端自动生成带分享ID的URL，支持他人导入
- **数据导入**: 支持从分享链接导入路书数据到本地

### 在线模式前端功能
- **模式切换**: 支持在线/离线模式切换
- **状态保持**: 自动保存在线模式状态到本地存储
- **计划选择**: 在线模式下可选择和管理云端路书计划
- **自动保存**: 在线模式下自动保存编辑内容到云端
- **内容检查**: 定期检查内容变化，提示保存状态

### 安全与限流
- **IP限流**: 每个IP每秒限制1次请求，防止滥用
- **JWT认证**: 所有管理操作需要有效的JWT token
- **CORS支持**: 完善的跨域资源共享配置
- **错误处理**: 统一的错误响应格式和处理

## 🤝 贡献指南

欢迎提交Issue和Pull Request来改进项目！

### 开发环境设置
1. Fork项目到您的GitHub账户
2. 克隆到本地开发环境
3. 安装Go依赖：`go mod tidy`
4. 启动开发服务器进行测试

### 提交规范
- 使用清晰的提交信息
- 添加必要的测试
- 更新相关文档

## 📄 许可证

本项目采用MIT许可证。详情请见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [Leaflet](https://leafletjs.com/) - 优秀的开源地图库
- [OpenStreetMap](https://www.openstreetmap.org/) - 免费可编辑的世界地图
- 百度地图、高德地图、Google地图等地图服务提供方
- 所有贡献者和用户

## 📞 支持与反馈

如有问题或建议，请：
- 提交GitHub Issue
- 查看项目Wiki获取更多信息
- 关注项目更新

---

**⭐ 如果这个项目对您有帮助，请给个Star支持一下！**

## 📋 开发计划

### 已完成 ✅
- 前端地图操作界面
- 标记点添加和编辑
- 连接线功能
- 多地图源支持
- 搜索功能
- 数据导入导出
- 本地存储
- 坐标转换（中国地图）
- HTML导出功能
- 分享功能
- 撤销操作
- 快捷键支持

### 待开发 🚧
- 支持Docker部署
- Markdown格式支持
- 搜索框bug修复
- 按钮底部对齐
- 按时间过滤
- 添加其他地图源
- 支持黑暗模式
- 飞机查询功能
  - 机场数据：https://raw.githubusercontent.com/jbrooksuk/JSON-Airports/master/airports.json
  - 航班计算：https://flights.ctrip.com/itinerary/oneway/{FROM}-{TO}?date={DATE}
