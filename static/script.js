const apiBaseUrl = (() => {
    const custom = localStorage.getItem('custom_api_base_url');
    if (custom) return custom;
    const hostname = window.location.hostname || '';
    const protocol = window.location.protocol || '';

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || protocol === 'file:') {
        return 'http://127.0.0.1:5436';
    } else {
        return window.location.origin;
    }
})();

// 从页面 DOM 中获取前端展示的版本号（由 index.html + update_version.sh 写入）
function getAppVersionFromDOM() {
    try {
        const el = document.getElementById('version-display');
        if (!el) return 'unknown';

        // 优先使用文本内容
        const text = (el.textContent || '').trim();
        if (text) return text;

        // 其次尝试 data-version 等属性
        const dataVersion = (el.getAttribute('data-version') || '').trim();
        if (dataVersion) return dataVersion;

        return 'unknown';
    } catch (e) {
        return 'unknown';
    }
}

// 供其他脚本使用的全局版本常量
window.ROADBOOK_APP_VERSION = getAppVersionFromDOM();

class RoadbookApp {
    constructor() {
        this.map = null;
        this.markers = [];
        this.connections = [];
        this.labels = [];
        this.currentMode = 'view';
        this.selectedMarkers = [];
        this.currentIcon = {
            type: 'default',
            icon: '📍',
            color: '#667eea'
        };
        this.searchMarker = null;  // 搜索结果标记点
        this.searchTimeout = null; // 搜索延时定时器
        this.searchPopupTimeout = null; // 搜索弹窗定时器
        this.currentSearchMethod = 'auto'; // 当前搜索方式：auto, nominatim, overpass, photon, mapsearch
        this.tooltip = null; // 连接线工具提示
        this.connectionLabelTooltip = null; // 连接线标注工具提示
        this.markerTooltip = null; // 标记点工具提示
        this.searchResults = null; // 搜索结果对象
        this.currentMarker = null; // 当前选中的标记点
        this.currentConnection = null; // 当前选中的连接线
        this.filterMode = false; // 是否处于筛选模式
        this.filteredDate = null; // 当前筛选的日期
        this.history = []; // 操作历史栈
        this.historyLimit = 50; // 历史记录最大数量
        this.dateNotes = {}; // 日期备注信息
        this.hoverTimeout = null; // 聚焦按钮的悬浮计时器
        this.lastDateRange = null; // 上次使用的日期范围
        this.isDarkMode = false; // 主题模式状态

        this.isDraggingLine = false; // 是否正在拖拽连接线
        this.dragStartMarker = null; // 拖拽连接线的起始标记点
        this.dragPreviewLine = null; // 拖拽时的预览线
        this.dragPreviewArrow = null; // 拖拽时的预览箭头

        this.searchProviderOriginalTexts = new Map();

        this.init();
    }

    // --- Latency and Comment Features Start ---

    addSearchProviderComments() {
        const select = document.getElementById('searchMethodSelect');
        if (!select) return;

        const providerComments = {
            auto: '根据当前地图自动选择最合适的搜索服务。',
            gaode: '高德搜索，由后端服务器代理，适用于中国大陆区域, 需要 apikey。',
            tiansearch: '天地图搜索，由后端服务器代理，适用于中国大陆区域。',
            cnsearch: '百度搜索，由后端服务器代理，适用于中国大陆区域（可能不稳定）。',
            nominatim: 'OpenStreetMap官方搜索，全球范围适用，国外地址推荐。',
            overpass: '一个功能强大的OSM数据挖掘工具，语法复杂，稳定性差不推荐。',
            mapsearch: '一个第三方的中文OSM搜索服务，无需翻墙。',
            photon: '基于OpenStreetMap的快速搜索，全球范围适用。'
        };

        Array.from(select.options).forEach(option => {
            const provider = option.value;
            if (providerComments[provider]) {
                option.title = providerComments[provider];
            }
        });
    }

    // Helper to convert performance.now() diff to ms
    performanceToMilliseconds(diff) {
        return Math.round(diff);
    }

