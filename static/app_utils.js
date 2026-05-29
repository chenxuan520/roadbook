// app_utils.js - 工具方法

// 检测是否为移动设备
RoadbookApp.prototype.isMobileDevice = function() {
    // 检测多种移动设备特征
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 2) || // 检测触摸屏
        (window.innerWidth <= 768); // 小屏幕设备也视为移动设备
};

// 移动端：将详情面板（标记/连接线/日期）以底部抽屉形式呈现，并统一管理遮罩与背景滚动锁
// 仅监听面板 display 变化，不改动各 show/hide 业务方法，降低耦合与回归风险
RoadbookApp.prototype.initMobileDetailSheet = function() {
    const panelIds = ['markerDetailPanel', 'connectionDetailPanel', 'dateDetailPanel'];
    const panels = panelIds.map(id => document.getElementById(id)).filter(Boolean);
    if (panels.length === 0) {
        return;
    }

    // 遮罩层：点击空白处复用已有的关闭逻辑（保证实时保存等副作用一致）
    let overlay = document.getElementById('mobileSheetOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'mobileSheetOverlay';
        overlay.className = 'mobile-sheet-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', () => {
            if (typeof this.hideMarkerDetail === 'function') this.hideMarkerDetail();
            if (typeof this.hideConnectionDetail === 'function') this.hideConnectionDetail();
            if (typeof this.closeDateDetail === 'function') this.closeDateDetail();
        });
    }

    // 同步遮罩/滚动锁状态：仅在窄屏（与 CSS @media 768 对齐）且有面板打开时启用抽屉态
    const sync = () => {
        const isNarrow = window.innerWidth <= 768;
        const anyOpen = isNarrow && panels.some(p => p.style.display && p.style.display !== 'none');
        if (anyOpen) {
            overlay.classList.add('active');
            document.body.classList.add('sheet-open');
            // 避免与右侧日程抽屉叠加
            const rightPanel = document.querySelector('.right-panel');
            if (rightPanel) rightPanel.classList.remove('active');
        } else {
            overlay.classList.remove('active');
            document.body.classList.remove('sheet-open');
        }
    };

    const observer = new MutationObserver(sync);
    panels.forEach(p => observer.observe(p, { attributes: true, attributeFilter: ['style'] }));
    window.addEventListener('resize', sync);
    this.syncMobileDetailSheet = sync;
    sync();
};

RoadbookApp.prototype.getIconForName = function(name) {
    const lowerCaseName = name.toLowerCase();
    // 交通类
    if (['机场', 'airport', '站', 'station', 'bus', '地铁', 'subway', 'train', 'bus', '车站'].some(kw => lowerCaseName.includes(kw))) {
        return {type: 'emoji', icon: '🚉', color: '#607D8B'};
    }
    // 住宿类
    if (['酒店', 'hotel', '民宿', 'hostel'].some(kw => lowerCaseName.includes(kw))) {
        return {type: 'emoji', icon: '🏨', color: '#2196F3'};
    }
    // 餐饮类
    if (['餐厅', 'restaurant', '饭', 'eat', 'food', '美食'].some(kw => lowerCaseName.includes(kw))) {
        return {type: 'emoji', icon: '🍽️', color: '#4CAF50'};
    }
    // 景点类
    if (['景点', 'park', '山', '海', 'lake', 'view', 'garden', '公园', 'museum', '博物馆'].some(kw => lowerCaseName.includes(kw))) {
        return {type: 'emoji', icon: '🏞️', color: '#FF9800'};
    }
    // 购物类
    if (['购物', 'shopping', 'mall', 'store', 'market'].some(kw => lowerCaseName.includes(kw))) {
        return {type: 'emoji', icon: '🛍️', color: '#9C27B0'};
    }
    // 默认返回数字图标配置
    return {
        type: 'number',
        icon: String(this.markers.length + 1),
        color: '#667eea'
    };
};

