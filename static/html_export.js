class RoadbookHtmlExporter {
    constructor(app) {
        this.app = app;
    }

    #getLocalDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    exportToHtml() {
        const data = this.prepareExportData();
        const htmlContent = this.generateHtmlContent(data);

        // 创建并下载HTML文件
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `roadbook_${this.#getLocalDateString(new Date())}_${Date.now()}.html`;
        a.click();

        URL.revokeObjectURL(url);
    }

    exportToTxt(returnOnly = false) {
        const data = this.prepareExportData();
        const txtContent = this.generateTxtContent(data);

        if (returnOnly) {
            return txtContent;
        }

        const blob = new Blob([txtContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `roadbook_${this.#getLocalDateString(new Date())}.txt`;
        a.click();

        URL.revokeObjectURL(url);
    }

    generateTxtContent(data) {
        let content = "行程安排\n\n";
        const markersById = new Map(data.markers.map(m => [m.id, m]));

        // Collect all events (markers and connections)
        const events = [];
        data.markers.forEach(marker => {
            if (marker.dateTimes && marker.dateTimes.length > 0) {
                marker.dateTimes.forEach(dtString => {
                    if (dtString) { // Ensure the string is not null or empty
                        const d = new Date(dtString);
                        if (!isNaN(d.getTime())) { // Check if the date is valid
                            events.push({ type: 'marker', data: marker, time: d });
                        }
                    }
                });
            }
        });
        data.connections.forEach(connection => {
            if (connection.dateTime) { // Ensure the string is not null or empty
                const d = new Date(connection.dateTime);
                if (!isNaN(d.getTime())) { // Check if the date is valid
                    events.push({ type: 'connection', data: connection, time: d });
                }
            }
        });

        // Sort events by time
        events.sort((a, b) => a.time - b.time);

        if (events.length === 0) {
            return "没有有效的行程数据可供导出。";
        }

        // Group events by day
        const eventsByDay = {};
        events.forEach(event => {
            const day = this.#getLocalDateString(event.time);
            if (!eventsByDay[day]) {
                eventsByDay[day] = [];
            }
            eventsByDay[day].push(event);
        });

        // Generate content for each day
        let totalTripCost = 0;
        for (const day in eventsByDay) {
            content += `日期: ${day}\n`;
            const dayEvents = eventsByDay[day];
            let lastMarker = null;

            dayEvents.forEach(event => {
                if (event.type === 'marker') {
                    if (lastMarker !== event.data.title) {
                        content += `- 地点: ${event.data.title} (坐标: ${event.data.position[0].toFixed(2)}, ${event.data.position[1].toFixed(2)})\n`;
                        lastMarker = event.data.title;
                    }
                } else if (event.type === 'connection') {
                    const startMarker = markersById.get(event.data.startId);
                    const endMarker = markersById.get(event.data.endId);
                    if (startMarker && endMarker) {
                        content += `  交通: 从 ${startMarker.title} 到 ${endMarker.title}，乘坐 ${this.getTransportTypeName(event.data.transportType)}\n`;
                    }
                }
            });

            // 添加日期备注和消费信息
            if (data.dateNotes && data.dateNotes[day]) {
                const noteEntry = data.dateNotes[day];
                let notesText = '';
                let expensesList = [];

                if (typeof noteEntry === 'string') {
                    notesText = noteEntry;
                } else if (noteEntry && typeof noteEntry === 'object') {
                    notesText = noteEntry.notes || '';
                    expensesList = noteEntry.expenses || [];
                }

                if (notesText) {
                    content += `  备注: ${this.stripMarkdownLinks(notesText).replace(/\n/g, ' ')}\n`;
                }

                if (expensesList.length > 0) {
                    content += `  消费明细:\n`;
                    let dayCost = 0;
                    expensesList.forEach(exp => {
                        const cost = parseFloat(exp.cost) || 0;
                        dayCost += cost;
                        content += `    - ¥${cost.toFixed(2)}: ${this.stripMarkdownLinks(exp.remark || '无备注')}\n`;
                    });
                    content += `  当日总消费: ¥${dayCost.toFixed(2)}\n`;
                    totalTripCost += dayCost;
                }
            }

            content += "\n";
        }

        if (totalTripCost > 0) {
            content += `行程总预计消费: ¥${totalTripCost.toFixed(2)}\n`;
        }

        return content;
    }

    getTransportTypeName(type) {
        const names = {
            car: '汽车',
            train: '火车',
            subway: '地铁',
            plane: '飞机',
            walk: '步行',
            bus: '公交',
            cruise: '游轮'
        };
        return names[type] || '其他';
    }

    stripMarkdownLinks(text) {
        if (!text) return '';
        return text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    }





    prepareExportData() {
        return {
            version: window.ROADBOOK_APP_VERSION || 'unknown',
            exportTime: new Date().toISOString(),
            currentLayer: this.app.currentLayer,
            currentSearchMethod: this.app.currentSearchMethod,
            markers: this.app.markers.map((m) => ({
                id: m.id,
                position: m.position,
                title: m.title,
                labels: m.labels,
                logo: m.logo,
                createdAt: m.createdAt,
                dateTimes: m.dateTimes || [m.dateTime],
                icon: m.icon
            })),
            connections: this.app.connections.map(c => {
                const startMarker = this.app.markers.find(m => m.id === c.startId);
                const endMarker = this.app.markers.find(m => m.id === c.endId);

                return {
                    id: c.id,
                    startId: c.startId,
                    endId: c.endId,
                    transportType: c.transportType,
                    dateTime: c.dateTime,
                    label: c.label,
                    logo: c.logo,
                    duration: c.duration || 0,
                    startTitle: startMarker ? startMarker.title : c.startTitle,
                    endTitle: endMarker ? endMarker.title : c.endTitle
                };
            }),
            labels: this.app.labels.map(l => ({
                markerIndex: this.app.markers.indexOf(l.marker),
                content: l.content
            })),
            dateNotes: this.app.dateNotes || {}
        };
    }

    generateHtmlContent(data) {
        return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RoadbookMaker Share - ${new Date().toLocaleDateString('zh-CN')}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        ${this.generateCssStyles()}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="header-top">
                <div style="display: flex; align-items: center; justify-content: center; position: relative; width: 100%;">
                    <button id="exportHelpBtn" class="help-btn" title="导出界面帮助" style="position: absolute; left: 10px; width: 40px; height: 40px; background: linear-gradient(135deg, #66b3ff 0%, #3a8fd4 100%); border: none; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; color: white; box-shadow: 0 2px 8px rgba(58, 143, 212, 0.4); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); backdrop-filter: blur(10px); z-index: 1001;">❓</button>
                    <h1>RoadbookMaker Share</h1>
                </div>
            </div>
        </header>

        <main>
            <div id="logoPreview" class="logo-preview" style="display: none; position: fixed; z-index: 10000; pointer-events: none;">
                <img id="logoPreviewImg" class="logo-preview-img" alt="Logo预览" style="max-width: 100px; max-height: 100px; border-radius: 4px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
            </div>
            <div id="mapContainer" style="height: 100%; width: 100%;"></div>
            <!-- 移动端菜单切换按钮 -->
            <button id="menuToggleBtn" class="menu-toggle-btn">☰</button>
            <!-- 右侧面板用于显示日期分组信息 -->
            <div class="right-panel">
                <div class="sidebar" id="markerListPanel">
                    <div class="sidebar-header">
                        <h3>日程列表</h3>
                        <button id="closeSidebarBtn" class="close-btn">×</button>
                    </div>
                    <div id="markerList"></div>
                    <div id="totalExpensesContainer" class="total-expenses-container" style="display: none;">
                        <span>预计总花费:</span>
                        <span id="totalExpensesAmount">0</span>
                    </div>
                </div>
            </div>
            <!-- 日期备注便签 -->
            <div id="dateNotesSticky" class="date-notes-sticky" style="display: none;">
                <div class="date-notes-header">
                    <span id="dateNotesDate"></span>
                    <button id="closeDateNotesSticky" class="close-sticky-btn">×</button>
                </div>
                <div id="dateNotesContent" class="date-notes-content"></div>
            </div>
            <div class="github-corner">
                <a href="https://github.com/chenxuan520/roadbook" target="_blank" class="github-corner-link" title="GitHub" rel="noopener noreferrer">
                    <svg width="60" height="60" viewBox="0 0 250 250" style="fill:#000000; color:#fff;" aria-hidden="true">
                        <path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path>
                        <path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style="transform-origin: 130px 106px;" class="octo-arm"></path>
                        <path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body"></path>
                    </svg>
                </a>
            </div>
        </main>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        // 解析内联数据 - 使用安全的编码方式
        const roadbookData = JSON.parse(decodeURIComponent(\`${encodeURIComponent(JSON.stringify(data))}\`));

        // 初始化只读地图
        document.addEventListener('DOMContentLoaded', function() {
            // 初始化地图
            const map = L.map('mapContainer').setView([39.90923, 116.397428], 10); // 北京天安门

            // 定义地图图层
            const mapLayers = {
                osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors',
                    maxZoom: 19
                }),
                satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    attribution: 'Tiles © Esri',
                    maxZoom: 19
                }),
                // 高德地图矢量地图 - 无需key，直接访问瓦片
                gaode: L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
                    attribution: '© 高德地图',
                    maxZoom: 19,
                    subdomains: ['1', '2', '3', '4']
                }),
                // 高德地图卫星图 - 无需key，直接访问瓦片
                gaode_satellite: L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {
                    attribution: '© 高德地图',
                    maxZoom: 19,
                    subdomains: ['1', '2', '3', '4']
                }),
                // Google地图 - 无需key，直接访问瓦片
                google: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
                    attribution: '© Google Maps',
                    maxZoom: 19,
                    subdomains: ['0', '1', '2', '3']
                }),
                // Google地图卫星图 - 无需key，直接访问瓦片
                google_satellite: L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
                    attribution: '© Google Maps',
                    maxZoom: 19,
                    subdomains: ['0', '1', '2', '3']
                })
            };

            // 添加当前图层到地图
            const currentLayer = roadbookData.currentLayer || 'gaode';
            if (mapLayers[currentLayer]) {
                mapLayers[currentLayer].addTo(map);
            } else {
                mapLayers['gaode'].addTo(map); // 默认高德地图
            }

            // 添加比例尺控件
            L.control.scale({imperial: false, metric: true}).addTo(map);

            // 只读模式下添加标记点
            roadbookData.markers.forEach(markerData => {
                const icon = createMarkerIcon(markerData.icon, 0);
                const marker = L.marker([markerData.position[0], markerData.position[1]], {
                    icon: icon,
                    draggable: false, // 禁用拖拽
                    title: markerData.title
                }).addTo(map);

                // 添加点击弹窗显示详细信息
                marker.bindPopup(generateMarkerPopupContent(markerData));

                marker.on('mouseover', function(e) {
                    if (e.target.getElement()) {
                        e.target.getElement()._savedTitle = e.target.getElement().getAttribute('title');
                        e.target.getElement().removeAttribute('title');
                    }
                    showMarkerTooltip(markerData, e.latlng);
                    if (markerData.logo) {
                        showLogoPreview(markerData.logo, e);
                    }
                });

                marker.on('mouseout', function(e) {
                    if (e.target.getElement() && e.target.getElement()._savedTitle) {
                        e.target.getElement().setAttribute('title', e.target.getElement()._savedTitle);
                    }
                    hideMarkerTooltip();
                    hideLogoPreview();
                });
            });

            // 只读模式下添加连接线
            roadbookData.connections.forEach(connData => {
                // 查找起始点和终点
                const startMarker = roadbookData.markers.find(m => m.id === connData.startId);
                const endMarker = roadbookData.markers.find(m => m.id === connData.endId);

                if (!startMarker || !endMarker) return;

                // 创建连接线
                const polyline = L.polyline([
                    [startMarker.position[0], startMarker.position[1]],
                    [endMarker.position[0], endMarker.position[1]]
                ], {
                    color: getTransportColor(connData.transportType),
                    weight: 6,
                    opacity: 1.0,
                    smoothFactor: 1.0
                }).addTo(map);

                // 添加终点标记（小圆点）
                const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
                    radius: 6,
                    fillColor: getTransportColor(connData.transportType),
                    color: '#fff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 1
                }).addTo(map);

                // 创建箭头
                const arrowHead = createArrowHead([startMarker.position[0], startMarker.position[1]], [endMarker.position[0], endMarker.position[1]], connData.transportType);
                arrowHead.addTo(map);

                // 计算中点位置并添加交通图标
                const startLat = parseFloat(startMarker.position[0]);
                const startLng = parseFloat(startMarker.position[1]);
                const endLat = parseFloat(endMarker.position[0]);
                const endLng = parseFloat(endMarker.position[1]);

                if (!isNaN(startLat) && !isNaN(startLng) && !isNaN(endLat) && !isNaN(endLng)) {
                    const midLat = (startLat + endLat) / 2;
                    const midLng = (startLng + endLng) / 2;
                    const transportIcon = getTransportIcon(connData.transportType);

                    const iconMarker = L.marker([midLat, midLng], {
                        icon: L.divIcon({
                            className: 'transport-icon',
                            html: \`
                                <div style="background-color: white; border: 2px solid \${getTransportColor(connData.transportType)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">\${transportIcon}</div>
                            \`,
                            iconSize: [30, 30],
                            iconAnchor: [15, 15]
                        })
                    }).addTo(map);

                    // 为连接线添加弹窗
                    polyline.bindPopup(generateConnectionPopupContent(connData, startMarker, endMarker));

                    // Add tooltip and logo preview events
                    polyline.on('mouseover', function(e) {
                        showConnectionTooltip(connData, e.latlng);
                        if (connData.logo) {
                            showLogoPreview(connData.logo, e);
                        }
                    });
                    polyline.on('mouseout', function() {
                        hideConnectionTooltip();
                        hideLogoPreview();
                    });
                }
            });

            // 保留地图交互功能
            // 注意：我们不限制交互，保持地图的可缩放、拖拽功能
            // 只是不允许编辑功能

            // 如果有标记点，自动调整视窗以包含所有元素
            if (roadbookData.markers.length > 0) {
                const group = new L.featureGroup([
                    ...roadbookData.markers.map(m => L.marker([m.position[0], m.position[1]])),
                    ...roadbookData.connections.map(c => L.polyline([
                        [roadbookData.markers.find(m => m.id === c.startId)?.position[0], roadbookData.markers.find(m => m.id === c.startId)?.position[1]],
                        [roadbookData.markers.find(m => m.id === c.endId)?.position[0], roadbookData.markers.find(m => m.id === c.endId)?.position[1]]
                    ]))
                ]);

                if (group.getLayers().length > 0) {
                    map.fitBounds(group.getBounds().pad(0.1));
                }
            }

            // 创建标记点图标的函数
            function createMarkerIcon(iconConfig, _number) {
                const icon = iconConfig.icon || '📍';
                const color = iconConfig.color || '#667eea';

                const displayContent = icon;

                return L.divIcon({
                    className: 'custom-marker',
                    html: \`
                        <div style="background-color: \${color}; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">\${displayContent}</div>
                    \`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });
            }

            // 获取交通方式颜色
            function getTransportColor(type) {
                const colors = {
                    car: '#FF5722',
                    train: '#2196F3',
                    subway: '#9C27B0',  // 地铁 - 紫色
                    plane: '#4CAF50',
                    walk: '#FF9800',
                    bus: '#795548',  // 公交 - 棕色
                    cruise: '#00BCD4' // 游轮 - 青色
                };
                return colors[type] || '#666';
            }

            // 获取交通方式图标
            function getTransportIcon(type) {
                const icons = {
                    car: '🚗',
                    train: '🚄',
                    subway: '🚇',  // 地铁
                    plane: '✈️',
                    walk: '🚶',
                    bus: '🚌',  // 公交
                    cruise: '🚢' // 游轮
                };
                return icons[type] || '•';
            }

            // 创建箭头
            function createArrowHead(startPos, endPos, transportType) {
                const startLat = parseFloat(startPos[0]);
                const startLng = parseFloat(startPos[1]);
                const endLat = parseFloat(endPos[0]);
                const endLng = parseFloat(endPos[1]);

                // 计算方向角度
                const deltaLat = endLat - startLat;
                const deltaLng = endLng - startLng;

                // 计算基础角度（弧度）
                let angle = Math.atan2(deltaLng, deltaLat);

                // 转换为角度
                angle = angle * 180 / Math.PI;

                // 计算线段长度的75%位置
                const ratio = 0.75;
                const arrowLat = startLat + (endLat - startLat) * ratio;
                const arrowLng = startLng + (endLng - startLng) * ratio;

                // 创建箭头图标
                const arrowColor = getTransportColor(transportType);
                const arrowIcon = L.divIcon({
                    className: 'arrow-icon',
                    html: \`
                        <div style="
                            position: relative;
                            width: 28px;
                            height: 28px;
                            transform: rotate(\${angle}deg);
                            transform-origin: center;">
                            <div style="
                                position: absolute;
                                top: 0;
                                left: 50%;
                                transform: translateX(-50%);
                                width: 0;
                                height: 0;
                                border-left: 10px solid transparent;
                                border-right: 10px solid transparent;
                                border-bottom: 20px solid \${arrowColor};
                                filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));
                            "></div>
                        </div>
                    \`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });

                return L.marker([arrowLat, arrowLng], {
                    icon: arrowIcon,
                    interactive: false
                });
            }

            // 计算两点之间的直线距离（米）
            function calculateLineDistance(latlng1, latlng2) {
                const R = 6371e3; // 地球半径（米）
                const φ1 = latlng1[0] * Math.PI/180;
                const φ2 = latlng2[0] * Math.PI/180;
                const Δφ = (latlng2[0]-latlng1[0]) * Math.PI/180;
                const Δλ = (latlng2[1]-latlng1[1]) * Math.PI/180;

                const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                        Math.cos(φ1) * Math.cos(φ2) *
                        Math.sin(Δλ/2) * Math.sin(Δλ/2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

                return R * c; // 距离以米为单位
            }

            // 生成标记点弹窗内容
            function generateMarkerPopupContent(markerData) {
                let content = '<div class="popup-content">';
                content += '<h3>' + markerData.title + '</h3>';

                // 格式化时间显示，只在小时或分钟不为0时显示时分
                if (markerData.dateTimes && markerData.dateTimes.length > 0) {
                    const formattedTimes = markerData.dateTimes.map(dt => formatTime(dt));
                    content += '<p><strong>时间:</strong> ' + formattedTimes.join(', ') + '</p>';
                } else if (markerData.dateTime) {
                    content += '<p><strong>时间:</strong> ' + formatTime(markerData.dateTime) + '</p>';
                }

                if (markerData.labels && markerData.labels.length > 0) {
                    content += '<p><strong>标注:</strong> ' + convertMarkdownLinksToHtml(markerData.labels.join('; ')) + '</p>';
                }

                content += '<p><strong>坐标:</strong> ' + markerData.position[1].toFixed(6) + ', ' + markerData.position[0].toFixed(6) + '</p>';
                content += '</div>';

                return content;
            }

            // 生成连接线弹窗内容
            function generateConnectionPopupContent(connData, startMarker, endMarker) {
                let content = '<div class="popup-content">';
                content += '<h3>' + startMarker.title + ' → ' + endMarker.title + '</h3>';
                content += '<p><strong>交通方式:</strong> ' + getTransportIcon(connData.transportType) + ' ' + getTransportTypeName(connData.transportType) + '</p>';

                // 动态计算并显示距离
                if (startMarker.position && endMarker.position) {
                    const distance = calculateLineDistance(startMarker.position, endMarker.position);
                    let distanceStr;
                    if (distance > 1000) {
                        distanceStr = (distance / 1000).toFixed(2) + ' km';
                    } else {
                        distanceStr = Math.round(distance) + ' m';
                    }
                    content += '<p><strong>距离:</strong> ' + distanceStr + '</p>';
                }

                if (connData.duration > 0) {
                    content += '<p><strong>耗时:</strong> ' + connData.duration + ' 小时</p>';
                }

                if (connData.dateTime) {
                    // 使用相同的格式化方式显示时间
                    content += '<p><strong>时间:</strong> ' + formatTime(connData.dateTime) + '</p>';
                }

                if (connData.label) {
                    content += '<p><strong>标注:</strong> ' + convertMarkdownLinksToHtml(connData.label) + '</p>';
                }

                // 添加导航链接
                const startLat = startMarker.position[0];
                const startLng = startMarker.position[1];
                const endLat = endMarker.position[0];
                const endLng = endMarker.position[1];
                const startTitle = startMarker.title || '起点';
                const endTitle = endMarker.title || '终点';

                content += '<div class="navigation-links" style="margin-top: 8px; font-size: 0.9rem;">';
                content += '<p><strong>导航:</strong> ';
                content += '<a href="http://api.map.baidu.com/direction?origin=latlng:' + startLat + ',' + startLng + '|name:' + encodeURIComponent(startTitle) + '&destination=latlng:' + endLat + ',' + endLng + '|name:' + encodeURIComponent(endTitle) + '&mode=driving&region=中国&output=html&coord_type=gcj02&src=webapp.demo" target="_blank" style="margin: 0 5px; text-decoration: underline;">百度导航</a>';
                content += '<a href="https://uri.amap.com/navigation?from=' + startLng + ',' + startLat + ',' + encodeURIComponent(startTitle) + '&to=' + endLng + ',' + endLat + ',' + encodeURIComponent(endTitle) + '&mode=car&policy=1&coordinate=gaode" target="_blank" style="margin: 0 5px; text-decoration: underline;">高德导航</a>';
                content += '<a href="https://apis.map.qq.com/uri/v1/routeplan?type=drive&from=' + encodeURIComponent(startTitle) + '&fromcoord=' + startLat + ',' + startLng + '&to=' + encodeURIComponent(endTitle) + '&tocoord=' + endLat + ',' + endLng + '&referer=myapp" target="_blank" style="margin: 0 5px; text-decoration: underline;">腾讯导航</a>';
                content += '<a href="https://www.google.com/maps/dir/?api=1&origin=' + startLat + ',' + startLng + '&destination=' + endLat + ',' + endLng + '" target="_blank" style="margin: 0 5px; text-decoration: underline;">Google导航</a>';
                content += '</p>';
                content += '</div>';

                content += '</div>';

                return content;
            }

            // 获取交通方式类型名称
            function getTransportTypeName(type) {
                const names = {
                    car: '汽车',
                    train: '火车',
                    subway: '地铁',
                    plane: '飞机',
                    walk: '步行',
                    bus: '公交',
                    cruise: '游轮'
                };
                return names[type] || '其他';
            }

            // 显示logo预览
            function showLogoPreview(logoUrl, event) {
                if (!logoUrl || !event) {
                    hideLogoPreview();
                    return;
                }

                const logoPreview = document.getElementById('logoPreview');
                const logoPreviewImg = document.getElementById('logoPreviewImg');

                if (!logoPreview || !logoPreviewImg) {
                    return;
                }

                logoPreviewImg.src = logoUrl;

                logoPreviewImg.onload = () => {
                    logoPreview.style.position = 'fixed';
                    logoPreview.style.left = event.originalEvent.clientX + 'px';
                    logoPreview.style.top = (event.originalEvent.clientY + 15) + 'px';
                    logoPreview.style.display = 'block';
                    logoPreview.style.opacity = '0';
                    setTimeout(() => {
                        logoPreview.style.opacity = '1';
                    }, 10);
                };

                logoPreviewImg.onerror = () => {
                    logoPreview.style.display = 'none';
                };
            }

            // 隐藏Logo预览
            function hideLogoPreview() {
                const logoPreview = document.getElementById('logoPreview');
                if (logoPreview) {
                    logoPreview.style.display = 'none';
                }
            }

            // 实现日期分组功能，包含点击聚焦和备注功能
            function updateMarkerList() {
                const listContainer = document.getElementById('markerList');
                listContainer.innerHTML = '';

                // 按日期分组标记点
                const markersByDate = groupMarkersByDate();

                // 获取所有日期并排序（从早到晚）
                const allDates = getAllDatesFromMarkers();

                // 初始化collapsedDates对象，用于存储展开/收起状态
                if (typeof window.collapsedDates === 'undefined') {
                    window.collapsedDates = {};
                }

                allDates.forEach(date => {
                    // 创建日期分组标题
                    const dateHeader = document.createElement('div');
                    dateHeader.className = 'date-group-header';
                    const markers = markersByDate[date] || [];
                    // 默认为展开状态
                    const isCollapsed = window.collapsedDates[date] || false;
                    const expandIcon = isCollapsed ? '📁' : '📂'; // 收起状态显示▶，展开状态显示▼

                    dateHeader.innerHTML = \`
                        <h4 style="display: flex; align-items: center; gap: 8px;">
                            <span class="expand-toggle">\${expandIcon}</span>
                            \${formatDateHeader(date)}
                        </h4>
                        <span class="marker-count">\${markers.length} 个地点</span>
                    \`;

                    // 为日期标题添加展开/收起功能，同时保留筛选功能
                    dateHeader.style.cursor = 'pointer';
                    const expandToggle = dateHeader.querySelector('.expand-toggle');
                    dateHeader.addEventListener('click', (e) => {
                        // 如果点击的是展开/收起按钮，则只执行展开/收起功能
                        if (e.target.classList.contains('expand-toggle') || e.target === expandToggle) {
                            // 切换展开/收起状态
                            window.collapsedDates[date] = !window.collapsedDates[date];
                            // 重新渲染整个列表以更新展开/收起状态
                            updateMarkerList();
                            // 阻止事件冒泡，避免触发其他点击事件
                            e.stopPropagation();
                        } else {
                            // 否则执行筛选功能
                            filterByDate(date); // 执行筛选并自动调整视窗
                            // 在筛选后显示日期备注，这样用户可以查看备注
                            setTimeout(() => {
                                showDateNotesSticky(date);
                            }, 300); // 延迟显示备注，让视窗调整完成
                        }
                    });

                    listContainer.appendChild(dateHeader);

                    // 按最早时间排序该日期的标记点
                    const sortedMarkers = sortMarkersByEarliestTime(markers, date);

                    // 如果未收起，则显示该日期的标记点
                    if (!window.collapsedDates[date]) {
                        // 添加该日期的所有标记点
                        sortedMarkers.forEach(marker => {
                            const item = document.createElement('div');
                            item.className = 'marker-item';

                            // 显示该日期对应的时间点（只显示这一天的）
                            const dayTimes = getMarkerTimesForDate(marker, date);
                            const timeDisplay = dayTimes.length > 0
                                ? dayTimes.map(dt => formatTime(dt)).join(', ')
                                : '';

                            item.innerHTML = \`
                                <div class="marker-info">
                                    <div class="title">\${marker.title}</div>
                                    <div class="coords">\${marker.position[1].toFixed(6)}, \${marker.position[0].toFixed(6)}</div>
                                    <div class="time-info">\${timeDisplay}</div>
                                </div>
                            \`;

                            // 点击标记点信息在地图上定位
                            item.querySelector('.marker-info').addEventListener('click', () => {
                                map.setView([marker.position[0], marker.position[1]], 15); // 跳转到标记点位置
                            });

                            listContainer.appendChild(item);
                        });
                    }
                });
            }

            // 按日期分组标记点 - 包含所有出现过的日期
            function groupMarkersByDate() {
                const groups = {};

                roadbookData.markers.forEach(marker => {
                    // 获取该标记点的所有日期
                    const markerDates = getMarkerAllDates(marker);

                    // 将该标记点添加到它出现的所有日期分组中
                    markerDates.forEach(dateKey => {
                        if (!groups[dateKey]) {
                            groups[dateKey] = [];
                        }
                        groups[dateKey].push(marker);
                    });
                });

                return groups;
            }

            // 获取标记点所有出现的日期
            function getMarkerAllDates(marker) {
                const dates = new Set();

                if (marker.dateTimes && marker.dateTimes.length > 0) {
                    marker.dateTimes.forEach(dateTime => {
                        const dateKey = getDateKey(dateTime);
                        if (dateKey !== '未知日期') {
                            dates.add(dateKey);
                        }
                    });
                } else if (marker.dateTime) {
                    const dateKey = getDateKey(marker.dateTime);
                    if (dateKey !== '未知日期') {
                        dates.add(dateKey);
                    }
                }

                return Array.from(dates);
            }

            // 获取日期键（YYYY-MM-DD格式）
            function getDateKey(dateTimeString) {
                if (!dateTimeString) return '未知日期';
                try {
                    const date = new Date(dateTimeString);
                    if (isNaN(date.getTime())) return '未知日期';
                    // 使用本地时区的日期，而不是UTC
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    return year + '-' + month + '-' + day; // YYYY-MM-DD in local timezone
                } catch (error) {
                    return '未知日期';
                }
            }

            // 格式化日期标题
            function formatDateHeader(dateKey) {
                if (dateKey === '未知日期') return dateKey;
                try {
                    const date = new Date(dateKey);
                    // 获取今天的日期键（本地时区）
                    const today = new Date();
                    const todayKey = getDateKey(today.toISOString());

                    // 获取昨天的日期键（本地时区）
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    const yesterdayKey = getDateKey(yesterday.toISOString());

                    if (dateKey === todayKey) {
                        return '今天';
                    } else if (dateKey === yesterdayKey) {
                        return '昨天';
                    } else {
                        return \`\${date.getMonth() + 1}月\${date.getDate()}日 (\${getWeekdayName(date.getDay())})\`;
                    }
                } catch (error) {
                    return dateKey;
                }
            }

            // 获取星期几的中文名称
            function getWeekdayName(day) {
                const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                return weekdays[day];
            }

            // 格式化时间（只在小时或分钟不为0时显示）
            function formatTime(dateTimeString) {
                if (!dateTimeString) return '';
                try {
                    const date = new Date(dateTimeString);
                    if (isNaN(date.getTime())) return '';

                    // 检查小时和分钟是否为0
                    const hours = date.getHours();
                    const minutes = date.getMinutes();

                    // 如果小时和分钟都为0，则只显示日期部分
                    if (hours === 0 && minutes === 0) {
                        // 只返回日期部分
                        return date.toLocaleDateString('zh-CN');
                    } else {
                        // 显示日期和时间（时:分）
                        return date.toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                        });
                    }
                } catch (error) {
                    return '';
                }
            }

            // 按最早时间排序标记点（创建副本避免修改原数组）
            function sortMarkersByEarliestTime(markers, dateKey) {
                return [...markers].sort((a, b) => {
                    // 获取每个标记点在该日期的最早时间
                    const aTimes = getMarkerTimesForDate(a, dateKey);
                    const bTimes = getMarkerTimesForDate(b, dateKey);

                    if (aTimes.length === 0 && bTimes.length === 0) return 0;
                    if (aTimes.length === 0) return 1; // a没有时间，排后面
                    if (bTimes.length === 0) return -1; // b没有时间，排后面

                    // 按最早时间排序（时间小的在前）
                    const aEarliest = new Date(aTimes[0]);
                    const bEarliest = new Date(bTimes[0]);

                    return aEarliest - bEarliest;
                });
            }

            // 获取标记点在指定日期的时间点
            function getMarkerTimesForDate(marker, dateKey) {
                const times = [];

                if (marker.dateTimes && marker.dateTimes.length > 0) {
                    marker.dateTimes.forEach(dateTime => {
                        const dtDateKey = getDateKey(dateTime);
                        if (dtDateKey === dateKey) {
                            times.push(dateTime);
                        }
                    });
                } else if (marker.dateTime) {
                    const dtDateKey = getDateKey(marker.dateTime);
                    if (dtDateKey === dateKey) {
                        times.push(marker.dateTime);
                    }
                }

                return times;
            }

            // 获取所有标记点中出现过的日期（从早到晚排序）
            function getAllDatesFromMarkers() {
                const allDates = new Set();

                roadbookData.markers.forEach(marker => {
                    const markerDates = getMarkerAllDates(marker);
                    markerDates.forEach(date => {
                        if (date !== '未知日期') {
                            allDates.add(date);
                        }
                    });
                });

                // 转换为数组并按日期排序（从早到晚）
                return Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));
            }

            // 添加变量跟踪过滤模式状态
            let isFilteredMode = false;
            let filteredDate = null;

            // 按日期筛选功能 (只读模式)
            function filterByDate(date) {
                // 设置过滤模式状态
                isFilteredMode = true;
                filteredDate = date;

                // 隐藏所有标记点
                map.eachLayer(function(layer) {
                    if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                        map.removeLayer(layer);
                    }
                });

                // 显示筛选日期内的标记点
                roadbookData.markers.forEach(marker => {
                    const markerDates = getMarkerAllDates(marker);
                    if (markerDates.includes(date)) {
                        const icon = createMarkerIcon(marker.icon, 0);
                        const markerObj = L.marker([marker.position[0], marker.position[1]], {
                            icon: icon,
                            draggable: false, // 禁用拖拽
                            title: marker.title
                        }).addTo(map);

                        // 添加点击弹窗显示详细信息
                        markerObj.bindPopup(generateMarkerPopupContent(marker));

                        // 添加鼠标悬浮事件
                        markerObj.on('mouseover', function(e) {
                            showMarkerTooltip(marker, e.latlng);
                        });

                        // 添加鼠标移出事件
                        markerObj.on('mouseout', function() {
                            hideMarkerTooltip();
                        });
                    }
                });

                // 显示筛选日期内的连接线
                roadbookData.connections.forEach(connection => {
                    const connectionDate = getDateKey(connection.dateTime);
                    if (connectionDate === date) {
                        // 查找起始点和终点
                        const startMarker = roadbookData.markers.find(m => m.id === connection.startId);
                        const endMarker = roadbookData.markers.find(m => m.id === connection.endId);

                        if (startMarker && endMarker) {
                            // 创建连接线
                            const polyline = L.polyline([
                                [startMarker.position[0], startMarker.position[1]],
                                [endMarker.position[0], endMarker.position[1]]
                            ], {
                                color: getTransportColor(connection.transportType),
                                weight: 6,
                                opacity: 1.0,
                                smoothFactor: 1.0
                            }).addTo(map);

                            // 添加终点标记（小圆点）
                            const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
                                radius: 6,
                                fillColor: getTransportColor(connection.transportType),
                                color: '#fff',
                                weight: 2,
                                opacity: 1,
                                fillOpacity: 1
                            }).addTo(map);

                            // 创建箭头
                            const arrowHead = createArrowHead([startMarker.position[0], startMarker.position[1]], [endMarker.position[0], endMarker.position[1]], connection.transportType);
                            arrowHead.addTo(map);

                            // 计算中点位置并添加交通图标
                            const startLat = parseFloat(startMarker.position[0]);
                            const startLng = parseFloat(startMarker.position[1]);
                            const endLat = parseFloat(endMarker.position[0]);
                            const endLng = parseFloat(endMarker.position[1]);

                            if (!isNaN(startLat) && !isNaN(startLng) && !isNaN(endLat) && !isNaN(endLng)) {
                                const midLat = (startLat + endLat) / 2;
                                const midLng = (startLng + endLng) / 2;
                                const transportIcon = getTransportIcon(connection.transportType);

                                const iconMarker = L.marker([midLat, midLng], {
                                    icon: L.divIcon({
                                        className: 'transport-icon',
                                        html: \`
                                            <div style="background-color: white; border: 2px solid \${getTransportColor(connection.transportType)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">\${transportIcon}</div>
                                        \`,
                                        iconSize: [30, 30],
                                        iconAnchor: [15, 15]
                                    })
                                }).addTo(map);

                                // 为连接线添加弹窗
                                polyline.bindPopup(generateConnectionPopupContent(connection, startMarker, endMarker));

                                // 为连接线添加鼠标悬浮事件
                                polyline.on('mouseover', function(e) {
                                    showConnectionTooltip(connection, e.latlng);
                                });

                                // 为连接线添加鼠标移出事件
                                polyline.on('mouseout', function() {
                                    hideConnectionTooltip();
                                });
                            }
                        }
                    }
                });

                // 自动调整视窗以聚焦到筛选后的元素
                autoFitMapViewAfterFilter();

                // 在移动端自动关闭侧边栏以便用户查看筛选结果
                if (isMobileDevice()) {
                    const rightPanel = document.querySelector('.right-panel');
                    const menuToggleBtn = document.getElementById('menuToggleBtn');
                    if (rightPanel) {
                        rightPanel.classList.remove('active');
                    }
                    if (menuToggleBtn) {
                        menuToggleBtn.textContent = '☰';
                    }
                }
            }

            // 退出过滤模式的函数
            function exitFilterMode() {
                if (!isFilteredMode) return;

                isFilteredMode = false;
                filteredDate = null;

                // 重新加载所有标记点和连接线
                map.eachLayer(function(layer) {
                    if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                        map.removeLayer(layer);
                    }
                });

                // 添加所有标记点
                roadbookData.markers.forEach(markerData => {
                    const icon = createMarkerIcon(markerData.icon, 0);
                    const marker = L.marker([markerData.position[0], markerData.position[1]], {
                        icon: icon,
                        draggable: false, // 禁用拖拽
                        title: markerData.title
                    }).addTo(map);

                    // 添加点击弹窗显示详细信息
                    marker.bindPopup(generateMarkerPopupContent(markerData));

                    // 添加鼠标悬浮事件
                    marker.on('mouseover', function(e) {
                        showMarkerTooltip(markerData, e.latlng);
                    });

                    // 添加鼠标移出事件
                    marker.on('mouseout', function() {
                        hideMarkerTooltip();
                    });
                });

                // 添加所有连接线
                roadbookData.connections.forEach(connData => {
                    // 查找起始点和终点
                    const startMarker = roadbookData.markers.find(m => m.id === connData.startId);
                    const endMarker = roadbookData.markers.find(m => m.id === connData.endId);

                    if (!startMarker || !endMarker) return;

                    // 创建连接线
                    const polyline = L.polyline([
                        [startMarker.position[0], startMarker.position[1]],
                        [endMarker.position[0], endMarker.position[1]]
                    ], {
                        color: getTransportColor(connData.transportType),
                        weight: 6,
                        opacity: 1.0,
                        smoothFactor: 1.0
                    }).addTo(map);

                    // 添加终点标记（小圆点）
                    const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
                        radius: 6,
                        fillColor: getTransportColor(connData.transportType),
                        color: '#fff',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 1
                    }).addTo(map);

                    // 创建箭头
                    const arrowHead = createArrowHead([startMarker.position[0], startMarker.position[1]], [endMarker.position[0], endMarker.position[1]], connData.transportType);
                    arrowHead.addTo(map);

                    // 计算中点位置并添加交通图标
                    const startLat = parseFloat(startMarker.position[0]);
                    const startLng = parseFloat(startMarker.position[1]);
                    const endLat = parseFloat(endMarker.position[0]);
                    const endLng = parseFloat(endMarker.position[1]);

                    if (!isNaN(startLat) && !isNaN(startLng) && !isNaN(endLat) && !isNaN(endLng)) {
                        const midLat = (startLat + endLat) / 2;
                        const midLng = (startLng + endLng) / 2;
                        const transportIcon = getTransportIcon(connData.transportType);

                        const iconMarker = L.marker([midLat, midLng], {
                            icon: L.divIcon({
                                className: 'transport-icon',
                                html: \`
                                    <div style="background-color: white; border: 2px solid \${getTransportColor(connData.transportType)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">\${transportIcon}</div>
                                \`,
                                iconSize: [30, 30],
                                iconAnchor: [15, 15]
                            })
                        }).addTo(map);

                        // 为连接线添加弹窗
                        polyline.bindPopup(generateConnectionPopupContent(connData, startMarker, endMarker));

                        // 为连接线添加鼠标悬浮事件
                        polyline.on('mouseover', function(e) {
                            showConnectionTooltip(connData, e.latlng);
                        });

                        // 为连接线添加鼠标移出事件
                        polyline.on('mouseout', function() {
                            hideConnectionTooltip();
                        });
                    }
                });

                // 隐藏日期备注便签
                const sticky = document.getElementById('dateNotesSticky');
                if (sticky) {
                    sticky.style.display = 'none';
                }

                // 重新自动调整视窗以包含所有元素
                if (roadbookData.markers.length > 0) {
                    const group = new L.featureGroup([
                        ...roadbookData.markers.map(m => L.marker([m.position[0], m.position[1]])),
                        ...roadbookData.connections.map(c => L.polyline([
                            [roadbookData.markers.find(m => m.id === c.startId)?.position[0], roadbookData.markers.find(m => m.id === c.startId)?.position[1]],
                            [roadbookData.markers.find(m => m.id === c.endId)?.position[0], roadbookData.markers.find(m => m.id === c.endId)?.position[1]]
                        ]))
                    ]);

                    if (group.getLayers().length > 0) {
                        map.fitBounds(group.getBounds().pad(0.1));
                    }
                }

                // 在移动端自动关闭侧边栏以便用户查看筛选结果
                if (isMobileDevice()) {
                    const rightPanel = document.querySelector('.right-panel');
                    const menuToggleBtn = document.getElementById('menuToggleBtn');
                    if (rightPanel) {
                        rightPanel.classList.remove('active');
                    }
                    if (menuToggleBtn) {
                        menuToggleBtn.textContent = '☰';
                    }
                }
            }

            // 筛选后自动调整地图视窗以包含筛选后的元素
            function autoFitMapViewAfterFilter() {
                const group = new L.featureGroup([]);

                // 添加当前显示的标记点到组中
                map.eachLayer(function(layer) {
                    if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                        group.addLayer(layer);
                    }
                });

                if (group.getLayers().length > 0) {
                    map.fitBounds(group.getBounds().pad(0.1));
                }
            }

            // 将Markdown链接转换为HTML链接
            function convertMarkdownLinksToHtml(text) {
                if (!text) return '';
                const linkRegex = /\\[([^\\]]+?)\\]\\((https?:\\/\\/[^\\s$.?#].[^\\s]*)\\)/g;
                return text.replace(linkRegex, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
            }

            // 显示日期备注便签（类似script.js中的实现）
            function showDateNotesSticky(date) {
                const sticky = document.getElementById('dateNotesSticky');
                const dateElement = document.getElementById('dateNotesDate');
                const contentElement = document.getElementById('dateNotesContent');

                if (sticky && dateElement && contentElement) {
                    // 设置日期标题
                    dateElement.textContent = formatDateHeader(date);

                    // 获取日期备注 - 使用roadbookData中的dateNotes
                    let notesEntry = roadbookData.dateNotes && roadbookData.dateNotes[date] ? roadbookData.dateNotes[date] : '';
                    let notesText = '';
                    let expensesList = [];

                    if (typeof notesEntry === 'string') {
                        notesText = notesEntry;
                    } else if (notesEntry && typeof notesEntry === 'object') {
                        notesText = notesEntry.notes || '';
                        expensesList = notesEntry.expenses || [];
                    }

                    let html = convertMarkdownLinksToHtml(notesText);
                    if (expensesList.length > 0) {
                        let total = 0;
                        html += '<div style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 5px;"><strong>预计消费:</strong><ul style="padding-left: 20px; margin: 5px 0;">';
                        expensesList.forEach(e => {
                            html += \`<li>¥\${e.cost} - \${e.remark || '无备注'}</li>\`;
                            total += (parseFloat(e.cost) || 0);
                        });
                        html += \`</ul><div style="font-weight: bold; text-align: right; color: #667eea;">总计: ¥\${total.toFixed(2)}</div></div>\`;
                    }

                    contentElement.innerHTML = html || '暂无备注';

                    // 添加事件监听器，防止链接点击退出聚焦模式
                    contentElement.addEventListener('click', (e) => {
                        // 检查点击的元素是否是链接 (<a> 标签)
                        if (e.target.tagName === 'A' && e.target.closest('#dateNotesContent')) {
                            e.stopPropagation(); // 停止事件传播
                        }
                    });

                    // 显示便签
                    sticky.style.display = 'flex';

                    // 阻止滚动事件冒泡到地图，防止在备注内容区域滚动时影响地图
                    contentElement.addEventListener('wheel', function(e) {
                        const scrollTop = this.scrollTop;
                        const scrollHeight = this.scrollHeight;
                        const clientHeight = this.clientHeight;

                        // 检查是否滚动到了顶部或底部
                        const isScrollAtTop = (scrollTop === 0 && e.deltaY < 0);
                        const isScrollAtBottom = (scrollTop + clientHeight >= scrollHeight && e.deltaY > 0);

                        // 如果已经滚动到了顶部或底部，允许事件继续传播以影响地图
                        // 否则阻止事件传播，只在便签内容内部滚动
                        if (!isScrollAtTop && !isScrollAtBottom) {
                            e.stopPropagation();
                        }
                    });

                    // 添加关闭事件
                    const closeBtn = document.getElementById('closeDateNotesSticky');
                    if (closeBtn) {
                        closeBtn.onclick = () => {
                            sticky.style.display = 'none';
                        };
                    }
                }
            }

            // 添加点击地图事件来退出筛选模式
            map.on('click', function() {
                if (isFilteredMode) {
                    exitFilterMode();
                }
            });

            // 检测是否为移动设备
            function isMobileDevice() {
                return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                       (navigator.maxTouchPoints && navigator.maxTouchPoints > 2) ||
                       (window.innerWidth <= 768);
            }

            // 添加标记点的鼠标悬浮事件处理函数
            function showMarkerTooltip(markerData, latlng) {
                let tooltipContent = '<div style="background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">';
                tooltipContent += '<div><strong>' + markerData.title + '</strong></div>';
                tooltipContent += '<div>坐标: ' + markerData.position[1].toFixed(6) + ', ' + markerData.position[0].toFixed(6) + '</div>';

                // 显示多个时间点，按日期分组（从早到晚排序）
                if (markerData.dateTimes && markerData.dateTimes.length > 0) {
                    // 按日期分组时间点
                    const timesByDate = {};
                    markerData.dateTimes.forEach(function(dt) {
                        const dateKey = getDateKey(dt);
                        if (!timesByDate[dateKey]) {
                            timesByDate[dateKey] = [];
                        }
                        timesByDate[dateKey].push(dt); // 保存完整时间用于排序
                    });

                    // 获取排序后的日期（从早到晚）
                    const sortedDates = Object.keys(timesByDate).sort(function(a, b) { return new Date(a) - new Date(b); });

                    if (sortedDates.length === 1) {
                        // 只有一个日期，直接显示时间（按时间排序）
                        const times = timesByDate[sortedDates[0]]
                            .sort(function(a, b) { return new Date(a) - new Date(b); })
                            .map(function(dt) { return formatTime(dt); })
                            .join(', ');
                        tooltipContent += '<div>时间: ' + times + '</div>';
                    } else {
                        // 多个日期，按日期分组显示（从早到晚）
                        tooltipContent += '<div>时间:</div>';
                        sortedDates.forEach(function(date) {
                            const dateHeader = formatDateHeader(date);
                            const times = timesByDate[date]
                                .sort(function(a, b) { return new Date(a) - new Date(b); })
                                .map(function(dt) { return formatTime(dt); })
                                .join(', ');
                            tooltipContent += '<div style="margin-left: 8px;">• ' + dateHeader + ': ' + times + '</div>';
                        });
                    }
                } else if (markerData.dateTime) {
                    tooltipContent += '<div>时间: ' + formatTime(markerData.dateTime) + '</div>';
                }

                if (markerData.labels && markerData.labels.length > 0) {
                    const labelsHtml = convertMarkdownLinksToHtml(markerData.labels.join('; '));
                    tooltipContent += '<div>标注: ' + labelsHtml + '</div>';
                }
                tooltipContent += '</div>';

                // 创建临时 tooltip，Leaflet 提供了内置的tooltip支持
                if (window.currentMarkerTooltip) {
                    map.removeLayer(window.currentMarkerTooltip);
                }

                const tooltip = L.tooltip({
                    permanent: false,
                    direction: 'top',
                    className: 'marker-tooltip'
                });
                tooltip.setLatLng(latlng);
                tooltip.setContent(tooltipContent);
                tooltip.addTo(map);
                window.currentMarkerTooltip = tooltip;
            }

            // 隐藏标记点tooltip的函数
            function hideMarkerTooltip() {
                if (window.currentMarkerTooltip) {
                    map.removeLayer(window.currentMarkerTooltip);
                    window.currentMarkerTooltip = null;
                }
            }

            // 添加连接线的鼠标悬浮事件处理函数
            function showConnectionTooltip(connection, latlng) {
                // 通过ID获取当前的起始点和终点对象，确保显示最新的标题
                var startMarker = roadbookData.markers.find(function(m) { return m.id === connection.startId; });
                var endMarker = roadbookData.markers.find(function(m) { return m.id === connection.endId; });

                var startTitle = startMarker ? startMarker.title : connection.startTitle;
                var endTitle = endMarker ? endMarker.title : connection.endTitle;

                let tooltipContent = '<div style="background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">';
                tooltipContent += '<div><strong>' + startTitle + ' → ' + endTitle + '</strong></div>';
                tooltipContent += '<div>' + getTransportIcon(connection.transportType) + ' ' + getTransportTypeName(connection.transportType) + '</div>';
                if (connection.duration > 0) {
                    tooltipContent += '<div>耗时: ' + connection.duration + ' 小时</div>';
                }
                if (connection.dateTime) {
                    // 使用相同的格式化方式显示时间
                    tooltipContent += '<div>时间: ' + formatTime(connection.dateTime) + '</div>';
                }
                if (connection.label) {
                    const labelsHtml = convertMarkdownLinksToHtml(connection.label);
                    tooltipContent += '<div>标注: ' + labelsHtml + '</div>';
                }
                tooltipContent += '</div>';

                // 创建临时 tooltip
                if (window.currentConnectionTooltip) {
                    map.removeLayer(window.currentConnectionTooltip);
                }

                const tooltip = L.tooltip({
                    permanent: false,
                    direction: 'top',
                    className: 'connection-tooltip'
                });
                tooltip.setLatLng(latlng);
                tooltip.setContent(tooltipContent);
                tooltip.addTo(map);
                window.currentConnectionTooltip = tooltip;
            }

            // 隐藏连接线tooltip的函数
            function hideConnectionTooltip() {
                if (window.currentConnectionTooltip) {
                    map.removeLayer(window.currentConnectionTooltip);
                    window.currentConnectionTooltip = null;
                }
            }

            // 遍历所有标记点并添加鼠标悬浮事件
            roadbookData.markers.forEach(function(markerData) {
                const icon = createMarkerIcon(markerData.icon, 0);
                const marker = L.marker([markerData.position[0], markerData.position[1]], {
                    icon: icon,
                    draggable: false, // 禁用拖拽
                    title: markerData.title
                }).addTo(map);

                // 添加点击弹窗显示详细信息
                marker.bindPopup(generateMarkerPopupContent(markerData));

                marker.on('mouseover', function(e) {
                    if (e.target.getElement()) {
                        e.target.getElement()._savedTitle = e.target.getElement().getAttribute('title');
                        e.target.getElement().removeAttribute('title');
                    }
                    showMarkerTooltip(markerData, e.latlng);
                    if (markerData.logo) {
                        showLogoPreview(markerData.logo, e);
                    }
                });

                marker.on('mouseout', function(e) {
                    if (e.target.getElement() && e.target.getElement()._savedTitle) {
                        e.target.getElement().setAttribute('title', e.target.getElement()._savedTitle);
                    }
                    hideMarkerTooltip();
                    hideLogoPreview();
                });

                // 添加鼠标悬浮事件
                marker.on('mouseover', function(e) {
                    showMarkerTooltip(markerData, e.latlng);
                });

                // 添加鼠标移出事件
                marker.on('mouseout', function() {
                    hideMarkerTooltip();
                });
            });

            // 遍历所有连接线并添加鼠标悬浮事件
            roadbookData.connections.forEach(function(connData) {
                // 查找起始点和终点
                const startMarker = roadbookData.markers.find(function(m) { return m.id === connData.startId; });
                const endMarker = roadbookData.markers.find(function(m) { return m.id === connData.endId; });

                if (!startMarker || !endMarker) return;

                // 创建连接线
                const polyline = L.polyline([
                    [startMarker.position[0], startMarker.position[1]],
                    [endMarker.position[0], endMarker.position[1]]
                ], {
                    color: getTransportColor(connData.transportType),
                    weight: 6,
                    opacity: 1.0,
                    smoothFactor: 1.0
                }).addTo(map);

                // 添加终点标记（小圆点）
                const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
                    radius: 6,
                    fillColor: getTransportColor(connData.transportType),
                    color: '#fff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 1
                }).addTo(map);

                // 创建箭头
                const arrowHead = createArrowHead([startMarker.position[0], startMarker.position[1]], [endMarker.position[0], endMarker.position[1]], connData.transportType);
                arrowHead.addTo(map);

                // 计算中点位置并添加交通图标
                const startLat = parseFloat(startMarker.position[0]);
                const startLng = parseFloat(startMarker.position[1]);
                const endLat = parseFloat(endMarker.position[0]);
                const endLng = parseFloat(endMarker.position[1]);

                if (!isNaN(startLat) && !isNaN(startLng) && !isNaN(endLat) && !isNaN(endLng)) {
                    const midLat = (startLat + endLat) / 2;
                    const midLng = (startLng + endLng) / 2;
                    const transportIcon = getTransportIcon(connData.transportType);

                    const iconMarker = L.marker([midLat, midLng], {
                        icon: L.divIcon({
                            className: 'transport-icon',
                            html: '<div style="background-color: white; border: 2px solid ' + getTransportColor(connData.transportType) + '; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">' + transportIcon + '</div>',
                            iconSize: [30, 30],
                            iconAnchor: [15, 15]
                        })
                    }).addTo(map);

                    // 为连接线添加弹窗
                    polyline.bindPopup(generateConnectionPopupContent(connData, startMarker, endMarker));

                    // Add tooltip and logo preview events
                    polyline.on('mouseover', function(e) {
                        showConnectionTooltip(connData, e.latlng);
                        if (connData.logo) {
                            showLogoPreview(connData.logo, e);
                        }
                    });
                    polyline.on('mouseout', function() {
                        hideConnectionTooltip();
                        hideLogoPreview();
                    });

                    // 为连接线添加鼠标悬浮事件
                    polyline.on('mouseover', function(e) {
                        showConnectionTooltip(connData, e.latlng);
                    });

                    // 为连接线添加鼠标移出事件
                    polyline.on('mouseout', function() {
                        hideConnectionTooltip();
                    });
                }
            });

            // 初始更新标记点列表
            updateMarkerList();

            // 计算并显示总花费
            function updateTotalExpenses() {
                const container = document.getElementById('totalExpensesContainer');
                const amountSpan = document.getElementById('totalExpensesAmount');
                if (!container || !amountSpan) return;

                let totalCost = 0;
                const expensesByDate = {}; // date -> total

                if (roadbookData.dateNotes) {
                    for (const [date, noteEntry] of Object.entries(roadbookData.dateNotes)) {
                        if (noteEntry && typeof noteEntry === 'object' && Array.isArray(noteEntry.expenses)) {
                            let dayTotal = 0;
                            noteEntry.expenses.forEach(expense => {
                                const cost = parseFloat(expense.cost);
                                if (!isNaN(cost)) {
                                    dayTotal += cost;
                                }
                            });

                            if (dayTotal > 0) {
                                totalCost += dayTotal;
                                expensesByDate[date] = dayTotal;
                            }
                        }
                    }
                }

                if (totalCost > 0) {
                    container.style.display = 'flex';
                    amountSpan.textContent = '¥' + totalCost.toFixed(2);

                    // 添加鼠标悬浮显示明细
                    container.onmouseenter = function(e) {
                        showExpensesTooltip(expensesByDate, totalCost, container);
                    };

                    container.onmouseleave = function() {
                        const tooltip = document.getElementById('expenses-tooltip');
                        if (tooltip) {
                            tooltip.style.display = 'none';
                        }
                    };
                } else {
                    container.style.display = 'none';
                }
            }

            // 显示消费明细Tooltip
            function showExpensesTooltip(expensesByDate, totalCost, container) {
                // 按照日期排序
                const sortedDates = Object.keys(expensesByDate).sort((a, b) => new Date(a) - new Date(b));

                let content = '<div class="expenses-tooltip-header">消费明细 (按日期)</div>';

                sortedDates.forEach(date => {
                    const cost = expensesByDate[date];
                    const dateStr = formatDateHeader(date);
                    content += \`
                        <div class="expenses-tooltip-item">
                            <span>\${dateStr}</span>
                            <span class="expenses-tooltip-cost">¥\${cost.toFixed(2)}</span>
                        </div>
                    \`;
                });

                content += \`
                    <div class="expenses-tooltip-footer">
                        <span>总计</span>
                        <span class="expenses-tooltip-total">¥\${totalCost.toFixed(2)}</span>
                    </div>
                \`;

                let tooltip = document.getElementById('expenses-tooltip');
                if (!tooltip) {
                    tooltip = document.createElement('div');
                    tooltip.id = 'expenses-tooltip';
                    // 样式将由CSS类控制，这里只设置必要的定位样式
                    tooltip.style.position = 'fixed';
                    tooltip.style.zIndex = '2000';
                    tooltip.style.padding = '10px';
                    tooltip.style.borderRadius = '4px';
                    tooltip.style.pointerEvents = 'none';
                    tooltip.style.minWidth = '200px';
                    tooltip.style.fontSize = '12px';
                    document.body.appendChild(tooltip);
                }

                tooltip.innerHTML = content;
                tooltip.style.display = 'block';

                // 定位
                const rect = container.getBoundingClientRect();
                // 尝试显示在左侧
                let left = rect.left - 220;
                // 如果左侧空间不足（例如在移动端），显示在上方
                if (left < 10) {
                    left = rect.left;
                    // 显示在上方
                    tooltip.style.top = (rect.top - tooltip.offsetHeight - 10) + 'px';
                } else {
                    // 显示在左侧，垂直居中
                    tooltip.style.top = (rect.top + (rect.height - tooltip.offsetHeight) / 2) + 'px';
                }
                tooltip.style.left = left + 'px';
            }

            // 初始化时调用
            updateTotalExpenses();

            // 移动端功能适配
            function initMobileFeatures() {
                const menuToggleBtn = document.getElementById('menuToggleBtn');
                if (menuToggleBtn) {
                    if (isMobileDevice()) {
                        menuToggleBtn.classList.add('show');

                        // 添加点击事件
                        menuToggleBtn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            const rightPanel = document.querySelector('.right-panel');
                            rightPanel.classList.toggle('active');

                            // 更新按钮图标
                            this.textContent = rightPanel.classList.contains('active') ? '✕' : '☰';
                        });

                        // 点击侧边栏外部关闭侧边栏
                        document.addEventListener('click', function(e) {
                            const rightPanel = document.querySelector('.right-panel');
                            const menuBtn = document.getElementById('menuToggleBtn');

                            if (!rightPanel.contains(e.target) &&
                                !menuBtn.contains(e.target) &&
                                rightPanel.classList.contains('active')) {
                                rightPanel.classList.remove('active');
                                menuBtn.textContent = '☰';
                            }
                        });

                        // 添加关闭侧边栏按钮事件
                        const closeSidebarBtn = document.getElementById('closeSidebarBtn');
                        if (closeSidebarBtn) {
                            closeSidebarBtn.addEventListener('click', function() {
                                const rightPanel = document.querySelector('.right-panel');
                                rightPanel.classList.remove('active');
                                menuToggleBtn.textContent = '☰';
                            });
                        }
                    } else {
                        // 在电脑端完全移除按钮元素，而不仅仅是隐藏
                        menuToggleBtn.remove();
                    }
                }
            }

            // 初始化移动端功能
            initMobileFeatures();

            // 监听窗口大小变化，以适配横竖屏切换
            window.addEventListener('resize', function() {
                const menuToggleBtn = document.getElementById('menuToggleBtn');
                if (menuToggleBtn) {
                    if (isMobileDevice()) {
                        menuToggleBtn.classList.add('show');
                    } else {
                        menuToggleBtn.classList.remove('show');
                        // 在非移动设备上确保侧边栏可见
                        const rightPanel = document.querySelector('.right-panel');
                        rightPanel.classList.remove('active');
                        menuToggleBtn.textContent = '☰';
                    }
                }
            });

            // 帮助按钮功能
            (function() {
                const exportHelpBtn = document.getElementById('exportHelpBtn');
                const exportHelpModal = document.getElementById('exportHelpModal');
                const closeExportHelp = document.getElementById('closeExportHelp');

                if (exportHelpBtn) {
                    exportHelpBtn.onclick = function() {
                        if (exportHelpModal) {
                            // 使用内联样式确保覆盖所有CSS规则
                            exportHelpModal.style.cssText =
                                'display: flex !important; ' +
                                'position: fixed !important; ' +
                                'z-index: 10000 !important; ' +
                                'left: 0 !important; ' +
                                'top: 0 !important; ' +
                                'width: 100% !important; ' +
                                'height: 100% !important; ' +
                                'background-color: rgba(0,0,0,0.5) !important; ' +
                                'align-items: center !important; ' +
                                'justify-content: center !important; ';
                        }
                    };
                }

                if (closeExportHelp) {
                    closeExportHelp.onclick = function() {
                        if (exportHelpModal) {
                            exportHelpModal.style.display = 'none';
                        }
                    };
                }

                // 点击模态框外部关闭
                window.onclick = function(event) {
                    if (event.target === exportHelpModal) {
                        if (exportHelpModal) {
                            exportHelpModal.style.display = 'none';
                        }
                    }
                };
            })();
        });
    </script>
    <script>
        // 立即检测设备类型并在电脑端移除菜单按钮
        (function() {
            // 检测是否为移动设备
            function isMobileDevice() {
                return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                       (navigator.maxTouchPoints && navigator.maxTouchPoints > 2) ||
                       (window.innerWidth <= 768);
            }

            // 等待DOM加载完成后执行
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function() {
                    const menuToggleBtn = document.getElementById('menuToggleBtn');
                    if (menuToggleBtn && !isMobileDevice()) {
                        menuToggleBtn.remove(); // 完全移除按钮元素
                    }
                });
            } else {
                // 如果DOM已经加载完成
                const menuToggleBtn = document.getElementById('menuToggleBtn');
                if (menuToggleBtn && !isMobileDevice()) {
                    menuToggleBtn.remove(); // 完全移除按钮元素
                }
            }
        })();
    </script>

    <!-- 帮助模态框 -->
    <div id="exportHelpModal" class="modal" style="display: none;">
        <div class="modal-content help-modal-content">
            <span class="close" id="closeExportHelp">&times;</span>
            <h2>导出界面帮助</h2>
            <div class="help-content">
                <h3>功能说明</h3>
                <ul>
                    <li><strong>查看标记点</strong> - 点击地图上的标记点可查看详细信息</li>
                    <li><strong>查看连接线</strong> - 点击连接线可查看路线详情和导航链接</li>
                    <li><strong>日程列表</strong> - 在右侧面板查看按日期分组的行程安排</li>
                    <li><strong>地图操作</strong> - 支持缩放、拖拽等基本地图操作</li>
                    <li><strong>筛选模式</strong> - 点击日期标题可筛选显示特定日期的标记点</li>
                </ul>

                <h3>操作提示</h3>
                <ul>
                    <li>点击左侧日期可筛选当天的行程</li>
                    <li>点击右侧日程列表可快速定位到对应位置</li>
                    <li>点击连接线可查看交通方式和导航链接</li>
                    <li>拖拽地图或使用缩放按钮调整视图</li>
                </ul>

                <h3>导出功能</h3>
                <p>此页面为RoadbookMaker Share导出的静态HTML文件，无需网络连接即可查看完整行程信息。包含所有标记点、连接线和备注信息。</p>
            </div>
        </div>
    </div>
</body>
</html>`;
    }

    generateCssStyles() {
        // 返回项目中的CSS样式，只包含必要的部分以支持只读视图
        return `
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Microsoft YaHei', Arial, sans-serif;
    background-color: #f5f5f5;
}

.container {
    height: 100vh;
    display: flex;
    flex-direction: column;
}

header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 0.5rem 0;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    position: relative;
}

header h1 {
    text-align: center;
    margin: 0;
    font-size: 1.5rem;
}

main {
    flex: 1;
    display: flex;
    overflow: hidden;
}

.right-panel {
    width: 350px;
    position: relative;
    overflow: hidden;
}

#mapContainer {
    flex: 1;
    position: relative;
    background: #e0e0e0;
    min-height: 400px;
}

.sidebar {
    width: 100%;
    height: 100%;
    background: white;
    border-left: 1px solid #ddd;
    padding: 1rem;
    overflow-y: auto;
    position: absolute;
    top: 0;
    left: 0;
}

/* 侧边栏标题区域样式 */
.sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid #667eea;
    background: transparent;
}

.sidebar-header h3 {
    margin: 0;
    color: #333;
    font-size: 1.1rem;
}

.sidebar h3 {
    margin: 0;
    color: #333;
}

.marker-item {
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 8px;
    padding: 0.8rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.marker-item:hover {
    background: #e9ecef;
    transform: translateX(5px);
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.marker-info {
    flex: 1;
}

.marker-item .title {
    font-weight: bold;
    color: #495057;
    margin-bottom: 0.2rem;
    font-size: 0.9rem;
}

.marker-item .coords {
    font-size: 0.75rem;
    color: #6c757d;
    margin-bottom: 0.1rem;
}

.marker-item .date {
    font-size: 0.7rem;
    color: #868e96;
}

.marker-actions {
    display: flex;
    gap: 0.3rem;
    margin-left: 0.5rem;
}

/* 日期分组标题样式 */
.date-group-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 0.8rem 1rem;
    margin: 1rem 0 0.5rem 0;
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    cursor: default;
    transition: all 0.3s ease;
}

.date-group-header h4 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.date-group-header .marker-count {
    font-size: 0.8rem;
    opacity: 0.9;
    background: rgba(255,255,255,0.2);
    padding: 0.2rem 0.5rem;
    border-radius: 12px;
}

/* 时间信息显示样式 */
.time-info {
    font-size: 0.75rem;
    color: #6c757d;
    margin-top: 0.2rem;
    font-weight: 500;
}

/* GitHub角标样式 - 经典右上角Octocat */
.github-corner {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 9999;
    border: 0;
    width: 60px;
    height: 60px;
}

.github-corner:hover .octo-arm {
    animation: octocat-arm 0.56s ease-in-out;
}

.github-corner .github-corner-link {
    display: block;
    position: absolute;
    top: 0;
    right: 0;
    border: 0;
    text-decoration: none;
}

@keyframes octocat-arm {
    0%, 100% { transform: rotate(0); }
    20%, 60% { transform: rotate(-25deg); }
    40%, 80% { transform: rotate(10deg); }
}

/* 自定义标记点样式 */
.custom-marker {
    background: none !important;
    border: none !important;
}

.custom-label {
    background: none !important;
    border: none !important;
}

/* 箭头图标样式 */
.arrow-icon {
    background: none !important;
    border: none !important;
    pointer-events: none !important;
}

.arrow-icon div {
    transition: transform 0.2s ease;
}

/* 弹窗内容样式 */
.popup-content h3 {
    margin: 0 0 10px 0;
    color: #333;
    font-size: 1.2em;
}

.popup-content p {
    margin: 5px 0;
    color: #666;
    line-height: 1.4;
}

.popup-content strong {
    color: #333;
}

/* 日期备注便签样式 */
.date-notes-sticky {
    position: absolute;
    top: 60px; /* 调整位置，避免覆盖header */
    left: 10px;
    z-index: 2000;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    width: 250px;
    max-height: 300px;
    display: flex;
    flex-direction: column;
    backdrop-filter: blur(10px);
    background: rgba(255, 255, 255, 0.95);
}

.date-notes-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 15px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 8px 8px 0 0;
    font-size: 0.9rem;
}

.close-sticky-btn {
    background: none;
    border: none;
    color: white;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background-color 0.3s ease;
}

.close-sticky-btn:hover {
    background: rgba(255, 255, 255, 0.2);
}

/* 电脑端隐藏侧边栏关闭按钮，只在移动设备显示 */
.close-btn {
    display: none; /* 默认隐藏 */
}

@media (max-width: 768px) {
    .close-btn {
        display: flex; /* 移动设备上显示 */
    }
}

.date-notes-content {
    padding: 15px;
    overflow-y: auto;
    max-height: 200px;
    font-size: 0.9rem;
    line-height: 1.4;
    color: #333;
    white-space: pre-wrap; /* 保持换行 */
    word-wrap: break-word; /* 允许长单词换行 */
}

/* 当便签内容为空时的样式 */
.date-notes-content:empty::before {
    content: "暂无备注";
    color: #999;
    font-style: italic;
}

/* 移动设备适配 */
@media (max-width: 768px) {
    .right-panel {
        position: fixed;
        top: 0;
        right: -350px; /* 默认隐藏在屏幕右侧 */
        width: 300px; /* 适配移动设备宽度 */
        height: 100vh;
        z-index: 1001;
        transition: right 0.3s ease;
        box-shadow: -2px 0 10px rgba(0,0,0,0.1);
    }

    .right-panel.active {
        right: 0; /* 展开状态 */
    }

    /* 在移动设备上添加菜单按钮 */
    .menu-toggle-btn {
        position: absolute;
        top: 70px; /* 位于header下方 */
        right: 15px;
        z-index: 1000;
        width: 44px;
        height: 44px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: none;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        color: white;
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(10px);
        display: none; /* 默认隐藏，通过JS控制显示 */
    }

    .menu-toggle-btn {
        display: none !important; /* 强制隐藏，确保电脑端不显示 */
        visibility: hidden !important; /* 进一步确保不可见 */
        opacity: 0 !important; /* 额外确保不可见 */
        pointer-events: none !important; /* 确保不响应点击事件 */
        width: 0 !important; /* 确保不占用空间 */
        height: 0 !important; /* 确保不占用空间 */
        margin: 0 !important; /* 确保不占用空间 */
        padding: 0 !important; /* 确保不占用空间 */
    }

    @media (max-width: 768px) {
        .menu-toggle-btn {
            display: flex !important; /* 只在移动设备上显示 */
            visibility: visible !important; /* 移动设备上可见 */
            opacity: 1 !important; /* 移动设备上可见 */
            pointer-events: auto !important; /* 移动设备上可交互 */
            width: 44px !important; /* 恢复正常尺寸 */
            height: 44px !important; /* 恢复正常尺寸 */
            margin: inherit !important; /* 恢复正常边距 */
            padding: inherit !important; /* 恢复正常内边距 */
        }
    }

    .menu-toggle-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
        transition: left 0.6s ease;
    }

    .menu-toggle-btn:hover {
        transform: translateY(-3px) scale(1.05);
        box-shadow: 0 8px 20px rgba(102, 126, 234, 0.5);
    }

    .menu-toggle-btn:hover::before {
        left: 100%;
    }

    .menu-toggle-btn:active {
        transform: translateY(-1px) scale(0.98);
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
    }

    /* 调整地图容器在侧边栏展开时的样式 */
    .map-container-sidebar-open {
        margin-right: 300px;
    }

    /* 移动设备上隐藏日期备注便签，避免重叠 */
    .date-notes-sticky {
        top: 70px; /* 调整位置避免与菜单按钮重叠 */
    }

    /* 帮助模态框样式 */
    .modal {
        display: none;
        position: fixed;
        z-index: 10000;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.5);
        align-items: center;
        justify-content: center;
    }

    .modal-content {
        background-color: white;
        margin: 5vh auto;
        padding: 0;
        border-radius: 10px;
        width: 90%;
        max-width: 800px;
        max-height: 90vh;
        min-height: 200px;
        overflow-y: auto;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        position: relative;
    }

    .help-modal-content {
        padding: 1.5rem;
        width: 100%;
    }

    .modal-content h2 {
        margin-top: 0;
        margin-bottom: 1rem;
        color: #333;
        padding-bottom: 0.8rem;
        border-bottom: 2px solid #667eea;
        font-size: 1.4rem;
    }

    .close {
        color: #aaa;
        float: right;
        font-size: 28px;
        font-weight: bold;
        cursor: pointer;
        line-height: 1;
        position: absolute;
        top: 15px;
        right: 20px;
    }

    .close:hover {
        color: #000;
    }

    .help-content h3 {
        color: #333;
        margin-top: 1.2rem;
        margin-bottom: 0.8rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid #667eea;
        font-size: 1.2rem;
    }

    .help-content ul {
        margin: 0.8rem 0 1rem 1.2rem;
        padding-left: 0.8rem;
    }

    .help-content li {
        margin-bottom: 0.4rem;
        line-height: 1.5;
        font-size: 0.95rem;
    }

    .help-content p {
        margin-bottom: 0.8rem;
        line-height: 1.5;
        color: #555;
        font-size: 0.95rem;
    }

    /* Logo Preview Styles */
    .logo-preview {
        position: fixed;
        z-index: 10000;
        pointer-events: none;
        transition: opacity 0.3s ease;
    }

    .logo-preview-img {
        max-width: 100px;
        max-height: 100px;
        border-radius: 4px;
        border: 2px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        background: white;
        object-fit: contain;
    }

    /* 预计总花费容器样式 */
    .total-expenses-container {
        padding: 10px;
        margin-top: 10px;
        border-top: 1px solid #dddddd;
        font-weight: bold;
        display: flex; /* explicit display flex */
        justify-content: space-between;
        align-items: center;
        background-color: #f5f5f5;
        border-radius: 4px;
        cursor: help;
        color: #333333;
        transition: all 0.3s ease;
    }

    .total-expenses-container:hover {
        background-color: #ffffff;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    #totalExpensesAmount {
        color: #667eea;
        font-size: 1.1em;
    }

    /* 消费明细提示框样式 */
    #expenses-tooltip {
        background: #ffffff !important;
        color: #333333 !important;
        border: 1px solid #e1e5e9;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
        backdrop-filter: blur(10px);
    }

    /* 消费明细内部样式 */
    .expenses-tooltip-header {
        border-bottom: 1px solid #e1e5e9;
        padding-bottom: 5px;
        margin-bottom: 5px;
        font-weight: bold;
        color: #333333;
    }

    .expenses-tooltip-item {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
        color: #666666;
    }

    .expenses-tooltip-cost {
        color: #28a745;
        margin-left: 10px;
        font-weight: 500;
    }

    .expenses-tooltip-footer {
        border-top: 1px solid #e1e5e9;
        padding-top: 5px;
        margin-top: 5px;
        display: flex;
        justify-content: space-between;
        font-weight: bold;
        color: #333333;
    }

    .expenses-tooltip-total {
        color: #dc3545;
    }
}`;
    }

    // Import from HTML function
    importFromHtml(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const htmlContent = e.target.result;

                // 从HTML中提取嵌入的JSON数据 - 适配新的编码方式
                // 查找使用encodeURIComponent和decodeURIComponent编码的数据
                let dataMatch = htmlContent.match(/const roadbookData = JSON\.parse\(decodeURIComponent\(`([^`]*)`\)\);/);

                if (!dataMatch) {
                    // 尝试匹配旧的格式作为备选
                    dataMatch = htmlContent.match(/const roadbookData = JSON\.parse\(`([^`\\]*(\\.[^`\\]*)*)`\)/);

                    if (!dataMatch) {
                        alert('HTML文件中未找到RoadbookMaker数据！');
                        return;
                    }

                    // 解析旧格式的数据
                    const dataStr = dataMatch[1].replace(/\\`/g, '`');
                    const data = JSON.parse(dataStr);
                    this.processImportedData(data);
                    return;
                }

                // 解析新编码格式的数据
                const encodedDataStr = dataMatch[1];
                // 修复反斜杠转义问题
                const properlyDecodedStr = encodedDataStr.replace(/\\`/g, '`');
                const decodedDataStr = decodeURIComponent(properlyDecodedStr);
                const data = JSON.parse(decodedDataStr);

                this.processImportedData(data);

            } catch (error) {
                console.error('导入HTML失败:', error);
                alert('HTML文件格式错误或数据损坏！');
            }
        };
        reader.readAsText(file);
    }

    processImportedData(data) {
        // 调用app的loadRoadbook方法加载数据
        this.app.loadRoadbook(data, true);

        // 确保UI下拉框显示正确的值（导入后）
        setTimeout(() => {
            if (data.currentLayer) {
                this.app.switchMapSource(data.currentLayer);
                const mapSourceSelect = document.getElementById('mapSourceSelect');
                if (mapSourceSelect) {
                    mapSourceSelect.value = data.currentLayer;
                }
            }

            if (data.currentSearchMethod) {
                this.app.currentSearchMethod = data.currentSearchMethod;
                const searchMethodSelect = document.getElementById('searchMethodSelect');
                if (searchMethodSelect) {
                    searchMethodSelect.value = data.currentSearchMethod;
                }
            }
        }, 100); // 稍微延时以确保数据加载完成
    }
}