    async testSearchProviderLatency(provider) {
        const urls = {
            nominatim: 'https://nominatim.openstreetmap.org/status.php',
            overpass: 'https://overpass-api.de/api/interpreter',
            mapsearch: 'https://map.011203.dpdns.org/search?q=test',
            photon: 'https://photon.komoot.io/api/?q=test',
            // For backend-proxied providers (gaode, tiansearch, cnsearch),
            // latency is not tested via HEAD request from frontend.
            // Backend /api/search/providers should ideally provide this info,
            // or these options are simply marked as "available" if not loginRequired.
        };

        const url = urls[provider];
        if (!url) {
            // If the provider is a backend-proxied one, assume OK unless specified by backend
            if (['gaode', 'tiansearch', 'cnsearch'].includes(provider)) {
                return { status: 'ok', latency: 0 };
            }
            return { status: 'n/a' };
        }

        const startTime = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });

            clearTimeout(timeoutId);
            const latency = this.performanceToMilliseconds(performance.now() - startTime);
            return { status: 'ok', latency };
        } catch (error) {
            return { status: 'error' };
        }
    }

    async updateProviderIcons() {
        const select = document.getElementById('searchMethodSelect');
        if (!select) return;

        if (this.searchProviderOriginalTexts.size === 0) {
            Array.from(select.options).forEach(option => {
                let cleanText = option.text;
                // Remove existing icons like ⏱️, ✅, ❌ etc.
                if (cleanText.length > 2 && !/^[a-zA-Z0-9]/.test(cleanText.charAt(0)) && cleanText.charAt(1) === ' ') {
                    cleanText = cleanText.substring(2);
                }
                this.searchProviderOriginalTexts.set(option.value, cleanText);
            });
        }

        let backendProviders = [];
        let backendFetchFailed = false; // New flag to track if fetching backend providers failed
        try {
            const response = await fetch(`${apiBaseUrl}/api/search/providers`);
            if (response.ok) {
                backendProviders = await response.json();
            } else {
                console.error('Failed to fetch search providers from backend:', response.statusText);
                backendFetchFailed = true; // Set flag on HTTP error
            }
        } catch (error) {
            console.error('Error fetching search providers from backend:', error);
            backendFetchFailed = true; // Set flag on network error
        }

        const promises = Array.from(select.options).map(async (option) => {
            const providerId = option.value;
            const originalText = this.searchProviderOriginalTexts.get(providerId) || 'Unknown';

            // Special handling for "auto"
            if (providerId === 'auto') {
                option.text = originalText;
                option.disabled = false;
                return;
            }

            const isBackendProvider = ['gaode', 'tiansearch', 'cnsearch'].includes(providerId);

            // Handle overall backend fetch failure for backend providers
            if (isBackendProvider && backendFetchFailed) {
                option.text = `❌ ${originalText}`;
                // option.disabled = true; // Removed disabled state
                return;
            }

            let backendProvider = null;
            if (!backendFetchFailed) { // Only try to find if the fetch itself didn't fail
                backendProvider = backendProviders.find(bp => {
                    // Map frontend IDs to backend names/IDs for backend-proxied services
                    // Backend names are lowercase: 'gaode', 'tianmap', 'baidu'
                    if (providerId === 'gaode' && bp.name === 'gaode') return true;
                    if (providerId === 'tiansearch' && bp.name === 'tianmap') return true;
                    if (providerId === 'cnsearch' && bp.name === 'baidu') return true;
                    return false; // For frontend-only providers, this will be false
                });
            }

            // Handle loginRequired for backend-proxied providers (if backend fetch succeeded and provider found)
            // Backend property is 'login_required' (snake_case)
            if (backendProvider && backendProvider.login_required) {
                option.text = `🔒 ${originalText}`;
                return;
            } else if (backendProvider) { // If it's a backend provider, and not loginRequired
                // Assume "ok" status for now if no specific status from backend itself.
                option.text = `✅ ${originalText}`;
                return; // Done with this backend provider
            }

            // For frontend-only providers (nominatim, overpass, mapsearch, photon)
            // and any other provider not explicitly handled as a backend provider
            // if (!option.disabled) { // Condition no longer needed if not disabling
                option.text = `⏱️ ${originalText}`;
            // }

            const result = await this.testSearchProviderLatency(providerId);

            let icon = '❔';
            if (result.status === 'ok') {
                if (result.latency < 500) icon = '✅';
                else if (result.latency < 1500) icon = '👍';
                else icon = '⚠️';
            } else if (result.status === 'error') {
                icon = '❌';
            }

            option.text = `${icon} ${originalText}`;
            // option.disabled = (result.status === 'error'); // Removed disabled state
        });

        await Promise.all(promises);
        console.log("所有搜索服务商延迟测试完成。");
    }

    // --- Latency and Comment Features End ---


    // 主题切换相关方法
    initTheme() {
        const savedTheme = localStorage.getItem('roadbook-theme');
        if (savedTheme) {
            // 如果有保存的设置，则使用它
            if (savedTheme === 'dark') {
                this.enableDarkMode();
            } else {
                this.enableLightMode();
            }
        } else {
            // 否则，追随系统设置
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                this.enableDarkMode();
            } else {
                this.enableLightMode();
            }
        }
    }

    toggleTheme() {
        if (this.isDarkMode) {
            this.enableLightMode();
        } else {
            this.enableDarkMode();
        }
    }

    enableDarkMode() {
        document.body.classList.add('dark-mode');
        this.isDarkMode = true;
        localStorage.setItem('roadbook-theme', 'dark');
        this.updateThemeIcon();
    }

    enableLightMode() {
        document.body.classList.remove('dark-mode');
        this.isDarkMode = false;
        localStorage.setItem('roadbook-theme', 'light');
        this.updateThemeIcon();
    }

    updateThemeIcon() {
        const themeIcon = document.getElementById('themeIcon');
        if (themeIcon) {
            themeIcon.textContent = this.isDarkMode ? '🌙' : '☀️';
        }
    }

    // 添加方法到类中
    addHistory(operation, data) {
        // 记录操作到历史栈
        this.history.push({
            operation: operation,
            data: data,
            timestamp: Date.now()
        });

        // 限制历史记录数量
        if (this.history.length > this.historyLimit) {
            this.history.shift(); // 移除最旧的记录
        }
    }

    // 检测是否为移动设备
    isMobileDevice() {
        // 检测多种移动设备特征
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (navigator.maxTouchPoints && navigator.maxTouchPoints > 2) || // 检测触摸屏
               (window.innerWidth <= 768); // 小屏幕设备也视为移动设备
    }

    // 撤销操作
    undo() {
        if (this.history.length === 0) {
            console.log('没有可撤销的操作');
            return false;
        }

        const lastOperation = this.history.pop();

        switch (lastOperation.operation) {
            case 'addMarker':
                return this.undoAddMarker(lastOperation.data);
            case 'removeMarker':
                return this.undoRemoveMarker(lastOperation.data);
            case 'addConnection':
                return this.undoAddConnection(lastOperation.data);
            case 'removeConnection':
                return this.undoRemoveConnection(lastOperation.data);
            case 'moveMarker':
                return this.undoMoveMarker(lastOperation.data);
            default:
                console.error('未知的操作类型:', lastOperation.operation);
                return false;
        }
    }

    undoAddMarker(data) {
        // 查找要撤销的标记点
        const markerIndex = this.markers.findIndex(m => m.id === data.id);
        if (markerIndex !== -1) {
            const marker = this.markers[markerIndex];
            this.removeMarker(marker);
            console.log(`已撤销添加标记点: ${data.title}`);
            return true;
        }
        console.warn('找不到要撤销的标记点:', data);
        return false;
    }

    undoRemoveMarker(data) {
        // 重新添加标记点
        const icon = this.createMarkerIcon(data.icon, this.markers.length + 1);

        const marker = L.marker([data.position[0], data.position[1]], {
            icon: icon,
            draggable: !this.isMobileDevice(),
            title: data.title
        }).addTo(this.map);

        const markerData = {
            id: data.id,
            marker: marker,
            position: data.position,
            title: data.title,
            labels: data.labels || [],
            logo: data.logo || null,  // 添加logo属性
            icon: data.icon,
            createdAt: data.createdAt,
            dateTimes: data.dateTimes || [data.dateTime],
            dateTime: data.dateTimes ? data.dateTimes[0] : data.dateTime
        };

        this.markers.push(markerData);

        // 添加事件监听
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (this.isMobileDevice()) {
                const popupContent = this.generateMarkerPopupContent(markerData);
                marker.bindPopup(popupContent).openPopup();
            } else {
                this.showMarkerDetail(markerData);
            }
        });

        marker.on('mouseover', (e) => {
            if (e.target.getElement()) {
                e.target.getElement()._savedTitle = e.target.getElement().getAttribute('title');
                e.target.getElement().removeAttribute('title');
            }
            this.showMarkerTooltip(markerData, e.latlng, e);
        });

        marker.on('mouseout', (e) => {
            if (e.target.getElement() && e.target.getElement()._savedTitle) {
                e.target.getElement().setAttribute('title', e.target.getElement()._savedTitle);
            }
            this.hideMarkerTooltip();
        });

        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            markerData.position = [newPos.lat, newPos.lng];

            // 更新连接线
            this.updateConnections();
            // 更新标注位置
            this.updateLabels();

            // 如果当前标记点正在详情面板中显示，更新坐标显示
            if (this.currentMarker === markerData) {
                const markerCoords = document.getElementById('markerCoords');
                if (markerCoords) {
                    markerCoords.textContent = `${newPos.lng.toFixed(6)}, ${newPos.lat.toFixed(6)}`;
                }
            }

            // 更新标记点列表中的坐标显示
            this.updateMarkerList();

            // 保存到本地存储
            this.saveToLocalStorage();
        });

        console.log(`已撤销删除标记点: ${data.title}`);
        return true;
    }

    undoAddConnection(data) {
        // 查找要撤销的连接线
        const connectionIndex = this.connections.findIndex(c => c.id === data.id);
        if (connectionIndex !== -1) {
            const connection = this.connections[connectionIndex];
            this.removeConnection(connection);
            console.log('已撤销添加连接线');
            return true;
        }
        console.warn('找不到要撤销的连接线:', data);
        return false;
    }

    undoRemoveConnection(data) {
        // 通过ID查找起始点和终点
        const startMarker = this.markers.find(m => m.id === data.startId);
        const endMarker = this.markers.find(m => m.id === data.endId);

        if (!startMarker || !endMarker) {
            console.error('连接线的起始点或终点不存在:', data.startId, data.endId);
            return false;
        }

        // 创建连接线
        const polyline = L.polyline([
            [startMarker.position[0], startMarker.position[1]],
            [endMarker.position[0], endMarker.position[1]]
        ], {
            color: this.getTransportColor(data.transportType),
            weight: 6,
            opacity: 1.0,
            smoothFactor: 1.0
        }).addTo(this.map);

        // 添加终点标记（小圆点）
        const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
            radius: 6,
            fillColor: this.getTransportColor(data.transportType),
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(this.map);

        // 创建箭头
        const arrowHead = this.createArrowHead(startMarker.position, endMarker.position, data.transportType);
        arrowHead.addTo(this.map);

        // 计算中点位置并添加交通图标
        const startLat = parseFloat(startMarker.position[0]);
        const startLng = parseFloat(startMarker.position[1]);
        const endLat = parseFloat(endMarker.position[0]);
        const endLng = parseFloat(endMarker.position[1]);

        if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
            console.error('连接线坐标无效:', startMarker.position, endMarker.position);
            return false;
        }

        const fallbackMidLat = (startLat + endLat) / 2;
        const fallbackMidLng = (startLng + endLng) / 2;
        const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
        const transportIcon = this.getTransportIcon(data.transportType);

        const iconMarker = L.marker(midPos, {
            icon: L.divIcon({
                className: 'transport-icon',
                html: `<div style="background-color: white; border: 2px solid ${this.getTransportColor(data.transportType)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${transportIcon}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(this.map);

        const connection = {
            id: data.id,
            startId: data.startId,
            endId: data.endId,
            transportType: data.transportType,
            polyline: polyline,
            endCircle: endCircle,
            iconMarker: iconMarker,
            arrowHead: arrowHead,
            dateTime: data.dateTime || this.getCurrentLocalDateTime(),
            label: data.label || '',
            logo: data.logo || null,  // 添加logo属性
            duration: data.duration || 0,
            startTitle: data.startTitle || startMarker.title,
            endTitle: data.endTitle || endMarker.title
        };

        // 添加连接线事件
        const self = this;
        polyline.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            if (self.isMobileDevice()) {
                const startMarker = self.markers.find(m => m.id === connection.startId);
                const endMarker = self.markers.find(m => m.id === connection.endId);
                const popupContent = self.generateConnectionPopupContent(connection, startMarker, endMarker);
                polyline.bindPopup(popupContent).openPopup();
            } else {
                self.showConnectionDetail(connection);
            }
        });

        // 绑定图标点击事件
        iconMarker.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            if (self.isMobileDevice()) {
                const startMarker = self.markers.find(m => m.id === connection.startId);
                const endMarker = self.markers.find(m => m.id === connection.endId);
                const popupContent = self.generateConnectionPopupContent(connection, startMarker, endMarker);
                polyline.bindPopup(popupContent).openPopup();
            } else {
                self.showConnectionDetail(connection);
            }
        });

        polyline.on('mouseover', function(e) {
            self.showConnectionTooltip(connection, e.latlng);
        });

        polyline.on('mouseout', function() {
            self.hideConnectionTooltip();
        });

        this.connections.push(connection);

        console.log('已撤销删除连接线');
        return true;
    }

    undoMoveMarker(data) {
        // 查找标记点并恢复到之前的位置
        const marker = this.markers.find(m => m.id === data.id);
        if (marker) {
            // 将标记点移回之前的位置
            marker.marker.setLatLng([data.prevPosition[0], data.prevPosition[1]]);
            marker.position = [...data.prevPosition];

            // 更新连接线和标注位置
            this.updateConnections();
            this.updateLabels();

            // 更新标记点列表
            this.updateMarkerList();

            console.log(`已撤销移动标记点 "${marker.title}" 到 ${data.prevPosition[1].toFixed(6)}, ${data.prevPosition[0].toFixed(6)}`);
            return true;
        }
        console.warn('找不到要撤销移动的标记点:', data);
        return false;
    }

    init() {
        // 检测是否为移动设备
        // if (this.isMobileDevice()) {
        //     this.showSwalAlert('设备提示', '当前界面不支持手机端编辑功能，请使用电脑访问以获得完整体验。导出的路书可在手机端正常查看。', 'info');
        // }

        // 初始化主题
        this.initTheme();

        // 初始化移动端适配
        this.initMobileFeatures();

        // 先尝试从本地存储加载设置，以获取保存的地图源和搜索方式
        const cachedData = this.loadSettingsFromCache();
        if (cachedData) {
            // 如果缓存中有数据，使用缓存的设置
            this.currentLayer = cachedData.currentLayer || 'osm';
            this.currentSearchMethod = cachedData.currentSearchMethod || 'auto';
        } else {
            // 否则使用默认设置
            this.currentLayer = 'gaode';  // 改为高德地图
            this.currentSearchMethod = 'auto';
        }

        // 检查URL中是否有分享ID参数
        const urlParams = new URLSearchParams(window.location.search);
        const shareID = urlParams.get('shareID');

        // 首先进行正常的地图初始化（无论是否有分享ID）
        this.initMap();
        this.bindEvents();
        this.bindExpandModalEvents();
        this.addSearchProviderComments();

        if (shareID) {
            // 如果有分享ID，先正常加载本地数据，然后处理分享数据
            this.loadFromLocalStorage(); // 先加载本地缓存
            this.updateSearchInputState(); // 初始化搜索框状态

            // 检查本地缓存
            const hasLocalData = this.checkLocalCache();
            if (hasLocalData) {
                // 本地有数据，询问用户是否覆盖
                this.askUserToImportSharedData(shareID);
            } else {
                // 本地无数据，直接导入分享数据
                this.importSharedData(shareID);
            }
            // 清除分享参数，避免重复触发
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            // 正常初始化流程
            this.loadFromLocalStorage(); // 初始化时加载本地缓存
            this.updateSearchInputState(); // 初始化搜索框状态

            // 检查是否是首次进入（没有标记点、连接线和日期备注）
            const savedData = localStorage.getItem('roadbookData');
            if (!savedData) {
                // 首次进入，尝试获取用户位置并定位
                this.locateUserAndFitView();
            }
        }
    }

    // 自动定位用户并聚焦到用户位置（仅在首次进入时）
    locateUserAndFitView() {
        if (!navigator.geolocation) {
            console.log('浏览器不支持地理定位');
            // 如果浏览器不支持定位，则使用默认位置（北京）
            this.map.setView([39.90923, 116.397428], 10); // 北京天安门
            return;
        }

        console.log('正在尝试获取用户位置...');

        // 先显示一个加载提示
        const loadingMessage = document.createElement('div');
        loadingMessage.id = 'geolocation-loading';
        loadingMessage.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            z-index: 10000;
            font-size: 16px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        loadingMessage.innerHTML = `
            <div style="margin-bottom: 8px;">📍 正在获取您的位置...</div>
            <div style="font-size: 12px; opacity: 0.8;">请允许位置访问权限</div>
        `;
        document.body.appendChild(loadingMessage);

        // 设置较短的超时时间来移除加载提示，避免UI阻塞
        const timeoutId = setTimeout(() => {
            const loadingEl = document.getElementById('geolocation-loading');
            if (loadingEl) {
                document.body.removeChild(loadingEl);
                console.log('获取位置超时，使用默认位置');
                // 超时后使用默认位置
                this.map.setView([39.90923, 116.397428], 10); // 北京天安门

                // 在默认位置添加一个临时标记点来显示定位结果
                if (this.searchMarker) {
                    this.map.removeLayer(this.searchMarker);
                }

                this.searchMarker = L.marker([39.90923, 116.397428])
                    .addTo(this.map);
            }
        }, 3000); // 3秒超时

        navigator.geolocation.getCurrentPosition(
            // 成功回调
            (position) => {
                // 清除超时定时器
                clearTimeout(timeoutId);

                const { latitude, longitude } = position.coords;
                console.log(`获取到用户位置: 纬度=${latitude}, 经度=${longitude}`);

                // 移除加载提示
                const loadingEl = document.getElementById('geolocation-loading');
                if (loadingEl) {
                    document.body.removeChild(loadingEl);
                }

                // 设置地图视图到用户位置，使用中等缩放级别
                this.map.setView([latitude, longitude], 13);

                // 在用户位置添加一个临时标记点来显示定位结果
                if (this.searchMarker) {
                    this.map.removeLayer(this.searchMarker);
                }

                this.searchMarker = L.marker([latitude, longitude])
                    .addTo(this.map);

                console.log(`地图已定位到用户位置: [${latitude}, ${longitude}]`);
            },
            // 失败回调
            (error) => {
                // 清除超时定时器
                clearTimeout(timeoutId);

                console.log('获取用户位置失败:', error.message);

                // 移除加载提示
                const loadingEl = document.getElementById('geolocation-loading');
                if (loadingEl) {
                    document.body.removeChild(loadingEl);
                }

                // 获取失败时，使用默认位置（北京）
                this.map.setView([39.90923, 116.397428], 10); // 北京天安门

                // 在默认位置添加一个临时标记点来显示定位结果
                if (this.searchMarker) {
                    this.map.removeLayer(this.searchMarker);
                }

                this.searchMarker = L.marker([39.90923, 116.397428])
                    .addTo(this.map);

                console.log('使用默认位置（北京）');
            },
            {
                enableHighAccuracy: false,  // 禁用高精度以加快响应（可能无法在某些环境下工作）
                timeout: 2500,             // 2.5秒超时（略短于UI超时时间）
                maximumAge: 60000          // 使用1分钟内的缓存位置
            }
        );
    }

    // 从缓存中只加载设置而不加载其他数据
    loadSettingsFromCache() {
        try {
            const savedData = localStorage.getItem('roadbookData');
            if (savedData) {
                const data = JSON.parse(savedData);
                // 只返回设置相关的信息
                return {
                    currentLayer: data.currentLayer,
                    currentSearchMethod: data.currentSearchMethod
                };
            }
        } catch (error) {
            console.error('从本地存储加载设置失败:', error);
        }
        return null;
    }

    // 检查本地缓存是否存在且不为空
    checkLocalCache() {
        try {
            const savedData = localStorage.getItem('roadbookData');
            if (!savedData || savedData === '{}' || savedData === 'null') {
                return false;
            }
            const data = JSON.parse(savedData);
            // 检查是否有实际的标记点或连接线数据
            return (data.markers && data.markers.length > 0) ||
                   (data.connections && data.connections.length > 0) ||
                   (data.labels && data.labels.length > 0);
        } catch (error) {
            console.error('检查本地缓存失败:', error);
            return false;
        }
    }

    // 询问用户是否导入分享数据
    askUserToImportSharedData(shareID) {
        // 延迟显示确认对话框，确保页面完全加载
        setTimeout(() => {
            this.showSwalConfirm('发现分享链接', '检测到分享链接，当前本地已有数据。是否导入分享数据？这将覆盖当前本地数据。', '导入', '取消')
                .then(result => {
                    if (result.isConfirmed) {
                        this.importSharedData(shareID);
                    } else {
                        // 用户选择不导入，正常初始化
                        this.showSwalAlert('提示', '已取消导入分享数据', 'info');
                    }
                })
                .catch(error => {
                    console.error('显示确认对话框失败:', error);
                    // 如果显示对话框失败，继续正常初始化
                    this.showSwalAlert('提示', '已取消导入分享数据', 'info');
                });
        }, 1000); // 延迟1秒，确保所有UI元素都加载完成
    }

    // 导入分享数据
    async importSharedData(shareID) {
        try {
            // 显示加载提示（延迟显示，确保UI已经初始化）
            setTimeout(() => {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        title: '正在导入',
                        text: '正在加载分享数据...',
                        icon: 'info',
                        showConfirmButton: false,
                        allowOutsideClick: false,
                        didOpen: () => {
                            Swal.showLoading();
                        }
                    });
                }
            }, 100);

            // 调用分享接口获取数据
            const response = await this.fetchShareData(shareID);

            if (response && response.plan && response.plan.content) {
                // 提取实际的路线图数据内容
                const shareContent = response.plan.content;

                // 确保数据结构完整，提供默认值
                if (!shareContent.markers) {
                    shareContent.markers = [];
                }
                if (!shareContent.connections) {
                    shareContent.connections = [];
                }
                if (!shareContent.labels) {
                    shareContent.labels = [];
                }
                if (!shareContent.dateNotes) {
                    shareContent.dateNotes = {};
                }

                // 验证数据结构
                if (!Array.isArray(shareContent.markers)) {
                    throw new Error('分享数据中的markers必须是数组');
                }
                if (!Array.isArray(shareContent.connections)) {
                    throw new Error('分享数据中的connections必须是数组');
                }

                // 加载分享的数据
                this.loadRoadbook(shareContent, false);

                // 保存到本地缓存
                this.saveToLocalStorage();

                // 关闭加载提示并显示成功消息
                if (typeof Swal !== 'undefined') {
                    Swal.close();
                }

                setTimeout(() => {
                    this.showSwalAlert('成功', `分享数据导入成功！导入了 ${shareContent.markers.length} 个标记点和 ${shareContent.connections.length} 条连接线`, 'success');
                }, 200);

                // 继续正常初始化流程
                this.continueNormalInit();
            } else {
                throw new Error('分享数据格式不正确，缺少plan或plan.content字段');
            }
        } catch (error) {
            // 关闭加载提示
            if (typeof Swal !== 'undefined') {
                Swal.close();
            }

            this.showSwalAlert('错误', '导入分享数据失败: ' + error.message, 'error');

            // 导入失败，继续正常初始化
            this.continueNormalInit();
        }
    }

    // 从分享接口获取数据
    async fetchShareData(shareID) {
        try {
            // 构建分享接口URL
            const baseUrl = this.getShareApiBaseUrl();
            const shareUrl = `${baseUrl}/share/plans/${shareID}`;

            const response = await fetch(shareUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `获取分享数据失败: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('获取分享数据失败:', error);
            throw error;
        }
    }

    // 获取分享API基础URL
    getShareApiBaseUrl() {
        return apiBaseUrl + '/api/v1';
    }

    // 继续正常初始化流程
    continueNormalInit() {
        this.initMap();
        this.bindEvents();
        this.loadFromLocalStorage(); // 初始化时加载本地缓存
        this.updateSearchInputState(); // 初始化搜索框状态

        // 检查是否是首次进入（没有标记点、连接线和日期备注）
        const savedData = localStorage.getItem('roadbookData');
        if (!savedData) {
            // 首次进入，尝试获取用户位置并定位
            this.locateUserAndFitView();
        }
    }

    initMap() {
        // 初始化地图，使用OpenStreetMap作为默认图层
        this.map = L.map('mapContainer', {
            zoomSnap: 1,  // 使缩放级别步长进行捕捉，实现更平滑的缩放
            zoomDelta: 1  // 设置缩放增量
        }).setView([39.90923, 116.397428], 10); // 北京天安门

        // 定义地图搜索能力配置
        this.mapSearchConfig = {
            osm: {
                searchable: true,
                name: 'OpenStreetMap',
                searchUrl: 'https://nominatim.openstreetmap.org/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim' // 使用Nominatim API
            },
            satellite: {
                searchable: true,
                name: 'ESRI影像图',
                searchUrl: apiBaseUrl + '/api/tianmap/search',
                params: { format: 'json', limit: 10 },
                parser: 'nominatim'
            },
            esri_street: {
                searchable: true,
                name: 'ESRI街道图',
                searchUrl: apiBaseUrl + '/api/tianmap/search',
                params: { format: 'json', limit: 10 },
                parser: 'nominatim'
            },
            gaode: {
                searchable: true,
                name: '高德地图',
                searchUrl: apiBaseUrl + '/api/tianmap/search', // 使用TianSearch端点
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim' // 使用Nominatim格式，因为TianSearch与Nominatim格式一致
            },
            gaode_satellite: {
                searchable: true,
                name: '高德卫星图',
                searchUrl: apiBaseUrl + '/api/tianmap/search',
                params: { format: 'json', limit: 10 },
                parser: 'nominatim'
            },
            google: {
                searchable: true,
                name: 'Google地图',
                searchUrl: 'https://photon.komoot.io/api/',
                params: {
                    limit: 10
                },
                parser: 'photon' // 使用Photon API
            },
            google_satellite: {
                searchable: true,
                name: 'Google卫星图',
                searchUrl: apiBaseUrl + '/api/tianmap/search',
                params: { format: 'json', limit: 10 },
                parser: 'nominatim'
            },
            tencent: {
                searchable: true,
                name: '腾讯地图',
                searchUrl: apiBaseUrl + '/api/tianmap/search',
                params: { format: 'json', limit: 10 },
                parser: 'nominatim'
            }
        };

        // 定义地图图层
        this.mapLayers = {
            osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }),
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles © Esri',
                maxZoom: 19
            }),
            esri_street: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles &copy; Esri',
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
            }),
            tencent: L.tileLayer('https://rt{s}.map.gtimg.com/realtimerender?z={z}&x={x}&y={-y}&type=vector&styleid=3', {
                attribution: '&copy; Tencent',
                maxZoom: 18,
                subdomains: ['0', '1', '2']
            })
        };

        // 验证当前图层是否存在，如果不存在则回退到默认值
        if (!this.mapLayers[this.currentLayer]) {
            console.warn(`缓存的地图源 "${this.currentLayer}" 已失效，自动切换到默认地图。`);
            this.currentLayer = 'gaode'; // 默认高德地图
            this.saveToLocalStorage(); // 更新缓存，防止下次再出错
        }

        // 添加当前图层到地图
        // this.currentLayer 已经在 init() 方法中设置好了
        this.mapLayers[this.currentLayer].addTo(this.map);

        // 添加比例尺控件
        L.control.scale({imperial: false, metric: true}).addTo(this.map);

        // 添加地图点击事件
        this.map.on('click', (e) => {
            if (this.isMobileDevice()) return; // 移动端禁止点击地图操作

            // 新增: 如果AI助手窗口是打开的，则关闭它
            if (window.aiAssistant && typeof window.aiAssistant.closeChatIfOpen === 'function') {
                window.aiAssistant.closeChatIfOpen();
            }

            if (this.currentMode === 'addMarker') {
                this.addMarker(e.latlng);
            } else {
                // 如果当前处于编辑模式（有选中的标记点或连接线），则退出编辑模式
                // 这模仿了日期编辑界面的行为：点击地图返回列表，但不调整视图
                if (this.currentMarker) {
                    this.hideMarkerDetail();
                }
                if (this.currentConnection) {
                    this.hideConnectionDetail();
                }
            }
        });

        // 添加地图右键点击事件，用于取消添加标记点状态
        this.map.on('contextmenu', () => {
            if (this.currentMode === 'addMarker') {
                this.setMode('view'); // 取消添加标记点状态
            }
        });

        // 在地图容器DOM元素上添加右键事件监听器以阻止默认菜单
        const mapContainer = this.map.getContainer();
        mapContainer.addEventListener('contextmenu', (e) => {
            // 添加安全校验，防止事件对象不规范导致报错
            if (e && typeof e.preventDefault === 'function') {
                e.preventDefault(); // 阻止浏览器默认右键菜单
            }
        });
    }

    updateRecommendedTransportInModal() {
        const startSelect = document.getElementById('startMarker');
        const endSelect = document.getElementById('endMarker');
        const transportTypeSelect = document.getElementById('transportType');

        if (startSelect.value && endSelect.value) {
            const startMarker = this.markers[startSelect.value];
            const endMarker = this.markers[endSelect.value];
            if (startMarker && endMarker) {
                const distance = startMarker.marker.getLatLng().distanceTo(endMarker.marker.getLatLng());
                const recommendedTransport = this.getRecommendedTransport(distance);

                document.querySelectorAll('#connectModal .transport-btn').forEach(b => b.classList.remove('active'));
                const recommendedBtn = document.querySelector(`#connectModal .transport-btn[data-transport="${recommendedTransport}"]`);
                if (recommendedBtn) {
                    recommendedBtn.classList.add('active');
                }
                if (transportTypeSelect) {
                    transportTypeSelect.value = recommendedTransport;
                }
            }
        }
    }

    bindEvents() {
        // 全新的拖拽连接线逻辑，使用原生DOM事件以避免冲突
        const mapContainer = this.map.getContainer();

        mapContainer.addEventListener('mousedown', (e) => {
            if (this.currentMode !== 'view' || e.button !== 2) {
                return;
            }

            const latlng = this.map.mouseEventToLatLng(e);
            const startMarker = this.getMarkerAt(latlng);

            if (startMarker) {
                e.preventDefault();
                e.stopPropagation();

                this.isDraggingLine = true;
                this.dragStartMarker = startMarker;
                this.map.dragging.disable();

                const previewColorType = 'preview'; // 使用预览颜色
                const previewLatLng = [latlng.lat, latlng.lng];

                this.dragPreviewLine = L.polyline([startMarker.position, previewLatLng], {
                    color: this.getTransportColor(previewColorType),
                    weight: 3,
                    dashArray: '5, 10'
                }).addTo(this.map);

                this.dragPreviewArrow = this.createArrowHead(startMarker.position, previewLatLng, previewColorType);
                this.dragPreviewArrow.addTo(this.map);
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDraggingLine) {
                return;
            }

            const latlng = this.map.mouseEventToLatLng(e);
            const previewLatLng = [latlng.lat, latlng.lng];

            if (this.dragPreviewLine) {
                this.dragPreviewLine.setLatLngs([this.dragStartMarker.position, previewLatLng]);
            }

            if (this.dragPreviewArrow) {
                this.dragPreviewArrow.remove();
                const previewColorType = 'preview'; // 使用预览颜色
                this.dragPreviewArrow = this.createArrowHead(this.dragStartMarker.position, previewLatLng, previewColorType);
                this.dragPreviewArrow.addTo(this.map);
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (!this.isDraggingLine) {
                return;
            }

            if (this.dragPreviewLine) {
                this.dragPreviewLine.remove();
                this.dragPreviewLine = null;
            }
            if (this.dragPreviewArrow) {
                this.dragPreviewArrow.remove();
                this.dragPreviewArrow = null;
            }

            const latlng = this.map.mouseEventToLatLng(e);
            const endMarker = this.getMarkerAt(latlng);

            if (endMarker && endMarker.id !== this.dragStartMarker.id) {
                this.createConnection(this.dragStartMarker, endMarker, 'car');
            }

            this.isDraggingLine = false;
            this.dragStartMarker = null;
            this.map.dragging.enable();
        });


        // 工具栏按钮事件
        const addMarkerBtn = document.getElementById('addMarkerBtn');
        if (addMarkerBtn) {
            addMarkerBtn.addEventListener('click', () => {
                this.setMode('addMarker');
            });
        }

        const connectMarkersBtn = document.getElementById('connectMarkersBtn');
        if (connectMarkersBtn) {
            connectMarkersBtn.addEventListener('click', () => {
                this.showConnectModal();
            });
        }

        // 绑定导出按钮事件，现在需要处理下拉菜单
        const exportDropdownBtn = document.getElementById('exportDropdownBtn');
        const exportDropdownContent = document.getElementById('exportDropdownContent');
        const exportBtn = document.getElementById('exportBtn');
        const exportHtmlBtn = document.getElementById('exportHtmlBtn');
        const exportTxtBtn = document.getElementById('exportTxtBtn');


        // 下拉按钮点击事件 - 显示/隐藏下拉菜单
        if (exportDropdownBtn) {
            exportDropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                exportDropdownContent.classList.toggle('show');
            });
        }

        // 点击导出JSON按钮
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportRoadbook();
                // 隐藏下拉菜单
                if (exportDropdownContent) {
                    exportDropdownContent.classList.remove('show');
                }
            });
        }

        // 点击导出HTML按钮
        if (exportHtmlBtn) {
            exportHtmlBtn.addEventListener('click', () => {
                if (window.htmlExporter) {
                    window.htmlExporter.exportToHtml();
                } else {
                    console.error('HTML Exporter not found');
                }
                // 隐藏下拉菜单
                if (exportDropdownContent) {
                    exportDropdownContent.classList.remove('show');
                }
            });
        }

        // 点击导出TXT按钮
        if (exportTxtBtn) {
            exportTxtBtn.addEventListener('click', () => {
                // 隐藏下拉菜单
                if (exportDropdownContent) {
                    exportDropdownContent.classList.remove('show');
                }

                Swal.fire({
                    title: '导出为 TXT',
                    text: '导出的 TXT 文件主要用于大模型分析，无法重新导入。',
                    icon: 'info',
                    showCancelButton: true,
                    showDenyButton: true,
                    confirmButtonText: '导出文件',
                    denyButtonText: '复制到剪贴板',
                    cancelButtonText: '取消',
                    confirmButtonColor: '#667eea',
                    denyButtonColor: '#32b47c',
                    cancelButtonColor: '#6c757d'
                }).then((result) => {
                    if (result.isConfirmed) {
                        // 用户点击“确认导出”
                        if (window.htmlExporter) {
                            window.htmlExporter.exportToTxt();
                            this.showSwalAlert('已开始下载', 'TXT 文件已开始下载。', 'success');
                        } else {
                            console.error('HTML Exporter not found');
                        }
                    } else if (result.isDenied) {
                        // 用户点击“复制到剪贴板”
                        if (window.htmlExporter) {
                            const txtContent = window.htmlExporter.exportToTxt(true);
                            navigator.clipboard.writeText(txtContent).then(() => {
                                this.showSwalAlert('成功', '行程安排已复制到剪贴板！', 'success');
                            }).catch(err => {
                                console.error('复制失败:', err);
                                this.showSwalAlert('失败', '复制失败，请检查浏览器权限或手动导出。', 'error');
                            });
                        } else {
                            console.error('HTML Exporter not found');
                        }
                    }
                });
            });
        }

        // 点击页面其他地方隐藏下拉菜单
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown')) {
                if (exportDropdownContent && exportDropdownContent.classList.contains('show')) {
                    exportDropdownContent.classList.remove('show');
                }
            }
        });


        const importBtn = document.getElementById('importBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const importFile = document.getElementById('importFile');
                if (importFile) {
                    // 每次点击前清空 value，确保选择同一个文件也能触发 change 事件
                    importFile.value = '';
                    importFile.click();
                }
            });
        }

        const importFile = document.getElementById('importFile');
        if (importFile) {
            importFile.addEventListener('change', (e) => {
                this.importRoadbook(e.target.files[0]);
            });
        }

        const mapSourceSelect = document.getElementById('mapSourceSelect');
        if (mapSourceSelect) {
            mapSourceSelect.addEventListener('change', (e) => {
                // 只有在不是UI更新时才执行切换和保存操作
                if (!this.updatingUI) {
                    this.switchMapSource(e.target.value);
                    // 保存到本地存储以确保刷新后状态保持
                    this.saveToLocalStorage();
                }
            });
        }

        const clearCacheBtn = document.getElementById('clearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', () => {
                this.clearCache();
            });
        }

        // 搜索功能
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchLocation(searchInput.value);
                }
            });

            // 实时搜索功能（在用户输入时显示结果）
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                if (query) {
                    // 延迟搜索，避免频繁请求
                    clearTimeout(this.searchTimeout);
                    this.searchTimeout = setTimeout(() => {
                        this.searchLocation(query);
                    }, 300);
                } else {
                    // 如果输入为空，隐藏搜索结果
                    const searchResults = document.getElementById('searchResults');
                    if (searchResults) {
                        searchResults.style.display = 'none';
                    }
                }
            });
        }

        // 搜索方式选择事件
        const searchMethodSelect = document.getElementById('searchMethodSelect');
        if (searchMethodSelect) {
            searchMethodSelect.addEventListener('change', (e) => {
                // 只有在不是UI更新时才执行切换和保存操作
                if (!this.updatingUI) {
                    this.currentSearchMethod = e.target.value;
                    console.log(`搜索方式已切换为: ${this.currentSearchMethod}`);
                    // 保存到本地存储以确保刷新后状态保持
                    this.saveToLocalStorage();
                }
            });

            // Add a one-time mousedown listener to run the latency test
            searchMethodSelect.addEventListener('mousedown', () => {
                this.updateProviderIcons();
            }, { once: true });
        }

        // 点击页面其他地方隐藏搜索结果
        document.addEventListener('click', (e) => {
            const searchResults = document.getElementById('searchResults');
            const searchBox = document.querySelector('.search-box');
            if (searchResults && searchBox &&
                !searchBox.contains(e.target) &&
                !searchResults.contains(e.target)) {
                searchResults.style.display = 'none';
            }
        });

        // 标记点详情面板中的图标更换按钮事件
        const changeIconBtn = document.getElementById('changeIconBtn');
        if (changeIconBtn) {
            changeIconBtn.addEventListener('click', () => {
                this.showIconModal();
            });
        }

        const confirmIcon = document.getElementById('confirmIcon');
        if (confirmIcon) {
            confirmIcon.addEventListener('click', () => {
                this.confirmIconSelection();
            });
        }

        // 标记点详情面板关闭按钮
        const closeMarkerDetailBtn = document.getElementById('closeMarkerDetailBtn');
        if (closeMarkerDetailBtn) {
            closeMarkerDetailBtn.addEventListener('click', () => {
                this.hideMarkerDetail();
            });
        }

        // 连接线详情面板关闭按钮
        const closeConnectionDetailBtn = document.getElementById('closeConnectionDetailBtn');
        if (closeConnectionDetailBtn) {
            closeConnectionDetailBtn.addEventListener('click', () => {
                this.hideConnectionDetail();
            });
        }

        // --- 全局实时保存事件绑定 ---
        const realtimeSaveHandler = () => {
            if (this.currentMarker) {
                this.saveMarkerDetail();
            } else if (this.currentConnection) {
                this.saveConnectionDetail();
            } else if (this.currentDate) {
                this.saveDateNotes();
            }
        };

        ['markerNameInput', 'markerLabelsInput', 'markerLogoInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', realtimeSaveHandler);
        });
        ['connectionDuration', 'connectionLabelsInput', 'connectionLogoInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', realtimeSaveHandler);
        });
        ['connectionDateInput', 'connectionStartMarker', 'connectionEndMarker'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', realtimeSaveHandler);
        });
        const dateNotesInputForSave = document.getElementById('dateNotesInput');
        if (dateNotesInputForSave) dateNotesInputForSave.addEventListener('input', realtimeSaveHandler);
        // --- 全局实时保存事件绑定结束 ---

        // 连接线详情面板中的交通方式按钮事件
        document.querySelectorAll('.transport-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // 只有在连接线详情面板中才处理交通方式切换
                if (this.currentConnection) {
                    document.querySelectorAll('.transport-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    // 更新当前连接线的交通方式
                    const transportType = btn.dataset.transport;
                    this.updateConnectionTransport(this.currentConnection, transportType);
                    // 实时保存
                    this.saveConnectionDetail();
                }
            });
        });

        // 图标选项点击事件
        document.querySelectorAll('.icon-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            });
        });

        // 交通方式按钮点击事件
        document.querySelectorAll('.transport-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.transport-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 更新隐藏的select值
                const transportType = btn.dataset.transport;
                document.getElementById('transportType').value = transportType;
            });
        });

        // 模态框事件
        const closeBtn = document.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeModals();
            });
        }

        const startMarkerSelect = document.getElementById('startMarker');
        if (startMarkerSelect) {
            startMarkerSelect.addEventListener('change', () => this.updateRecommendedTransportInModal());
        }
        const endMarkerSelect = document.getElementById('endMarker');
        if (endMarkerSelect) {
            endMarkerSelect.addEventListener('change', () => this.updateRecommendedTransportInModal());
        }

        const confirmConnect = document.getElementById('confirmConnect');
        if (confirmConnect) {
            confirmConnect.addEventListener('click', () => {
                this.connectMarkers();
            });
        }


        // 图标选项点击事件
        document.querySelectorAll('.icon-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            });
        });

        // 交通方式按钮点击事件
        document.querySelectorAll('.transport-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.transport-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 更新隐藏的select值
                const transportType = btn.dataset.transport;
                document.getElementById('transportType').value = transportType;
            });
        });

        // 详情面板事件
        const closeDetailBtn = document.getElementById('closeDetailBtn');
        if (closeDetailBtn) {
            closeDetailBtn.addEventListener('click', () => {
                this.hideMarkerDetail();
            });
        }

        // saveMarkerBtn listener removed for real-time save

        // 为markerLabelsInput添加粘贴和输入事件监听器
        const markerLabelsInput = document.getElementById('markerLabelsInput');
        if (markerLabelsInput) {
            markerLabelsInput.addEventListener('paste', (e) => this.handleMarkerLabelsPaste(e));
            markerLabelsInput.addEventListener('input', () => {
                const targetContainer = document.getElementById('markerLabelsLinks');
                this.updateLinkPreview(markerLabelsInput, targetContainer);
            });
        }


        // saveConnectionBtn listener removed for real-time save

        // 为connectionLabelsInput添加粘贴和输入事件监听器
        const connectionLabelsInput = document.getElementById('connectionLabelsInput');
        if (connectionLabelsInput) {
            connectionLabelsInput.addEventListener('paste', (e) => this.handleConnectionLabelsPaste(e));
            connectionLabelsInput.addEventListener('input', () => {
                const targetContainer = document.getElementById('connectionLabelsLinks');
                this.updateLinkPreview(connectionLabelsInput, targetContainer);
            });
        }


        const deleteConnectionBtn = document.getElementById('deleteConnectionBtn');
        if (deleteConnectionBtn) {
            deleteConnectionBtn.addEventListener('click', () => {
                this.deleteCurrentConnection();
            });
        }

        const deleteMarkerBtn = document.getElementById('deleteMarkerBtn');
        if (deleteMarkerBtn) {
            deleteMarkerBtn.addEventListener('click', () => {
                this.deleteCurrentMarker();
            });
        }

        // 添加时间点按钮事件
        const addDateTimeBtn = document.getElementById('addDateTimeBtn');
        if (addDateTimeBtn) {
            addDateTimeBtn.addEventListener('click', () => {
                this.addMarkerDateTime();
            });
        }

        // 点击模态框外部关闭
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModals();
            }
        });

        // 地图控制按钮事件 - 调整视窗按钮
        const fitViewBtn = document.getElementById('fitViewBtn');
        if (fitViewBtn) {
            fitViewBtn.addEventListener('click', () => {
                const picker = document.getElementById('dateRangePicker');
                if (picker && picker.style.display === 'flex') {
                    return; // 如果选择器可见，则不执行默认聚焦，防止冲突
                }
                this.handleFitViewClick();
            });

            // 添加悬浮事件
            fitViewBtn.addEventListener('mouseover', () => {
                clearTimeout(this.hoverTimeout); // 清除可能存在的计时器
                    this.hoverTimeout = setTimeout(() => {
                        const picker = document.getElementById('dateRangePicker');
                        // 如果已经打开则不执行任何操作
                        if (picker.style.display === 'flex') return;

                        const startDateInput = document.getElementById('startDate');
                        const endDateInput = document.getElementById('endDate');

                        if (this.lastDateRange && this.lastDateRange.start && this.lastDateRange.end) {
                            // 如果有保存的日期范围，则使用它
                            startDateInput.value = this.lastDateRange.start;
                            endDateInput.value = this.lastDateRange.end;
                        } else {
                            // 默认逻辑：从所有点的最早日期到所有点的最晚日期；如果没有点则回退为最近一个月
                            let earliest = null;
                            let latest = null;
                            const updateRange = (dt) => {
                                if (!dt) return;
                                const d = new Date(dt);
                                if (isNaN(d.getTime())) return;
                                if (!earliest || d < earliest) earliest = d;
                                if (!latest || d > latest) latest = d;
                            };

                            // 遍历标记点的时间
                            this.markers.forEach(m => {
                                if (Array.isArray(m.dateTimes) && m.dateTimes.length > 0) {
                                    m.dateTimes.forEach(updateRange);
                                } else {
                                    updateRange(m.dateTime);
                                }
                            });

                            // 遍历连接线的时间
                            this.connections.forEach(c => updateRange(c.dateTime));

                            if (earliest && latest) {
                                const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                if (startDateInput) startDateInput.value = toDateStr(earliest);
                                if (endDateInput) endDateInput.value = toDateStr(latest);
                            } else {
                                // 没有任何点：回退为最近一个月
                                const endDate = new Date();
                                const startDate = new Date();
                                startDate.setMonth(startDate.getMonth() - 1);

                                if (startDateInput && typeof startDateInput.valueAsDate !== 'undefined') {
                                    startDateInput.valueAsDate = startDate;
                                } else if (startDateInput) {
                                    startDateInput.value = startDate.toISOString().split('T')[0];
                                }

                                if (endDateInput && typeof endDateInput.valueAsDate !== 'undefined') {
                                    endDateInput.valueAsDate = endDate;
                                } else if (endDateInput) {
                                    endDateInput.value = endDate.toISOString().split('T')[0];
                                }
                            }
                        }

                        picker.style.display = 'flex';
                    }, 1000); // 1秒后显示
            });

            fitViewBtn.addEventListener('mouseout', () => {
                clearTimeout(this.hoverTimeout);
            });
        }

        // 添加键盘事件监听器
        document.addEventListener('keydown', (e) => {
            // 添加一个保护，以防 e.key 未定义（可能由某些浏览器扩展或代理脚本引起）
            if (!e || !e.key) {
                return;
            }

            // 检查是否按下Ctrl+Z（或Cmd+Z）且没有在输入框中输入
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' &&
                !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault(); // 阻止浏览器默认的撤销操作
                this.undo(); // 执行撤销
            }
            // 检查是否按下A键添加标记点
            else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'a' &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.setMode('addMarker'); // 进入添加标记点模式
            }
            // 检查是否按下C键连接标记点
            else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'c' &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.showConnectModal(); // 打开连接标记点界面
            }
            // 检查是否按下H键或?键显示帮助
            else if (!e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === 'h' || e.key === '?') &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.showHelpModal(); // 显示帮助弹窗
            }
            // 检查是否按下D键、Backspace键或Delete键删除选中的标记点或连接线
            else if (!e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === 'd' || e.key === 'Backspace' || e.key === 'Delete') &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.deleteCurrentElement(); // 删除当前选中的元素
            }
            // 检查是否按下F键自动调整视窗
            else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f' &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                this.handleFitViewClick(); // 执行视窗调整（与右上角按钮相同的功能）
            }
            // 检查是否按下/键聚焦到搜索框
            else if (!e.ctrlKey && !e.metaKey && e.key === '/' &&
                     !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                const searchInput = document.getElementById('searchInput');
                if (searchInput && !searchInput.disabled) {
                    // 如果搜索框已有内容，则清空
                    if (searchInput.value.trim() !== '') {
                        searchInput.value = '';
                    }
                    searchInput.focus();

                    // 隐藏搜索结果下拉框
                    const searchResults = document.getElementById('searchResults');
                    if (searchResults) {
                        searchResults.style.display = 'none';
                    }
                }
            }
            // 检查是否按下ESC键退出添加标记点状态
            else if (e.key === 'Escape' && this.currentMode === 'addMarker') {
                e.preventDefault();
                this.setMode('view'); // 退出添加标记点状态，返回查看模式
                console.log('ESC键 pressed - 退出添加标记点状态');
            }
        });

        // 绑定帮助按钮事件
        const helpBtn = document.getElementById('helpBtn');
        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                this.showHelpModal();
            });
        }

        // 绑定帮助模态框关闭事件
        const closeHelp = document.getElementById('closeHelp');
        if (closeHelp) {
            closeHelp.addEventListener('click', () => {
                this.closeHelpModal();
            });
        }

        // 日期详情面板事件
        const closeDateDetailBtn = document.getElementById('closeDateDetailBtn');
        if (closeDateDetailBtn) {
            closeDateDetailBtn.addEventListener('click', () => {
                this.closeDateDetail();
            });
        }

        // saveDateNotesBtn listener removed for real-time save

        // 日期备注便签关闭按钮事件
        const closeDateNotesSticky = document.getElementById('closeDateNotesSticky');
        if (closeDateNotesSticky) {
            closeDateNotesSticky.addEventListener('click', () => {
                this.hideDateNotesSticky();
            });
        }

        // 为dateNotesInput添加粘贴事件监听器
        const dateNotesInput = document.getElementById('dateNotesInput');
        if (dateNotesInput) {
            dateNotesInput.addEventListener('paste', (e) => this.handleDateNotesPaste(e));
        }


        // 日期范围选择器应用按钮
        const applyDateRangeFilterBtn = document.getElementById('applyDateRangeFilter');
        if (applyDateRangeFilterBtn) {
            applyDateRangeFilterBtn.addEventListener('click', () => {
                const startDate = document.getElementById('startDate').value;
                const endDate = document.getElementById('endDate').value;
                if (startDate && endDate) {
                    this.fitViewByDateRange(startDate, endDate);
                    document.getElementById('dateRangePicker').style.display = 'none';
                } else {
                    this.showSwalAlert('提示', '请选择起始和结束日期。', 'warning');
                }
            });
        }

        // 点击页面其他地方隐藏日期选择器
        document.addEventListener('click', (e) => {
            const picker = document.getElementById('dateRangePicker');
            const fitBtn = document.getElementById('fitViewBtn');
            if (picker && picker.style.display === 'flex' && !picker.contains(e.target) && !fitBtn.contains(e.target)) {
                picker.style.display = 'none';
            }
        });

        // 点击模态框外部关闭
        window.addEventListener('click', (e) => {
            const helpModal = document.getElementById('helpModal');
            if (e.target === helpModal) {
                this.closeHelpModal();
            }
        });

        // 主题切换按钮事件
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        if (themeToggleBtn) {
            themeToggleBtn.addEventListener('click', () => {
                this.toggleTheme();
            });
        }

        // 扩大按钮事件
        const expandMarkerLabelsBtn = document.getElementById('expandMarkerLabelsBtn');
        if (expandMarkerLabelsBtn) {
            expandMarkerLabelsBtn.addEventListener('click', () => {
                this.openExpandModal('marker', '标记点备注');
            });
        }

        const expandConnectionLabelsBtn = document.getElementById('expandConnectionLabelsBtn');
        if (expandConnectionLabelsBtn) {
            expandConnectionLabelsBtn.addEventListener('click', () => {
                this.openExpandModal('connection', '连接线备注');
            });
        }

        const expandDateNotesBtn = document.getElementById('expandDateNotesBtn');
        if (expandDateNotesBtn) {
            expandDateNotesBtn.addEventListener('click', () => {
                this.openExpandModal('date', '日期备注');
            });
        }

        // 绑定添加消费按钮事件
        const addExpenseBtn = document.getElementById('addExpenseBtn');
        if (addExpenseBtn) {
            addExpenseBtn.addEventListener('click', () => {
                this.addCurrentDateExpense();
            });
        }

        // 绑定消费输入框回车事件
        const expenseCostInput = document.getElementById('expenseCostInput');
        const expenseRemarkInput = document.getElementById('expenseRemarkInput');

        const handleExpenseEnter = (e) => {
            if (e.key === 'Enter') {
                this.addCurrentDateExpense();
            }
        };

        if (expenseCostInput) {
            expenseCostInput.addEventListener('keydown', handleExpenseEnter);
        }
        if (expenseRemarkInput) {
            expenseRemarkInput.addEventListener('keydown', handleExpenseEnter);
        }
    }

    // 移动端功能初始化
    initMobileFeatures() {
        // 检测是否为移动设备
        if (!this.isMobileDevice()) {
            return; // 非移动设备不执行移动端适配
        }

        // 修改标题为只读模式
        const titleElement = document.querySelector('header h1');
        if (titleElement) {
            titleElement.textContent = `${titleElement.textContent} (只读模式)`;
        }

        // 显示进入提示
        this.showSwalAlert('只读模式', '当前为移动端只读模式，如需编辑请使用电脑访问。', 'info');

        // 初始化移动端菜单功能
        this.initMobileMenu();

        // 监听窗口大小变化，适配横竖屏切换
        window.addEventListener('resize', () => {
            this.handleResize();
        });
    }

    // 初始化移动端菜单
    initMobileMenu() {
        const menuToggleBtn = document.getElementById('menuToggleBtn');
        const rightPanel = document.querySelector('.right-panel');
        const closeSidebarBtn = document.getElementById('closeSidebarBtn');

        if (!menuToggleBtn || !rightPanel) {
            console.warn('移动端菜单元素未找到');
            return;
        }

        // 菜单切换按钮事件
        menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // 如果侧边栏是展开的，就关闭它
            if (rightPanel.classList.contains('active')) {
                rightPanel.classList.remove('active');
                menuToggleBtn.textContent = '☰';
                console.log('菜单关闭');
            } else {
                // 如果侧边栏是关闭的，就展开它
                rightPanel.classList.add('active');
                menuToggleBtn.textContent = '✕';
                console.log('菜单展开');
            }
        });

        // 关闭侧边栏按钮事件
        if (closeSidebarBtn) {
            closeSidebarBtn.addEventListener('click', () => {
                rightPanel.classList.remove('active');
                menuToggleBtn.textContent = '☰';
            });
        }

        // 移动端点击外部关闭侧边栏（简化版本）
        if (this.isMobileDevice()) {
            // 点击地图区域时关闭侧边栏（但点击标记点和连接线时除外）
            const mapContainer = document.getElementById('mapContainer');
            if (mapContainer) {
                mapContainer.addEventListener('click', (e) => {
                    // 如果点击的是地图空白区域（不是标记点、连接线等），且不是侧边栏和菜单按钮
                    if (rightPanel.classList.contains('active') &&
                        !rightPanel.contains(e.target) &&
                        !menuToggleBtn.contains(e.target) &&
                        !e.target.closest('.leaflet-marker-icon') && // 不是标记点
                        !e.target.closest('.leaflet-interactive')) { // 不是连接线等交互元素
                        rightPanel.classList.remove('active');
                        menuToggleBtn.textContent = '☰';
                    }
                });
            }
        }
    }

    // 处理窗口大小变化
    handleResize() {
        const menuToggleBtn = document.getElementById('menuToggleBtn');
        const rightPanel = document.querySelector('.right-panel');

        if (!menuToggleBtn || !rightPanel) {
            return;
        }

        if (window.innerWidth > 768) {
            // 大屏幕设备
            rightPanel.classList.remove('active');
            menuToggleBtn.textContent = '☰';
        }
    }

    switchMapSource(newSource) {
        if (!this.mapLayers[newSource]) {
            console.error('不支持的地图源:', newSource);
            return;
        }

        // 移除当前图层
        this.map.removeLayer(this.mapLayers[this.currentLayer]);

        // 切换到新图层
        this.currentLayer = newSource;
        this.mapLayers[this.currentLayer].addTo(this.map);

        // 更新搜索框状态
        this.updateSearchInputState();

        console.log('地图源已切换到:', newSource);
    }

    updateSearchInputState() {
        const searchInput = document.getElementById('searchInput');
        const currentMapConfig = this.mapSearchConfig[this.currentLayer];

        if (searchInput && currentMapConfig) {
            if (currentMapConfig.searchable) {
                // 启用搜索框
                searchInput.disabled = false;
                searchInput.placeholder = '搜索地点...';
                searchInput.style.opacity = '1';
            } else {
                // 禁用搜索框
                searchInput.disabled = true;
                searchInput.placeholder = `当前地图(${currentMapConfig.name})不支持搜索`;
                searchInput.style.opacity = '0.6';

                // 隐藏搜索结果
                const searchResults = document.getElementById('searchResults');
                if (searchResults) {
                    searchResults.style.display = 'none';
                }
            }
        }
    }

    getIconForName(name) {
        const lowerCaseName = name.toLowerCase();
        // 交通类
        if (['机场', 'airport', '站', 'station', 'bus', '地铁', 'subway', 'train', 'bus', '车站'].some(kw => lowerCaseName.includes(kw))) {
            return { type: 'emoji', icon: '🚉', color: '#607D8B' };
        }
        // 住宿类
        if (['酒店', 'hotel', '民宿', 'hostel'].some(kw => lowerCaseName.includes(kw))) {
            return { type: 'emoji', icon: '🏨', color: '#2196F3' };
        }
        // 餐饮类
        if (['餐厅', 'restaurant', '饭', 'eat', 'food', '美食'].some(kw => lowerCaseName.includes(kw))) {
            return { type: 'emoji', icon: '🍽️', color: '#4CAF50' };
        }
        // 景点类
        if (['景点', 'park', '山', '海', 'lake', 'view', 'garden', '公园', 'museum', '博物馆'].some(kw => lowerCaseName.includes(kw))) {
            return { type: 'emoji', icon: '🏞️', color: '#FF9800' };
        }
        // 购物类
        if (['购物', 'shopping', 'mall', 'store', 'market'].some(kw => lowerCaseName.includes(kw))) {
            return { type: 'emoji', icon: '🛍️', color: '#9C27B0' };
        }
        // 默认返回数字图标配置
        return {
            type: 'number',
            icon: String(this.markers.length + 1),
            color: '#667eea'
        };
    }

    setMode(mode) {
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
    }

    // 创建标记点实体并绑定事件（公共逻辑）
    createMarkerEntity(lat, lng, title = null, id = null, customIconConfig = null, dateTime = null) {
        const markerId = id || Date.now();
        const markerTitle = title || `标记点${this.markers.length + 1}`;
        const iconConfig = customIconConfig || this.getIconForName(markerTitle);
        const icon = this.createMarkerIcon(iconConfig, this.markers.length + 1);

        const marker = L.marker([lat, lng], {
            icon: icon,
            draggable: !this.isMobileDevice(),
            title: markerTitle
        }).addTo(this.map);

        let newMarkerDateTimes = [];
        let newMarkerDateTime = null;

        // Handle dateTime input (can be string, array, or null)
        if (Array.isArray(dateTime) && dateTime.length > 0) {
            newMarkerDateTimes = [...dateTime]; // Copy array
            newMarkerDateTime = dateTime[0];
        } else if (typeof dateTime === 'string') {
            newMarkerDateTimes = [dateTime];
            newMarkerDateTime = dateTime;
        }

        // If no valid time provided, generate default
        if (!newMarkerDateTime) {
            // 确定新标记点的时间 - 如果有上一个点则使用其时间，否则为当天00:00
            newMarkerDateTime = this.getCurrentLocalDateTime();
            if (this.markers.length > 0) {
                // 使用最后一个标记点的时间
                const lastMarker = this.markers[this.markers.length - 1];
                if (lastMarker.dateTimes && lastMarker.dateTimes.length > 0) {
                    newMarkerDateTime = lastMarker.dateTimes[0]; // 使用上一个点的第一个时间
                } else if (lastMarker.dateTime) {
                    newMarkerDateTime = lastMarker.dateTime;
                } else {
                    // 如果上一个点也没有时间，则使用当天00:00
                    const lastDateTime = new Date();
                    newMarkerDateTime = `${lastDateTime.getFullYear()}-${String(lastDateTime.getMonth() + 1).padStart(2, '0')}-${String(lastDateTime.getDate()).padStart(2, '0')} 00:00:00`;
                }
            } else {
                // 如果没有上一个点，使用当天00:00
                const today = new Date();
                newMarkerDateTime = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} 00:00:00`;
            }
            // Sync array with default
            newMarkerDateTimes = [newMarkerDateTime];
        } else if (newMarkerDateTimes.length === 0) {
             // If input was empty array, sync with the (potentially fallback) single time
             newMarkerDateTimes = [newMarkerDateTime];
        }

        const markerData = {
            id: markerId, // 不可见不可编辑的唯一ID
            marker: marker,
            position: [lat, lng],
            title: markerTitle,
            labels: [], // 存储标注文本，不直接显示
            logo: null, // 添加logo属性，默认为空
            icon: iconConfig, // 保存图标信息
            createdAt: this.getCurrentLocalDateTime(),
            dateTimes: newMarkerDateTimes, // 改为数组，支持多个时间点
            dateTime: newMarkerDateTime // 使用第一个时间点作为默认时间
        };

        // 添加点击事件显示详情
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (this.isMobileDevice()) {
                const popupContent = this.generateMarkerPopupContent(markerData);
                marker.bindPopup(popupContent).openPopup();
            } else {
                this.showMarkerDetail(markerData);
            }
        });

        // 添加悬浮事件显示标注信息
        marker.on('mouseover', (e) => {
            if (e.target.getElement()) {
                e.target.getElement()._savedTitle = e.target.getElement().getAttribute('title');
                e.target.getElement().removeAttribute('title');
            }
            this.showMarkerTooltip(markerData, e.latlng, e);
        });

        marker.on('mouseout', (e) => {
            if (e.target.getElement() && e.target.getElement()._savedTitle) {
                e.target.getElement().setAttribute('title', e.target.getElement()._savedTitle);
            }
            this.hideMarkerTooltip();
        });

        // 添加拖拽事件更新位置
        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            const oldPosition = [...markerData.position]; // 保存之前的位置

            markerData.position = [newPos.lat, newPos.lng]; // position[0] = lat, position[1] = lng

            console.log(`拖拽事件触发 - 标记点ID: ${markerData.id}, 新坐标: [${newPos.lat}, ${newPos.lng}]`);

            // 记录移动操作到历史栈
            this.addHistory('moveMarker', {
                id: markerData.id,
                prevPosition: oldPosition,
                newPosition: [newPos.lat, newPos.lng]
            });

            // 更新连接线
            this.updateConnections();

            // 更新标注位置
            this.updateLabels();

            // 如果当前标记点正在详情面板中显示，更新坐标显示
            if (this.currentMarker === markerData) {
                const markerCoords = document.getElementById('markerCoords');
                if (markerCoords) {
                    // 正确的坐标显示格式：经度, 纬度
                    markerCoords.textContent =
                        `${newPos.lng.toFixed(6)}, ${newPos.lat.toFixed(6)}`;
                }
            }

            // 更新标记点列表中的坐标显示
            this.updateMarkerList();

            console.log(`标记点"${markerData.title}"坐标已更新: ${newPos.lat.toFixed(6)}, ${newPos.lng.toFixed(6)}`);

            // 保存到本地存储
            this.saveToLocalStorage();
            console.log(`拖拽后本地存储已保存`);
        });

        return markerData;
    }

    addMarker(latlng) {
        // 从搜索框获取名称,如果为空则使用默认名称
        const searchInput = document.getElementById('searchInput');
        const markerTitle = searchInput.value.trim() ? searchInput.value.trim() : null;

        const markerData = this.createMarkerEntity(latlng.lat, latlng.lng, markerTitle);

        this.markers.push(markerData);
        this.updateMarkerList();
        this.setMode('view');

        // 记录添加操作到历史栈
        this.addHistory('addMarker', {
            id: markerData.id,
            position: markerData.position,
            title: markerData.title,
            icon: markerData.icon,
            createdAt: markerData.createdAt,
            dateTimes: markerData.dateTimes,
            dateTime: markerData.dateTime
        });

        // 保存到本地存储
        this.saveToLocalStorage();

        // 自动显示新添加标记点的详情面板
        this.showMarkerDetail(markerData);
    }

    // AI Helper: Add marker without UI interaction
    aiAddMarker(title, lat, lng, id = null, dateTime = null) {
        console.log(`aiAddMarker called: title="${title}", lat=${lat} (${typeof lat}), lng=${lng} (${typeof lng}), id=${id}`);

        // Convert to number if they are strings, handle potential whitespace
        let parsedLat = lat;
        let parsedLng = lng;

        if (typeof lat === 'string') {
            parsedLat = parseFloat(lat.trim());
        }
        if (typeof lng === 'string') {
            parsedLng = parseFloat(lng.trim());
        }

        if (isNaN(parsedLat) || isNaN(parsedLng)) {
            console.error('Invalid coordinates for aiAddMarker:', lat, lng);
            return null;
        }

        // Use provided ID or generate one
        let markerId = id;
        if (!markerId || this.markers.find(m => m.id === markerId)) {
            // If ID is missing or conflicts, generate a new one
            if (id) console.warn(`AI provided ID ${id} conflicts or is invalid, generating new ID`);
            markerId = Date.now() + Math.floor(Math.random() * 10000);
        }

        // Use createMarkerEntity to create the marker and bind events
        const markerData = this.createMarkerEntity(parsedLat, parsedLng, title, markerId, null, dateTime);

        this.markers.push(markerData);
        this.updateMarkerList();

        // Add to history
        this.addHistory('addMarker', {
            id: markerData.id,
            position: markerData.position,
            title: markerData.title,
            icon: markerData.icon,
            createdAt: markerData.createdAt,
            dateTimes: markerData.dateTimes,
            dateTime: markerData.dateTime
        });

        this.saveToLocalStorage();
        return markerData;
    }

    // AI Helper: Connect markers by ID
    // 确保标记点包含指定的时间点（或时间数组）
    ensureMarkerDateTime(marker, dateTime) {
        if (!marker || !dateTime) return false;

        let changed = false;

        // 规范化输入为数组
        const newTimes = Array.isArray(dateTime) ? dateTime : [dateTime];
        if (newTimes.length === 0) return false;

        // 初始化 dateTimes 数组
        if (!marker.dateTimes) {
            marker.dateTimes = [];
            // 如果存在旧的单个时间点，先迁移过来
            if (marker.dateTime) {
                marker.dateTimes.push(marker.dateTime);
            }
            changed = true;
        }

        // 添加新时间点（去重且同一天只能有一个时间点）
        newTimes.forEach(time => {
            if (!time) return;

            // 检查该时间点是否已存在（完全相同）
            if (marker.dateTimes.includes(time)) return;

            // 检查该日期是否已存在时间点
            const dateKey = this.getDateKey(time);
            const hasDate = marker.dateTimes.some(existingTime => this.getDateKey(existingTime) === dateKey);

            // 只有当该日期没有时间点时才添加（保留最早添加的那个，或者手动操作时保留旧的）
            // 这里的逻辑是：如果日期已存在，则忽略新时间点，这符合手动操作的习惯（修改连接线时间不应覆盖该点已有的时间规划，除非用户明确去修改点的时间）
            // 同时对 AI 也是一种保护，防止在同一天生成冲突的时间点
            if (!hasDate) {
                marker.dateTimes.push(time);
                changed = true;
            } else {
                console.log(`跳过添加时间点 ${time}，因为该日期 (${dateKey}) 已存在时间安排`);
            }
        });

        if (changed) {
            // 排序时间点
            marker.dateTimes.sort();

            // 如果 legacy dateTime 字段为空，或者它是 dateTimes 中的一个，更新它为第一个时间点
            // 这里我们保持 dateTime 字段与 dateTimes[0] 同步，或者是保持原样？
            // 通常最好保持 dateTime 字段有值，以兼容旧代码
            if (!marker.dateTime || marker.dateTimes.length > 0) {
                marker.dateTime = marker.dateTimes[0];
            }
        }

        return changed;
    }

    aiConnectMarkers(startId, endId, transportType = 'car', dateTime = null) {
        // 禁止自己连接自己
        if (startId === endId) {
            console.error('Invalid marker IDs for aiConnectMarkers: Start ID and End ID are the same.', startId);
            return false;
        }

        const startMarker = this.markers.find(m => m.id === startId);
        const endMarker = this.markers.find(m => m.id === endId);

        if (!startMarker || !endMarker) {
            console.error('Invalid marker IDs for aiConnectMarkers:', startId, endId, 'Start:', startMarker, 'End:', endMarker);
            return false;
        }

        this.createConnection(startMarker, endMarker, transportType, dateTime);

        // 如果提供了时间，自动添加到起始点和终点的 dateTimes 数组中
        if (dateTime) {
             let changed = false;

             if (this.ensureMarkerDateTime(startMarker, dateTime)) {
                 changed = true;
             }
             if (this.ensureMarkerDateTime(endMarker, dateTime)) {
                 changed = true;
             }

             if (changed) {
                 // 触发更新
                 this.updateMarkerList();
                 this.saveToLocalStorage();
             }
        }

        return true;
    }

    // AI Helper: Remove marker by ID
    aiRemoveMarker(id) {
        const marker = this.markers.find(m => m.id === id);
        if (!marker) {
            console.error('Invalid marker ID for aiRemoveMarker:', id);
            return false;
        }
        this.removeMarker(marker);
        return true;
    }

    // AI Helper: Update marker by ID
    aiUpdateMarker(id, title, lat, lng, dateTime = null) {
        const marker = this.markers.find(m => m.id === id);
        if (!marker) {
            console.error('Invalid marker ID for aiUpdateMarker:', id);
            return false;
        }

        let updated = false;

        if (title) {
            marker.title = title;
            // Also update marker tooltip/popup if necessary, currently title is mostly used for list and export
            // Re-creating icon might be needed if title affects icon (e.g. "Hotel" vs "Park")
            const newIconConfig = this.getIconForName(title);
            // Only update icon if type changed or it's default
            if (marker.icon.type === 'default' || newIconConfig.type !== marker.icon.type) {
                 marker.icon = newIconConfig;
                 const newIcon = this.createMarkerIcon(newIconConfig, this.markers.indexOf(marker) + 1);
                 marker.marker.setIcon(newIcon);
            }
            updated = true;
        }

        if (dateTime) {
            marker.dateTime = dateTime;
            marker.dateTimes = [dateTime];
            updated = true;
        }

        // Convert to number if they are strings, handle potential whitespace
        let parsedLat = lat;
        let parsedLng = lng;

        if (typeof lat === 'string') {
            parsedLat = parseFloat(lat.trim());
        }
        if (typeof lng === 'string') {
            parsedLng = parseFloat(lng.trim());
        }

        if (!isNaN(parsedLat) && !isNaN(parsedLng) && typeof parsedLat === 'number' && typeof parsedLng === 'number') {
             marker.position = [parsedLat, parsedLng];
             marker.marker.setLatLng([parsedLat, parsedLng]);

             // Record history? (Maybe skip for AI bulk ops to avoid clutter, or keep for undo)
             // For now, let's keep it simple and just update

             updated = true;
        }

        if (updated) {
            this.updateConnections(); // Update lines connected to this marker
            this.updateLabels();      // Update labels attached to this marker
            this.updateMarkerList();  // Refresh list
            this.saveToLocalStorage();
            return true;
        }
        return false;
    }

    // AI Helper: Remove connection by ID
    aiRemoveConnection(id) {
        const connection = this.connections.find(c => c.id === id);
        if (!connection) {
            console.error('Invalid connection ID for aiRemoveConnection:', id);
            return false;
        }
        this.removeConnection(connection);
        return true;
    }

    // AI Helper: Update connection by ID
    aiUpdateConnection(id, transportType, dateTime = null) {
        const connection = this.connections.find(c => c.id === id);
        if (!connection) {
            console.error('Invalid connection ID for aiUpdateConnection:', id);
            return false;
        }

        let updated = false;

        if (transportType && connection.transportType !== transportType) {
            connection.transportType = transportType;

            // Re-draw connection with new style
            // updateConnections() re-sets latlngs and arrow heads, but might not change color/style if polyline object is reused without style update
            // createConnection sets color on creation.
            // Let's update style manually here
            const newColor = this.getTransportColor(transportType);
            connection.polyline.setStyle({ color: newColor });

            if (connection.endCircle) {
                connection.endCircle.setStyle({ fillColor: newColor });
            }

            // Icon marker update
            if (connection.iconMarker) {
                const transportIcon = this.getTransportIcon(transportType);
                const iconHtml = `<div style="background-color: white; border: 2px solid ${newColor}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${transportIcon}</div>`;
                const newIcon = L.divIcon({
                    className: 'transport-icon',
                    html: iconHtml,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });
                connection.iconMarker.setIcon(newIcon);
            }

            updated = true;
        }

        if (dateTime) {
            connection.dateTime = dateTime;
            updated = true;
        }

        if (updated) {
            // Arrow head update is handled in updateConnections called below (it recreates arrow)
            this.updateConnections();
            this.saveToLocalStorage();
            return true;
        }
        return false;
    }

    showIconModal() {
        document.getElementById('iconModal').style.display = 'block';
        // 重置选择状态
        document.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
        document.getElementById('customIcon').value = '';
        document.getElementById('iconColor').value = '#667eea';
    }

    updateCurrentIconPreview(iconConfig) {
        const preview = document.getElementById('currentIconPreview');
        if (preview && iconConfig) {
            preview.textContent = iconConfig.icon || '📍';
            preview.style.backgroundColor = iconConfig.color || '#667eea';
        }
    }

    confirmIconSelection() {
        const selectedOption = document.querySelector('.icon-option.selected');
        const customIcon = document.getElementById('customIcon').value.trim();
        const iconColor = document.getElementById('iconColor').value;

        let newIconConfig;

        if (customIcon) {
            // 使用自定义图标
            newIconConfig = {
                type: 'custom',
                icon: customIcon,
                color: iconColor
            };
        } else if (selectedOption) {
            // 使用预设图标
            const iconType = selectedOption.dataset.icon;
            const iconPreview = selectedOption.querySelector('.icon-preview');
            const icon = iconPreview.textContent;
            const color = iconPreview.style.backgroundColor;

            newIconConfig = {
                type: iconType,
                icon: icon,
                color: color
            };
        } else {
            // 如果没有选择，保持当前图标
            this.closeModals();
            return;
        }

        // 如果有当前标记点，更新其图标
        if (this.currentMarker) {
            this.currentMarker.icon = newIconConfig;

            // 重新创建标记点图标
            const newIcon = this.createMarkerIcon(newIconConfig, this.markers.indexOf(this.currentMarker) + 1);
            this.currentMarker.marker.setIcon(newIcon);

            // 更新预览
            this.updateCurrentIconPreview(newIconConfig);

            console.log(`标记点"${this.currentMarker.title}"图标已更新:`, newIconConfig);
        } else {
            // 如果没有当前标记点，设置为默认图标（用于新标记点）
            this.currentIcon = newIconConfig;
            console.log('默认图标已设置:', newIconConfig);
        }

        this.closeModals();
    }

    showConnectModal() {
        if (this.markers.length < 2) {
            this.showSwalAlert('提示', '需要至少2个标记点才能连接！', 'warning');
            return;
        }

        const startSelect = document.getElementById('startMarker');
        const endSelect = document.getElementById('endMarker');

        startSelect.innerHTML = '';
        endSelect.innerHTML = '';

        this.markers.forEach((marker, index) => {
            const option1 = new Option(marker.title, index);
            const option2 = new Option(marker.title, index);
            startSelect.add(option1);
            endSelect.add(option2);
        });

        // 默认选中最近创建的两个标记点
        if (this.markers.length >= 2) {
            // 按照创建时间排序，最新的两个点
            const sortedIndices = Array.from({length: this.markers.length}, (_, i) => i)
                .sort((a, b) => {
                    // 使用id作为时间戳的近似值，id越大表示越新创建
                    return this.markers[b].id - this.markers[a].id;
                });

            // 设置最近创建的两个点
            const newestIndex = sortedIndices[0];
            const secondNewestIndex = sortedIndices[1];

            startSelect.selectedIndex = secondNewestIndex; // 倒数第二个创建的作为起点
            endSelect.selectedIndex = newestIndex; // 最新创建的作为终点

            console.log(`默认选中最近创建的两个点: 起点[${secondNewestIndex}]${this.markers[secondNewestIndex].title} -> 终点[${newestIndex}]${this.markers[newestIndex].title}`);
        }

        document.getElementById('connectModal').style.display = 'block';

        // 初始化时更新推荐的交通方式
        this.updateRecommendedTransportInModal();
    }

    getRecommendedTransport(distance) {
        if (distance < 5000) { // 5km
            return 'walk';
        } else if (distance < 400000) { // 400km
            return 'car';
        } else if (distance < 1500000) { // 1500km
            return 'train';
        } else {
            return 'plane';
        }
    }

    estimateDuration(distance, transportType) {
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
    }

    createConnection(startMarker, endMarker, _transportType, dateTime = null) { // transportType is now ignored, but kept for compatibility
        if (!startMarker || !endMarker) {
            console.error('创建连接失败：起始点或终点无效。');
            return;
        }

        // 禁止自己连接自己
        if (startMarker.id === endMarker.id) {
            console.error('创建连接失败：起始点和终点不能相同。');
            return;
        }

        const distance = startMarker.marker.getLatLng().distanceTo(endMarker.marker.getLatLng()); // in meters
        const recommendedTransport = this.getRecommendedTransport(distance);
        const estimatedDuration = this.estimateDuration(distance, recommendedTransport);

        console.log(`创建连接线: ${startMarker.title} -> ${endMarker.title}, 距离: ${(distance / 1000).toFixed(2)} km, 推荐交通: ${recommendedTransport}, 预估时间: ${estimatedDuration} 小时`);

        // 创建连接线
        const polyline = L.polyline([
            [startMarker.position[0], startMarker.position[1]],
            [endMarker.position[0], endMarker.position[1]]
        ], {
            color: this.getTransportColor(recommendedTransport),
            weight: 6,
            opacity: 1.0,
            smoothFactor: 1.0
        }).addTo(this.map);

        // 创建箭头
        const arrowHead = this.createArrowHead(startMarker.position, endMarker.position, recommendedTransport);
        arrowHead.addTo(this.map);

        // 添加终点标记（小圆点）
        const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
            radius: 6,
            fillColor: this.getTransportColor(recommendedTransport),
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(this.map);

        // 计算中点位置并添加交通图标
        const startLat = parseFloat(startMarker.position[0]);
        const startLng = parseFloat(startMarker.position[1]);
        const endLat = parseFloat(endMarker.position[0]);
        const endLng = parseFloat(endMarker.position[1]);

        if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
            console.error('连接线坐标无效:', startMarker.position, endMarker.position);
            this.showSwalAlert('错误', '坐标数据错误，请重新选择标记点！', 'error');
            return;
        }

        const fallbackMidLat = (startLat + endLat) / 2;
        const fallbackMidLng = (startLng + endLng) / 2;
        const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
        const transportIcon = this.getTransportIcon(recommendedTransport);
        const iconMarker = L.marker(midPos, {
            icon: L.divIcon({
                className: 'transport-icon',
                html: `<div style="background-color: white; border: 2px solid ${this.getTransportColor(recommendedTransport)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${transportIcon}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(this.map);

        let connectionDateTime = dateTime;
        if (!connectionDateTime) {
            // 使用起始点的时间作为连接线的默认时间
            connectionDateTime = this.getCurrentLocalDateTime();
            if (startMarker.dateTimes && startMarker.dateTimes.length > 0) {
                connectionDateTime = startMarker.dateTimes[0];
            } else if (startMarker.dateTime) {
                connectionDateTime = startMarker.dateTime;
            }
        }

        const connection = {
            id: Date.now(),
            startId: startMarker.id,
            endId: endMarker.id,
            transportType: recommendedTransport,
            polyline: polyline,
            endCircle: endCircle,
            iconMarker: iconMarker,
            arrowHead: arrowHead,
            dateTime: connectionDateTime,
            label: '',
            logo: null,
            duration: estimatedDuration,
            startTitle: startMarker.title,
            endTitle: endMarker.title
        };

        const self = this;
        polyline.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            if (self.isMobileDevice()) {
                const startMarker = self.markers.find(m => m.id === connection.startId);
                const endMarker = self.markers.find(m => m.id === connection.endId);
                const popupContent = self.generateConnectionPopupContent(connection, startMarker, endMarker);
                polyline.bindPopup(popupContent).openPopup();
            } else {
                self.showConnectionDetail(connection);
            }
        });
        polyline.on('mouseover', function(e) {
            self.showConnectionTooltip(connection, e.latlng, e);
        });
        polyline.on('mouseout', function() {
            self.hideConnectionTooltip();
        });

        // 绑定图标点击事件
        iconMarker.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            if (self.isMobileDevice()) {
                const startMarker = self.markers.find(m => m.id === connection.startId);
                const endMarker = self.markers.find(m => m.id === connection.endId);
                const popupContent = self.generateConnectionPopupContent(connection, startMarker, endMarker);
                polyline.bindPopup(popupContent).openPopup();
            } else {
                self.showConnectionDetail(connection);
            }
        });
        iconMarker.on('mouseover', function(e) {
            self.showConnectionTooltip(connection, e.latlng, e);
        });
        iconMarker.on('mouseout', function() {
            self.hideConnectionTooltip();
        });

        this.connections.push(connection);

        this.addHistory('addConnection', {
            id: connection.id,
            startId: connection.startId,
            endId: connection.endId,
            transportType: connection.transportType,
            dateTime: connection.dateTime,
            label: connection.label,
            duration: connection.duration,
            startTitle: connection.startTitle,
            endTitle: connection.endTitle
        });

        this.saveToLocalStorage();
        this.showConnectionDetail(connection);
        console.log('连接线创建成功，连接数:', this.connections.length);
    }

    connectMarkers() {
        const startSelect = document.getElementById('startMarker');
        const endSelect = document.getElementById('endMarker');
        const transportSelect = document.getElementById('transportType');

        if (!startSelect || !endSelect || !transportSelect) {
            console.error('连接模态框元素不存在');
            return;
        }

        const startIndex = startSelect.value;
        const endIndex = endSelect.value;
        const transportType = transportSelect.value || 'car';

        if (startIndex === endIndex) {
            this.showSwalAlert('提示', '起始点和目标点不能相同！', 'warning');
            return;
        }

        const startMarker = this.markers[startIndex];
        const endMarker = this.markers[endIndex];

        this.createConnection(startMarker, endMarker, transportType);

        this.closeModals();
    }


    getTransportColor(type) {
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
    }

    createMarkerIcon(iconConfig, _number) {
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
    }

    getCurrentLocalDateTime() {
        // 获取本地时间，格式化为中文显示
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    // 通过屏幕像素距离检测鼠标是否在某个标记点上
    getMarkerAt(latlng) {
        const clickPoint = this.map.latLngToContainerPoint(latlng);
        const tolerance = 20; // 20像素的容差范围

        for (const marker of this.markers) {
            const markerPoint = this.map.latLngToContainerPoint(marker.position);
            if (clickPoint.distanceTo(markerPoint) <= tolerance) {
                return marker;
            }
        }
        return null;
    }

    // 将Markdown链接转换为HTML链接
    convertMarkdownLinksToHtml(text) {
        if (!text) return '';
        // 匹配 [link text](url) 格式的Markdown链接
        // 注意：这里只处理简单的链接，不处理图片或其他复杂的Markdown语法
        const linkRegex = /\[([^\]]+?)\]\((https?:\/\/[^\s$.?#].[^\s]*)\)/g;
        return text.replace(linkRegex, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    // 生成标记点弹窗内容 (只读模式)
    generateMarkerPopupContent(markerData) {
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
        content += '</div>';

        return content;
    }

    // 生成连接线弹窗内容 (只读模式)
    generateConnectionPopupContent(connData, startMarker, endMarker) {
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
    }

    // 处理日期备注输入框的粘贴事件，自动将链接转换为Markdown格式
    handleDateNotesPaste(event) {
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
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 处理标记点标签输入框的粘贴事件，自动将链接转换为Markdown格式
    handleMarkerLabelsPaste(event) {
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
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 更新备注区下方的链接预览
    updateLinkPreview(sourceTextarea, targetContainer) {
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
    }

    // 处理连接线标签输入框的粘贴事件，自动将链接转换为Markdown格式
    handleConnectionLabelsPaste(event) {
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
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 转义HTML特殊字符，防止XSS攻击
    escapeHtml(text) {
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
    }

    getLocalDateTimeForInput(dateTimeString) {
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
    }

    // 在 WebMercator 投影坐标系下计算线段上的点，避免长距离情况下的视觉偏移
    // startPos/endPos: [lat, lng]
    // ratio: 0~1
    getPointOnConnection(startPos, endPos, ratio) {
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
    }

    // 基于投影坐标计算箭头朝向角度（0deg 指向上方）
    getConnectionAngleDeg(startPos, endPos) {
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
    }

    createArrowHead(startPos, endPos, transportType) {
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
    }

    // 计算两点之间的直线距离（米）
    calculateLineDistance(latlng1, latlng2) {
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

    showMarkerTooltip(markerData, latlng, event = null) {
        let tooltipContent = `<div style="background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">`;
        tooltipContent += `<div><strong>${markerData.title}</strong></div>`;
        tooltipContent += `<div>坐标: ${markerData.position[1].toFixed(6)}, ${markerData.position[0].toFixed(6)}</div>`;

        // 显示多个时间点，按日期分组（从早到晚排序）
        if (markerData.dateTimes && markerData.dateTimes.length > 0) {
            // 按日期分组时间点
            const timesByDate = {};
            markerData.dateTimes.forEach(dt => {
                const dateKey = this.getDateKey(dt);
                if (!timesByDate[dateKey]) {
                    timesByDate[dateKey] = [];
                }
                timesByDate[dateKey].push(dt); // 保存完整时间用于排序
            });

            // 获取排序后的日期（从早到晚）
            const sortedDates = Object.keys(timesByDate).sort((a, b) => new Date(a) - new Date(b));

            if (sortedDates.length === 1) {
                // 只有一个日期，直接显示时间（按时间排序）
                const times = timesByDate[sortedDates[0]]
                    .sort((a, b) => new Date(a) - new Date(b))
                    .map(dt => this.formatTime(dt))
                    .join(', ');
                tooltipContent += `<div>时间: ${times}</div>`;
            } else {
                // 多个日期，按日期分组显示（从早到晚）
                tooltipContent += `<div>时间:</div>`;
                sortedDates.forEach(date => {
                    const dateHeader = this.formatDateHeader(date);
                    const times = timesByDate[date]
                        .sort((a, b) => new Date(a) - new Date(b))
                        .map(dt => this.formatTime(dt))
                        .join(', ');
                    tooltipContent += `<div style="margin-left: 8px;">• ${dateHeader}: ${times}</div>`;
                });
            }
        } else if (markerData.dateTime) {
            tooltipContent += `<div>时间: ${this.formatTime(markerData.dateTime)}</div>`;
        }

                if (markerData.labels && markerData.labels.length > 0) {
                    const labelsHtml = this.convertMarkdownLinksToHtml(markerData.labels.join('; '));
                    tooltipContent += '<div>标注: ' + labelsHtml + '</div>';
                }

        tooltipContent += `</div>`;

        if (!this.markerTooltip) {
            this.markerTooltip = L.tooltip({
                permanent: false,
                direction: 'top',
                className: 'marker-tooltip'
            });
        }

        this.markerTooltip.setContent(tooltipContent);
        this.markerTooltip.setLatLng(latlng);
        this.markerTooltip.addTo(this.map);

        // 设置当前标记点数据，用于logo预览
        this.currentMarkerDataForTooltip = markerData;

        // 显示logo预览，与tooltip同步
        setTimeout(() => {
            if (markerData.logo && event) {
                this.showLogoPreview(markerData.logo, event);
            }
        }, 50);
    }


    hideMarkerTooltip() {
        if (this.markerTooltip) {
            this.markerTooltip.remove();
            this.markerTooltip = null;
        }
        this.currentMarkerDataForTooltip = null;

        // 隐藏logo预览，与tooltip同步
        this.hideLogoPreview();
    }

    showConnectionTooltip(connection, latlng, event = null) {
        // 通过ID获取当前的起始点和终点对象，确保显示最新的标题
        const startMarker = this.markers.find(m => m.id === connection.startId);
        const endMarker = this.markers.find(m => m.id === connection.endId);

        const startTitle = startMarker ? startMarker.title : connection.startTitle;
        const endTitle = endMarker ? endMarker.title : connection.endTitle;

        let tooltipContent = `<div style="background: rgba(0,0,0,0.8); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">`;
        tooltipContent += `<div><strong>${startTitle} → ${endTitle}</strong></div>`;
        tooltipContent += `<div>${this.getTransportIcon(connection.transportType)} ${this.getTransportTypeName(connection.transportType)}</div>`;

        // 动态计算并添加距离信息（复用已找到的startMarker和endMarker）
        if (startMarker && endMarker) {
            const distance = this.calculateLineDistance(startMarker.position, endMarker.position);
            let distanceStr;
            if (distance > 1000) {
                distanceStr = (distance / 1000).toFixed(2) + ' km';
            } else {
                distanceStr = Math.round(distance) + ' m';
            }
            tooltipContent += `<div>距离: ${distanceStr}</div>`;
        }

        if (connection.duration > 0) {
            tooltipContent += `<div>耗时: ${connection.duration} 小时</div>`;
        }
        if (connection.dateTime) {
            // 使用相同的格式化方式显示时间
            tooltipContent += `<div>时间: ${this.formatTime(connection.dateTime)}</div>`;
        }
        if (connection.label) {
            const labelsHtml = this.convertMarkdownLinksToHtml(connection.label);
            tooltipContent += `<div>标注: ${labelsHtml}</div>`;
        }

        tooltipContent += `</div>`;

        if (!this.tooltip) {
            this.tooltip = L.tooltip({
                permanent: false,
                direction: 'top',
                className: 'connection-tooltip'
            });
        }

        this.tooltip.setContent(tooltipContent);
        this.tooltip.setLatLng(latlng);
        this.tooltip.addTo(this.map);

        // 设置当前连接线数据，用于logo预览
        this.currentConnectionDataForTooltip = connection;

        // 显示logo预览，与tooltip同步
        setTimeout(() => {
            if (connection.logo && event) {
                this.showLogoPreview(connection.logo, event);
            }
        }, 50);
    }


    hideConnectionTooltip() {
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }
        this.currentConnectionDataForTooltip = null;

        // 隐藏logo预览，与tooltip同步
        this.hideLogoPreview();
    }

    // 显示Logo预览
    showLogoPreview(logoUrl, latlng) {
        if (!logoUrl) {
            this.hideLogoPreview();
            return;
        }

        const logoPreview = document.getElementById('logoPreview');
        const logoPreviewImg = document.getElementById('logoPreviewImg');

        if (!logoPreview || !logoPreviewImg) {
            return;
        }

        // 设置预览图片的源
        logoPreviewImg.src = logoUrl;

        // 图片加载完成后显示预览
        logoPreviewImg.onload = () => {
            // 将Leaflet的地理坐标转换为像素坐标
            const pos = this.map.latLngToLayerPoint(latlng);

            // 设置预览位置，相对于地图容器（在鼠标附近）
            logoPreview.style.display = 'block';
            logoPreview.style.left = (pos.x + 15) + 'px';  // 偏移一些避免遮挡
            logoPreview.style.top = (pos.y - 30) + 'px';   // 稍微往上，避免遮挡

            // 添加淡入效果
            logoPreview.style.opacity = '0';
            setTimeout(() => {
                logoPreview.style.opacity = '1';
            }, 10);
        };

        // 图片加载失败处理
        logoPreviewImg.onerror = () => {
            logoPreview.style.display = 'none';
        };
    }

    // 显示logo预览 - 与tooltip同步
    showLogoPreview(logoUrl, event) {
        if (!logoUrl || !event) {
            this.hideLogoPreview();
            return;
        }

        const logoPreview = document.getElementById('logoPreview');
        const logoPreviewImg = document.getElementById('logoPreviewImg');

        if (!logoPreview || !logoPreviewImg) {
            return;
        }

        // 设置预览图片的源
        logoPreviewImg.src = logoUrl;

        logoPreviewImg.onload = () => {
            // 使用事件对象获取鼠标位置
            logoPreview.style.position = 'fixed';
            logoPreview.style.left = event.originalEvent.clientX + 'px';
            logoPreview.style.top = (event.originalEvent.clientY + 15) + 'px';  // 鼠标下方15px

            logoPreview.style.display = 'block';
            logoPreview.style.opacity = '0';

            setTimeout(() => {
                logoPreview.style.opacity = '1';
            }, 10);
        };

        // 图片加载失败处理
        logoPreviewImg.onerror = () => {
            logoPreview.style.display = 'none';
        };
    }

    // 隐藏Logo预览
    hideLogoPreview() {
        const logoPreview = document.getElementById('logoPreview');
        if (logoPreview) {
            logoPreview.style.display = 'none';
        }
        // 清除logo预览数据
        this.logoPreviewData = null;
    }

    getTransportIcon(type) {
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

    showConnectionDetail(connectionData) {
        // 如果当前处于筛选模式，则退出筛选模式但保持当前视图
        this.checkAndHandleFilterMode();

        // 移动端自动展开侧边栏
        if (this.isMobileDevice()) {
            const rightPanel = document.querySelector('.right-panel');
            const menuToggleBtn = document.getElementById('menuToggleBtn');
            if (rightPanel && menuToggleBtn) {
                rightPanel.classList.add('active');
                menuToggleBtn.textContent = '✕';
            }
        }

        this.currentConnection = connectionData;
        this.currentMarker = null;

        // 设置面板标题
        const detailTitle = document.getElementById('detailTitle');
        if (detailTitle) {
            detailTitle.textContent = '连接线详情';
        }

        // 连接线不需要名称输入
        const markerNameInput = document.getElementById('markerNameInput');
        if (markerNameInput) {
            markerNameInput.style.display = 'none';
        }

        // 设置日期时间
        if (connectionData.dateTime) {
            const dateString = this.getLocalDateTimeForInput(connectionData.dateTime);
            const connectionDateInput = document.getElementById('connectionDateInput');
            if (connectionDateInput) {
                connectionDateInput.value = dateString;
            }
        } else {
            const now = this.getLocalDateTimeForInput(this.getCurrentLocalDateTime());
            const connectionDateInput = document.getElementById('connectionDateInput');
            if (connectionDateInput) {
                connectionDateInput.value = now;
            }
        }

        // 显示连接信息，使用当前标记点的标题而不是保存时的标题
        const markerCoords = document.getElementById('markerCoords');
        if (markerCoords) {
            // 通过ID找到当前的标记点对象，获取最新的标题
            const startMarker = this.markers.find(m => m.id === connectionData.startId);
            const endMarker = this.markers.find(m => m.id === connectionData.endId);

            const startTitle = startMarker ? startMarker.title : connectionData.startTitle;
            const endTitle = endMarker ? endMarker.title : connectionData.endTitle;

            // 动态计算并添加距离信息（复用上面已找到的startMarker和endMarker）
            let distanceStr = '';
            if (startMarker && endMarker) {
                const distance = this.calculateLineDistance(startMarker.position, endMarker.position);
                if (distance > 1000) {
                    distanceStr = ` | 距离: ${(distance / 1000).toFixed(2)} km`;
                } else {
                    distanceStr = ` | 距离: ${Math.round(distance)} m`;
                }
            }

            markerCoords.textContent =
                `${startTitle} → ${endTitle} (${this.getTransportIcon(connectionData.transportType)} ${this.getTransportTypeName(connectionData.transportType)})${distanceStr}`;
        }

        // 设置耗时
        const durationInput = document.getElementById('connectionDuration');
        if (durationInput) {
            durationInput.value = connectionData.duration || 0;
        }

        // 显示标注内容
        const connectionLabelsInput = document.getElementById('connectionLabelsInput');
        if (connectionLabelsInput) {
            connectionLabelsInput.value = connectionData.label || '';
            // Also update the link preview when showing the detail
            const targetContainer = document.getElementById('connectionLabelsLinks');
            this.updateLinkPreview(connectionLabelsInput, targetContainer);
        }

        // 设置当前交通方式的激活状态
        document.querySelectorAll('#connectionDetailPanel .transport-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.transport === connectionData.transportType) {
                btn.classList.add('active');
            }
        });

        // 填充起始点和终点选择框
        const startSelect = document.getElementById('connectionStartMarker');
        const endSelect = document.getElementById('connectionEndMarker');

        if (startSelect && endSelect) {
            startSelect.innerHTML = '';
            endSelect.innerHTML = '';

            this.markers.forEach((marker, index) => {
                const optionStart = new Option(marker.title, index);
                const optionEnd = new Option(marker.title, index);

                // 通过ID查找当前连接的起始点和终点，并高亮
                const startMarker = this.markers.find(m => m.id === connectionData.startId);
                const endMarker = this.markers.find(m => m.id === connectionData.endId);

                if (startMarker && marker.id === startMarker.id) {
                    optionStart.selected = true;
                }
                if (endMarker && marker.id === endMarker.id) {
                    optionEnd.selected = true;
                }

                startSelect.add(optionStart);
                endSelect.add(optionEnd);
            });
        }

        // 生成导航链接
        this.updateNavigationLinks(connectionData);

        // 更新小红书链接
        this.updateXiaohongshuLink(connectionData);

        // 显示Logo链接
        const connectionLogoInput = document.getElementById('connectionLogoInput');
        if (connectionLogoInput) {
            connectionLogoInput.value = connectionData.logo || '';

            // --- Logo 预览功能 (优化版) ---
            let previewContainer = document.getElementById('connectionLogoPreviewContainer');
            if (!previewContainer) {
                previewContainer = document.createElement('div');
                previewContainer.id = 'connectionLogoPreviewContainer';
                previewContainer.className = 'detail-logo-preview-container';
                connectionLogoInput.parentNode.insertBefore(previewContainer, connectionLogoInput.nextSibling);
            }

            const updatePreview = (url) => {
                const trimmedUrl = url.trim();
                if (trimmedUrl && (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://'))) {
                    // 预加载图片
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        // 加载成功后才显示
                        previewContainer.innerHTML = `<img src="${trimmedUrl}" class="detail-logo-preview-img" alt="Logo Preview">`;
                        previewContainer.style.display = 'block';
                    };
                    tempImg.onerror = () => {
                        // 加载失败则隐藏
                        previewContainer.style.display = 'none';
                    };
                    tempImg.src = trimmedUrl;
                } else {
                    // URL无效或为空则隐藏
                    previewContainer.style.display = 'none';
                }
            };

            // 绑定 change 和 paste 事件
            const handleInputChange = () => {
                updatePreview(connectionLogoInput.value);
            };
            connectionLogoInput.onchange = handleInputChange;
            connectionLogoInput.onpaste = () => {
                // onpaste 后立即触发更新
                setTimeout(handleInputChange, 0);
            };

            // 初始化预览
            updatePreview(connectionData.logo || '');
            // --- 预览功能结束 ---
        }

        // 隐藏标记点详情面板，显示连接线详情面板
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        if (markerDetailPanel) {
            markerDetailPanel.style.display = 'none';
        }
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.style.display = 'block';
        }
    }

    // 更新导航链接
    updateNavigationLinks(connectionData) {
        // 通过ID找到当前的标记点对象，获取最新的位置信息
        const startMarker = this.markers.find(m => m.id === connectionData.startId);
        const endMarker = this.markers.find(m => m.id === connectionData.endId);

        if (!startMarker || !endMarker) {
            console.error('无法找到起始或终点标记点');
            return;
        }

        // 获取起始点和终点的坐标
        const startLat = startMarker.position[0];
        const startLng = startMarker.position[1];
        const endLat = endMarker.position[0];
        const endLng = endMarker.position[1];

        // 获取起始点和终点的名称
        const startTitle = startMarker.title || '起点';
        const endTitle = endMarker.title || '终点';

        // 生成百度导航链接
        const baiduLink = `http://api.map.baidu.com/direction?origin=latlng:${startLat},${startLng}|name:${startTitle}&destination=latlng:${endLat},${endLng}|name:${endTitle}&mode=driving&region=中国&output=html&coord_type=gcj02&src=webapp.demo`;
        const baiduNavLink = document.getElementById('baiduNavLink');
        if (baiduNavLink) {
            baiduNavLink.href = baiduLink;
            baiduNavLink.target = '_blank';
        }

        // 生成高德导航链接
        const amapLink = `https://uri.amap.com/navigation?from=${startLng},${startLat},${startTitle}&to=${endLng},${endLat},${endTitle}&mode=car&policy=1&coordinate=gaode`;
        const amapNavLink = document.getElementById('amapNavLink');
        if (amapNavLink) {
            amapNavLink.href = amapLink;
            amapNavLink.target = '_blank';
        }

        // 生成腾讯导航链接
        const qqLink = `https://apis.map.qq.com/uri/v1/routeplan?type=drive&from=${startTitle}&fromcoord=${startLat},${startLng}&to=${endTitle}&tocoord=${endLat},${endLng}&referer=myapp`;
        const qqNavLink = document.getElementById('qqNavLink');
        if (qqNavLink) {
            qqNavLink.href = qqLink;
            qqNavLink.target = '_blank';
        }

        // 生成Google导航链接
        const googleLink = `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${endLat},${endLng}`;
        const googleNavLink = document.getElementById('googleNavLink');
        if (googleNavLink) {
            googleNavLink.href = googleLink;
            googleNavLink.target = '_blank';
        }

        // 更新购票服务链接
        this.updateTicketBookingLinks(connectionData);
    }

    // 获取交通枢纽信息
    async getTrafficInfo(lat, lon) {
        if (lat === undefined || lon === undefined) {
            throw new Error("无效的坐标");
        }
        const response = await fetch(`${apiBaseUrl}/api/trafficpos?lat=${lat}&lon=${lon}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`交通信息API请求失败: ${response.status} ${errorText}`);
        }
        return await response.json();
    }

    // 更新购票服务链接的显示和事件绑定
    updateTicketBookingLinks(connectionData) {
        const ticketBookingSection = document.getElementById('ticketBookingSection');
        const ctripTrainLink = document.getElementById('ctripTrainLink');
        const planeTicketBtn = document.getElementById('planeTicketBtn');

        if (!ticketBookingSection || !ctripTrainLink || !planeTicketBtn) {
            console.error('购票服务元素不存在');
            return;
        }

        // 重置状态
        ticketBookingSection.style.display = 'none';
        ctripTrainLink.style.display = 'none';
        planeTicketBtn.style.display = 'none';

        const transportType = connectionData.transportType;

        if (transportType === 'train') {
            ticketBookingSection.style.display = 'block';
            ctripTrainLink.style.display = 'inline-block';
            ctripTrainLink.textContent = '🚄 携程火车票';
            // 为<a>标签绑定点击事件来触发异步逻辑
            ctripTrainLink.onclick = (e) => {
                e.preventDefault(); // 阻止<a>标签的默认跳转行为
                this.handleTrainTicketClick(connectionData);
            };
        } else if (transportType === 'plane') {
            ticketBookingSection.style.display = 'block';
            planeTicketBtn.style.display = 'inline-block';
            planeTicketBtn.textContent = '✈️ 查询飞机票';
            // 为<button>标签绑定点击事件
            planeTicketBtn.onclick = () => {
                this.handlePlaneTicketClick(connectionData);
            };
        }
    }

    // 处理火车票点击
    async handleTrainTicketClick(connectionData) {
        Swal.fire({
            title: '正在查询火车站...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const startMarker = this.markers.find(m => m.id === connectionData.startId);
            const endMarker = this.markers.find(m => m.id === connectionData.endId);

            if (!startMarker || !endMarker) throw new Error('无法找到路线的起点或终点。');

            const [startInfo, endInfo] = await Promise.all([
                this.getTrafficInfo(startMarker.position[0], startMarker.position[1]),
                this.getTrafficInfo(endMarker.position[0], endMarker.position[1])
            ]);

            const startStation = startInfo.nearest_station.name;
            const endStation = endInfo.nearest_station.name;
            if (!startStation || !endStation) throw new Error('未能获取有效的火车站名称。');

            let travelDate = new Date().toISOString().split('T')[0];
            if (connectionData.dateTime) {
                try {
                    const date = new Date(connectionData.dateTime);
                    travelDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                } catch (e) { /* 忽略错误，使用默认日期 */ }
            }

            const ctripLink = `https://trains.ctrip.com/webapp/train/list?ticketType=0&dStation=${encodeURIComponent(startStation)}&aStation=${encodeURIComponent(endStation)}&dDate=${travelDate}&rDate=&trainsType=gaotie-dongche`;

            Swal.close();
            window.open(ctripLink, '_blank');
        } catch (error) {
            Swal.fire('查询失败', error.message, 'error');
        }
    }

    // 处理飞机票点击
    async handlePlaneTicketClick(connectionData) {
        Swal.fire({
            title: '正在查询机场信息...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const startMarker = this.markers.find(m => m.id === connectionData.startId);
            const endMarker = this.markers.find(m => m.id === connectionData.endId);

            if (!startMarker || !endMarker) throw new Error('无法找到路线的起点或终点。');

            const [startInfo, endInfo] = await Promise.all([
                this.getTrafficInfo(startMarker.position[0], startMarker.position[1]),
                this.getTrafficInfo(endMarker.position[0], endMarker.position[1])
            ]);

            const startAirportCode = startInfo.nearest_airport.code;
            const endAirportCode = endInfo.nearest_airport.code;
            if (!startAirportCode || !endAirportCode) throw new Error('未能获取有效的机场代码。');

            let travelDate = new Date().toISOString().split('T')[0];
            if (connectionData.dateTime) {
                try {
                    const date = new Date(connectionData.dateTime);
                    travelDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                } catch (e) { /* 忽略错误，使用默认日期 */ }
            }

            const ctripLink = `https://flights.ctrip.com/online/list/oneway-${startAirportCode}-${endAirportCode}?depdate=${travelDate}`;

            Swal.close();
            window.open(ctripLink, '_blank');
        } catch (error) {
            Swal.fire('查询失败', error.message, 'error');
        }
    }

    showLabelModal() {
        if (this.markers.length === 0) {
            this.showSwalAlert('提示', '需要先添加标记点！', 'warning');
            return;
        }

        const labelSelect = document.getElementById('labelMarker');
        labelSelect.innerHTML = '';

        this.markers.forEach((marker, index) => {
            const option = new Option(marker.title, index);
            labelSelect.add(option);
        });

        document.getElementById('labelModal').style.display = 'block';
    }

    addLabel() {
        const markerIndex = document.getElementById('labelMarker').selectedIndex;
        const content = document.getElementById('labelContent').value.trim();

        if (!content) {
            this.showSwalAlert('提示', '请输入标注内容！', 'warning');
            return;
        }

        const marker = this.markers[markerIndex];

        // 创建自定义标注样式
        const label = L.divIcon({
            className: 'custom-label',
            html: `<div style="background-color: rgba(255,255,255,0.9); border: 2px solid #667eea; border-radius: 5px; padding: 8px; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 200px;">${content}</div>`,
            iconSize: [200, 'auto'],
            iconAnchor: [100, -10]
        });

        const labelMarker = L.marker([marker.position[0], marker.position[1]], {
            icon: label
        }).addTo(this.map);

        marker.labels.push(labelMarker);
        this.labels.push({ marker: marker, label: labelMarker, content: content });

        document.getElementById('labelContent').value = '';
        this.closeModals();
    }

    updateMarkerList() {
        const listContainer = document.getElementById('markerList');
        listContainer.innerHTML = '';

        // 按日期分组标记点
        const markersByDate = this.groupMarkersByDate();

        // 获取所有日期并排序（从近到远）
        const allDates = this.getAllDatesFromMarkers();

        allDates.forEach(date => {
            // 创建日期分组标题
            const dateHeader = document.createElement('div');
            dateHeader.className = 'date-group-header';
            const markers = markersByDate[date] || [];
            // 默认为收起状态
            if (!this.collapsedDates) this.collapsedDates = {};
            const isCollapsed = (this.collapsedDates[date] !== undefined) ? this.collapsedDates[date] : true;
            const expandIcon = isCollapsed ? '📁' : '📂'; // 收起状态显示📁，展开状态显示📂

            dateHeader.innerHTML = `
                <h4 style="display: flex; align-items: center; gap: 8px;">
                    <span class="expand-toggle">${expandIcon}</span>
                    ${this.formatDateHeader(date)}
                </h4>
                <span class="marker-count">${markers.length} 个地点</span>
            `;

            // 为日期标题添加展开/收起功能，同时保留筛选功能
            dateHeader.style.cursor = 'pointer';
            dateHeader.addEventListener('click', (e) => {
                // 如果点击的是展开/收起按钮，则只执行展开/收起功能
                if (e.target.classList.contains('expand-toggle')) {
                    // 切换展开/收起状态
                    // 如果当前状态未定义（默认状态），则从默认收起状态开始，点击后应该展开（false）
                    // 如果当前状态已定义，则直接取反
                    if (this.collapsedDates[date] === undefined) {
                        this.collapsedDates[date] = false; // 从默认收起切换到展开
                    } else {
                        this.collapsedDates[date] = !this.collapsedDates[date];
                    }
                    // 重新渲染整个列表以更新展开/收起状态
                    this.updateMarkerList();
                } else {
                    // 否则执行筛选功能
                    this.filterByDate(date); // 执行筛选并自动调整视窗
                    // 在筛选后显示日期详情，这样用户可以编辑备注
                    setTimeout(() => {
                        this.showDateDetail(date);
                    }, 300); // 延迟显示详情，让视窗调整完成
                }
            });

            listContainer.appendChild(dateHeader);

            // 按最早时间排序该日期的标记点
            const sortedMarkers = this.sortMarkersByEarliestTime(markers, date);

            // 如果未收起，则显示该日期的标记点 (使用计算后的isCollapsed值)
            if (!isCollapsed) {
                // 添加该日期的所有标记点
                sortedMarkers.forEach(marker => {
                    const item = document.createElement('div');
                    item.className = 'marker-item';

                    // 显示该日期对应的时间点（只显示这一天的）
                    const dayTimes = this.getMarkerTimesForDate(marker, date);
                    const timeDisplay = dayTimes.length > 0
                        ? dayTimes.map(dt => this.formatTime(dt)).join(', ')
                        : '';

                    item.innerHTML = `
                        <div class="marker-info">
                            <div class="title">${marker.title}</div>
                            <div class="coords">${marker.position[1].toFixed(6)}, ${marker.position[0].toFixed(6)}</div>
                            <div class="time-info">${timeDisplay}</div>
                        </div>
                        <div class="marker-actions">
                            <button class="edit-btn" title="编辑">✏️</button>
                            <button class="delete-btn" title="删除">🗑️</button>
                        </div>
                    `;

                    // 点击标记点信息显示详情
                    item.querySelector('.marker-info').addEventListener('click', () => {
                        this.showMarkerDetail(marker);
                    });

                    // 编辑按钮
                    item.querySelector('.edit-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showMarkerDetail(marker);
                    });

                    // 删除按钮
                    item.querySelector('.delete-btn').addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const result = await this.showSwalConfirm('删除确认', `确定要删除标记点"${marker.title}"吗？`, '删除', '取消');
                        if (result.isConfirmed) {
                            this.removeMarker(marker);
                        }
                    });

                    listContainer.appendChild(item);
                });
            }
        });

        // 计算并显示总花费
        let totalCost = 0;
        const dailyExpenses = [];

        allDates.forEach(date => {
            const expenses = this.getDateExpenses(date);
            if (expenses && expenses.length > 0) {
                const dayCost = expenses.reduce((sum, item) => sum + (parseFloat(item.cost) || 0), 0);
                if (dayCost > 0) {
                    totalCost += dayCost;
                    dailyExpenses.push({ date, cost: dayCost });
                }
            }
        });

        const totalContainer = document.getElementById('totalExpensesContainer');
        const totalAmount = document.getElementById('totalExpensesAmount');

        if (totalContainer && totalAmount) {
            if (totalCost > 0) {
                totalContainer.style.display = 'flex';
                totalAmount.textContent = `¥${totalCost.toFixed(2)}`;

                // 绑定鼠标悬停事件显示明细
                totalContainer.onmouseover = () => {
                    let tooltip = document.getElementById('expenses-tooltip');
                    if (!tooltip) {
                        tooltip = document.createElement('div');
                        tooltip.id = 'expenses-tooltip';
                        tooltip.style.position = 'fixed';
                        tooltip.style.zIndex = '10000';
                        tooltip.style.pointerEvents = 'none';
                        tooltip.style.padding = '10px';
                        tooltip.style.borderRadius = '4px';
                        tooltip.style.fontSize = '12px';
                        tooltip.style.minWidth = '180px';
                        document.body.appendChild(tooltip);
                    }

                    let tooltipContent = '<div class="expenses-tooltip-header">每日消费明细</div>';
                    if (dailyExpenses.length > 0) {
                        dailyExpenses.forEach(item => {
                            tooltipContent += `<div class="expenses-tooltip-item">
                                <span>${this.formatDateHeader(item.date)}:</span>
                                <span class="expenses-tooltip-cost">¥${item.cost.toFixed(2)}</span>
                            </div>`;
                        });
                        tooltipContent += `<div class="expenses-tooltip-footer">
                            <span>总计:</span>
                            <span class="expenses-tooltip-total">¥${totalCost.toFixed(2)}</span>
                        </div>`;
                    } else {
                        tooltipContent += '<div>无消费记录</div>';
                    }

                    tooltip.innerHTML = tooltipContent;
                    tooltip.style.display = 'block';

                    const rect = totalContainer.getBoundingClientRect();
                    tooltip.style.left = rect.left + 'px';
                    tooltip.style.top = (rect.top - tooltip.offsetHeight - 5) + 'px';
                };

                totalContainer.onmousemove = () => {
                    const tooltip = document.getElementById('expenses-tooltip');
                    if (tooltip && tooltip.style.display !== 'none') {
                        // 稍微跟随鼠标，但保持在上方
                        // tooltip.style.left = (e.clientX + 10) + 'px';
                        // tooltip.style.top = (e.clientY - tooltip.offsetHeight - 10) + 'px';
                    }
                };

                totalContainer.onmouseout = () => {
                    const tooltip = document.getElementById('expenses-tooltip');
                    if (tooltip) {
                        tooltip.style.display = 'none';
                    }
                };
            } else {
                totalContainer.style.display = 'none';
            }
        }
    }

    // 获取所有标记点中出现过的日期（从早到晚排序）
    getAllDatesFromMarkers() {
        const allDates = new Set();

        this.markers.forEach(marker => {
            const markerDates = this.getMarkerAllDates(marker);
            markerDates.forEach(date => {
                if (date !== '未知日期') {
                    allDates.add(date);
                }
            });
        });

        // 转换为数组并按日期排序（从早到晚）
        return Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));
    }

    // 获取标记点在指定日期的时间点
    getMarkerTimesForDate(marker, dateKey) {
        const times = [];

        if (marker.dateTimes && marker.dateTimes.length > 0) {
            marker.dateTimes.forEach(dateTime => {
                const dtDateKey = this.getDateKey(dateTime);
                if (dtDateKey === dateKey) {
                    times.push(dateTime);
                }
            });
        } else if (marker.dateTime) {
            const dtDateKey = this.getDateKey(marker.dateTime);
            if (dtDateKey === dateKey) {
                times.push(marker.dateTime);
            }
        }

        return times;
    }

    // 按最早时间排序标记点（创建副本避免修改原数组）
    sortMarkersByEarliestTime(markers, dateKey) {
        return [...markers].sort((a, b) => {
            // 获取每个标记点在该日期的最早时间
            const aTimes = this.getMarkerTimesForDate(a, dateKey);
            const bTimes = this.getMarkerTimesForDate(b, dateKey);

            if (aTimes.length === 0 && bTimes.length === 0) return 0;
            if (aTimes.length === 0) return 1; // a没有时间，排后面
            if (bTimes.length === 0) return -1; // b没有时间，排后面

            // 按最早时间排序（时间小的在前）
            const aEarliest = new Date(aTimes[0]);
            const bEarliest = new Date(bTimes[0]);

            return aEarliest - bEarliest;
        });
    }

    // 按日期分组标记点 - 包含所有出现过的日期
    groupMarkersByDate() {
        const groups = {};

        this.markers.forEach(marker => {
            // 获取该标记点的所有日期
            const markerDates = this.getMarkerAllDates(marker);

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
    getMarkerAllDates(marker) {
        const dates = new Set();

        if (marker.dateTimes && marker.dateTimes.length > 0) {
            marker.dateTimes.forEach(dateTime => {
                const dateKey = this.getDateKey(dateTime);
                if (dateKey !== '未知日期') {
                    dates.add(dateKey);
                }
            });
        } else if (marker.dateTime) {
            const dateKey = this.getDateKey(marker.dateTime);
            if (dateKey !== '未知日期') {
                dates.add(dateKey);
            }
        }

        return Array.from(dates);
    }

    // 获取日期键（YYYY-MM-DD格式）
    getDateKey(dateTimeString) {
        if (!dateTimeString) return '未知日期';
        try {
            const date = new Date(dateTimeString);
            if (isNaN(date.getTime())) return '未知日期';
            // 使用本地时区的日期，而不是UTC
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`; // YYYY-MM-DD in local timezone
        } catch (error) {
            return '未知日期';
        }
    }

    // 格式化日期标题
    formatDateHeader(dateKey) {
        if (dateKey === '未知日期') return dateKey;
        try {
            const date = new Date(dateKey);
            // 获取今天的日期键（本地时区）
            const today = new Date();
            const todayKey = this.getDateKey(today.toISOString());

            // 获取昨天的日期键（本地时区）
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayKey = this.getDateKey(yesterday.toISOString());

            if (dateKey === todayKey) {
                return '今天';
            } else if (dateKey === yesterdayKey) {
                return '昨天';
            } else {
                return `${date.getMonth() + 1}月${date.getDate()}日 (${this.getWeekdayName(date.getDay())})`;
            }
        } catch (error) {
            return dateKey;
        }
    }

    // 获取星期几的中文名称
    getWeekdayName(day) {
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return weekdays[day];
    }

    // 格式化时间（只在小时或分钟不为0时显示）
    formatTime(dateTimeString) {
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

    // 按日期筛选功能
    filterByDate(date) {
        this.filterMode = true;
        this.filteredDate = date;

        console.log(`进入日期筛选模式: ${date}`);

        // 隐藏所有标记点
        this.markers.forEach(marker => {
            marker.marker.remove();
        });

        // 隐藏所有连接线
        this.connections.forEach(connection => {
            connection.polyline.remove();
            if (connection.endCircle) connection.endCircle.remove();
            if (connection.iconMarker) connection.iconMarker.remove();
            if (connection.arrowHead) connection.arrowHead.remove();
        });

        // 显示筛选日期内的标记点
        this.markers.forEach(marker => {
            const markerDates = this.getMarkerAllDates(marker);
            if (markerDates.includes(date)) {
                marker.marker.addTo(this.map);
            }
        });

        // 显示筛选日期内的连接线
        this.connections.forEach(connection => {
            const connectionDate = this.getDateKey(connection.dateTime);
            if (connectionDate === date) {
                connection.polyline.addTo(this.map);
                if (connection.endCircle) connection.endCircle.addTo(this.map);
                if (connection.iconMarker) connection.iconMarker.addTo(this.map);
                if (connection.arrowHead) connection.arrowHead.addTo(this.map);
            }
        });

        // 更新标记点列表显示
        this.updateMarkerListForFilter();

        // 显示筛选模式提示
        this.showFilterModeIndicator(date);

        // 绑定退出筛选模式的事件
        this.bindFilterExitEvents();

        // 自动调整视窗以聚焦到筛选后的元素
        this.autoFitMapViewAfterFilter();

        // 显示日期备注便签
        this.showDateNotesSticky(date);
    }

    // 显示筛选模式提示
    showFilterModeIndicator(date) {
        const headerTitle = document.querySelector('header h1');
        if (headerTitle) {
            const originalText = headerTitle.textContent;
            const dateHeader = this.formatDateHeader(date);
            headerTitle.innerHTML = `${originalText} <span style="font-size: 0.8rem; background: rgba(255,255,255,0.2); padding: 0.2rem 0.5rem; border-radius: 10px; margin-left: 1rem;">📅 ${dateHeader} 筛选模式</span>`;
            headerTitle.style.cursor = 'pointer';
            headerTitle.title = '点击退出筛选模式';

            // 添加点击标题退出筛选模式
            headerTitle.onclick = () => {
                this.exitFilterMode();
            };
        }
    }

    // 绑定退出筛选模式的事件
    bindFilterExitEvents() {
        // 点击地图退出筛选模式
        this.map.on('click', this.exitFilterModeHandler, this);

        // ESC键退出筛选模式
        if (!this.boundExitFilterModeKeyHandler) {
            this.boundExitFilterModeKeyHandler = this.exitFilterModeKeyHandler.bind(this);
        }
        document.addEventListener('keydown', this.boundExitFilterModeKeyHandler, true);

        // 点击任意按钮退出筛选模式
        if (!this.boundExitFilterModeClickHandler) {
            this.boundExitFilterModeClickHandler = this.exitFilterModeClickHandler.bind(this);
        }
        document.querySelectorAll('.btn').forEach(btn => {
            btn.addEventListener('click', this.boundExitFilterModeClickHandler, true);
        });
    }

    // 显示日期备注便签
    showDateNotesSticky(date) {
        const sticky = document.getElementById('dateNotesSticky');
        const dateElement = document.getElementById('dateNotesDate');
        const contentElement = document.getElementById('dateNotesContent');

        if (sticky && dateElement && contentElement) {
            // 设置日期标题
            dateElement.textContent = this.formatDateHeader(date);

            // 获取日期备注
            const notes = this.getDateNotes(date);
                                contentElement.innerHTML = this.convertMarkdownLinksToHtml(notes);

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
        }
    }

    // 隐藏日期备注便签
    hideDateNotesSticky() {
        const sticky = document.getElementById('dateNotesSticky');
        if (sticky) {
            sticky.style.display = 'none';
        }
    }

    // 退出筛选模式的处理器
    exitFilterModeHandler(e) {
        if (e.originalEvent) {
            this.exitFilterMode(false); // 点击地图退出筛选模式时不自动调整视图
        }
    }

    exitFilterModeKeyHandler(e) {
        if (e.key === 'Escape') {
            this.exitFilterMode(); // ESC键退出筛选模式时自动调整视图
        }
    }

    exitFilterModeClickHandler(e) {
        // 筛选模式下，日期详情面板内的按钮（如添加消费、扩大编辑等）不应该触发“退出筛选模式”
        if (e && e.target && typeof e.target.closest === 'function') {
            if (e.target.closest('#dateDetailPanel') || e.target.closest('#dateNotesSticky') || e.target.closest('#dateRangePicker') || e.target.closest('#expandModal')) {
                return;
            }
        }
        this.exitFilterMode(); // 按钮点击退出筛选模式时自动调整视图
    }

    // 退出筛选模式
    exitFilterMode(shouldFitView = true) {
        if (!this.filterMode) return;

        console.log('退出日期筛选模式');

        // 如果日期详情面板是打开的，手动保存内容并关闭面板（防止递归调用）
        const dateNotesInput = document.getElementById('dateNotesInput');
        if (dateNotesInput && this.currentDate) {
            // 使用封装好的保存方法，确保数据结构正确
            this.saveDateNotes();

            // 隐藏日期详情面板
            const dateDetailPanel = document.getElementById('dateDetailPanel');
            if (dateDetailPanel) {
                dateDetailPanel.style.display = 'none';
            }

            // 清除当前状态
            this.currentDate = null;
            this.currentMarker = null;
            this.currentConnection = null;
        }

        this.filterMode = false;
        this.filteredDate = null;

        // 恢复所有标记点显示
        this.markers.forEach(marker => {
            marker.marker.addTo(this.map);
        });

        // 恢复所有连接线显示
        this.connections.forEach(connection => {
            connection.polyline.addTo(this.map);
            if (connection.endCircle) connection.endCircle.addTo(this.map);
            if (connection.iconMarker) connection.iconMarker.addTo(this.map);
            if (connection.arrowHead) connection.arrowHead.addTo(this.map);
        });

        // 恢复标记点列表显示
        this.updateMarkerList();

        // 恢复标题
        const headerTitle = document.querySelector('header h1');
        if (headerTitle) {
            headerTitle.textContent = 'RoadbookMaker';
            headerTitle.style.cursor = 'default';
            headerTitle.title = '';
            headerTitle.onclick = null;
        }

        // 移除事件监听
        this.map.off('click', this.exitFilterModeHandler, this);
        document.removeEventListener('keydown', this.boundExitFilterModeKeyHandler || this.exitFilterModeKeyHandler, true);
        document.querySelectorAll('.btn').forEach(btn => {
            btn.removeEventListener('click', this.boundExitFilterModeClickHandler || this.exitFilterModeClickHandler, true);
        });

        // 隐藏日期备注便签（自动关闭并保存）
        this.hideDateNotesSticky();

        // 退出筛选模式后根据参数决定是否调整视图
        if (shouldFitView) {
            setTimeout(() => {
                this.autoFitMapView();
            }, 100); // 稍微延时以确保所有元素都已重新添加到地图
        }
    }

    // 处理调整视窗按钮点击事件
    handleFitViewClick() {
        console.log('用户点击了调整视窗按钮');

        const fitViewBtn = document.getElementById('fitViewBtn');
        if (fitViewBtn) {
            // 添加点击动画效果
            fitViewBtn.classList.add('active');
            fitViewBtn.classList.add('rotating');

            setTimeout(() => {
                fitViewBtn.classList.remove('active');
            }, 600);

            setTimeout(() => {
                fitViewBtn.classList.remove('rotating');
            }, 1000);
        }

        // 执行视窗调整
        this.autoFitMapView();
    }

    // 根据日期范围调整视图
    fitViewByDateRange(startDateStr, endDateStr) {
        const startDate = new Date(startDateStr);
        startDate.setHours(0, 0, 0, 0); // 设置为当天的开始

        const endDate = new Date(endDateStr);
        endDate.setHours(23, 59, 59, 999); // 设置为当天的结束

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            this.showSwalAlert('错误', '无效的日期格式。', 'error');
            return;
        }

        if (startDate > endDate) {
            this.showSwalAlert('错误', '开始日期不能晚于结束日期。', 'error');
            return;
        }

        const filteredMarkers = this.markers.filter(marker => {
            const markerDates = (marker.dateTimes && marker.dateTimes.length > 0) ? marker.dateTimes : [marker.dateTime];
            return markerDates.some(dtStr => {
                if (!dtStr) return false;
                const dt = new Date(dtStr);
                return dt >= startDate && dt <= endDate;
            });
        });

        const filteredConnections = this.connections.filter(conn => {
            if (!conn.dateTime) return false;
            const connDate = new Date(conn.dateTime);
            return connDate >= startDate && connDate <= endDate;
        });

        if (filteredMarkers.length === 0 && filteredConnections.length === 0) {
            this.showSwalAlert('提示', '该日期范围内没有找到任何地点或路线。', 'info');
            return;
        }

        const bounds = L.latLngBounds();
        filteredMarkers.forEach(marker => bounds.extend(marker.position));
        filteredConnections.forEach(conn => bounds.extend(conn.polyline.getLatLngs()));

        if (bounds.isValid()) {
            this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
        }

        // 保存本次使用的日期范围
        this.lastDateRange = { start: startDateStr, end: endDateStr };
        this.saveToLocalStorage();
    }

    // 更新筛选模式下的标记点列表
    updateMarkerListForFilter() {
        const listContainer = document.getElementById('markerList');
        listContainer.innerHTML = '';

        if (this.filteredDate) {
            // 创建筛选模式标题
            const filterHeader = document.createElement('div');
            filterHeader.className = 'date-group-header';
            filterHeader.innerHTML = `
                <h4>📅 ${this.formatDateHeader(this.filteredDate)} 筛选结果</h4>
                <span class="marker-count">筛选模式</span>
            `;
            filterHeader.style.cursor = 'pointer';
            filterHeader.title = '点击退出筛选模式';
            filterHeader.addEventListener('click', () => {
                this.exitFilterMode();
            });
            listContainer.appendChild(filterHeader);

            // 显示筛选日期内的标记点
            const filteredMarkers = this.markers.filter(marker => {
                const markerDates = this.getMarkerAllDates(marker);
                return markerDates.includes(this.filteredDate);
            });

            // 按时间排序
            const sortedMarkers = this.sortMarkersByEarliestTime(filteredMarkers, this.filteredDate);

            sortedMarkers.forEach(marker => {
                const item = document.createElement('div');
                item.className = 'marker-item';

                const dayTimes = this.getMarkerTimesForDate(marker, this.filteredDate);
                const timeDisplay = dayTimes.length > 0
                    ? dayTimes.map(dt => this.formatTime(dt)).join(', ')
                    : '';

                item.innerHTML = `
                    <div class="marker-info">
                        <div class="title">${marker.title}</div>
                        <div class="coords">${marker.position[1].toFixed(6)}, ${marker.position[0].toFixed(6)}</div>
                        <div class="time-info">${timeDisplay}</div>
                    </div>
                    <div class="marker-actions">
                        <button class="edit-btn" title="编辑">✏️</button>
                        <button class="delete-btn" title="删除">🗑️</button>
                    </div>
                `;

                item.querySelector('.marker-info').addEventListener('click', () => {
                    this.showMarkerDetail(marker);
                });

                item.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showMarkerDetail(marker);
                });

                item.querySelector('.delete-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const result = await this.showSwalConfirm('删除确认', `确定要删除标记点"${marker.title}"吗？`, '删除', '取消');
                    if (result.isConfirmed) {
                        this.removeMarker(marker);
                    }
                });

                listContainer.appendChild(item);
            });
        }
    }

    updateConnections() {
        this.connections.forEach(conn => {
            // 通过ID获取当前的起始点和终点对象
            const startMarker = this.markers.find(m => m.id === conn.startId);
            const endMarker = this.markers.find(m => m.id === conn.endId);

            if (!startMarker || !endMarker || !startMarker.position || !endMarker.position) {
                console.warn('连接线数据不完整:', conn);
                return;
            }

            const startLat = parseFloat(startMarker.position[0]);
            const startLng = parseFloat(startMarker.position[1]);
            const endLat = parseFloat(endMarker.position[0]);
            const endLng = parseFloat(endMarker.position[1]);

            if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
                console.error('连接线坐标无效:', startMarker.position, endMarker.position);
                return;
            }

            const newPath = [
                [startLat, startLng],
                [endLat, endLng]
            ];
            conn.polyline.setLatLngs(newPath);

            // 更新终点圆点位置
            if (conn.endCircle) {
                conn.endCircle.setLatLng([endLat, endLng]);
            }

            // 更新图标位置（中点）
            if (conn.iconMarker) {
                const fallbackMidLat = (startLat + endLat) / 2;
                const fallbackMidLng = (startLng + endLng) / 2;
                const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
                conn.iconMarker.setLatLng(midPos);
            }

            // 更新箭头位置
            if (conn.arrowHead) {
                const newArrow = this.createArrowHead(startMarker.position, endMarker.position, conn.transportType);
                conn.arrowHead.remove();
                conn.arrowHead = newArrow;
                conn.arrowHead.addTo(this.map);
            }
        });
    }

    updateLabels() {
        this.labels.forEach(labelData => {
            labelData.label.setLatLng([labelData.marker.position[0], labelData.marker.position[1]]);
        });
    }

    // 保存到本地存储
    saveToLocalStorage() {
        const data = {
            version: window.ROADBOOK_APP_VERSION || 'unknown',
            saveTime: new Date().toISOString(),
            currentLayer: this.currentLayer, // 保存当前地图源
            currentSearchMethod: this.currentSearchMethod, // 保存当前搜索方式
            markers: this.markers.map((m) => ({
                id: m.id,
                position: m.position,
                title: m.title,
                labels: m.labels, // 现在labels是字符串数组，直接导出
                logo: m.logo, // 保存logo属性
                createdAt: m.createdAt,
                dateTimes: m.dateTimes || [m.dateTime], // 导出多个时间点
                icon: m.icon // 导出图标信息
            })),
            connections: this.connections.map(c => {
                // 通过ID获取实际的标记点对象（为了兼容性）
                const startMarker = this.markers.find(m => m.id === c.startId);
                const endMarker = this.markers.find(m => m.id === c.endId);

                return {
                    id: c.id,
                    startId: c.startId, // 使用ID而不是索引
                    endId: c.endId,     // 使用ID而不是索引
                    transportType: c.transportType,
                    dateTime: c.dateTime,
                    label: c.label,
                    logo: c.logo, // 保存logo属性
                    duration: c.duration || 0, // 保存耗时信息
                    startTitle: startMarker ? startMarker.title : c.startTitle,
                    endTitle: endMarker ? endMarker.title : c.endTitle
                };
            }),
            labels: this.labels.map(l => ({
                markerIndex: this.markers.indexOf(l.marker),
                content: l.content
            })),
            dateNotes: this.dateNotes || {}, // 保存日期备注信息
            lastDateRange: this.lastDateRange // 保存上次使用的日期范围
        };

        try {
            // console.log('开始保存到本地存储，标记点数量:', this.markers.length);
            // if (this.markers.length > 0) {
            //     this.markers.forEach((marker, index) => {
            //         console.log(`保存标记点 ${index}: ID=${marker.id}, 位置=${marker.position}, 标题=${marker.title}`);
            //     });
            // }

            localStorage.setItem('roadbookData', JSON.stringify(data));
            // console.log('路书数据已保存到本地存储');

            // 验证保存的数据
            const savedData = localStorage.getItem('roadbookData');
            const parsedData = JSON.parse(savedData);
            console.log('验证保存的数据:', parsedData);
        } catch (error) {
            console.error('保存到本地存储失败:', error);
        }
    }

    // 从本地存储加载数据
    loadFromLocalStorage() {
        try {
            const savedData = localStorage.getItem('roadbookData');
            if (savedData) {
                const data = JSON.parse(savedData);
                console.log('从本地存储加载路书数据');
                console.log('本地存储数据:', data);

                // 检查标记点位置数据
                // if (data.markers && data.markers.length > 0) {
                //     data.markers.forEach((marker, index) => {
                //         console.log(`标记点 ${index}: ID=${marker.id}, 位置=${marker.position}, 标题=${marker.title}`);
                //     });
                // }

                // 直接加载本地缓存数据，不显示导入提示
                this.loadRoadbook(data, false);

                // 加载日期备注信息
                if (data.dateNotes) {
                    this.dateNotes = data.dateNotes;
                } else {
                    this.dateNotes = {};
                }

                // 加载上次使用的日期范围
                if (data.lastDateRange) {
                    this.lastDateRange = data.lastDateRange;
                }

                // 恢复地图源和搜索方式（如果存在）
                // 注意：我们先更新内部状态，然后再更新UI，避免触发change事件
                if (data.currentLayer) {
                    this.currentLayer = data.currentLayer; // 先更新内部状态
                    this.switchMapSourceWithoutSaving(data.currentLayer); // 然后切换图层
                }

                if (data.currentSearchMethod) {
                    this.currentSearchMethod = data.currentSearchMethod;
                }

                // 标记正在更新UI，避免触发保存事件
                this.updatingUI = true;

                // 确保UI下拉框立即显示正确的值，但要避免触发change事件
                this.updateUISelectsNoEvent(data.currentLayer, data.currentSearchMethod);

                // 延迟清除标记，确保UI更新完成
                setTimeout(() => {
                    this.updatingUI = false;
                }, 100);

                // 延迟执行自动调整视窗，确保所有元素都已渲染
                setTimeout(() => {
                    this.autoFitMapView();
                }, 500);
            } else {
                console.log('没有找到本地缓存数据');

                // 确保UI下拉框显示默认值
                this.updateUISelectsNoEvent(this.currentLayer, this.currentSearchMethod);
            }
        } catch (error) {
            console.error('从本地存储加载数据失败:', error);
        }
    }

    // 不保存到本地存储的切换地图源方法，避免在加载缓存时触发事件
    switchMapSourceWithoutSaving(newSource) {
        if (!this.mapLayers[newSource]) {
            console.error('不支持的地图源:', newSource);
            return;
        }

        // 移除当前图层
        if (this.currentLayer && this.mapLayers[this.currentLayer]) {
            this.map.removeLayer(this.mapLayers[this.currentLayer]);
        }

        // 切换到新图层
        this.currentLayer = newSource;
        this.mapLayers[this.currentLayer].addTo(this.map);

        // 更新搜索框状态
        this.updateSearchInputState();

        console.log('地图源已切换到:', newSource);
    }

    // 更新UI下拉框的辅助方法，不触发事件
    updateUISelectsNoEvent(currentLayer, currentSearchMethod) {
        // 确保DOM元素存在后再更新
        if (document.readyState === 'loading') {
            // 如果DOM还未完全加载，等待加载完成
            document.addEventListener('DOMContentLoaded', () => {
                this.setSelectValuesNoEvent(currentLayer, currentSearchMethod);
            });
        } else {
            // DOM已加载，直接更新
            this.setSelectValuesNoEvent(currentLayer, currentSearchMethod);
        }
    }

    // 设置下拉框值的辅助方法，不触发change事件
    setSelectValuesNoEvent(currentLayer, currentSearchMethod) {
        const mapSourceSelect = document.getElementById('mapSourceSelect');
        if (mapSourceSelect) {
            // 使用传入的值或当前值或默认值
            const layer = currentLayer || this.currentLayer || 'osm';
            mapSourceSelect.value = layer;
        }

        const searchMethodSelect = document.getElementById('searchMethodSelect');
        if (searchMethodSelect) {
            // 使用传入的值或当前值或默认值
            const method = currentSearchMethod || this.currentSearchMethod || 'auto';
            searchMethodSelect.value = method;
        }
    }

    // 搜索地点
    searchLocation(query) {
        if (!query.trim()) {
            // 隐藏搜索结果下拉框
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                searchResults.style.display = 'none';
            }
            return;
        }

        this.fetchSearchResults(query)
            .then(data => {
                if (Array.isArray(data) && data.length > 0) {
                    // Check if it's Photon GeoJSON features or standard list
                    if (data[0].geometry && data[0].properties) {
                         this.showPhotonSearchResults(data);
                    } else {
                         this.showSearchResults(data);
                    }
                } else if (data && data.features && data.features.length > 0) {
                    // Photon raw response
                    this.showPhotonSearchResults(data.features);
                } else {
                    // 没有找到结果，显示提示
                    const searchResults = document.getElementById('searchResults');
                    if (searchResults) {
                        const resultsList = document.getElementById('resultsList');
                        if (resultsList) {
                            resultsList.innerHTML = '<li style="padding: 12px 15px; color: #999; cursor: default;">未找到相关地点，请尝试其他关键词</li>';
                        }
                        searchResults.style.display = 'block';
                    }
                }
            })
            .catch(error => {
                console.error('搜索地点时出错:', error);
                // 显示错误信息
                const searchResults = document.getElementById('searchResults');
                if (searchResults) {
                    const resultsList = document.getElementById('resultsList');
                    if (resultsList) {
                        let errorMessage = '搜索失败，请检查网络连接';

                        // 提取状态码
                        const statusMatch = error.message.match(/(\d{3})/);
                        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

                        if (statusCode === 401) {
                            errorMessage = '搜索失败：未授权，请登录。';
                        } else if (statusCode === 403) {
                            errorMessage = '搜索失败：无权限，请检查API密钥或配置。';
                        } else if (statusCode === 400) {
                            errorMessage = '搜索失败：请求参数错误。';
                        } else if (statusCode === 404) {
                            errorMessage = '搜索失败：服务或资源未找到。';
                        } else if (error.message.includes('API Error')) {
                             const apiErrorMessage = error.message.replace(/Search API Error: |Overpass API Error: /, '');
                             errorMessage = `搜索失败：${apiErrorMessage}`;
                        } else if (error.message.includes('timeout') || error.name === 'AbortError') {
                             errorMessage = '搜索请求超时，请稍后再试。';
                        } else if (error.message === 'Search config error') {
                             errorMessage = '搜索方式配置错误';
                        } else if (error.message === 'Search not supported') {
                             errorMessage = '当前地图不支持搜索';
                        }

                        resultsList.innerHTML = `<li style="padding: 12px 15px; color: #999; cursor: default;">${errorMessage}</li>`;
                    }
                    searchResults.style.display = 'block';
                }
            });
    }

    // AI Helper: Search location and return data
    async aiSearchLocation(query) {
        try {
            const results = await this.fetchSearchResults(query);
            let formattedResults = [];

            if (Array.isArray(results)) {
                if (results.length > 0 && results[0].geometry && results[0].properties) {
                    // Photon/GeoJSON features
                    formattedResults = results.slice(0, 3).map(f => ({
                        name: f.properties.name || f.properties.street || 'Unknown',
                        lat: f.geometry.coordinates[1],
                        lng: f.geometry.coordinates[0],
                        address: [f.properties.city, f.properties.country].filter(Boolean).join(', ')
                    }));
                } else {
                    // Standard results
                    formattedResults = results.slice(0, 3).map(r => ({
                        name: r.display_name || r.name,
                        lat: parseFloat(r.lat),
                        lng: parseFloat(r.lon),
                        type: r.type
                    }));
                }
            } else if (results && results.features) {
                 // Photon raw response
                 formattedResults = results.features.slice(0, 3).map(f => ({
                    name: f.properties.name || f.properties.street || 'Unknown',
                    lat: f.geometry.coordinates[1],
                    lng: f.geometry.coordinates[0],
                    address: [f.properties.city, f.properties.country].filter(Boolean).join(', ')
                }));
            }

            return formattedResults;
        } catch (e) {
            console.error('AI Search failed:', e);
            return [];
        }
    }

    // 核心搜索逻辑，返回Promise
    async fetchSearchResults(query) {
        // 使用当前选择的搜索方法
        let searchConfig;

        if (this.currentSearchMethod === 'auto') {
            // 自动模式：检查当前地图是否支持搜索
            const currentMapConfig = this.mapSearchConfig[this.currentLayer];
            if (!currentMapConfig || !currentMapConfig.searchable) {
                return Promise.reject(new Error('Search not supported'));
            }
            searchConfig = currentMapConfig;
        } else if (this.currentSearchMethod === 'nominatim') {
            // Nominatim搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: 'https://nominatim.openstreetmap.org/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim',
                name: 'Nominatim'
            };
        } else if (this.currentSearchMethod === 'overpass') {
            // Overpass搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: 'https://overpass-api.de/api/interpreter',
                parser: 'overpass',
                name: 'Overpass'
            };
        } else if (this.currentSearchMethod === 'photon') {
            // Photon搜索模式（原Google搜索）
            searchConfig = {
                searchable: true,
                searchUrl: 'https://photon.komoot.io/api/',
                params: {
                    limit: 10
                },
                parser: 'photon',
                name: 'Photon'
            };
        } else if (this.currentSearchMethod === 'mapsearch') {
            // MapSearch搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: 'https://map.011203.dpdns.org/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim', // 使用Nominatim格式，因为MapSearch与Nominatim格式一致
                name: 'MapSearch'
            };
        } else if (this.currentSearchMethod === 'gaode') {
            // Gaode Search
            searchConfig = {
                searchable: true,
                searchUrl: apiBaseUrl + '/api/gaode/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim',
                name: '高德'
            };
        } else if (this.currentSearchMethod === 'cnsearch') {
            // CNSearch搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: apiBaseUrl + '/api/cnmap/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim', // 使用Nominatim格式，因为CNSearch与Nominatim格式一致
                name: '百度'
            };
        } else if (this.currentSearchMethod === 'tiansearch') {
            // TianSearch搜索模式
            searchConfig = {
                searchable: true,
                searchUrl: apiBaseUrl + '/api/tianmap/search',
                params: {
                    format: 'json',
                    limit: 10
                },
                parser: 'nominatim', // 使用Nominatim格式，因为TianSearch与Nominatim格式一致
                name: '天地图'
            };
        } else {
            return Promise.reject(new Error('Search config error'));
        }

        let url;

        if (searchConfig.parser === 'overpass') {
            // 构建Overpass API查询 - 使用英文搜索
            const overpassQuery = `[out:json];(
                node['name:en'~'${query}',i]['place'~'city|town|village'];
                node['name:zh'~'${query}',i]['place'~'city|town|village'];
                node['name'~'${query}',i]['place'~'city|town|village'];
                way['name:en'~'${query}',i]['place'~'city|town|village'];
                way['name:zh'~'${query}',i]['place'~'city|town|village'];
                way['name'~'${query}',i]['place'~'city|town|village'];
                relation['name:en'~'${query}',i]['place'~'city|town|village'];
                relation['name:zh'~'${query}',i]['place'~'city|town|village'];
                relation['name'~'${query}',i]['place'~'city|town|village'];
            );out center;`;

            url = `${searchConfig.searchUrl}?data=${encodeURIComponent(overpassQuery)}`;
            const response = await fetch(url);
            if (!response.ok) {
                try {
                    const errData = await response.json();
                    throw new Error(`Overpass API Error: ${response.status} ${errData.message || response.statusText}`);
                } catch {
                    throw new Error(`Overpass API Error: ${response.status} ${response.statusText}`);
                }
            }
            const data = await response.json();
            if (data && data.elements && data.elements.length > 0) {
                return this.convertOverpassToSearchResults(data.elements);
            }
            return [];
        } else {
            // 原有的Nominatim/Photon/Backend search logic
            const params = new URLSearchParams({
                ...searchConfig.params,
                q: query
            });

            // Prepare headers, including Authorization if JWT token exists
            const headers = {
                'Content-Type': 'application/json',
            };
            const jwtToken = localStorage.getItem('online_token');
            if (jwtToken) {
                headers['Authorization'] = `Bearer ${jwtToken}`;
            }

            url = `${searchConfig.searchUrl}?${params.toString()}`;
            const response_1 = await fetch(url, {headers});
            if (!response_1.ok) {
                try {
                    const errData_1 = await response_1.json();
                    throw new Error(`${searchConfig.name || 'Search'} API Error: ${response_1.status} ${errData_1.message || errData_1.error || response_1.statusText}`);
                } catch {
                    throw new Error(`${searchConfig.name || 'Search'} API Error: ${response_1.status} ${response_1.statusText}`);
                }
            }
            return await response_1.json();
        }
    }

    // 显示Photon搜索结果下拉框
    showPhotonSearchResults(features) {
        const searchResults = document.getElementById('searchResults');
        const resultsList = document.getElementById('resultsList');

        if (!searchResults || !resultsList) return;

        // 清空现有结果
        resultsList.innerHTML = '';

        // 添加搜索结果到列表
        features.forEach((feature) => {
            const li = document.createElement('li');
            const name = feature.properties.name || feature.properties.street || '未知地点';
            const city = feature.properties.city || '';
            const country = feature.properties.country || '';

            let address = '';
            if (city && country) {
                address = `${city}, ${country}`;
            } else if (city) {
                address = city;
            } else if (country) {
                address = country;
            }

            li.innerHTML = `
                <div class="result-title">${name}</div>
                <div class="result-address">${address || '地点'}</div>
            `;

            // 添加点击事件
            li.addEventListener('click', () => {
                this.selectPhotonSearchResult(feature);
            });

            resultsList.appendChild(li);
        });

        // 显示搜索结果下拉框
        searchResults.style.display = 'block';
    }

    // 选择Photon搜索结果
    selectPhotonSearchResult(feature) {
        const coordinates = feature.geometry.coordinates;
        const lat = coordinates[1];
        const lon = coordinates[0];

        if (!isNaN(lat) && !isNaN(lon)) {
            // 聚焦到搜索结果位置
            this.map.setView([lat, lon], 15); // 缩放级别15适合城市级别

            // 在搜索结果位置添加一个临时标记点来显示结果
            if (this.searchMarker) {
                this.map.removeLayer(this.searchMarker);
            }

            const name = feature.properties.name || feature.properties.street || '搜索结果';
            this.searchMarker = L.marker([lat, lon])
                .addTo(this.map)
                .bindPopup(name)
                .openPopup();

            // 添加点击事件以聚焦视图
            this.searchMarker.on('click', () => {
                this.map.setView([lat, lon], 15);
            });

            // 3秒后自动关闭弹窗
            if (this.searchPopupTimeout) {
                clearTimeout(this.searchPopupTimeout);
            }
            this.searchPopupTimeout = setTimeout(() => {
                if (this.searchMarker) {
                    this.map.closePopup(this.searchMarker.getPopup());
                }
                this.searchPopupTimeout = null;
            }, 3000);

            // 隐藏搜索结果下拉框
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                searchResults.style.display = 'none';
            }

            console.log(`已选择Photon搜索结果: ${name} (${lat}, ${lon})`);
        } else {
            this.showSwalAlert('错误', '未能获取有效的地理位置信息', 'error');
        }
    }

    // 转换Overpass API结果为标准格式
    convertOverpassToSearchResults(elements) {
        return elements.map(element => {
            let lat, lon, name, display_name;

            if (element.type === 'node') {
                lat = element.lat;
                lon = element.lon;
            } else if (element.type === 'way' || element.type === 'relation') {
                // 对于way和relation，使用center坐标
                if (element.center) {
                    lat = element.center.lat;
                    lon = element.center.lon;
                }
            }

            // 获取名称
            if (element.tags) {
                name = element.tags.name || element.tags['name:zh'] || element.tags['name:en'] || '未知地点';

                // 构建显示名称
                display_name = name;
                if (element.tags['addr:city']) {
                    display_name += `, ${element.tags['addr:city']}`;
                }
                if (element.tags['addr:country']) {
                    display_name += `, ${element.tags['addr:country']}`;
                }
            }

            return {
                lat: lat,
                lon: lon,
                display_name: display_name || name,
                name: name,
                type: element.tags && element.tags.place ? element.tags.place : 'unknown'
            };
        }).filter(result => result.lat && result.lon); // 只保留有坐标的结果
    }

    // 显示搜索结果下拉框
    showSearchResults(results) {
        const searchResults = document.getElementById('searchResults');
        const resultsList = document.getElementById('resultsList');

        if (!searchResults || !resultsList) return;

        // 清空现有结果
        resultsList.innerHTML = '';

        // 添加搜索结果到列表
        results.forEach((result) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div class="result-title">${result.display_name}</div>
                <div class="result-address">${result.type || result.class || '地点'}</div>
            `;

            // 添加点击事件
            li.addEventListener('click', () => {
                this.selectSearchResult(result);
            });

            resultsList.appendChild(li);
        });

        // 显示搜索结果下拉框
        searchResults.style.display = 'block';
    }

    // 选择搜索结果
    selectSearchResult(result) {
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        if (!isNaN(lat) && !isNaN(lon)) {
            // 聚焦到搜索结果位置
            this.map.setView([lat, lon], 15); // 缩放级别15适合城市级别

            // 在搜索结果位置添加一个临时标记点来显示结果
            if (this.searchMarker) {
                this.map.removeLayer(this.searchMarker);
            }

            this.searchMarker = L.marker([lat, lon])
                .addTo(this.map)
                .bindPopup(result.display_name)
                .openPopup();

            // 添加点击事件以聚焦视图
            this.searchMarker.on('click', () => {
                this.map.setView([lat, lon], 15);
            });

            // 3秒后自动关闭弹窗
            if (this.searchPopupTimeout) {
                clearTimeout(this.searchPopupTimeout);
            }
            this.searchPopupTimeout = setTimeout(() => {
                if (this.searchMarker) {
                    this.map.closePopup(this.searchMarker.getPopup());
                }
                this.searchPopupTimeout = null;
            }, 3000);

            // 隐藏搜索结果下拉框
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                searchResults.style.display = 'none';
            }

            console.log(`已选择搜索结果: ${result.display_name} (${lat}, ${lon})`);
        } else {
            this.showSwalAlert('错误', '未能获取有效的地理位置信息', 'error');
        }
    }

    async clearCache() {
        const result = await this.showSwalConfirm('清除确认', '确定要清除本地缓存吗？此操作将删除所有已保存的数据，无法恢复。', '清除', '取消');
        if (result.isConfirmed) {
            try {
                localStorage.removeItem('roadbookData');
                // 清除当前数据
                this.clearAll();
                this.showSwalAlert('成功', '本地缓存已清除！', 'success');
            } catch (error) {
                console.error('清除本地缓存失败:', error);
                this.showSwalAlert('错误', '清除本地缓存失败！', 'error');
            }
        }
    }

    exportRoadbook() {
        const data = {
            version: window.ROADBOOK_APP_VERSION || 'unknown',
            exportTime: new Date().toISOString(),
            currentLayer: this.currentLayer, // 导出当前地图源
            currentSearchMethod: this.currentSearchMethod, // 导出当前搜索方式
            markers: this.markers.map((m) => ({
                id: m.id,
                position: m.position,
                title: m.title,
                labels: m.labels, // 现在labels是字符串数组，直接导出
                logo: m.logo, // 保存logo属性
                createdAt: m.createdAt,
                dateTimes: m.dateTimes || [m.dateTime], // 导出多个时间点
                icon: m.icon // 导出图标信息
            })),
            connections: this.connections.map(c => {
                // 通过ID获取实际的标记点对象（为了兼容性）
                const startMarker = this.markers.find(m => m.id === c.startId);
                const endMarker = this.markers.find(m => m.id === c.endId);

                return {
                    id: c.id,
                    startId: c.startId, // 使用ID而不是索引
                    endId: c.endId,     // 使用ID而不是索引
                    transportType: c.transportType,
                    dateTime: c.dateTime,
                    label: c.label,
                    logo: c.logo, // 保存logo属性
                    duration: c.duration || 0, // 保存耗时信息
                    startTitle: startMarker ? startMarker.title : c.startTitle,
                    endTitle: endMarker ? endMarker.title : c.endTitle
                };
            }),
            labels: this.labels.map(l => ({
                markerIndex: this.markers.indexOf(l.marker),
                content: l.content
            })),
            dateNotes: this.dateNotes || {} // 包含日期备注信息
        };

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `roadbook_${new Date().toISOString().slice(0, 10)}_${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);
    }



    importRoadbook(file) {
        if (!file) return;

        // 检查是否是HTML文件
        if (file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')) {
            // If html_export.js is loaded, use the new module
            if (typeof RoadbookHtmlExporter !== 'undefined' && window.htmlExporter) {
                window.htmlExporter.importFromHtml(file);
            } else {
                this.importFromHtml(file); // fallback to old method
            }
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                // 调用loadRoadbook方法加载数据
                this.loadRoadbook(data, true); // 明确指定这是手动导入

                // 确保UI下拉框显示正确的值（导入后）
                setTimeout(() => {
                    if (data.currentLayer) {
                        this.switchMapSource(data.currentLayer);
                        const mapSourceSelect = document.getElementById('mapSourceSelect');
                        if (mapSourceSelect) {
                            mapSourceSelect.value = data.currentLayer;
                        }
                    }

                    if (data.currentSearchMethod) {
                        this.currentSearchMethod = data.currentSearchMethod;
                        const searchMethodSelect = document.getElementById('searchMethodSelect');
                        if (searchMethodSelect) {
                            searchMethodSelect.value = data.currentSearchMethod;
                        }
                    }
                }, 100); // 稍微延时以确保数据加载完成

            } catch (error) {
                this.showSwalAlert('错误', '文件格式错误！', 'error');
            }
        };
        reader.readAsText(file);
    }

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
                        this.showSwalAlert('错误', 'HTML文件中未找到路书数据！', 'error');
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
                this.showSwalAlert('错误', 'HTML文件格式错误或数据损坏！', 'error');
            }
        };
        reader.readAsText(file);
    }

    processImportedData(data) {
        // 调用loadRoadbook方法加载数据
        this.loadRoadbook(data, true); // 明确指定这是手动导入

        // 确保UI下拉框显示正确的值（导入后）
        setTimeout(() => {
            if (data.currentLayer) {
                this.switchMapSource(data.currentLayer);
                const mapSourceSelect = document.getElementById('mapSourceSelect');
                if (mapSourceSelect) {
                    mapSourceSelect.value = data.currentLayer;
                }
            }

            if (data.currentSearchMethod) {
                this.currentSearchMethod = data.currentSearchMethod;
                const searchMethodSelect = document.getElementById('searchMethodSelect');
                if (searchMethodSelect) {
                    searchMethodSelect.value = data.currentSearchMethod;
                }
            }
        }, 100); // 稍微延时以确保数据加载完成
    }

    /**
     * 比较两个版本号的大小
     * @param {string} v1 - 例如 "v0.0.9-4-gb666551"
     * @param {string} v2 - 例如 "v0.0.10"
     * @returns {number} 1: v1 > v2, -1: v1 < v2, 0: 相等或无法比较
     */
    compareVersions(v1, v2) {
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
    }

    loadRoadbook(data, isImport = true) {
        // 清除现有数据
        this.clearAll();

        let versionWarning = null;

        // 版本兼容性检查
        if (data.version) {
            console.log(`导入路书版本: ${data.version}`);

            // 只有在手动导入时才提示版本问题
            if (isImport) {
                const currentVersion = window.ROADBOOK_APP_VERSION;

                // 确保当前版本不是 unknown 且格式正确
                if (currentVersion && currentVersion !== 'unknown') {
                    const compareResult = this.compareVersions(data.version, currentVersion);

                    if (compareResult === 1) { // 导入版本 > 当前版本
                        versionWarning = `⚠️ 版本警告: 导入的数据版本 (${data.version}) 高于当前应用版本 (${currentVersion})。<br>可能包含当前版本不支持的特性，建议升级应用。`;
                        console.warn(versionWarning.replace(/<br>/g, '\n'));
                    }
                }
            }
        }

        // 加载标记点
        data.markers.forEach(markerData => {
            // console.log(`加载标记点: ID=${markerData.id}, 位置=${markerData.position}, 标题=${markerData.title}`);

            // 使用导入的图标信息或默认图标
            const iconConfig = markerData.icon || { type: 'default', icon: '📍', color: '#667eea' };
            const icon = this.createMarkerIcon(iconConfig, this.markers.length + 1);

            const marker = L.marker([markerData.position[0], markerData.position[1]], {
                icon: icon,
                draggable: !this.isMobileDevice(),
                title: markerData.title
            }).addTo(this.map);

            const markerObj = {
                id: markerData.id,
                marker: marker,
                position: markerData.position,
                title: markerData.title,
                labels: markerData.labels || [], // 导入labels数组
                logo: markerData.logo || null, // 导入logo属性
                icon: markerData.icon || { type: 'default', icon: '📍', color: '#667eea' }, // 导入图标信息
                createdAt: markerData.createdAt,
                dateTimes: markerData.dateTimes || [markerData.dateTime], // 导入多个时间点
                dateTime: markerData.dateTimes ? markerData.dateTimes[0] : markerData.dateTime // 兼容旧版本
            };

            this.markers.push(markerObj);

            // 添加事件监听
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (this.isMobileDevice()) {
                    const popupContent = this.generateMarkerPopupContent(markerObj);
                    marker.bindPopup(popupContent).openPopup();
                } else {
                    this.showMarkerDetail(markerObj);
                }
            });

            marker.on('mouseover', (e) => {
                if (e.target.getElement()) {
                    e.target.getElement()._savedTitle = e.target.getElement().getAttribute('title');
                    e.target.getElement().removeAttribute('title');
                }
                this.showMarkerTooltip(markerObj, e.latlng, e);
            });

            marker.on('mouseout', (e) => {
                if (e.target.getElement() && e.target.getElement()._savedTitle) {
                    e.target.getElement().setAttribute('title', e.target.getElement()._savedTitle);
                }
                this.hideMarkerTooltip();
            });

            marker.on('dragend', (e) => {
                const newPos = e.target.getLatLng();
                markerObj.position = [newPos.lat, newPos.lng];

                console.log(`导入拖拽事件触发 - 标记点ID: ${markerObj.id}, 新坐标: [${newPos.lat}, ${newPos.lng}]`);

                // 更新连接线
                this.updateConnections();

                // 更新标注位置
                this.updateLabels();

                // 如果当前标记点正在详情面板中显示，更新坐标显示
                if (this.currentMarker === markerObj) {
                    const markerCoords = document.getElementById('markerCoords');
                    if (markerCoords) {
                        markerCoords.textContent =
                            `${newPos.lng.toFixed(6)}, ${newPos.lat.toFixed(6)}`;
                    }
                }

                // 更新标记点列表中的坐标显示
                this.updateMarkerList();

                console.log(`导入的标记点"${markerObj.title}"坐标已更新: ${newPos.lat.toFixed(6)}, ${newPos.lng.toFixed(6)}`);

                // 保存到本地存储
                this.saveToLocalStorage();
                console.log(`导入标记点拖拽后本地存储已保存`);
            });
        });

        // 加载连接线
        data.connections.forEach(connData => {
            // 对于老版本的数据，使用startIndex和endIndex
            let startMarker, endMarker;
            if (connData.startIndex !== undefined && connData.endIndex !== undefined) {
                startMarker = this.markers[connData.startIndex];
                endMarker = this.markers[connData.endIndex];
            } else if (connData.startId !== undefined && connData.endId !== undefined) {
                // 对于新版本的数据，使用ID查找
                startMarker = this.markers.find(m => m.id === connData.startId);
                endMarker = this.markers.find(m => m.id === connData.endId);
            }

            if (!startMarker || !endMarker) {
                console.warn('无法找到连接的起始或结束标记点', connData);
                return;
            }

            // 创建连接线
            const polyline = L.polyline([
                [startMarker.position[0], startMarker.position[1]],
                [endMarker.position[0], endMarker.position[1]]
            ], {
                color: this.getTransportColor(connData.transportType),
                weight: 6,
                opacity: 1.0,
                smoothFactor: 1.0
            }).addTo(this.map);

            // 添加终点标记（小圆点）
            const endCircle = L.circleMarker([endMarker.position[0], endMarker.position[1]], {
                radius: 6,
                fillColor: this.getTransportColor(connData.transportType),
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 1
            }).addTo(this.map);

            // 创建箭头
            const arrowHead = this.createArrowHead(startMarker.position, endMarker.position, connData.transportType);
            arrowHead.addTo(this.map);

            // 计算中点位置并添加交通图标
            const startLat = parseFloat(startMarker.position[0]);
            const startLng = parseFloat(startMarker.position[1]);
            const endLat = parseFloat(endMarker.position[0]);
            const endLng = parseFloat(endMarker.position[1]);

            if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
                console.error('导入连接线坐标无效:', startMarker.position, endMarker.position);
                return;
            }

            const fallbackMidLat = (startLat + endLat) / 2;
            const fallbackMidLng = (startLng + endLng) / 2;
            const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
            const transportIcon = this.getTransportIcon(connData.transportType);

            const iconMarker = L.marker(midPos, {
                icon: L.divIcon({
                    className: 'transport-icon',
                    html: `<div style="background-color: white; border: 2px solid ${this.getTransportColor(connData.transportType)}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${transportIcon}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                })
            }).addTo(this.map);

            const connection = {
                id: connData.id,
                startId: startMarker.id, // 使用ID而不是对象引用
                endId: endMarker.id,     // 使用ID而不是对象引用
                transportType: connData.transportType,
                polyline: polyline,
                endCircle: endCircle,
                iconMarker: iconMarker,
                arrowHead: arrowHead,
                dateTime: connData.dateTime || this.getCurrentLocalDateTime(),
                label: connData.label || '',
                logo: connData.logo || null, // 导入logo属性
                duration: connData.duration || 0, // 加载耗时信息
                startTitle: connData.startTitle || startMarker.title,
                endTitle: connData.endTitle || endMarker.title
            };

            // 添加连接线事件
        const self = this;
        polyline.on('click', function(e) {
            L.DomEvent.stopPropagation(e);
            if (self.isMobileDevice()) {
                const startMarker = self.markers.find(m => m.id === connection.startId);
                const endMarker = self.markers.find(m => m.id === connection.endId);
                const popupContent = self.generateConnectionPopupContent(connection, startMarker, endMarker);
                polyline.bindPopup(popupContent).openPopup();
            } else {
                self.showConnectionDetail(connection);
            }
        });

            polyline.on('mouseover', function(e) {
                self.showConnectionTooltip(connection, e.latlng, e);
            });

            polyline.on('mouseout', function() {
                self.hideConnectionTooltip();
            });

            // 绑定图标点击事件
            iconMarker.on('click', function(e) {
                L.DomEvent.stopPropagation(e);
                if (self.isMobileDevice()) {
                    const startMarker = self.markers.find(m => m.id === connection.startId);
                    const endMarker = self.markers.find(m => m.id === connection.endId);
                    const popupContent = self.generateConnectionPopupContent(connection, startMarker, endMarker);
                    // Use polyline's popup but trigger from icon marker
                    polyline.bindPopup(popupContent).openPopup();
                } else {
                    self.showConnectionDetail(connection);
                }
            });
            iconMarker.on('mouseover', function(e) {
                self.showConnectionTooltip(connection, e.latlng, e);
            });
            iconMarker.on('mouseout', function() {
                self.hideConnectionTooltip();
            });

            this.connections.push(connection);
        });

        // 加载独立标注（兼容旧版本）
        if (data.labels) {
            data.labels.forEach(labelData => {
                const marker = this.markers[labelData.markerIndex];
                if (marker && labelData.content) {
                    this.createLabelForMarker(marker, labelData.content);
                }
            });
        }

        // 加载日期备注信息
        if (data.dateNotes) {
            this.dateNotes = data.dateNotes;
        } else {
            this.dateNotes = {};
        }

        // 加载上次使用的日期范围
        if (data.lastDateRange) {
            this.lastDateRange = data.lastDateRange;
        }

        this.updateMarkerList();

        const markerCount = this.markers.length;
        const connectionCount = this.connections.length;

        // 保存到本地存储
        this.saveToLocalStorage();

        // 只在手动导入文件时显示提示
        if (isImport) {
            let title = '导入成功';
            let message = `路书导入成功！\n标记点: ${markerCount} 个\n连接线: ${connectionCount} 条`;
            let icon = 'success';

            if (versionWarning) {
                // 如果有版本警告，使用 HTML 显示，并改变样式
                message = `路书导入成功！<br>标记点: ${markerCount} 个<br>连接线: ${connectionCount} 条<br><br><span style="color: #856404; background-color: #fff3cd; padding: 10px; border-radius: 4px; display: inline-block; text-align: left; font-size: 0.9em; border: 1px solid #ffeeba; width: 100%; box-sizing: border-box;">${versionWarning}</span>`;
            }

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: title,
                    html: versionWarning ? message : message.replace(/\n/g, '<br>'),
                    icon: icon,
                    confirmButtonText: '确定',
                    confirmButtonColor: '#667eea'
                });
            } else {
                this.showSwalAlert(title, message.replace(/<br>/g, '\n'), icon);
            }
        }

        // 自动调整视窗以包含所有元素（取代定位到第一个标记点）
        this.autoFitMapView();
    }

    // 为标记点创建标注的辅助方法
    createLabelForMarker(marker, content) {
        const label = L.divIcon({
            className: 'custom-label',
            html: `<div style="background-color: rgba(255,255,255,0.9); border: 2px solid #667eea; border-radius: 5px; padding: 8px; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 200px;">${content}</div>`,
            iconSize: [200, 'auto'],
            iconAnchor: [100, -10]
        });

        const labelMarker = L.marker([marker.position[0], marker.position[1]], {
            icon: label
        }).addTo(this.map);

        marker.labels.push(labelMarker);
        this.labels.push({ marker: marker, label: labelMarker, content: content });
    }

    // 自动调整地图视窗以包含所有元素
    autoFitMapView() {
        if (this.markers.length === 0 && this.connections.length === 0) {
            console.log('没有标记点和连接线，保持默认视窗');
            return;
        }

        console.log('开始自动调整地图视窗，标记点数量:', this.markers.length, '连接线数量:', this.connections.length);

        try {
            // 创建边界对象
            const bounds = L.latLngBounds();
            let hasValidPoints = false;

            // 添加所有标记点的坐标到边界
            this.markers.forEach(marker => {
                if (marker.position && marker.position.length >= 2) {
                    const lat = parseFloat(marker.position[0]);
                    const lng = parseFloat(marker.position[1]);
                    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                        bounds.extend([lat, lng]);
                        hasValidPoints = true;
                        // console.log(`添加标记点到边界: [${lat}, ${lng}]`);
                    } else {
                        console.warn(`无效的标记点坐标: [${lat}, ${lng}]`);
                    }
                }
            });

            // 添加所有连接线的坐标到边界
            this.connections.forEach(connection => {
                if (connection.polyline) {
                    try {
                        const latlngs = connection.polyline.getLatLngs();
                        if (Array.isArray(latlngs) && latlngs.length > 0) {
                            latlngs.forEach(latlng => {
                                if (latlng && typeof latlng.lat === 'number' && typeof latlng.lng === 'number') {
                                    const lat = parseFloat(latlng.lat);
                                    const lng = parseFloat(latlng.lng);
                                    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                                        bounds.extend([lat, lng]);
                                        hasValidPoints = true;
                                        // console.log(`添加连接线点到边界: [${lat}, ${lng}]`);
                                    }
                                }
                            });
                        }
                    } catch (err) {
                        console.warn('获取连接线坐标失败:', err);
                    }
                }
            });

            // 检查是否有有效的点
            if (!hasValidPoints) {
                console.warn('没有找到有效的坐标点');
                return;
            }

            // 检查边界是否有效
            if (bounds.isValid()) {
                // 计算合适的padding，根据标记点数量调整
                const markerCount = this.markers.length + this.connections.length;
                const basePadding = 50;
                const additionalPadding = Math.min(markerCount * 10, 100); // 最多额外增加100像素
                const padding = basePadding + additionalPadding;

                console.log(`调整地图视窗到边界，使用padding: ${padding}px`);

                // 获取边界的中心点和建议缩放级别
                const center = bounds.getCenter();
                const zoom = this.map.getBoundsZoom(bounds, false, [padding, padding]);

                console.log(`边界中心点: [${center.lat}, ${center.lng}], 建议缩放级别: ${zoom}`);

                // 延迟执行以确保所有元素都已渲染
                setTimeout(() => {
                    try {
                        this.map.fitBounds(bounds, {
                            padding: [padding, padding],
                            maxZoom: 16, // 最大缩放级别，避免过度放大
                            minZoom: 3,  // 最小缩放级别，避免缩放过小
                            animate: true,
                            duration: 1.5, // 动画持续时间1.5秒
                            easeLinearity: 0.25
                        });

                        console.log('地图视窗调整完成');
                    } catch (err) {
                        console.error('调整视窗时出错:', err);
                    }
                }, 400); // 400毫秒延迟，确保DOM完全更新

            } else {
                console.warn('边界无效，无法调整视窗');
            }

        } catch (error) {
            console.error('自动调整视窗时出错:', error);
        }
    }

    // 筛选后自动调整地图视窗以包含筛选后的元素
    autoFitMapViewAfterFilter() {
        if (!this.filterMode || !this.filteredDate) {
            console.log('不在筛选模式，使用常规自动调整视窗');
            this.autoFitMapView();
            return;
        }

        console.log('筛选模式下自动调整地图视窗，日期:', this.filteredDate);

        try {
            // 创建边界对象
            const bounds = L.latLngBounds();
            let hasValidPoints = false;

            // 添加筛选日期内的标记点坐标到边界
            this.markers.forEach(marker => {
                const markerDates = this.getMarkerAllDates(marker);
                if (markerDates.includes(this.filteredDate)) {
                    if (marker.position && marker.position.length >= 2) {
                        const lat = parseFloat(marker.position[0]);
                        const lng = parseFloat(marker.position[1]);
                        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                            bounds.extend([lat, lng]);
                            hasValidPoints = true;
                            console.log(`添加筛选后标记点到边界: [${lat}, ${lng}]`);
                        } else {
                            console.warn(`无效的筛选后标记点坐标: [${lat}, ${lng}]`);
                        }
                    }
                }
            });

            // 添加筛选日期内的连接线坐标到边界
            this.connections.forEach(connection => {
                const connectionDate = this.getDateKey(connection.dateTime);
                if (connectionDate === this.filteredDate && connection.polyline) {
                    try {
                        const latlngs = connection.polyline.getLatLngs();
                        if (Array.isArray(latlngs) && latlngs.length > 0) {
                            latlngs.forEach(latlng => {
                                if (latlng && typeof latlng.lat === 'number' && typeof latlng.lng === 'number') {
                                    const lat = parseFloat(latlng.lat);
                                    const lng = parseFloat(latlng.lng);
                                    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                                        bounds.extend([lat, lng]);
                                        hasValidPoints = true;
                                        console.log(`添加筛选后连接线点到边界: [${lat}, ${lng}]`);
                                    }
                                }
                            });
                        }
                    } catch (err) {
                        console.warn('获取筛选后连接线坐标失败:', err);
                    }
                }
            });

            // 检查是否有有效的点
            if (!hasValidPoints) {
                console.warn('筛选后没有找到有效的坐标点');

                // 如果筛选后没有点，可以保持当前视图或提供提示
                return;
            }

            // 检查边界是否有效
            if (bounds.isValid()) {
                // 计算合适的padding
                const basePadding = 50;

                console.log(`筛选后调整地图视窗到边界，使用padding: ${basePadding}px`);

                // 延迟执行以确保所有元素都已渲染
                setTimeout(() => {
                    try {
                        this.map.fitBounds(bounds, {
                            padding: [basePadding, basePadding],
                            maxZoom: 16, // 最大缩放级别，避免过度放大
                            minZoom: 3,  // 最小缩放级别，避免缩放过小
                            animate: true,
                            duration: 1.5, // 动画持续时间1.5秒
                            easeLinearity: 0.25
                        });

                        console.log('筛选后地图视窗调整完成');
                    } catch (err) {
                        console.error('筛选后调整视窗时出错:', err);
                    }
                }, 400); // 400毫秒延迟，确保DOM完全更新

            } else {
                console.warn('筛选后边界无效，无法调整视窗');
            }

        } catch (error) {
            console.error('筛选后自动调整视窗时出错:', error);
        }
    }

    clearAll() {
        // 清除所有标记点
        this.markers.forEach(marker => {
            marker.marker.remove();
            // 标注不再直接显示，无需删除
        });

        // 清除所有连接线
        this.connections.forEach(conn => {
            conn.polyline.remove();
            if (conn.endCircle) {
                conn.endCircle.remove();
            }
            if (conn.iconMarker) {
                conn.iconMarker.remove();
            }
            if (conn.arrowHead) {
                conn.arrowHead.remove();
            }
        });

        this.markers = [];
        this.connections = [];
        this.labels = [];
        this.dateNotes = {}; // 清除日期备注
        this.updateMarkerList();
    }

    // 清空路书数据和本地缓存
    clearRoadbook() {
        this.clearAll(); // 清除所有地图元素和内部数据
        localStorage.removeItem('roadbookData'); // 清除本地缓存
        console.log('路书数据和本地缓存已清空。');
    }

    async showMarkerContextMenu(markerData) {
        // 简单的右键菜单
        const result = await this.showSwalConfirm('删除确认', `要删除标记点"${markerData.title}"吗？`, '删除', '取消');
        if (result.isConfirmed) {
            this.removeMarker(markerData);
        }
    }

    removeConnection(connection) {
        if (!connection) return;

        // 记录删除连接操作到历史栈
        this.addHistory('removeConnection', {
            id: connection.id,
            startId: connection.startId,
            endId: connection.endId,
            transportType: connection.transportType,
            dateTime: connection.dateTime,
            label: connection.label,
            duration: connection.duration,
            startTitle: connection.startTitle,
            endTitle: connection.endTitle
        });

        // 从地图上移除
        connection.polyline.remove();
        if (connection.endCircle) {
            connection.endCircle.remove();
        }
        if (connection.iconMarker) {
            connection.iconMarker.remove();
        }
        if (connection.arrowHead) {
            connection.arrowHead.remove();
        }

        // 从数组中移除
        this.connections = this.connections.filter(conn => conn !== connection);

        // 保存到本地存储
        this.saveToLocalStorage();
    }

    removeMarker(markerData) {
        // 记录删除操作到历史栈
        this.addHistory('removeMarker', {
            id: markerData.id,
            position: [...markerData.position],
            title: markerData.title,
            labels: [...markerData.labels], // 复制数组
            icon: {...markerData.icon}, // 复制对象
            createdAt: markerData.createdAt,
            dateTimes: [...markerData.dateTimes],
            dateTime: markerData.dateTime
        });

        // 删除标记点
        markerData.marker.remove();
        // 标注不再直接显示，无需删除

        // 删除相关连接 - 使用ID进行匹配，而不是对象引用
        this.connections = this.connections.filter(conn => {
            if (conn.startId === markerData.id || conn.endId === markerData.id) {
                conn.polyline.remove();
                if (conn.endCircle) {
                    conn.endCircle.remove();
                }
                if (conn.iconMarker) {
                    conn.iconMarker.remove();
                }
                if (conn.arrowHead) {
                    conn.arrowHead.remove();
                }
                return false;
            }
            return true;
        });

        // 从数组中移除
        this.markers = this.markers.filter(m => m !== markerData);
        this.labels = this.labels.filter(l => l.marker !== markerData);

        this.updateMarkerList();

        // 保存到本地存储
        this.saveToLocalStorage();
    }

    // 检查并处理筛选模式 - 如果处于筛选模式则退出但保持当前视图
    checkAndHandleFilterMode() {
        if (this.filterMode) {
            // 如果日期详情面板是打开的，手动保存内容并关闭面板（防止递归调用）
            const dateNotesInput = document.getElementById('dateNotesInput');
            if (dateNotesInput && this.currentDate) {
                // 手动保存备注内容
                if (!this.dateNotes) {
                    this.dateNotes = {};
                }
                const notes = dateNotesInput.value.trim();
                this.dateNotes[this.currentDate] = notes;

                // 保存到本地存储
                this.saveToLocalStorage();

                // 隐藏日期详情面板
                const dateDetailPanel = document.getElementById('dateDetailPanel');
                if (dateDetailPanel) {
                    dateDetailPanel.style.display = 'none';
                }

                // 清除当前状态
                this.currentDate = null;
                this.currentMarker = null;
                this.currentConnection = null;
            }

            // 退出筛选模式但不调整视图
            this.exitFilterMode(false);
        }
    }

    showMarkerDetail(markerData) {
        // 如果当前处于筛选模式，则退出筛选模式但保持当前视图
        this.checkAndHandleFilterMode();

        // 移动端自动展开侧边栏
        if (this.isMobileDevice()) {
            const rightPanel = document.querySelector('.right-panel');
            const menuToggleBtn = document.getElementById('menuToggleBtn');
            if (rightPanel && menuToggleBtn) {
                rightPanel.classList.add('active');
                menuToggleBtn.textContent = '✕';
            }
        }

        this.currentMarker = markerData;
        this.currentConnection = null;

        // 设置面板标题
        const detailTitle = document.getElementById('detailTitle');
        if (detailTitle) {
            detailTitle.textContent = '标记点详情';
        }

        // 填充详情面板数据
        const markerNameInput = document.getElementById('markerNameInput');
        if (markerNameInput) {
            markerNameInput.value = markerData.title;
            markerNameInput.style.display = 'block';
        }

        // 显示时间点列表（新的多点时间管理）
        this.updateDateTimesDisplay();

        const markerCoords = document.getElementById('markerCoords');
        if (markerCoords) {
            markerCoords.textContent =
                `${markerData.position[1].toFixed(6)}, ${markerData.position[0].toFixed(6)}`;
        }

        // 显示标注内容 - 现在labels是字符串数组
        const labelsContent = markerData.labels.join('; ');
        const markerLabelsInput = document.getElementById('markerLabelsInput');
        if (markerLabelsInput) {
            markerLabelsInput.value = labelsContent || '';
            markerLabelsInput.style.display = 'block';
            // Also update the link preview when showing the detail
            const targetContainer = document.getElementById('markerLabelsLinks');
            this.updateLinkPreview(markerLabelsInput, targetContainer);
        }

        // 插入“相关的线路”列表 ---
        // 1. 查找或创建容器
        let formGroupContainer = document.getElementById('relatedConnectionsFormGroup');
        if (!formGroupContainer) {
            formGroupContainer = document.createElement('div');
            formGroupContainer.id = 'relatedConnectionsFormGroup';
            formGroupContainer.className = 'form-group';

            const connectionsContainer = document.createElement('div');
            connectionsContainer.id = 'relatedConnectionsContainer';
            connectionsContainer.className = 'related-connections-container';
            formGroupContainer.appendChild(connectionsContainer);

            // 插入到“标注内容”输入框的父节点之后
            const labelsInputContainer = document.getElementById('markerLabelsInput').parentNode;
            if (labelsInputContainer) {
                labelsInputContainer.parentNode.insertBefore(formGroupContainer, labelsInputContainer.nextSibling);
            }
        }

        // 2. 清空旧内容并生成新列表
        const connectionsContainer = document.getElementById('relatedConnectionsContainer');
        connectionsContainer.innerHTML = '';

        const relatedConnections = this.connections.filter(
            conn => conn.startId === markerData.id || conn.endId === markerData.id
        );

        if (relatedConnections.length > 0) {
            formGroupContainer.style.display = 'block';
            const title = document.createElement('h4');
            title.className = 'related-connections-title';
            title.textContent = '相关的线路';
            connectionsContainer.appendChild(title);

            relatedConnections.forEach(conn => {
                const item = document.createElement('div');
                item.className = 'related-connection-item';

                const isOutgoing = conn.startId === markerData.id;
                const otherMarkerId = isOutgoing ? conn.endId : conn.startId;
                const otherMarker = this.markers.find(m => m.id === otherMarkerId);
                const otherMarkerName = otherMarker ? otherMarker.title : '未知地点';

                item.innerHTML = `
                    <span class="connection-arrow">${isOutgoing ? '➡️' : '⬅️'}</span>
                    <span class="connection-text">${isOutgoing ? '前往' : '来自'}: <strong>${otherMarkerName}</strong></span>
                    <span class="connection-transport-icon">${this.getTransportIcon(conn.transportType)}</span>
                `;

                item.addEventListener('click', () => {
                    this.showConnectionDetail(conn);
                });

                connectionsContainer.appendChild(item);
            });
        } else {
            formGroupContainer.style.display = 'none';
        }
        // --- “相关的线路”列表逻辑结束 ---

        // 更新当前图标
        this.updateCurrentIconPreview(markerData.icon);

        // 更新 Google Maps 酒店搜索链接
        const hotelSearchSection = document.getElementById('hotelSearchSection');
        const googleHotelsLink = document.getElementById('googleHotelsLink');
        if (hotelSearchSection && googleHotelsLink && markerData.position && markerData.position.length === 2) {
            const lat = markerData.position[0];
            const lon = markerData.position[1];
            googleHotelsLink.href = `https://www.google.com/maps/search/hotels/@${lat},${lon},15z`;
            hotelSearchSection.style.display = 'block';
        } else if (hotelSearchSection) {
            hotelSearchSection.style.display = 'none';
        }

        // 更新小红书链接
        this.updateXiaohongshuLink(markerData);

        // 显示Logo链接
        const markerLogoInput = document.getElementById('markerLogoInput');
        if (markerLogoInput) {
            markerLogoInput.value = markerData.logo || '';

            // --- Logo 预览功能 (优化版) ---
            let previewContainer = document.getElementById('markerLogoPreviewContainer');
            if (!previewContainer) {
                previewContainer = document.createElement('div');
                previewContainer.id = 'markerLogoPreviewContainer';
                previewContainer.className = 'detail-logo-preview-container';
                markerLogoInput.parentNode.insertBefore(previewContainer, markerLogoInput.nextSibling);
            }

            const updatePreview = (url) => {
                const trimmedUrl = url.trim();
                if (trimmedUrl && (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://'))) {
                    // 预加载图片
                    const tempImg = new Image();
                    tempImg.onload = () => {
                        // 加载成功后才显示
                        previewContainer.innerHTML = `<img src="${trimmedUrl}" class="detail-logo-preview-img" alt="Logo Preview">`;
                        previewContainer.style.display = 'block';
                    };
                    tempImg.onerror = () => {
                        // 加载失败则隐藏
                        previewContainer.style.display = 'none';
                    };
                    tempImg.src = trimmedUrl;
                } else {
                    // URL无效或为空则隐藏
                    previewContainer.style.display = 'none';
                }
            };

            // 绑定 change 和 paste 事件
            const handleInputChange = () => {
                updatePreview(markerLogoInput.value);
            };
            markerLogoInput.onchange = handleInputChange;
            markerLogoInput.onpaste = () => {
                // onpaste 后立即触发更新
                setTimeout(handleInputChange, 0);
            };

            // 初始化预览
            updatePreview(markerData.logo || '');
            // --- 预览功能结束 ---
        }

        // 隐藏连接线详情面板，显示标记点详情面板
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.style.display = 'none';
        }
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        if (markerDetailPanel) {
            markerDetailPanel.style.display = 'block';
        }
    }

    hideMarkerDetail() {
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        if (markerDetailPanel) {
            markerDetailPanel.style.display = 'none';
        }
        this.currentMarker = null;
        this.currentConnection = null;
    }

    // 更新时间点显示
    updateDateTimesDisplay() {
        const container = document.getElementById('dateTimesContainer');
        if (!container || !this.currentMarker) return;

        container.innerHTML = '';

        const dateTimes = this.currentMarker.dateTimes || [this.currentMarker.dateTime];

        dateTimes.forEach((dateTime, index) => {
            const timeItem = document.createElement('div');
            timeItem.className = 'date-time-item';

            const timeInput = document.createElement('input');
            timeInput.type = 'datetime-local';
            timeInput.value = this.getLocalDateTimeForInput(dateTime);
            timeInput.addEventListener('change', (e) => {
                this.updateMarkerDateTime(index, e.target.value);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-time-btn';
            deleteBtn.textContent = '删除';
            deleteBtn.addEventListener('click', () => {
                this.deleteMarkerDateTime(index);
            });

            timeItem.appendChild(timeInput);
            if (dateTimes.length > 1) {
                timeItem.appendChild(deleteBtn);
            }

            container.appendChild(timeItem);
        });
    }

    // 更新标记点时间
    updateMarkerDateTime(index, newDateTime) {
        if (!this.currentMarker || !this.currentMarker.dateTimes) return;

        this.currentMarker.dateTimes[index] = newDateTime;
        this.currentMarker.dateTime = this.currentMarker.dateTimes[0]; // 更新主时间

        // 更新显示
        this.updateDateTimesDisplay();
        this.updateMarkerList();

        // 保存到本地存储
        this.saveToLocalStorage();

        console.log(`标记点"${this.currentMarker.title}"时间点${index + 1}已更新: ${newDateTime}`);
    }

    // 删除标记点时间
    async deleteMarkerDateTime(index) {
        if (!this.currentMarker || !this.currentMarker.dateTimes || this.currentMarker.dateTimes.length <= 1) {
            this.showSwalAlert('提示', '至少需要保留一个时间点！', 'warning');
            return;
        }

        const result = await this.showSwalConfirm('删除确认', '确定要删除这个时间点吗？', '删除', '取消');
        if (result.isConfirmed) {
            this.currentMarker.dateTimes.splice(index, 1);
            this.currentMarker.dateTime = this.currentMarker.dateTimes[0]; // 更新主时间

            // 更新显示
            this.updateDateTimesDisplay();
            this.updateMarkerList();

            // 保存到本地存储
            this.saveToLocalStorage();

            console.log(`标记点"${this.currentMarker.title}"时间点已删除，剩余${this.currentMarker.dateTimes.length}个时间点`);
        }
    }

    // 添加新的时间点
    addMarkerDateTime() {
        if (!this.currentMarker) return;

        if (!this.currentMarker.dateTimes) {
            this.currentMarker.dateTimes = [this.currentMarker.dateTime];
        }

        // 获取最后一个时间点，如果没有则使用当前时间
        let lastDateTime = null;
        if (this.currentMarker.dateTimes.length > 0) {
            // 获取最后一个时间点
            lastDateTime = new Date(this.currentMarker.dateTimes[this.currentMarker.dateTimes.length - 1]);
        } else if (this.currentMarker.dateTime) {
            lastDateTime = new Date(this.currentMarker.dateTime);
        }

        let newDateTime;
        if (lastDateTime) {
            // 将时间加一天，并将时分秒设置为00:00:00
            lastDateTime.setDate(lastDateTime.getDate() + 1); // 加一天
            lastDateTime.setHours(0, 0, 0, 0); // 设置为00:00:00
            newDateTime = `${lastDateTime.getFullYear()}-${String(lastDateTime.getMonth() + 1).padStart(2, '0')}-${String(lastDateTime.getDate()).padStart(2, '0')} 00:00:00`;
        } else {
            // 如果没有上一个时间点，使用当前时间
            newDateTime = this.getCurrentLocalDateTime();
        }

        this.currentMarker.dateTimes.push(newDateTime);

        // 更新显示
        this.updateDateTimesDisplay();
        this.updateMarkerList();

        // 保存到本地存储
        this.saveToLocalStorage();

        console.log(`标记点"${this.currentMarker.title}"添加新时间点: ${newDateTime}`);
    }

    hideConnectionDetail() {
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        if (connectionDetailPanel) {
            connectionDetailPanel.style.display = 'none';
        }
        this.currentMarker = null;
        this.currentConnection = null;
    }

    updateConnectionTransport(connection, transportType) {
        if (!connection) return;

        // 更新连接线的交通方式
        connection.transportType = transportType;

        // 更新地图上的连接线
        this.updateConnectionVisual(connection);

        console.log(`连接线交通方式已更新: ${transportType}`);
    }

    updateConnectionVisual(connection) {
        if (!connection || !connection.polyline) return;

        // 通过ID获取当前的起始点和终点对象
        const startMarker = this.markers.find(m => m.id === connection.startId);
        const endMarker = this.markers.find(m => m.id === connection.endId);

        if (!startMarker || !endMarker) {
            console.error('连接线的起始点或终点不存在:', connection.startId, connection.endId);
            return;
        }

        // 更新连接线的坐标
        const startLat = parseFloat(startMarker.position[0]);
        const startLng = parseFloat(startMarker.position[1]);
        const endLat = parseFloat(endMarker.position[0]);
        const endLng = parseFloat(endMarker.position[1]);

        if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
            console.error('连接线坐标无效:', startMarker.position, endMarker.position);
            return;
        }

        // 更新连接线坐标
        const newPath = [
            [startLat, startLng],
            [endLat, endLng]
        ];
        connection.polyline.setLatLngs(newPath);

        // 更新终点圆点位置
        if (connection.endCircle) {
            connection.endCircle.setLatLng([endLat, endLng]);
        }

        // 更新图标位置（中点）
        if (connection.iconMarker) {
            const fallbackMidLat = (startLat + endLat) / 2;
            const fallbackMidLng = (startLng + endLng) / 2;
            const midPos = this.getPointOnConnection(startMarker.position, endMarker.position, 0.5) || [fallbackMidLat, fallbackMidLng];
            connection.iconMarker.setLatLng(midPos);
        }

        // 更新箭头
        if (connection.arrowHead) {
            const newArrow = this.createArrowHead(startMarker.position, endMarker.position, connection.transportType);
            connection.arrowHead.remove();
            connection.arrowHead = newArrow;
            connection.arrowHead.addTo(this.map);
        }

        // 更新线的颜色样式
        const color = this.getTransportColor(connection.transportType);
        connection.polyline.setStyle({
            color: color,
            weight: 6,
            opacity: 1.0
        });

        // 更新终点圆点颜色
        if (connection.endCircle) {
            connection.endCircle.setStyle({
                fillColor: color
            });
        }

        // 更新图标
        if (connection.iconMarker) {
            const icon = this.getTransportIcon(connection.transportType);
            connection.iconMarker.setIcon(L.divIcon({
                html: `<div style="background-color: white; border: 2px solid ${color}; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${icon}</div>`,
                className: 'transport-icon',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            }));
        }

        // 更新详情面板中的显示
        if (this.currentConnection === connection) {
            const markerCoords = document.getElementById('markerCoords');
            if (markerCoords) {
                markerCoords.textContent = `${startMarker.title} → ${endMarker.title} (${this.getTransportIcon(connection.transportType)} ${this.getTransportTypeName(connection.transportType)})`;
            }
        }
    }

    saveConnectionDetail() {
        if (!this.currentConnection) return;

        // 保存连接线详情
        const dateTimeInput = document.getElementById('connectionDateInput');
        if (dateTimeInput && dateTimeInput.value) {
            this.currentConnection.dateTime = dateTimeInput.value;
        }

        // 获取当前选中的交通方式
        const activeTransportBtn = document.querySelector('.transport-btn.active');
        if (activeTransportBtn) {
            this.currentConnection.transportType = activeTransportBtn.dataset.transport;
        }

        // 保存标注内容
        const labelsInput = document.getElementById('connectionLabelsInput');
        if (labelsInput) {
            this.currentConnection.label = labelsInput.value.trim();
        }

        // 保存耗时信息
        const durationInput = document.getElementById('connectionDuration');
        if (durationInput && durationInput.value !== '') {
            this.currentConnection.duration = parseFloat(durationInput.value) || 0;
        }

        // 检查起始点和终点是否被更改
        const startSelect = document.getElementById('connectionStartMarker');
        const endSelect = document.getElementById('connectionEndMarker');

        if (startSelect && endSelect) {
            const newStartIndex = parseInt(startSelect.value);
            const newEndIndex = parseInt(endSelect.value);

            const newStartMarker = this.markers[newStartIndex];
            const newEndMarker = this.markers[newEndIndex];

            // 如果起始点或终点被更改
            const oldStartMarker = this.markers.find(m => m.id === this.currentConnection.startId);
            const oldEndMarker = this.markers.find(m => m.id === this.currentConnection.endId);

            if ((oldStartMarker && oldStartMarker.id !== newStartMarker.id) ||
                (oldEndMarker && oldEndMarker.id !== newEndMarker.id)) {

                // 保存旧的起始点和终点信息，用于显示
                const oldStartTitle = oldStartMarker ? oldStartMarker.title : this.currentConnection.startTitle;
                const oldEndTitle = oldEndMarker ? oldEndMarker.title : this.currentConnection.endTitle;

                // 更新连接线的起始点和终点ID
                this.currentConnection.startId = newStartMarker.id;
                this.currentConnection.endId = newEndMarker.id;
                this.currentConnection.startTitle = newStartMarker.title;
                this.currentConnection.endTitle = newEndMarker.title;

                // 更新连接线在地图上的显示
                this.updateConnectionVisual(this.currentConnection);

                console.log(`连接线更新: ${oldStartTitle} → ${oldEndTitle} 改为 ${newStartMarker.title} → ${newEndMarker.title}`);
            }
        }

        // 更新地图上的连接线显示
        this.updateConnectionVisual(this.currentConnection);

        // 保存Logo链接
        const connectionLogoInput = document.getElementById('connectionLogoInput');
        if (connectionLogoInput) {
            const logoValue = connectionLogoInput.value.trim();
            this.currentConnection.logo = logoValue || null;  // 如果为空则设置为null
        }

        // --- 自动同步日期到标记点 ---
        if (this.currentConnection.dateTime) {
            const startMarker = this.markers.find(m => m.id === this.currentConnection.startId);
            const endMarker = this.markers.find(m => m.id === this.currentConnection.endId);

            [startMarker, endMarker].forEach(marker => {
                this.ensureMarkerDateTime(marker, this.currentConnection.dateTime);
            });
        }

        // 更新连接线列表
        this.updateMarkerList();

        console.log('连接线详情已保存:', this.currentConnection);

        // 关闭详情面板
        // this.hideConnectionDetail(); // 为实时保存而移除

        // 保存到本地存储（移除成功提示）
        this.saveToLocalStorage();
    }

    saveMarkerDetail() {
        if (this.currentMarker) {
            // 保存标记点
            const newName = document.getElementById('markerNameInput').value.trim();
            if (newName) {
                this.currentMarker.title = newName;
                this.currentMarker.marker.setTooltipContent(newName);
            }

            // 保存标注内容 - 只保存文本，不直接显示
            const labelsText = document.getElementById('markerLabelsInput').value.trim();
            if (labelsText) {
                this.currentMarker.labels = labelsText.split(';').map(label => label.trim()).filter(label => label);
            } else {
                this.currentMarker.labels = [];
            }

            // 保存Logo链接
            const markerLogoInput = document.getElementById('markerLogoInput');
            if (markerLogoInput) {
                const logoValue = markerLogoInput.value.trim();
                this.currentMarker.logo = logoValue || null;  // 如果为空则设置为null
            }

            this.updateMarkerList();
        } else if (this.currentConnection) {
            // 保存连接线
            const dateTimeValue = document.getElementById('connectionDateInput').value;
            if (dateTimeValue) {
                this.currentConnection.dateTime = dateTimeValue;
            }

            // 保存耗时
            const durationValue = document.getElementById('connectionDuration').value;
            if (durationValue) {
                this.currentConnection.duration = parseFloat(durationValue);
            }

            // 保存标注内容
            const connectionLabelsInput = document.getElementById('connectionLabelsInput');
            if (connectionLabelsInput) {
                const labelText = connectionLabelsInput.value.trim();
                this.currentConnection.label = labelText;
            }

            // 保存Logo链接
            const connectionLogoInput = document.getElementById('connectionLogoInput');
            if (connectionLogoInput) {
                const logoValue = connectionLogoInput.value.trim();
                this.currentConnection.logo = logoValue || null;  // 如果为空则设置为null
            }
        }

        // this.hideMarkerDetail(); // 为实时保存而移除

        // 保存到本地存储
        this.saveToLocalStorage();
    }

    async deleteCurrentMarker() {
        if (!this.currentMarker) return;

        const result = await this.showSwalConfirm('删除确认', `确定要删除标记点"${this.currentMarker.title}"吗？`, '删除', '取消');
        if (result.isConfirmed) {
            this.removeMarker(this.currentMarker);
            this.hideMarkerDetail();
        }
    }

    async deleteCurrentConnection() {
        if (!this.currentConnection) return;

        const result = await this.showSwalConfirm('删除确认', `确定要删除连接线"${this.currentConnection.startTitle} → ${this.currentConnection.endTitle}"吗？`, '删除', '取消');
        if (result.isConfirmed) {
            this.removeConnection(this.currentConnection);
            this.hideConnectionDetail();
        }
    }

    showHelpModal() {
        document.getElementById('helpModal').style.display = 'block';
    }

    closeHelpModal() {
        document.getElementById('helpModal').style.display = 'none';
    }

    // 删除当前选中的元素（标记点或连接线）
    deleteCurrentElement() {
        if (this.currentMarker) {
            // 如果当前选中的是标记点，执行删除标记点操作
            this.deleteCurrentMarker();
        } else if (this.currentConnection) {
            // 如果当前选中的是连接线，执行删除连接线操作
            this.deleteCurrentConnection();
        }
        // 如果都没有选中，不执行任何操作
    }

    // 显示日期详情
    showDateDetail(date) {
        this.currentDate = date;
        this.currentMarker = null;
        this.currentConnection = null;

        // 设置面板标题
        const dateDetailTitle = document.getElementById('dateDetailTitle');
        if (dateDetailTitle) {
            dateDetailTitle.textContent = `${this.formatDateHeader(date)} 详情`;
        }

        // 显示日期
        const dateDisplay = document.getElementById('dateDisplay');
        if (dateDisplay) {
            dateDisplay.textContent = date;
        }

        // 显示日期备注
        const dateNotesInput = document.getElementById('dateNotesInput');
        if (dateNotesInput) {
            // 如果存在日期备注，显示它；否则显示空字符串
            dateNotesInput.value = this.getDateNotes(date) || '';
        }

        // 渲染消费列表
        this.renderDateExpenses(date);

        // 隐藏其他详情面板，显示日期详情面板
        const markerDetailPanel = document.getElementById('markerDetailPanel');
        const connectionDetailPanel = document.getElementById('connectionDetailPanel');
        const dateDetailPanel = document.getElementById('dateDetailPanel');

        if (markerDetailPanel) markerDetailPanel.style.display = 'none';
        if (connectionDetailPanel) connectionDetailPanel.style.display = 'none';
        if (dateDetailPanel) dateDetailPanel.style.display = 'block';
    }

    // 获取指定日期的备注
    getDateNotes(date) {
        if (!this.dateNotes) {
            this.dateNotes = {};
        }
        const entry = this.dateNotes[date];
        if (typeof entry === 'string') return entry;
        if (entry && entry.notes) return entry.notes;
        return '';
    }

    // 获取指定日期的消费列表
    getDateExpenses(date) {
        if (!this.dateNotes) {
            this.dateNotes = {};
        }
        const entry = this.dateNotes[date];
        if (entry && typeof entry === 'object' && Array.isArray(entry.expenses)) {
            return entry.expenses;
        }
        return [];
    }


    // 更新消费记录
    updateDateExpense(date, index, newCost, newRemark) {
        if (!this.dateNotes || !this.dateNotes[date]) return;

        const entry = this.dateNotes[date];
        if (typeof entry === 'object' && Array.isArray(entry.expenses)) {
            if (index >= 0 && index < entry.expenses.length) {
                entry.expenses[index].cost = parseFloat(newCost) || 0;
                entry.expenses[index].remark = newRemark || '';
                this.saveToLocalStorage();
            }
        }
    }

    renderDateExpenses(date) {
        const list = document.getElementById('dateExpensesList');
        if (!list) return;

        list.innerHTML = '';
        const expenses = this.getDateExpenses(date); // This returns a reference or copy? Let's assume array reference or we modify dateNotes directly

        // Need to ensure we're getting fresh data each render
        // Actually getDateExpenses returns entry.expenses which is a reference to the array inside dateNotes[date]

        if (expenses.length === 0) {
            list.innerHTML = '<li style="color: #999; font-size: 0.9em; text-align: center; padding: 5px;">暂无消费记录</li>';
        } else {
            expenses.forEach((expense, index) => {
                const li = document.createElement('li');
                li.style.display = 'flex';
                li.style.justifyContent = 'space-between';
                li.style.alignItems = 'center';
                li.style.padding = '5px 0';
                li.style.borderBottom = '1px solid #eee';
                // Add cursor pointer to indicate interactivity
                li.style.cursor = 'pointer';
                li.title = '双击编辑';

                // Store data for edit
                li.dataset.index = index;
                li.dataset.cost = expense.cost;
                li.dataset.remark = expense.remark || '';

                li.innerHTML = `
                    <div class="expense-display" style="flex: 1; display: flex; align-items: center; gap: 10px;">
                        <span class="expense-cost" style="font-weight: bold; color: #FF5722;">¥${expense.cost}</span>
                        <span class="expense-remark" style="color: #666; font-size: 0.9em;">${expense.remark || '无备注'}</span>
                    </div>
                    <div class="expense-edit-form" style="display: none; flex: 1; gap: 5px; align-items: center;">
                        <input type="number" class="edit-cost" value="${expense.cost}" step="0.01" style="width: 80px; padding: 2px;">
                        <input type="text" class="edit-remark" value="${expense.remark || ''}" placeholder="备注" style="flex: 1; padding: 2px;">
                        <button class="save-edit-btn" style="background: #4caf50; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 2px 8px;">🆗</button>
                        <button class="cancel-edit-btn" style="background: #9e9e9e; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 2px 8px;">✕</button>
                    </div>
                    <button class="delete-expense-btn" data-index="${index}" style="background: none; border: none; cursor: pointer; color: #999; padding: 0 5px;">✕</button>
                `;

                // Delete button
                li.querySelector('.delete-expense-btn').addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent triggering edit
                    const idx = parseInt(e.target.dataset.index);
                    this.removeDateExpense(date, idx);
                    this.renderDateExpenses(date);
                    this.updateMarkerList();
                });

                // Double click to edit
                li.addEventListener('dblclick', function() {
                    const displayDiv = this.querySelector('.expense-display');
                    const editDiv = this.querySelector('.expense-edit-form');
                    const deleteBtn = this.querySelector('.delete-expense-btn');

                    displayDiv.style.display = 'none';
                    editDiv.style.display = 'flex';
                    deleteBtn.style.display = 'none';
                    this.style.cursor = 'default';
                });

                // Save edit
                li.querySelector('.save-edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const costInput = li.querySelector('.edit-cost');
                    const remarkInput = li.querySelector('.edit-remark');

                    const newCost = costInput.value.trim();
                    const newRemark = remarkInput.value.trim();

                    if (!newCost) {
                        this.showSwalAlert('提示', '请输入金额', 'warning');
                        return;
                    }

                    this.updateDateExpense(date, index, newCost, newRemark);
                    this.renderDateExpenses(date);
                    this.updateMarkerList();
                });

                // Cancel edit
                li.querySelector('.cancel-edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.renderDateExpenses(date); // Simply re-render to reset state
                });

                // Support Enter key to save
                const handleEnter = (e) => {
                    if (e.key === 'Enter') {
                        e.stopPropagation();
                        e.preventDefault();
                        li.querySelector('.save-edit-btn').click();
                    }
                };
                li.querySelector('.edit-cost').addEventListener('keydown', handleEnter);
                li.querySelector('.edit-remark').addEventListener('keydown', handleEnter);

                list.appendChild(li);
            });
        }
    }


    addCurrentDateExpense() {
        if (!this.currentDate) return;

        const costInput = document.getElementById('expenseCostInput');
        const remarkInput = document.getElementById('expenseRemarkInput');

        if (!costInput || !remarkInput) return;

        const cost = costInput.value.trim();
        const remark = remarkInput.value.trim();

        if (!cost) {
            this.showSwalAlert('提示', '请输入金额', 'warning');
            return;
        }

        this.addDateExpense(this.currentDate, cost, remark);

        // Clear inputs
        costInput.value = '';
        remarkInput.value = '';

        // Re-render
        this.renderDateExpenses(this.currentDate);
        this.updateMarkerList(); // Update total in marker list
    }

    // 添加消费记录
    addDateExpense(date, cost, remark) {
        if (!this.dateNotes) this.dateNotes = {};

        let entry = this.dateNotes[date];
        // 如果不存在或为字符串，转换为对象
        if (!entry || typeof entry === 'string') {
            entry = {
                notes: typeof entry === 'string' ? entry : '',
                expenses: []
            };
            this.dateNotes[date] = entry;
        } else if (!entry.expenses) {
            entry.expenses = [];
        }

        entry.expenses.push({
            cost: parseFloat(cost) || 0,
            remark: remark || ''
        });

        this.saveToLocalStorage();
        return entry.expenses;
    }

    // 删除消费记录
    removeDateExpense(date, index) {
        if (!this.dateNotes || !this.dateNotes[date]) return;

        const entry = this.dateNotes[date];
        if (typeof entry === 'object' && Array.isArray(entry.expenses)) {
            if (index >= 0 && index < entry.expenses.length) {
                entry.expenses.splice(index, 1);
                this.saveToLocalStorage();
            }
        }
    }

    // 保存日期备注
    saveDateNotes() {
        const dateNotesInput = document.getElementById('dateNotesInput');
        if (!dateNotesInput || !this.currentDate) return;

        if (!this.dateNotes) {
            this.dateNotes = {};
        }

        const notes = dateNotesInput.value.trim();
        let entry = this.dateNotes[this.currentDate];

        // 升级数据结构为对象，如果它还不是对象
        if (typeof entry === 'string') {
            this.dateNotes[this.currentDate] = {
                notes: notes,
                expenses: []
            };
        } else if (entry && typeof entry === 'object') {
            entry.notes = notes;
        } else {
            // 不存在，创建新对象
            this.dateNotes[this.currentDate] = {
                notes: notes,
                expenses: []
            };
        }

        // 保存到本地存储
        this.saveToLocalStorage();

        // 为实时保存而注释掉以下代码
        /*
        console.log(`日期 ${this.currentDate} 的备注已保存`);

        // 隐藏日期详情面板（自动退出编辑页面）
        const dateDetailPanel = document.getElementById('dateDetailPanel');
        if (dateDetailPanel) {
            dateDetailPanel.style.display = 'none';
        }

        // 清除当前日期状态
        this.currentDate = null;
        this.currentMarker = null;
        this.currentConnection = null;

        // 如果当前处于筛选模式，则退出筛选模式
        if (this.filterMode) {
            this.exitFilterMode();
        }
        */
    }

    closeDateDetail() {
        const dateDetailPanel = document.getElementById('dateDetailPanel');
        if (dateDetailPanel) {
            dateDetailPanel.style.display = 'none';
        }
        this.currentDate = null;
        this.currentMarker = null;
        this.currentConnection = null;

        // 如果当前处于筛选模式，则退出筛选模式
        if (this.filterMode) {
            this.exitFilterMode();
        }
    }

    // SweetAlert2 工具函数
    showSwalAlert(title, text, icon = 'info', position = 'center') {
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
    }

    // SweetAlert2 确认对话框
    showSwalConfirm(title, text, confirmText = '确定', cancelText = '取消') {
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
            return Promise.resolve({ isConfirmed: confirm(text) });
        }
    }

    closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
        // 不再调用 closeDateDetail，因为关闭模态框不应该影响当前选中的标记点或连接
    }

    // 扩大编辑功能
    openExpandModal(type, title) {
        const modal = document.getElementById('expandModal');
        const modalTitle = document.getElementById('expandModalTitle');
        const modalTextarea = document.getElementById('expandModalTextarea');

        if (!modal || !modalTitle || !modalTextarea) {
            console.error('扩大编辑弹窗元素未找到');
            return;
        }

        // 根据类型获取当前文本内容
        let currentContent = '';
        if (type === 'marker' && this.currentMarker) {
            currentContent = this.currentMarker.labels.join('; ') || '';
        } else if (type === 'connection' && this.currentConnection) {
            currentContent = this.currentConnection.label || '';
        } else if (type === 'date' && this.currentDate) {
            currentContent = this.getDateNotes(this.currentDate) || '';
        }

        modalTitle.textContent = title;
        modalTextarea.value = currentContent;

        // 保存当前类型，用于处理输入时识别
        this.expandModalType = type;

        modal.style.display = 'flex';

        // 移除已有的事件监听器（防止重复绑定）
        if (this.expandModalInputHandler) {
            modalTextarea.removeEventListener('input', this.expandModalInputHandler);
        }
        if (this.expandModalPasteHandler) {
            modalTextarea.removeEventListener('paste', this.expandModalPasteHandler);
        }

        // 根据类型绑定相应的粘贴处理函数和输入处理函数
        if (type === 'marker') {
            this.expandModalPasteHandler = (e) => this.handleMarkerLabelsPaste(e);
            this.expandModalInputHandler = () => this.syncExpandModalToMarkerLabels(modalTextarea.value);
        } else if (type === 'connection') {
            this.expandModalPasteHandler = (e) => this.handleConnectionLabelsPaste(e);
            this.expandModalInputHandler = () => this.syncExpandModalToConnectionLabels(modalTextarea.value);
        } else if (type === 'date') {
            this.expandModalPasteHandler = (e) => this.handleDateNotesPaste(e);
            this.expandModalInputHandler = () => this.syncExpandModalToDateNotes(modalTextarea.value);
        }

        // 添加粘贴和输入事件监听器
        modalTextarea.addEventListener('paste', this.expandModalPasteHandler);
        modalTextarea.addEventListener('input', this.expandModalInputHandler);

        // 聚焦到textarea并设置光标到末尾
        setTimeout(() => {
            modalTextarea.focus();
            modalTextarea.setSelectionRange(modalTextarea.value.length, modalTextarea.value.length);
        }, 100);
    }

    // 实时同步扩大弹窗内容到标记点标签
    syncExpandModalToMarkerLabels(content) {
        if (this.currentMarker) {
            this.currentMarker.labels = content.split(';').map(label => label.trim()).filter(label => label);

            // 同步更新原textarea内容
            const markerLabelsInput = document.getElementById('markerLabelsInput');
            if (markerLabelsInput) {
                markerLabelsInput.value = content;
            }

            // 保存到本地存储
            //this.saveToLocalStorage();
        }
    }

    // 实时同步扩大弹窗内容到连接线标签
    syncExpandModalToConnectionLabels(content) {
        if (this.currentConnection) {
            this.currentConnection.label = content;

            // 同步更新原textarea内容
            const connectionLabelsInput = document.getElementById('connectionLabelsInput');
            if (connectionLabelsInput) {
                connectionLabelsInput.value = content;
            }

            // 保存到本地存储
            //this.saveToLocalStorage();
        }
    }

    // 实时同步扩大弹窗内容到日期备注
    syncExpandModalToDateNotes(content) {
        if (this.currentDate) {
            if (!this.dateNotes) {
                this.dateNotes = {};
            }
            this.dateNotes[this.currentDate] = content;

            // 同步更新原textarea内容
            const dateNotesInput = document.getElementById('dateNotesInput');
            if (dateNotesInput) {
                dateNotesInput.value = content;
            }

            // 保存到本地存储
            //this.saveToLocalStorage();
        }
    }

    // 绑定扩大弹窗相关事件
    bindExpandModalEvents() {
        const modal = document.getElementById('expandModal');
        const modalClose = document.querySelector('.expand-modal-close');

        if (!modal || !modalClose) {
            console.error('扩大编辑弹窗元素未找到');
            return;
        }

        // 点击关闭按钮
        modalClose.addEventListener('click', () => {
            this.closeExpandModal();
        });

        // 点击弹窗外部关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeExpandModal();
            }
        });

        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                this.closeExpandModal();
            }
        });
    }

    // 关闭扩大编辑弹窗
    closeExpandModal() {
        const modal = document.getElementById('expandModal');
        if (modal) {
            modal.style.display = 'none';

            // 移除事件监听器
            const modalTextarea = document.getElementById('expandModalTextarea');
            if (modalTextarea && this.expandModalInputHandler && this.expandModalPasteHandler) {
                modalTextarea.removeEventListener('input', this.expandModalInputHandler);
                modalTextarea.removeEventListener('paste', this.expandModalPasteHandler);
            }
        }
    }

    // 更新小红书链接
    updateXiaohongshuLink(data) {
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
    }

    // 配置后端API地址
    configureBackendApi() {
        const currentApi = localStorage.getItem('custom_api_base_url') || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:') ? 'http://127.0.0.1:5436' : window.location.origin);
        const url = prompt(`请输入后端 API 地址 (例如 https://api.example.com)\n当前生效地址: ${currentApi}\n(留空并确认可恢复默认设置)`, localStorage.getItem('custom_api_base_url') || '');

        if (url === null) {
            return; // 用户点击取消
        }

        if (url.trim() === '') {
            localStorage.removeItem('custom_api_base_url');
            alert('已恢复默认后端地址，请刷新页面生效');
        } else {
            localStorage.setItem('custom_api_base_url', url.replace(/\/$/, ''));
            alert('设置成功，请刷新页面生效');
        }
    }

}

// 初始化应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    console.log('RoadbookMaker已加载，支持Ctrl+Z撤销功能');

    app = new RoadbookApp();
    window.app = app; // 使应用实例全局可访问

    // Initialize the HTML exporter module
    if (typeof RoadbookHtmlExporter !== 'undefined' && window.app) {
        window.htmlExporter = new RoadbookHtmlExporter(window.app);
        // HTML导出按钮事件现在在script.js中统一处理
    }

    // 绑定标题双击事件
    const mainTitle = document.getElementById('mainTitle');
    if (mainTitle) {
        mainTitle.addEventListener('dblclick', () => {
            app.configureBackendApi();
        });
    }
});