RoadbookApp.prototype.setMode = function(mode) {
    this.currentMode = mode;

    // 更新按钮状态
    document.querySelectorAll('.btn').forEach(btn => {
        btn.classList.remove('active');
    });

    if (mode === 'addMarker') {
        document.getElementById('addMarkerBtn').classList.add('active');
        this.map.getContainer().style.cursor = 'crosshair';
    } else {
        this.map.getContainer().style.cursor = 'pointer';
    }
};

RoadbookApp.prototype.getTransportColor = function(type) {
    const colors = {
        car: '#FF5722',
        preview: '#FFD700', // 预览线 - 黄色
        train: '#2196F3',
        subway: '#9C27B0',  // 地铁 - 紫色
        plane: '#4CAF50',
        walk: '#FF9800',
        bus: '#795548',  // 公交 - 棕色
        cruise: '#00BCD4' // 游轮 - 青色
    };
    return colors[type] || '#666';
};

RoadbookApp.prototype.createMarkerIcon = function(iconConfig, _number) {
    const icon = iconConfig.icon || '📍';
    const color = iconConfig.color || '#667eea';

    // 用户选择什么就显示什么，不自动添加数字
    const displayContent = icon;

    return L.divIcon({
        className: 'custom-marker',
        html: `<div style="background-color: ${color}; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">${displayContent}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
};

RoadbookApp.prototype.getCurrentLocalDateTime = function() {
    // 获取本地时间，格式化为中文显示
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// 通过屏幕像素距离检测鼠标是否在某个标记点上
RoadbookApp.prototype.getMarkerAt = function(latlng) {
    const clickPoint = this.map.latLngToContainerPoint(latlng);
    const tolerance = 20; // 20像素的容差范围

    for (const marker of this.markers) {
        const markerPoint = this.map.latLngToContainerPoint(marker.position);
        if (clickPoint.distanceTo(markerPoint) <= tolerance) {
            return marker;
        }
    }
    return null;
};

// 将Markdown链接转换为HTML链接
RoadbookApp.prototype.convertMarkdownLinksToHtml = function(text) {
    if (!text) return '';
    // 匹配 [link text](url) 格式的Markdown链接
    // 注意：这里只处理简单的链接，不处理图片或其他复杂的Markdown语法
    const linkRegex = /\[([^\]]+?)\]\((https?:\/\/[^\s$.?#].[^\s]*)\)/g;
    return text.replace(linkRegex, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
};

// 生成标记点弹窗内容 (只读模式)
RoadbookApp.prototype.generateMarkerPopupContent = function(markerData, options = {}) {
    let content = '<div class="popup-content">';
    content += '<h3>' + markerData.title + '</h3>';

    // 格式化时间显示
    if (markerData.dateTimes && markerData.dateTimes.length > 0) {
        const formattedTimes = markerData.dateTimes.map(dt => this.formatTime(dt));
        content += '<p><strong>时间:</strong> ' + formattedTimes.join(', ') + '</p>';
    } else if (markerData.dateTime) {
        content += '<p><strong>时间:</strong> ' + this.formatTime(markerData.dateTime) + '</p>';
    }

    if (markerData.labels && markerData.labels.length > 0) {
        content += '<p><strong>标注:</strong> ' + this.convertMarkdownLinksToHtml(markerData.labels.join('; ')) + '</p>';
    }

    content += '<p><strong>坐标:</strong> ' + markerData.position[1].toFixed(6) + ', ' + markerData.position[0].toFixed(6) + '</p>';

    // 移动端轻量编辑：在只读气泡底部提供删除入口
    if (options.withDelete) {
        content += '<div class="popup-actions"><button type="button" class="popup-delete-marker">🗑️ 删除此标记点</button></div>';
    }
    content += '</div>';

    return content;
};

// 生成连接线弹窗内容 (只读模式)
RoadbookApp.prototype.generateConnectionPopupContent = function(connData, startMarker, endMarker) {
    let content = '<div class="popup-content">';
    content += '<h3>' + startMarker.title + ' → ' + endMarker.title + '</h3>';
    content += '<p><strong>交通方式:</strong> ' + this.getTransportIcon(connData.transportType) + ' ' + this.getTransportTypeName(connData.transportType) + '</p>';

    // 动态计算并显示距离
    if (startMarker.position && endMarker.position) {
        const distance = this.calculateLineDistance(startMarker.position, endMarker.position);
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
        content += '<p><strong>时间:</strong> ' + this.formatTime(connData.dateTime) + '</p>';
    }

    if (connData.label) {
        content += '<p><strong>标注:</strong> ' + this.convertMarkdownLinksToHtml(connData.label) + '</p>';
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
    content += '<a href="http://api.map.baidu.com/direction?origin=latlng:' + startLat + ',' + startLng + '|name:' + encodeURIComponent(startTitle) + '&destination=latlng:' + endLat + ',' + endLng + '|name:' + encodeURIComponent(endTitle) + '&mode=driving&region=中国&output=html&coord_type=gcj02&src=webapp.demo" target="_blank" style="margin: 0 5px; text-decoration: underline;">百度</a>';
    content += '<a href="https://uri.amap.com/navigation?from=' + startLng + ',' + startLat + ',' + encodeURIComponent(startTitle) + '&to=' + endLng + ',' + endLat + ',' + encodeURIComponent(endTitle) + '&mode=car&policy=1&coordinate=gaode" target="_blank" style="margin: 0 5px; text-decoration: underline;">高德</a>';
    content += '<a href="https://apis.map.qq.com/uri/v1/routeplan?type=drive&from=' + encodeURIComponent(startTitle) + '&fromcoord=' + startLat + ',' + startLng + '&to=' + encodeURIComponent(endTitle) + '&tocoord=' + endLat + ',' + endLng + '&referer=myapp" target="_blank" style="margin: 0 5px; text-decoration: underline;">腾讯</a>';
    content += '<a href="https://www.google.com/maps/dir/?api=1&origin=' + startLat + ',' + startLng + '&destination=' + endLat + ',' + endLng + '" target="_blank" style="margin: 0 5px; text-decoration: underline;">Google</a>';
    content += '</p>';
    content += '</div>';

    content += '</div>';

    return content;
};

// 处理日期备注输入框的粘贴事件，自动将链接转换为Markdown格式
RoadbookApp.prototype.handleDateNotesPaste = function(event) {
    event.preventDefault(); // 阻止默认的粘贴行为

    const clipboardData = event.clipboardData;
    const pastedText = clipboardData.getData('text/plain');

    // 更完善的URL匹配，支持多种URL模式，并确保匹配到完整的URL
    const urlRegex = /(https?:\/\/[^\s/$.?#].[^\s]*)/; // 匹配URL的正则表达式
    const match = pastedText.match(urlRegex);

    let processedText = pastedText;

    if (match) {
        const url = match[0]; // 匹配到的第一个URL
        processedText = `[相关链接](${url})`; // 始终使用 '相关链接' 作为链接文本
    }

    // 将处理后的文本插入到当前光标位置
    const textarea = event.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const newValue = textarea.value.substring(0, start) + processedText + textarea.value.substring(end);
    textarea.value = newValue;

    // 调整光标位置
    textarea.selectionStart = textarea.selectionEnd = start + processedText.length;

    // 触发input事件，确保Vue/React等框架或依赖input事件的逻辑能响应变化
    textarea.dispatchEvent(new Event('input', {bubbles: true}));
};

// 处理标记点标签输入框的粘贴事件，自动将链接转换为Markdown格式
RoadbookApp.prototype.handleMarkerLabelsPaste = function(event) {
    event.preventDefault(); // 阻止默认的粘贴行为

    const clipboardData = event.clipboardData;
    const pastedText = clipboardData.getData('text/plain');

    const urlRegex = /(https?:\/\/[^\s/$.?#].[^\s]*)/; // 匹配URL的正则表达式
    const match = pastedText.match(urlRegex);

    let processedText = pastedText;

    if (match) {
        const url = match[0]; // 匹配到的第一个URL
        processedText = `[相关链接](${url})`; // 始终使用 '相关链接' 作为链接文本
    }

    // 将处理后的文本插入到当前光标位置
    const textarea = event.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const newValue = textarea.value.substring(0, start) + processedText + textarea.value.substring(end);
    textarea.value = newValue;

    // 调整光标位置
    textarea.selectionStart = textarea.selectionEnd = start + processedText.length;

    // 触发input事件，确保Vue/React等框架或依赖input事件的逻辑能响应变化
    textarea.dispatchEvent(new Event('input', {bubbles: true}));
};

// 更新备注区下方的链接预览
RoadbookApp.prototype.updateLinkPreview = function(sourceTextarea, targetContainer) {
    const text = sourceTextarea.value;
    targetContainer.innerHTML = ''; // 清空现有链接

    if (!text) return;

    const linkRegex = /\[([^\]]+?)\]\((https?:\/\/[^\s$.?#].[^\s]*)\)/g;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
        const linkText = match[1];
        const linkUrl = match[2];

        const linkElement = document.createElement('a');
        linkElement.href = linkUrl;
        linkElement.textContent = linkText;
        linkElement.target = '_blank';
        linkElement.rel = 'noopener noreferrer';

        targetContainer.appendChild(linkElement);
    }
};

// 处理连接线标签输入框的粘贴事件，自动将链接转换为Markdown格式
RoadbookApp.prototype.handleConnectionLabelsPaste = function(event) {
    event.preventDefault(); // 阻止默认的粘贴行为

    const clipboardData = event.clipboardData;
    const pastedText = clipboardData.getData('text/plain');

    const urlRegex = /(https?:\/\/[^\s/$.?#].[^\s]*)/; // 匹配URL的正则表达式
    const match = pastedText.match(urlRegex);

    let processedText = pastedText;

    if (match) {
        const url = match[0]; // 匹配到的第一个URL
        processedText = `[相关链接](${url})`; // 始终使用 '相关链接' 作为链接文本
    }

    // 将处理后的文本插入到当前光标位置
    const textarea = event.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const newValue = textarea.value.substring(0, start) + processedText + textarea.value.substring(end);
    textarea.value = newValue;

    // 调整光标位置
    textarea.selectionStart = textarea.selectionEnd = start + processedText.length;

    // 触发input事件，确保Vue/React等框架或依赖input事件的逻辑能响应变化
    textarea.dispatchEvent(new Event('input', {bubbles: true}));
};

// 转义HTML特殊字符，防止XSS攻击
RoadbookApp.prototype.escapeHtml = function(text) {
    if (typeof text !== 'string') {
        return '';
    }
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
        '/': '&#x2F;'
    };
    return text.replace(/[&<>"'\/]/g, m => map[m]);
};

RoadbookApp.prototype.getLocalDateTimeForInput = function(dateTimeString) {
    // 将日期时间字符串转换为datetime-local输入框需要的格式
    if (!dateTimeString) return '';

    try {
        const date = new Date(dateTimeString);
        if (isNaN(date.getTime())) return '';

        // 获取本地时间的各个部分
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch (error) {
        console.error('日期时间转换错误:', error);
        return '';
    }
};

// 在 WebMercator 投影坐标系下计算线段上的点，避免长距离情况下的视觉偏移
// startPos/endPos: [lat, lng]
// ratio: 0~1
RoadbookApp.prototype.getPointOnConnection = function(startPos, endPos, ratio) {
    try {
        if (!this.map || typeof this.map.project !== 'function' || typeof this.map.unproject !== 'function') {
            return null;
        }

        const startLat = parseFloat(startPos[0]);
        const startLng = parseFloat(startPos[1]);
        const endLat = parseFloat(endPos[0]);
        const endLng = parseFloat(endPos[1]);

        if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
            return null;
        }

        const zoom = this.map.getZoom();
        const p1 = this.map.project(L.latLng(startLat, startLng), zoom);
        const p2 = this.map.project(L.latLng(endLat, endLng), zoom);
        const x = p1.x + (p2.x - p1.x) * ratio;
        const y = p1.y + (p2.y - p1.y) * ratio;
        const ll = this.map.unproject(L.point(x, y), zoom);
        return [ll.lat, ll.lng];
    } catch (e) {
        return null;
    }
};

// 基于投影坐标计算箭头朝向角度（0deg 指向上方）
RoadbookApp.prototype.getConnectionAngleDeg = function(startPos, endPos) {
    try {
        if (!this.map || typeof this.map.project !== 'function') {
            return null;
        }

        const startLat = parseFloat(startPos[0]);
        const startLng = parseFloat(startPos[1]);
        const endLat = parseFloat(endPos[0]);
        const endLng = parseFloat(endPos[1]);

        if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
            return null;
        }

        const zoom = this.map.getZoom();
        const p1 = this.map.project(L.latLng(startLat, startLng), zoom);
        const p2 = this.map.project(L.latLng(endLat, endLng), zoom);

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;

        // 屏幕坐标系 y 向下为正；箭头默认指向上方
        return Math.atan2(dx, -dy) * 180 / Math.PI;
    } catch (e) {
        return null;
    }
};

RoadbookApp.prototype.createArrowHead = function(startPos, endPos, transportType) {
    // 计算箭头位置（在线段中间偏后位置，避免与标记点冲突）
    const startLat = parseFloat(startPos[0]);
    const startLng = parseFloat(startPos[1]);
    const endLat = parseFloat(endPos[0]);
    const endLng = parseFloat(endPos[1]);

    // 计算线段长度的75%位置（避免太靠近终点）
    const ratio = 0.75;
    const projectedArrowPos = this.getPointOnConnection(startPos, endPos, ratio);
    const arrowLat = projectedArrowPos ? projectedArrowPos[0] : (startLat + (endLat - startLat) * ratio);
    const arrowLng = projectedArrowPos ? projectedArrowPos[1] : (startLng + (endLng - startLng) * ratio);

    // 计算方向角度：优先使用投影坐标（长距离更准确），失败则回退到地理坐标近似
    let angle = this.getConnectionAngleDeg(startPos, endPos);
    if (angle === null) {
        const deltaLat = endLat - startLat; // 纬度差（垂直方向，北为正）
        const deltaLng = endLng - startLng; // 经度差（水平方向，东为正）
        angle = Math.atan2(deltaLng, deltaLat) * 180 / Math.PI;
    }

    // 创建大号箭头图标 - 增大尺寸提高可见性
    const arrowColor = this.getTransportColor(transportType);
    const arrowIcon = L.divIcon({
        className: 'arrow-icon',
        html: `<div style="
            position: relative;
            width: 28px;
            height: 28px;
            transform: rotate(${angle}deg);
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
                border-bottom: 20px solid ${arrowColor};
                filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));
            "></div>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    return L.marker([arrowLat, arrowLng], {
        icon: arrowIcon,
        interactive: false, // 箭头不参与交互
        zIndexOffset: 15 // 确保箭头在连接线之上但低于标记点
    });
};

