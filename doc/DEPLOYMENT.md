# 路书制作工具 - 部署指南

## 项目概述

路书制作工具是一个基于网页的地图标记和路线规划工具，允许用户在地图上添加标记点、连接路线，并导出分享您的行程规划。

### 技术架构

- **前端**: 基于纯HTML/CSS/JavaScript，使用Leaflet地图库
- **后端**: Go语言编写的API服务，处理地图搜索代理功能
- **反向代理**: Nginx服务器
- **部署方式**: 前后端分离部署

## 项目结构

```
roadbook/
├── static/                 # 前端静态文件
│   ├── index.html          # 主页面
│   ├── script.js           # 前端逻辑
│   ├── style.css           # 样式文件
│   └── html_export.js      # HTML导出功能
├── backend/                # 后端API服务
│   ├── main.go             # 主程序文件
│   ├── config.json         # 配置文件
│   ├── go.mod              # Go模块文件
│   └── go.sum              # Go依赖文件
├── nginx.conf              # Nginx配置文件
└── DEPLOYMENT.md           # 本部署指南
```

## 部署步骤

### 1. 环境准备

确保系统已安装以下软件：

- **Go语言环境** (用于后端服务)
- **Nginx服务器**
- **Git** (可选，用于拉取代码)

### 2. 部署前端文件

1. 将 `static/` 目录中的所有文件部署到Nginx的web目录：
   ```bash
   sudo cp -r static/* /var/www/html/
   ```

2. 或者创建符号链接：
   ```bash
   sudo ln -s /path/to/roadbook/static /var/www/roadbook
   ```

### 3. 部署后端服务

1. 进入后端目录：
   ```bash
   cd /path/to/roadbook/backend
   ```

2. 安装依赖：
   ```bash
   go mod tidy
   ```

3. 启动后端服务：
   ```bash
   go run main.go
   ```

   或者构建二进制文件：
   ```bash
   go build -o roadbook-backend
   ./roadbook-backend
   ```

4. 后端服务默认运行在端口 5436 (根据config.json配置)

### 4. 配置Nginx

1. 复制提供的nginx.conf配置文件到Nginx配置目录：
   ```bash
   sudo cp nginx.conf /etc/nginx/sites-available/roadbook
   sudo ln -s /etc/nginx/sites-available/roadbook /etc/nginx/sites-enabled/
   ```

2. 修改nginx.conf中的路径为实际路径：
   ```nginx
   # 将以下行中的路径修改为实际路径
   root /path/to/roadbook/static;
   ```

3. 测试Nginx配置：
   ```bash
   sudo nginx -t
   ```

4. 重启Nginx服务：
   ```bash
   sudo systemctl reload nginx
   # 或
   sudo systemctl restart nginx
   ```

## Nginx配置详解

### 静态文件服务

```nginx
location / {
    try_files $uri $uri/ =404;
}
```
此配置确保所有静态文件（HTML、CSS、JS、图片等）都能正确加载。

### API反向代理

```nginx
# 代理所有API请求到后端服务
location /api/ {
    proxy_pass http://127.0.0.1:5436/api/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;

    # CORS头设置
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
    add_header Access-Control-Allow-Headers "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range";
}
```

### 中国地图服务代理（兼容性配置）

为了与前端现有代码兼容，nginx也代理直接的cnmap和tianmap请求：

```nginx
location ~ ^/(cnmap|tianmap)/ {
    proxy_pass http://127.0.0.1:5436/api/$1/;
    # ... 相同的代理头配置
}
```

此配置支持扩展，可以轻松添加新的地图API端点。

## 后端API端点

### 当前支持的地图搜索服务

1. **百度地图搜索**
   - 前端路径: `/api/cnmap/search` 或 `/cnmap/search`
   - 参数: `q` - 搜索关键词
   - 示例: `GET /api/cnmap/search?q=清华大学`

2. **天地图搜索**
   - 前端路径: `/api/tianmap/search` 或 `/tianmap/search`
   - 参数: `q` - 搜索关键词
   - 示例: `GET /api/tianmap/search?q=天安门`

### API返回格式

所有搜索API都返回标准的Nominatim兼容格式：

```json
[
  {
    "place_id": 1234567890,
    "licence": "Data © Baidu Map",
    "osm_type": "node",
    "osm_id": 1234567890,
    "boundingbox": ["39.9042114", "39.9042114", "116.4073947", "116.4073947"],
    "lat": "39.9042114",
    "lon": "116.4073947",
    "display_name": "清华大学, 北京市海淀区",
    "class": "place",
    "type": "point",
    "importance": 0.75
  }
]
```

## 扩展性配置

nginx配置设计为可扩展，支持添加新的API端点：

1. **添加新的API路径**: 在后端添加新端点时，不需要修改nginx配置
2. **统一API前缀**: 建议新端点使用 `/api/` 前缀以保持一致性
3. **路径映射**: 可以通过修改 `location` 规则来处理特定路径映射

## 安全配置

### HTTPS配置（推荐）

为了提高安全性，建议配置HTTPS：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;

    # ... 其他配置相同
}
```

### 安全头设置

配置文件中包含以下安全头：
- `X-Content-Type-Options`: 防止MIME类型嗅探
- `X-Frame-Options`: 防止点击劫持
- `X-XSS-Protection`: 启用浏览器XSS保护

## 性能优化

### 静态文件缓存

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### Gzip压缩

推荐在Nginx中启用Gzip压缩：

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
```

## 故障排除

### 后端服务未启动

1. 检查后端服务状态：
   ```bash
   cd /path/to/roadbook/backend
   go run main.go
   ```

2. 检查端口是否被占用：
   ```bash
   netstat -tlnp | grep 5436
   ```

### Nginx配置错误

1. 检查Nginx错误日志：
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

2. 验证配置文件语法：
   ```bash
   sudo nginx -t
   ```

### API请求失败

1. 确认前端请求路径与nginx配置匹配
2. 检查后端服务是否正常运行
3. 查看浏览器开发者工具中的网络请求

## 启动脚本示例

```bash
#!/bin/bash
# 启动脚本: start_roadbook.sh

# 启动后端服务
cd /path/to/roadbook/backend
nohup go run main.go > backend.log 2>&1 &

# 等待后端启动
sleep 3

# 重启Nginx
sudo systemctl reload nginx

echo "路书制作工具已启动"
```

## 更新与维护

### 更新前端

1. 替换 `static/` 目录中的文件
2. 清除浏览器缓存或更新版本号

### 更新后端

1. 备份当前后端服务
2. 更新 `backend/` 目录中的代码
3. 重新启动后端服务

### Nginx配置更新

1. 修改配置文件
2. 测试配置：`sudo nginx -t`
3. 重载配置：`sudo systemctl reload nginx`

## 版本兼容性

- **Go版本**: 建议使用Go 1.19+
- **Nginx版本**: 建议使用Nginx 1.18+
- **浏览器**: 支持现代浏览器（Chrome 60+, Firefox 55+, Safari 12+）

## 负载均衡（高可用部署）

对于生产环境，可以配置负载均衡：

```nginx
upstream backend {
    server 127.0.0.1:5436;
    server 127.0.0.1:5437;  # 备用后端服务
}

server {
    # ... 前端配置

    location /api/ {
        proxy_pass http://backend/api/;
        # ... 其他代理配置
    }
}
```

通过以上配置，您可以成功部署路书制作工具并实现前后端分离的架构。