// 计算两点之间的直线距离（米）
RoadbookApp.prototype.calculateLineDistance = function(latlng1, latlng2) {
    const R = 6371e3; // 地球半径（米）
    const φ1 = latlng1[0] * Math.PI / 180;
    const φ2 = latlng2[0] * Math.PI / 180;
    const Δφ = (latlng2[0] - latlng1[0]) * Math.PI / 180;
    const Δλ = (latlng2[1] - latlng1[1]) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // 距离以米为单位
};

RoadbookApp.prototype.getTransportTypeName = function(type) {
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
};

RoadbookApp.prototype.getTransportIcon = function(type) {
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
};

RoadbookApp.prototype.getRecommendedTransport = function(distance) {
    if (distance < 5000) { // 5km
        return 'walk';
    } else if (distance < 400000) { // 400km
        return 'car';
    } else if (distance < 1500000) { // 1500km
        return 'train';
    } else {
        return 'plane';
    }
};

RoadbookApp.prototype.estimateDuration = function(distance, transportType) {
    const speeds = {
        walk: 5,    // km/h
        car: 80,
        train: 250,
        plane: 800
    };
    const coefficients = {
        walk: 1.2,
        car: 1.4,
        train: 1.3,
        plane: 1.1
    };

    const speedKmh = speeds[transportType] || 80;
    const coefficient = coefficients[transportType] || 1.4; // Default to car's coefficient
    const actualDistanceKm = (distance * coefficient) / 1000;

    if (speedKmh === 0) return 0;
    const durationHours = actualDistanceKm / speedKmh;
    return Math.round(durationHours);
};

RoadbookApp.prototype.debugLog = function(...args) {
    if (this.debugMode) {
        console.log(...args);
    }
};

// SweetAlert2 工具函数
RoadbookApp.prototype.showSwalAlert = function(title, text, icon = 'info', position = 'center') {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: title,
            text: text,
            icon: icon,
            position: position,
            showConfirmButton: true,
            confirmButtonText: '确定',
            confirmButtonColor: '#667eea',
            timer: icon === 'success' ? 2000 : undefined,
            toast: position === 'top-end',
            background: icon === 'success' ? '#4caf50' : '#fff',
            color: icon === 'success' ? '#fff' : '#333',
            iconColor: icon === 'success' ? '#fff' : undefined
        });
    } else {
        // 如果SweetAlert2不可用，回退到普通alert
        alert(text);
    }
};

// SweetAlert2 确认对话框
RoadbookApp.prototype.showSwalConfirm = function(title, text, confirmText = '确定', cancelText = '取消') {
    if (typeof Swal !== 'undefined') {
        return Swal.fire({
            title: title,
            text: text,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: confirmText,
            cancelButtonText: cancelText,
            confirmButtonColor: '#667eea',
            cancelButtonColor: '#6c757d'
        });
    } else {
        // 如果SweetAlert2不可用，回退到普通confirm
        return Promise.resolve({isConfirmed: confirm(text)});
    }
};

RoadbookApp.prototype.closeModals = function() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
    // 不再调用 closeDateDetail，因为关闭模态框不应该影响当前选中的标记点或连接
};

/**
 * 比较两个版本号的大小
 * @param {string} v1 - 例如 "v0.0.9-4-gb666551"
 * @param {string} v2 - 例如 "v0.0.10"
 * @returns {number} 1: v1 > v2, -1: v1 < v2, 0: 相等或无法比较
 */
RoadbookApp.prototype.compareVersions = function(v1, v2) {
    // 1. 提取语义化版本和提交偏移量
    // 正则匹配：v(主).(次).(补丁)-(偏移量)-g(哈希)
    const regex = /^v?(\d+)\.(\d+)\.(\d+)(?:-(\d+)-g[0-9a-f]+)?$/;

    const parse = (v) => {
        if (!v || typeof v !== 'string') return null;
        const match = v.match(regex);
        if (!match) return null; // 格式不对，无法比较
        return {
            major: parseInt(match[1]),
            minor: parseInt(match[2]),
            patch: parseInt(match[3]),
            offset: match[4] ? parseInt(match[4]) : 0 // 没有偏移量则视为0
        };
    };

    const p1 = parse(v1);
    const p2 = parse(v2);

    if (!p1 || !p2) return 0; // 无法比较时视为相等

    // 2. 依次比较
    if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
    if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
    if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;

    // 3. 版本号相同，比较偏移量 (提交次数越多越新)
    if (p1.offset !== p2.offset) return p1.offset > p2.offset ? 1 : -1;

    return 0;
};

// 更新小红书链接
RoadbookApp.prototype.updateXiaohongshuLink = function(data) {
    const isMarker = !!data.marker;
    const linkId = isMarker ? 'xiaohongshuMarkerLink' : 'xiaohongshuConnectionLink';
    const linkElement = document.getElementById(linkId);

    if (linkElement) {
        let query = '';
        if (isMarker) {
            query = `${data.title} 攻略`;
        } else {
            const startMarker = this.markers.find(m => m.id === data.startId);
            const endMarker = this.markers.find(m => m.id === data.endId);
            if (startMarker && endMarker) {
                query = `${startMarker.title}到${endMarker.title}`;
            }
        }
        linkElement.href = `https://www.xiaohongshu.com/search_result/?keyword=${encodeURIComponent(query)}`;
    }
};
